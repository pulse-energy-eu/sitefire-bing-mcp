import { describe, it, expect, vi, beforeEach } from "vitest";
import { inspectUrl } from "../../src/tools/inspect-url.js";
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

describe("inspectUrl", () => {
  it("recent crawl: state=fresh", async () => {
    // Build a fixture with LastCrawledDate set to yesterday
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const freshFixture = {
      d: {
        __type: "UrlInfo",
        Url: "https://sitefire.ai/",
        IsPage: true,
        DateDiscovered: `/Date(${yesterday.getTime() - 86400000})/`,
        LastCrawledDate: `/Date(${yesterday.getTime()})/`,
        AnchorCount: 12,
        DocumentSize: 34521,
        HttpStatus: 200,
      },
    };
    mockFetch.mockResolvedValueOnce(
      mockResponse(JSON.stringify(freshFixture)),
    );

    const result = await inspectUrl(
      "key",
      "https://sitefire.ai/",
      "https://sitefire.ai/",
    );

    expect(result.is_page).toBe(true);
    expect(result.interpretation.state).toBe("fresh");
    expect(result.crawl_age_days).toBeLessThanOrEqual(2);
  });

  it("stale crawl (>60 days): state=stale", async () => {
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const staleFixture = {
      d: {
        __type: "UrlInfo",
        Url: "https://sitefire.ai/old-page",
        IsPage: true,
        DateDiscovered: `/Date(${ninetyDaysAgo.getTime() - 86400000})/`,
        LastCrawledDate: `/Date(${ninetyDaysAgo.getTime()})/`,
        AnchorCount: 3,
        DocumentSize: 12000,
        HttpStatus: 200,
      },
    };
    mockFetch.mockResolvedValueOnce(
      mockResponse(JSON.stringify(staleFixture)),
    );

    const result = await inspectUrl(
      "key",
      "https://sitefire.ai/old-page",
      "https://sitefire.ai/",
    );

    expect(result.interpretation.state).toBe("stale");
    expect(result.crawl_age_days).toBeGreaterThan(60);
    expect(result.interpretation.recommended_action).toContain("push_to_bing");
  });

  it("IsPage=false, never crawled: state=never_crawled + push_to_bing", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse(fixture("synthetic/url-info-never-crawled.json")),
    );

    const result = await inspectUrl(
      "key",
      "https://sitefire.ai/blog/nonexistent-post",
      "https://sitefire.ai/",
    );

    expect(result.is_page).toBe(false);
    expect(result.interpretation.state).toBe("never_crawled");
    expect(result.interpretation.recommended_action).toContain("push_to_bing");
  });

  it("URL not under site: throws BingApiError", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse(fixture("synthetic/not-authorized.json")),
    );

    await expect(
      inspectUrl("key", "https://other.com/page", "https://other.com/"),
    ).rejects.toThrow("NotAuthorized");
  });
});
