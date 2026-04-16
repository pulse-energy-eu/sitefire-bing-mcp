import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { bingFetch, BingApiError, parseBingDate } from "../src/bing-client.js";
import { readFileSync } from "fs";
import { join } from "path";

function fixture(path: string): string {
  return readFileSync(join(__dirname, "fixtures", path), "utf-8");
}

// Mock fetch at module level
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function mockResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  mockFetch.mockReset();
});

describe("bingFetch", () => {
  const apiKey = "test-key";

  it("happy path: returns d payload with __type stripped and dates parsed", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse(fixture("live/GetUserSites.json")),
    );

    const result = await bingFetch({ apiKey, method: "GetUserSites" });

    expect(Array.isArray(result)).toBe(true);
    const sites = result as Array<Record<string, unknown>>;
    expect(sites).toHaveLength(4);
    // __type should be stripped
    expect(sites[0]).not.toHaveProperty("__type");
    expect(sites[0].Url).toBe("https://app.gpt-pulse.com/");
    expect(sites[0].IsVerified).toBe(true);
  });

  it("200 with ErrorCode: throws BingApiError", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse(fixture("synthetic/invalid-api-key.json")),
    );

    await expect(
      bingFetch({ apiKey, method: "GetUserSites" }),
    ).rejects.toThrow(BingApiError);

    try {
      mockFetch.mockResolvedValueOnce(
        mockResponse(fixture("synthetic/invalid-api-key.json")),
      );
      await bingFetch({ apiKey, method: "GetUserSites" });
    } catch (e) {
      expect(e).toBeInstanceOf(BingApiError);
      expect((e as BingApiError).code).toBe("INVALID_API_KEY");
    }
  });

  it("200 with WCF XML: throws BingApiError(WCF_REJECT)", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse(fixture("synthetic/wcf-xml-error.html")),
    );

    await expect(
      bingFetch({ apiKey, method: "BadMethod" }),
    ).rejects.toThrow(BingApiError);

    try {
      mockFetch.mockResolvedValueOnce(
        mockResponse(fixture("synthetic/wcf-xml-error.html")),
      );
      await bingFetch({ apiKey, method: "BadMethod" });
    } catch (e) {
      expect(e).toBeInstanceOf(BingApiError);
      expect((e as BingApiError).code).toBe("WCF_REJECT");
    }
  });

  it("503 transient: retries once and succeeds", async () => {
    mockFetch
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(
        mockResponse(fixture("live/GetUserSites.json")),
      );

    const result = await bingFetch({ apiKey, method: "GetUserSites" });
    expect(Array.isArray(result)).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("503 transient: retries once, still 503, throws HTTP_FAIL", async () => {
    mockFetch
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(new Response("", { status: 503 }));

    await expect(
      bingFetch({ apiKey, method: "GetUserSites" }),
    ).rejects.toThrow(BingApiError);

    // Verify the error code
    mockFetch
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(new Response("", { status: 503 }));

    try {
      await bingFetch({ apiKey, method: "GetUserSites" });
    } catch (e) {
      expect((e as BingApiError).code).toBe("HTTP_FAIL");
      expect((e as BingApiError).message).toContain("temporarily unavailable");
    }
  });

  it("non-retryable 4xx: throws immediately", async () => {
    mockFetch.mockResolvedValueOnce(new Response("Not Found", { status: 404 }));

    try {
      await bingFetch({ apiKey, method: "GetUserSites" });
    } catch (e) {
      expect(e).toBeInstanceOf(BingApiError);
      expect((e as BingApiError).code).toBe("HTTP_FAIL");
      expect((e as BingApiError).message).toContain("404");
    }
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("non-2xx with typed error body: extracts BingApiError", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse(fixture("synthetic/not-authorized.json"), 403),
    );

    try {
      await bingFetch({ apiKey, method: "GetUserSites" });
    } catch (e) {
      expect(e).toBeInstanceOf(BingApiError);
      expect((e as BingApiError).code).toBe("NOT_AUTHORIZED");
    }
  });

  it("malformed JSON response: throws MALFORMED_ERROR", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse("this is not json at all"),
    );

    try {
      await bingFetch({ apiKey, method: "GetUserSites" });
    } catch (e) {
      expect(e).toBeInstanceOf(BingApiError);
      expect((e as BingApiError).code).toBe("MALFORMED_ERROR");
    }
  });

  it("empty 200 response body: throws MALFORMED_ERROR", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(""));

    try {
      await bingFetch({ apiKey, method: "GetUserSites" });
    } catch (e) {
      expect(e).toBeInstanceOf(BingApiError);
      expect((e as BingApiError).code).toBe("MALFORMED_ERROR");
    }
  });

  it("empty d array: returns empty array, not an error", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse(fixture("synthetic/empty-account.json")),
    );

    const result = await bingFetch({ apiKey, method: "GetUserSites" });
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(0);
  });

  it("network error: throws NETWORK_ERROR", async () => {
    mockFetch.mockRejectedValueOnce(new TypeError("fetch failed"));

    try {
      await bingFetch({ apiKey, method: "GetUserSites" });
    } catch (e) {
      expect(e).toBeInstanceOf(BingApiError);
      expect((e as BingApiError).code).toBe("NETWORK_ERROR");
    }
  });

  it("passes params as query parameters", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse(fixture("live/GetUrlInfo.json")),
    );

    await bingFetch({
      apiKey,
      method: "GetUrlInfo",
      params: { siteUrl: "https://sitefire.ai/", url: "https://sitefire.ai/" },
    });

    const calledUrl = new URL(mockFetch.mock.calls[0][0]);
    expect(calledUrl.searchParams.get("siteUrl")).toBe("https://sitefire.ai/");
    expect(calledUrl.searchParams.get("url")).toBe("https://sitefire.ai/");
    expect(calledUrl.searchParams.get("apikey")).toBe("test-key");
  });

  it("POST method sends JSON body", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse('{"d": null}'));

    await bingFetch({
      apiKey,
      method: "SubmitUrlBatch",
      httpMethod: "POST",
      body: { siteUrl: "https://sitefire.ai/", urlList: ["https://sitefire.ai/new"] },
    });

    const fetchCall = mockFetch.mock.calls[0];
    expect(fetchCall[1].method).toBe("POST");
    expect(fetchCall[1].headers["Content-Type"]).toBe("application/json");
  });
});

describe("parseBingDate", () => {
  it("converts /Date(ms)/ to ISO string", () => {
    const result = parseBingDate("/Date(1713225600000)/");
    expect(result).toBe("2024-04-16T00:00:00.000Z");
  });

  it("converts /Date(ms-TZ)/ to ISO string (ignores TZ offset in format)", () => {
    const result = parseBingDate("/Date(1713225600000-0700)/");
    expect(result).toBe("2024-04-16T00:00:00.000Z");
  });

  it("converts /Date(ms+TZ)/ to ISO string", () => {
    const result = parseBingDate("/Date(1713225600000+0200)/");
    expect(result).toBe("2024-04-16T00:00:00.000Z");
  });

  it("returns non-date strings unchanged", () => {
    expect(parseBingDate("hello")).toBe("hello");
  });

  it("returns non-string values unchanged", () => {
    expect(parseBingDate(42)).toBe(42);
    expect(parseBingDate(null)).toBeNull();
    expect(parseBingDate(undefined)).toBeUndefined();
  });

  it("parses dates in nested objects from fixture", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse(fixture("live/GetUrlInfo.json")),
    );
    const result = (await bingFetch({
      apiKey: "test",
      method: "GetUrlInfo",
    })) as Record<string, unknown>;

    // Dates should be ISO strings, not /Date(...)/ format
    expect(result.DiscoveryDate).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.LastCrawledDate).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
