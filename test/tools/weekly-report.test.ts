import { describe, it, expect, vi, beforeEach } from "vitest";
import { weeklyReport } from "../../src/tools/weekly-report.js";
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

describe("weeklyReport", () => {
  it("happy path: 5 allSettled calls compose into report", async () => {
    mockFetch
      .mockResolvedValueOnce(mockResponse(fixture("live/GetQueryStats.json")))
      .mockResolvedValueOnce(mockResponse(fixture("live/GetPageStats.json")))
      .mockResolvedValueOnce(mockResponse(fixture("live/GetCrawlStats.json")))
      .mockResolvedValueOnce(
        mockResponse(fixture("live/GetCrawlIssues.json")),
      )
      .mockResolvedValueOnce(mockResponse(fixture("live/GetFeeds.json")));

    const result = await weeklyReport("key", "https://sitefire.ai/");

    expect(result.site_url).toBe("https://sitefire.ai/");
    expect(result.is_new_property).toBe(false);
    expect(result.rollup).not.toBeNull();
    expect(result.rollup!.clicks).toBeGreaterThan(0);
    expect(result.top_queries.length).toBeGreaterThan(0);
    expect(result.top_queries.length).toBeLessThanOrEqual(10);
    expect(result.top_pages.length).toBeGreaterThan(0);
    expect(result.crawl_health.status_2xx_count).toBeGreaterThan(0);
    expect(result.crawl_issues.length).toBe(1);
    expect(result.sitemap_count).toBe(1);
    expect(result.partial_failures).toHaveLength(0);
    expect(result.empty_state_guidance).toBeNull();
  });

  it("1-of-5 rejects: partial_failures populated, rest intact", async () => {
    mockFetch
      .mockResolvedValueOnce(mockResponse(fixture("live/GetQueryStats.json")))
      .mockResolvedValueOnce(mockResponse(fixture("live/GetPageStats.json")))
      .mockRejectedValueOnce(new Error("network")) // GetCrawlStats fails
      .mockResolvedValueOnce(
        mockResponse(fixture("live/GetCrawlIssues.json")),
      )
      .mockResolvedValueOnce(mockResponse(fixture("live/GetFeeds.json")));

    const result = await weeklyReport("key", "https://sitefire.ai/");

    expect(result.partial_failures).toContain("GetCrawlStats");
    expect(result.partial_failures).toHaveLength(1);
    // Other sections still populated
    expect(result.top_queries.length).toBeGreaterThan(0);
    expect(result.top_pages.length).toBeGreaterThan(0);
    expect(result.crawl_issues.length).toBe(1);
  });

  it("all empty: is_new_property=true, empty_state_guidance set", async () => {
    const empty = '{"d": []}';
    mockFetch
      .mockResolvedValueOnce(mockResponse(empty))
      .mockResolvedValueOnce(mockResponse(empty))
      .mockResolvedValueOnce(mockResponse(empty))
      .mockResolvedValueOnce(mockResponse(empty))
      .mockResolvedValueOnce(mockResponse(empty));

    const result = await weeklyReport("key", "https://fresh-site.com/");

    expect(result.is_new_property).toBe(true);
    expect(result.rollup).toBeNull();
    expect(result.empty_state_guidance).toContain("48 hours");
    expect(result.empty_state_guidance).toContain("keyword_opportunity");
  });
});
