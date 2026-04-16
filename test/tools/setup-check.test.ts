import { describe, it, expect, vi, beforeEach } from "vitest";
import { setupCheck } from "../../src/tools/setup-check.js";
import { readFileSync } from "fs";
import { join } from "path";

function fixture(path: string): string {
  return readFileSync(join(__dirname, "..", "fixtures", path), "utf-8");
}

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function mockResponse(body: string, status = 200): Response {
  return new Response(body, { status });
}

beforeEach(() => mockFetch.mockReset());

describe("setupCheck", () => {
  it("all green: key valid, sites found, sitemap, data, no crawl issues", async () => {
    // GetUserSites, GetFeeds, GetRankAndTrafficStats, GetCrawlIssues
    mockFetch
      .mockResolvedValueOnce(mockResponse(fixture("live/GetUserSites.json")))
      .mockResolvedValueOnce(mockResponse(fixture("live/GetFeeds.json")))
      .mockResolvedValueOnce(
        mockResponse(fixture("live/GetRankAndTrafficStats.json")),
      )
      .mockResolvedValueOnce(mockResponse('{"d": []}'));

    const result = await setupCheck("valid-key", "https://sitefire.ai/");

    expect(result.key_valid).toBe(true);
    expect(result.sites_count).toBe(4);
    expect(result.target_site).toBe("https://sitefire.ai/");
    expect(result.checks.site_verified).toBe("pass");
    expect(result.checks.sitemap_submitted).toBe("pass");
    expect(result.checks.data_available).toBe("pass");
    expect(result.checks.crawl_issues_clean).toBe("pass");
  });

  it("key valid, 0 sites: returns GSC-import pointer", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse(fixture("synthetic/empty-account.json")),
    );

    const result = await setupCheck("valid-key");

    expect(result.key_valid).toBe(true);
    expect(result.sites_count).toBe(0);
    expect(result.checks.site_verified).toBe("fail");
    expect(result.next_actions.some((a) => a.includes("Import from Google Search Console"))).toBe(true);
  });

  it("site verified, no sitemap: includes submit-sitemap action", async () => {
    mockFetch
      .mockResolvedValueOnce(mockResponse(fixture("live/GetUserSites.json")))
      .mockResolvedValueOnce(mockResponse('{"d": []}')) // no feeds
      .mockResolvedValueOnce(
        mockResponse(fixture("live/GetRankAndTrafficStats.json")),
      )
      .mockResolvedValueOnce(mockResponse('{"d": []}'));

    const result = await setupCheck("valid-key", "https://sitefire.ai/");

    expect(result.checks.sitemap_submitted).toBe("fail");
    expect(result.next_actions.some((a) => a.includes("sitemap"))).toBe(true);
  });

  it("site verified, data pending: includes keyword_opportunity pointer", async () => {
    mockFetch
      .mockResolvedValueOnce(mockResponse(fixture("live/GetUserSites.json")))
      .mockResolvedValueOnce(mockResponse(fixture("live/GetFeeds.json")))
      .mockResolvedValueOnce(mockResponse('{"d": []}')) // no traffic data
      .mockResolvedValueOnce(mockResponse('{"d": []}'));

    const result = await setupCheck("valid-key", "https://sitefire.ai/");

    expect(result.checks.data_available).toBe("pending_48h");
    expect(result.next_actions.some((a) => a.includes("keyword_opportunity"))).toBe(true);
  });

  it("target_site inference: single site, no site_url param", async () => {
    const singleSite = {
      d: [{ __type: "Site", Url: "https://sitefire.ai/", IsVerified: true }],
    };
    mockFetch
      .mockResolvedValueOnce(mockResponse(JSON.stringify(singleSite)))
      .mockResolvedValueOnce(mockResponse(fixture("live/GetFeeds.json")))
      .mockResolvedValueOnce(
        mockResponse(fixture("live/GetRankAndTrafficStats.json")),
      )
      .mockResolvedValueOnce(mockResponse('{"d": []}'));

    const result = await setupCheck("valid-key");

    expect(result.target_site).toBe("https://sitefire.ai/");
  });

  it("invalid key: returns immediately with error", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse(fixture("synthetic/invalid-api-key.json")),
    );

    const result = await setupCheck("bad-key");

    expect(result.key_valid).toBe(false);
    expect(result.next_actions[0]).toContain("API key");
  });
});
