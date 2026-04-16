import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
  createBingClient,
  BingApiError,
  parseMsJsonDate,
} from "../src/bing-client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureDir = resolve(__dirname, "fixtures", "synthetic");

const readFixture = (name: string): string =>
  readFileSync(resolve(fixtureDir, name), "utf8");

interface StubResponseInit {
  status?: number;
  body: string;
  contentType?: string;
}

function stubResponse({ status = 200, body, contentType = "application/json" }: StubResponseInit): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": contentType },
  });
}

const noSleep = async (): Promise<void> => {
  // deterministic: no real delay in tests
};

describe("bing-client: bingFetch happy path", () => {
  it("unwraps the OData envelope, strips __type, and parses /Date(ms)/", async () => {
    const fixture = readFixture("get-user-sites-happy.json");
    const client = createBingClient({
      apiKey: "key",
      sleepImpl: noSleep,
      fetchImpl: async () => stubResponse({ body: fixture }),
    });

    const sites = await client.call<Array<Record<string, unknown>>>("GetUserSites");

    expect(Array.isArray(sites)).toBe(true);
    expect(sites).toHaveLength(2);
    expect(sites[0]).not.toHaveProperty("__type");
    expect(sites[0]?.Url).toBe("https://sitefire.ai/");
    expect(sites[0]?.VerifiedDate).toBeInstanceOf(Date);
    expect((sites[0]?.VerifiedDate as Date).toISOString()).toBe(
      new Date(1700000000000).toISOString(),
    );
  });

  it("returns an empty array when Bing responds with { d: [] }", async () => {
    const fixture = readFixture("empty-account.json");
    const client = createBingClient({
      apiKey: "key",
      sleepImpl: noSleep,
      fetchImpl: async () => stubResponse({ body: fixture }),
    });

    const sites = await client.call<unknown[]>("GetUserSites");
    expect(sites).toEqual([]);
  });

  it("parses /Date(ms+TZ)/ independent of host timezone", () => {
    const withTz = parseMsJsonDate("/Date(1705000000000+0000)/");
    const withOffset = parseMsJsonDate("/Date(1705000000000+0530)/");
    const noTz = parseMsJsonDate("/Date(1705000000000)/");

    // All three must parse to the same UTC instant: the +NNNN suffix is
    // informational only in Microsoft-JSON dates.
    expect(withTz?.toISOString()).toBe(new Date(1705000000000).toISOString());
    expect(withOffset?.toISOString()).toBe(new Date(1705000000000).toISOString());
    expect(noTz?.toISOString()).toBe(new Date(1705000000000).toISOString());
  });

  it("leaves ordinary strings untouched", () => {
    expect(parseMsJsonDate("not a date")).toBeUndefined();
    expect(parseMsJsonDate("2024-01-01T00:00:00Z")).toBeUndefined();
  });
});

describe("bing-client: typed errors (HTTP 200 with ErrorCode)", () => {
  it("ErrorCode 3 → kind=InvalidApiKey", async () => {
    const client = createBingClient({
      apiKey: "bad",
      sleepImpl: noSleep,
      fetchImpl: async () =>
        stubResponse({ body: JSON.stringify({ ErrorCode: 3, Message: "Invalid API key." }) }),
    });

    await expect(client.call("GetUserSites")).rejects.toMatchObject({
      name: "BingApiError",
      kind: "InvalidApiKey",
      errorCode: 3,
    });
  });

  it("ErrorCode 14 inside OData d → kind=NotAuthorized", async () => {
    const client = createBingClient({
      apiKey: "key",
      sleepImpl: noSleep,
      fetchImpl: async () =>
        stubResponse({
          body: JSON.stringify({
            d: {
              __type: "ApiError:#Microsoft.Bing.Webmaster.Api",
              ErrorCode: 14,
              Message: "User is not authorized to access this site.",
            },
          }),
        }),
    });

    await expect(client.call("GetQueryStats", { siteUrl: "https://other.example" })).rejects.toMatchObject({
      kind: "NotAuthorized",
      errorCode: 14,
    });
  });

  it("ErrorCode 7 → kind=InvalidUrl (from fixture)", async () => {
    const fixture = readFixture("wrong-site-format.json");
    const client = createBingClient({
      apiKey: "key",
      sleepImpl: noSleep,
      fetchImpl: async () => stubResponse({ body: fixture }),
    });

    await expect(client.call("GetUrlInfo", { url: "not-a-url" })).rejects.toMatchObject({
      kind: "InvalidUrl",
      errorCode: 7,
    });
  });

  it("ErrorCode 2 → kind=DateTimeOrObjectRef", async () => {
    const client = createBingClient({
      apiKey: "key",
      sleepImpl: noSleep,
      fetchImpl: async () =>
        stubResponse({ body: JSON.stringify({ ErrorCode: 2, Message: "Object reference not set." }) }),
    });
    await expect(client.call("GetFoo")).rejects.toMatchObject({ kind: "DateTimeOrObjectRef" });
  });

  it("ErrorCode 16 → kind=Deprecated", async () => {
    const client = createBingClient({
      apiKey: "key",
      sleepImpl: noSleep,
      fetchImpl: async () =>
        stubResponse({ body: JSON.stringify({ ErrorCode: 16, Message: "Deprecated." }) }),
    });
    await expect(client.call("GetRelatedKeywords")).rejects.toMatchObject({ kind: "Deprecated" });
  });

  it("Unknown ErrorCode → kind=Unknown (raw message preserved)", async () => {
    const client = createBingClient({
      apiKey: "key",
      sleepImpl: noSleep,
      fetchImpl: async () =>
        stubResponse({ body: JSON.stringify({ ErrorCode: 999, Message: "Surprise." }) }),
    });
    const err = await client.call("GetFoo").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BingApiError);
    expect((err as BingApiError).kind).toBe("Unknown");
    expect((err as BingApiError).rawMessage).toBe("Surprise.");
  });
});

describe("bing-client: WCF rejections", () => {
  it("200 with HTML body → kind=WcfReject", async () => {
    const fixture = readFixture("wcf-xml-error.html");
    const client = createBingClient({
      apiKey: "key",
      sleepImpl: noSleep,
      fetchImpl: async () =>
        stubResponse({ body: fixture, contentType: "text/html" }),
    });

    await expect(client.call("GetBogus")).rejects.toMatchObject({ kind: "WcfReject" });
  });
});

describe("bing-client: 503 retry-once", () => {
  it("retries once on 503 and returns the second response", async () => {
    let attempts = 0;
    const client = createBingClient({
      apiKey: "key",
      retryDelayMs: 1,
      sleepImpl: noSleep,
      fetchImpl: async () => {
        attempts += 1;
        if (attempts === 1) {
          return stubResponse({ status: 503, body: "Service Unavailable" });
        }
        return stubResponse({ body: JSON.stringify({ d: [] }) });
      },
    });

    const result = await client.call<unknown[]>("GetUserSites");
    expect(result).toEqual([]);
    expect(attempts).toBe(2);
  });

  it("throws HttpFail when both attempts return 503", async () => {
    let attempts = 0;
    const client = createBingClient({
      apiKey: "key",
      retryDelayMs: 1,
      sleepImpl: noSleep,
      fetchImpl: async () => {
        attempts += 1;
        return stubResponse({ status: 503, body: "Service Unavailable" });
      },
    });

    await expect(client.call("GetUserSites")).rejects.toMatchObject({
      kind: "HttpFail",
      httpStatus: 503,
    });
    expect(attempts).toBe(2);
  });
});

describe("bing-client: non-retryable HTTP failures", () => {
  it("throws immediately on HTTP 500 with no body", async () => {
    let attempts = 0;
    const client = createBingClient({
      apiKey: "key",
      sleepImpl: noSleep,
      fetchImpl: async () => {
        attempts += 1;
        return stubResponse({ status: 500, body: "" });
      },
    });

    await expect(client.call("GetUserSites")).rejects.toMatchObject({ kind: "HttpFail" });
    expect(attempts).toBe(1);
  });

  it("surfaces typed error bodies even when HTTP status is not 200", async () => {
    const client = createBingClient({
      apiKey: "key",
      sleepImpl: noSleep,
      fetchImpl: async () =>
        stubResponse({ status: 400, body: JSON.stringify({ ErrorCode: 3, Message: "Bad key" }) }),
    });

    await expect(client.call("GetUserSites")).rejects.toMatchObject({
      kind: "InvalidApiKey",
      httpStatus: 400,
    });
  });
});
