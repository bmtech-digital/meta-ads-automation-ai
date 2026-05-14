import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
  createHmac,
} from "node:crypto";

/**
 * AES-256-GCM token encryption — per `docs/plans/meta-integration-readiness.md` §4.
 *
 * Used for at-rest encryption of long-lived Meta tokens before they touch
 * Postgres. The DB sees only the ciphertext blob; tokens never appear in
 * SQL logs, backups, or query traces.
 *
 * Key sourcing follows the project pattern (decisions-log §1.1):
 *   - Dev: `META_ENCRYPTION_KEY_BASE64` env var loaded from `.env`.
 *   - Prod: Cloud Run injects the same env var from GCP Secret Manager
 *     (`meta-encryption-key-v1`) via `--update-secrets`.
 *
 * Storage format (base64url-encoded):
 *
 *     [1 byte key_version][12 bytes IV][N bytes ciphertext][16 bytes tag]
 *
 * key_version lets us rotate the key without a flag day — when a new
 * version is introduced, old ciphertexts still decrypt with their original
 * key (kept in `META_ENCRYPTION_KEY_BASE64_V<n>`). New encryptions always
 * use the latest. v1 is current.
 */

const ALGO = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const CURRENT_KEY_VERSION = 1;

let cachedKeys: Map<number, Buffer> | null = null;

function loadKeyVersions(): Map<number, Buffer> {
  if (cachedKeys) return cachedKeys;
  const out = new Map<number, Buffer>();
  // Current key.
  const primary =
    process.env.META_ENCRYPTION_KEY_BASE64 ??
    process.env[`META_ENCRYPTION_KEY_BASE64_V${CURRENT_KEY_VERSION}`];
  if (!primary) {
    throw new Error(
      "META_ENCRYPTION_KEY_BASE64 is not set — in dev, run " +
        '[Convert]::ToBase64String((1..32 | %{Get-Random -Maximum 256})) ' +
        "and add to .env. In prod, Cloud Run should inject from GCP Secret " +
        "Manager (`meta-encryption-key-v1`).",
    );
  }
  const primaryBuf = Buffer.from(primary, "base64");
  if (primaryBuf.length !== KEY_BYTES) {
    throw new Error(
      `META_ENCRYPTION_KEY_BASE64 must decode to ${KEY_BYTES} bytes; got ${primaryBuf.length}`,
    );
  }
  out.set(CURRENT_KEY_VERSION, primaryBuf);

  // Older key versions (post-rotation). Look for V1..V(current-1).
  for (let v = 1; v < CURRENT_KEY_VERSION; v++) {
    const older = process.env[`META_ENCRYPTION_KEY_BASE64_V${v}`];
    if (!older) continue;
    const buf = Buffer.from(older, "base64");
    if (buf.length !== KEY_BYTES) {
      throw new Error(
        `META_ENCRYPTION_KEY_BASE64_V${v} must decode to ${KEY_BYTES} bytes`,
      );
    }
    out.set(v, buf);
  }

  cachedKeys = out;
  return out;
}

/**
 * Reset the cached key store. Tests only — production callers should not need
 * this because the env is set once at boot.
 */
export function _resetCryptoCache(): void {
  cachedKeys = null;
}

/**
 * Encrypt `plaintext` with the current key version. Returns a base64url
 * string suitable for direct DB storage. Each call uses a fresh IV.
 */
export function encryptToken(plaintext: string): string {
  if (typeof plaintext !== "string" || plaintext.length === 0) {
    throw new Error("encryptToken: plaintext must be a non-empty string");
  }
  const keys = loadKeyVersions();
  const key = keys.get(CURRENT_KEY_VERSION);
  if (!key) {
    // loadKeyVersions guarantees this entry exists; defensive only.
    throw new Error("encryptToken: current key version not loaded");
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  const versionByte = Buffer.from([CURRENT_KEY_VERSION]);
  const packed = Buffer.concat([versionByte, iv, ct, tag]);
  return packed.toString("base64url");
}

/**
 * Decrypt a blob produced by `encryptToken`. Reads the key_version prefix to
 * pick the right key (supports rotation). Throws on tampering or wrong key.
 */
export function decryptToken(packed: string): string {
  if (typeof packed !== "string" || packed.length === 0) {
    throw new Error("decryptToken: input must be a non-empty string");
  }
  const buf = Buffer.from(packed, "base64url");
  if (buf.length < 1 + IV_BYTES + TAG_BYTES) {
    throw new Error("decryptToken: input too short");
  }
  const version = buf[0];
  const iv = buf.subarray(1, 1 + IV_BYTES);
  const tag = buf.subarray(buf.length - TAG_BYTES);
  const ct = buf.subarray(1 + IV_BYTES, buf.length - TAG_BYTES);

  const keys = loadKeyVersions();
  const key = keys.get(version);
  if (!key) {
    throw new Error(
      `decryptToken: unknown key_version=${version} — set META_ENCRYPTION_KEY_BASE64_V${version}`,
    );
  }
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  try {
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    return pt.toString("utf8");
  } catch {
    throw new Error("decryptToken: authentication failed (tampered or wrong key)");
  }
}

/** Convenience: returns true if the env is configured for the current key. */
export function isEncryptionConfigured(): boolean {
  try {
    loadKeyVersions();
    return true;
  } catch {
    return false;
  }
}

// ---- OAuth state HMAC helpers ------------------------------------------

/**
 * Sign an OAuth state payload with HMAC-SHA256. Used to make the `state`
 * query param tamper-evident — Meta bounces it back, we verify the signature
 * matches a payload we'd produce.
 *
 * Separate secret from the encryption key (`META_STATE_SECRET`) because the
 * threat model differs:
 *   - encryption key: leaks → attacker decrypts stored tokens (high impact)
 *   - state secret: leaks → attacker forges CSRF state (medium impact)
 *
 * Independent rotation is useful.
 */
const STATE_HMAC_SECRET_ENV = "META_STATE_SECRET";

function getStateSecret(): Buffer {
  const s = process.env[STATE_HMAC_SECRET_ENV];
  if (!s) {
    throw new Error(
      `${STATE_HMAC_SECRET_ENV} is not set — generate with ` +
        "openssl rand -hex 32 and add to .env / Secret Manager.",
    );
  }
  return Buffer.from(s, "utf8");
}

/**
 * Sign and pack an OAuth state payload. Format:
 *
 *     base64url(json) + "." + base64url(hmac)
 *
 * Caller is responsible for persisting `state` to `meta_oauth_state` table
 * with TTL and single-use semantics — HMAC alone doesn't prevent replay.
 */
export function signOAuthState(payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  const mac = createHmac("sha256", getStateSecret())
    .update(body)
    .digest()
    .toString("base64url");
  return `${body}.${mac}`;
}

/**
 * Verify an OAuth state token. Returns the parsed payload if valid, throws
 * otherwise. Constant-time MAC comparison.
 */
export function verifyOAuthState<T = Record<string, unknown>>(
  state: string,
): T {
  const parts = state.split(".");
  if (parts.length !== 2) {
    throw new Error("verifyOAuthState: malformed token");
  }
  const [body, mac] = parts;
  const expectedMac = createHmac("sha256", getStateSecret())
    .update(body)
    .digest();
  const actualMac = Buffer.from(mac, "base64url");
  if (
    actualMac.length !== expectedMac.length ||
    !timingSafeEqual(actualMac, expectedMac)
  ) {
    throw new Error("verifyOAuthState: signature mismatch");
  }
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T;
  } catch {
    throw new Error("verifyOAuthState: invalid payload encoding");
  }
}
