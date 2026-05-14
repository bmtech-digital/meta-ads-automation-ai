import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import {
  exchangeCodeForToken,
  extendToLongLivedToken,
  debugToken,
  getMe,
  getGrantedScopes,
  getMyPages,
  getMyAdAccounts,
  getInstagramAccountForPage,
  parseSignedRequest,
  MetaGraphError,
} from "./meta-graph";

const APP_SECRET = "test-app-secret";

// ---- fetch mocking helper -------------------------------------------------

interface MockedResponse {
  status?: number;
  body: unknown;
}

function mockFetchOnce(mocked: MockedResponse) {
  return vi.fn(async () => ({
    ok: (mocked.status ?? 200) < 400,
    status: mocked.status ?? 200,
    json: async () => mocked.body,
  })) as unknown as typeof fetch;
}

function mockFetchByPath(byPath: Record<string, MockedResponse>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : (input as Request).url ?? String(input);
    for (const [pathPart, mocked] of Object.entries(byPath)) {
      if (url.includes(pathPart)) {
        return {
          ok: (mocked.status ?? 200) < 400,
          status: mocked.status ?? 200,
          json: async () => mocked.body,
        };
      }
    }
    throw new Error(`unmocked path: ${url}`);
  }) as unknown as typeof fetch;
}

const originalFetch = global.fetch;

beforeEach(() => {
  // Restore between tests.
  global.fetch = originalFetch;
});

afterEach(() => {
  global.fetch = originalFetch;
});

// ---- Token exchange -------------------------------------------------------

describe("exchangeCodeForToken", () => {
  it("parses the short-lived token + expiry", async () => {
    global.fetch = mockFetchOnce({
      body: { access_token: "short-token", token_type: "bearer", expires_in: 3600 },
    });
    const result = await exchangeCodeForToken({
      appId: "1",
      appSecret: "s",
      redirectUri: "https://x/cb",
      code: "c",
    });
    expect(result.token).toBe("short-token");
    expect(result.expiresAt).toBeGreaterThan(Date.now());
  });

  it("throws MetaGraphError on Meta error envelope", async () => {
    global.fetch = mockFetchOnce({
      status: 400,
      body: {
        error: {
          message: "Invalid code",
          code: 100,
          type: "OAuthException",
          error_subcode: 1234,
          fbtrace_id: "abc",
        },
      },
    });
    await expect(
      exchangeCodeForToken({
        appId: "1",
        appSecret: "s",
        redirectUri: "https://x/cb",
        code: "bad",
      }),
    ).rejects.toBeInstanceOf(MetaGraphError);
  });
});

describe("extendToLongLivedToken", () => {
  it("returns long-lived token", async () => {
    global.fetch = mockFetchOnce({
      body: { access_token: "long-token", token_type: "bearer", expires_in: 60 * 24 * 3600 },
    });
    const result = await extendToLongLivedToken({
      appId: "1",
      appSecret: "s",
      shortLivedToken: "short",
    });
    expect(result.token).toBe("long-token");
    expect(result.expiresAt).toBeGreaterThan(Date.now() + 30 * 24 * 3600 * 1000);
  });
});

// ---- Introspection --------------------------------------------------------

describe("debugToken", () => {
  it("converts seconds to ms + maps fields", async () => {
    const futureSec = Math.floor(Date.now() / 1000) + 1000;
    global.fetch = mockFetchOnce({
      body: {
        data: {
          app_id: "app-1",
          is_valid: true,
          expires_at: futureSec,
          data_access_expires_at: futureSec - 100,
          scopes: ["public_profile", "ads_read"],
          user_id: "user-1",
        },
      },
    });
    const info = await debugToken({
      appId: "app-1",
      appSecret: "s",
      inputToken: "t",
    });
    expect(info.isValid).toBe(true);
    expect(info.userId).toBe("user-1");
    expect(info.scopes).toContain("ads_read");
    expect(info.expiresAtMs).toBe(futureSec * 1000);
  });

  it("handles missing optional fields", async () => {
    global.fetch = mockFetchOnce({
      body: {
        data: { app_id: "x", is_valid: false, expires_at: 0 },
      },
    });
    const info = await debugToken({ appId: "x", appSecret: "s", inputToken: "t" });
    expect(info.isValid).toBe(false);
    expect(info.userId).toBeNull();
    expect(info.scopes).toEqual([]);
  });
});

// ---- Profile + scopes -----------------------------------------------------

describe("getMe / getGrantedScopes", () => {
  it("returns id + name", async () => {
    global.fetch = mockFetchOnce({ body: { id: "u1", name: "Test" } });
    const me = await getMe("t");
    expect(me).toEqual({ id: "u1", name: "Test" });
  });

  it("filters granted scopes only", async () => {
    global.fetch = mockFetchOnce({
      body: {
        data: [
          { permission: "ads_read", status: "granted" },
          { permission: "instagram_basic", status: "declined" },
          { permission: "pages_show_list", status: "granted" },
        ],
      },
    });
    const scopes = await getGrantedScopes("t");
    expect(scopes).toEqual(["ads_read", "pages_show_list"]);
  });

  it("debugToken surfaces granular_scopes from the data envelope", async () => {
    global.fetch = mockFetchOnce({
      body: {
        data: {
          app_id: "app",
          is_valid: true,
          expires_at: Math.floor(Date.now() / 1000) + 1000,
          granular_scopes: [
            { scope: "ads_read", target_ids: ["act_1"] },
            { scope: "pages_show_list" },
          ],
        },
      },
    });
    const info = await debugToken({ appId: "app", appSecret: "s", inputToken: "t" });
    expect(info.granularScopes).toHaveLength(2);
    expect(info.granularScopes[0].target_ids).toEqual(["act_1"]);
  });
});

// ---- Assets ---------------------------------------------------------------

describe("getMyPages", () => {
  it("normalizes Page rows with defaults", async () => {
    global.fetch = mockFetchOnce({
      body: {
        data: [
          {
            id: "p1",
            name: "Page One",
            access_token: "page-tok-1",
            category: "Business",
            tasks: ["ADMIN", "ADVERTISE"],
          },
          {
            id: "p2",
            name: "Page Two",
            access_token: "page-tok-2",
            // missing category + tasks
          },
        ],
      },
    });
    const pages = await getMyPages("t");
    expect(pages).toHaveLength(2);
    expect(pages[0].tasks).toContain("ADMIN");
    expect(pages[1].category).toBeNull();
    expect(pages[1].tasks).toEqual([]);
  });
});

describe("getMyAdAccounts", () => {
  it("translates Meta `user_tasks` to numeric role (MANAGE=1, ADVERTISE=2, ANALYZE=3)", async () => {
    global.fetch = mockFetchOnce({
      body: {
        data: [
          {
            id: "act_1",
            name: "Manager Account",
            currency: "ILS",
            timezone_name: "Asia/Jerusalem",
            user_tasks: ["MANAGE", "ADVERTISE", "ANALYZE"],
            business: { id: "bm-1" },
          },
          {
            id: "act_2",
            user_tasks: ["ADVERTISE", "ANALYZE"],
          },
          {
            id: "act_3",
            user_tasks: ["ANALYZE"],
          },
          { id: "act_4" }, // no tasks → null
        ],
      },
    });
    const accounts = await getMyAdAccounts("t");
    expect(accounts[0].user_role).toBe(1);
    expect(accounts[0].business_id).toBe("bm-1");
    expect(accounts[1].user_role).toBe(2);
    expect(accounts[2].user_role).toBe(3);
    expect(accounts[3].user_role).toBeNull();
    expect(accounts[3].tasks).toEqual([]);
  });
});

describe("getInstagramAccountForPage", () => {
  it("returns ig info when present", async () => {
    global.fetch = mockFetchOnce({
      body: {
        instagram_business_account: { id: "ig-1", username: "@test" },
      },
    });
    const ig = await getInstagramAccountForPage({
      pageId: "p1",
      pageAccessToken: "pt",
    });
    expect(ig).toEqual({ ig_user_id: "ig-1", username: "@test" });
  });

  it("returns null when no IG linked", async () => {
    global.fetch = mockFetchOnce({ body: {} });
    const ig = await getInstagramAccountForPage({
      pageId: "p1",
      pageAccessToken: "pt",
    });
    expect(ig).toBeNull();
  });
});

// ---- Signed request -------------------------------------------------------

function makeSignedRequest(payload: Record<string, unknown>, secret: string): string {
  const payloadJson = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  const sig = createHmac("sha256", secret).update(payloadJson).digest("base64url");
  return `${sig}.${payloadJson}`;
}

describe("parseSignedRequest", () => {
  it("roundtrips a valid request", () => {
    const sr = makeSignedRequest(
      { user_id: "u1", issued_at: 1234, algorithm: "HMAC-SHA256" },
      APP_SECRET,
    );
    const out = parseSignedRequest(sr, APP_SECRET);
    expect(out.user_id).toBe("u1");
    expect(out.issued_at).toBe(1234);
  });

  it("rejects tampered payload", () => {
    const sr = makeSignedRequest(
      { user_id: "u1", algorithm: "HMAC-SHA256" },
      APP_SECRET,
    );
    const [sig, payload] = sr.split(".");
    const tampered = `${sig}.${payload.slice(0, -1)}X`;
    expect(() => parseSignedRequest(tampered, APP_SECRET)).toThrow(
      /signature mismatch/,
    );
  });

  it("rejects wrong secret", () => {
    const sr = makeSignedRequest(
      { user_id: "u1", algorithm: "HMAC-SHA256" },
      APP_SECRET,
    );
    expect(() => parseSignedRequest(sr, "different-secret")).toThrow(
      /signature mismatch/,
    );
  });

  it("rejects malformed input (no dot)", () => {
    expect(() => parseSignedRequest("notatoken", APP_SECRET)).toThrow(
      /malformed/,
    );
  });

  it("rejects wrong algorithm field", () => {
    const sr = makeSignedRequest(
      { user_id: "u1", algorithm: "RS256" },
      APP_SECRET,
    );
    expect(() => parseSignedRequest(sr, APP_SECRET)).toThrow(/algorithm/);
  });

  it("rejects missing user_id", () => {
    const sr = makeSignedRequest({ algorithm: "HMAC-SHA256" }, APP_SECRET);
    expect(() => parseSignedRequest(sr, APP_SECRET)).toThrow(/user_id/);
  });
});

// ---- Mocked end-to-end OAuth callback shape -------------------------------

describe("Graph client (composed)", () => {
  it("can sequence the calls used by /api/meta/oauth/callback", async () => {
    global.fetch = mockFetchByPath({
      "oauth/access_token": {
        body: { access_token: "long-token", expires_in: 60 * 24 * 3600 },
      },
      debug_token: {
        body: {
          data: {
            app_id: "app",
            is_valid: true,
            expires_at: Math.floor(Date.now() / 1000) + 1000,
            scopes: ["public_profile"],
            user_id: "u1",
          },
        },
      },
      "me/permissions": {
        body: { data: [{ permission: "public_profile", status: "granted" }] },
      },
      "me/accounts": {
        body: {
          data: [
            {
              id: "p1",
              name: "P",
              access_token: "pt",
              category: "Business",
              tasks: ["ADMIN"],
            },
          ],
        },
      },
      "me/adaccounts": {
        body: {
          data: [
            {
              id: "act_1",
              name: "A",
              currency: "ILS",
              user_tasks: ["ADVERTISE", "ANALYZE"],
            },
          ],
        },
      },
      "/me": { body: { id: "u1", name: "User" } },
    });

    const long = await extendToLongLivedToken({
      appId: "app",
      appSecret: "s",
      shortLivedToken: "short",
    });
    expect(long.token).toBe("long-token");

    const debug = await debugToken({
      appId: "app",
      appSecret: "s",
      inputToken: long.token,
    });
    expect(debug.isValid).toBe(true);

    const me = await getMe(long.token);
    expect(me.id).toBe("u1");

    const scopes = await getGrantedScopes(long.token);
    expect(scopes).toContain("public_profile");

    const pages = await getMyPages(long.token);
    expect(pages[0].id).toBe("p1");

    const accounts = await getMyAdAccounts(long.token);
    expect(accounts[0].user_role).toBe(2);
  });
});
