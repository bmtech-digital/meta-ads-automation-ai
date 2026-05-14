import { beforeEach, describe, expect, it } from "vitest";
import {
  _resetCryptoCache,
  decryptToken,
  encryptToken,
  isEncryptionConfigured,
  signOAuthState,
  verifyOAuthState,
} from "./crypto";

// 32-byte all-zero key (test only — never use a static key in prod).
const TEST_KEY = Buffer.alloc(32, 0).toString("base64");

beforeEach(() => {
  process.env.META_ENCRYPTION_KEY_BASE64 = TEST_KEY;
  process.env.META_STATE_SECRET = "test-state-secret-do-not-use-in-prod";
  _resetCryptoCache();
});

describe("encryptToken / decryptToken", () => {
  it("roundtrips a typical Meta access token", () => {
    const token = "EAABwzLix...A long Meta token...ZD";
    const blob = encryptToken(token);
    expect(blob).not.toContain(token);
    expect(decryptToken(blob)).toBe(token);
  });

  it("produces different ciphertext for the same plaintext (fresh IV)", () => {
    const blob1 = encryptToken("hello");
    const blob2 = encryptToken("hello");
    expect(blob1).not.toBe(blob2);
    expect(decryptToken(blob1)).toBe("hello");
    expect(decryptToken(blob2)).toBe("hello");
  });

  it("rejects empty plaintext", () => {
    expect(() => encryptToken("")).toThrow();
  });

  it("rejects tampered ciphertext", () => {
    const blob = encryptToken("important-secret");
    // Flip the last byte of the auth tag (the trailing 16 bytes of the decoded payload).
    const buf = Buffer.from(blob, "base64url");
    buf[buf.length - 1] ^= 0xff;
    const tampered = buf.toString("base64url");
    expect(() => decryptToken(tampered)).toThrow(/authentication failed/);
  });

  it("rejects ciphertext encrypted with a different key", () => {
    const blob = encryptToken("a-token");
    // Rotate to a different key. Old key v1 not retained → decrypt fails.
    process.env.META_ENCRYPTION_KEY_BASE64 = Buffer.alloc(32, 1).toString("base64");
    _resetCryptoCache();
    expect(() => decryptToken(blob)).toThrow();
  });

  it("isEncryptionConfigured returns false when env unset", () => {
    delete process.env.META_ENCRYPTION_KEY_BASE64;
    _resetCryptoCache();
    expect(isEncryptionConfigured()).toBe(false);
  });

  it("rejects key of wrong length", () => {
    process.env.META_ENCRYPTION_KEY_BASE64 = Buffer.alloc(16, 0).toString("base64");
    _resetCryptoCache();
    expect(() => encryptToken("x")).toThrow(/32 bytes/);
  });
});

describe("signOAuthState / verifyOAuthState", () => {
  it("roundtrips a payload", () => {
    const payload = { app_user_id: "u1", business_id: "b1", nonce: "n", ts: 123 };
    const token = signOAuthState(payload);
    expect(verifyOAuthState(token)).toEqual(payload);
  });

  it("rejects tampered body", () => {
    const token = signOAuthState({ x: 1 });
    const [body, mac] = token.split(".");
    const tamperedBody = body.slice(0, -1) + (body.slice(-1) === "A" ? "B" : "A");
    expect(() => verifyOAuthState(`${tamperedBody}.${mac}`)).toThrow(
      /signature mismatch/,
    );
  });

  it("rejects tampered MAC", () => {
    const token = signOAuthState({ x: 1 });
    const [body, mac] = token.split(".");
    const tamperedMac = mac.slice(0, -1) + (mac.slice(-1) === "A" ? "B" : "A");
    expect(() => verifyOAuthState(`${body}.${tamperedMac}`)).toThrow();
  });

  it("rejects malformed token (no dot)", () => {
    expect(() => verifyOAuthState("notatoken")).toThrow(/malformed/);
  });

  it("rejects when state secret changes", () => {
    const token = signOAuthState({ x: 1 });
    process.env.META_STATE_SECRET = "different-secret";
    expect(() => verifyOAuthState(token)).toThrow(/signature mismatch/);
  });
});
