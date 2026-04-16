import { describe, it, expect, vi, beforeEach } from "vitest";
import { keywordOpportunity } from "../../src/tools/keyword-opportunity.js";
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

describe("keywordOpportunity", () => {
  it("keyword with data: returns trend + direction", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse(fixture("live/GetKeywordStats.json")),
    );

    const result = await keywordOpportunity(
      "key",
      "generative engine optimization",
    );

    expect(result.keyword).toBe("generative engine optimization");
    expect(result.country).toBe("us");
    expect(result.language).toBe("en-US");
    expect(result.weekly_trend.length).toBeGreaterThan(0);
    expect(result.weekly_trend.length).toBeLessThanOrEqual(12);
    expect(result.has_demand).toBe(true);
    expect(result.latest_week_impressions).toBeGreaterThan(0);
  });

  it("keyword with zero impressions: has_demand=false", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse(fixture("synthetic/keyword-zero-demand.json")),
    );

    const result = await keywordOpportunity("key", "xyznonexistentkeyword123");

    expect(result.has_demand).toBe(false);
    expect(result.latest_week_impressions).toBe(0);
  });

  it("invalid key: throws with user message", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse(fixture("synthetic/invalid-api-key.json")),
    );

    await expect(
      keywordOpportunity("bad-key", "test"),
    ).rejects.toThrow("API key");
  });

  it("cross-site capability: does NOT require site_url", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse(fixture("live/GetKeywordStats.json")),
    );

    await keywordOpportunity("key", "generative engine optimization");

    const calledUrl = new URL(mockFetch.mock.calls[0][0]);
    expect(calledUrl.searchParams.has("siteUrl")).toBe(false);
  });

  it("trend direction: increasing data is 'up'", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse(fixture("live/GetKeywordStats.json")),
    );

    const result = await keywordOpportunity("key", "generative engine optimization");
    // Fixture has increasing broad impressions: 1200, 1350, 1400, 1500
    expect(result.trend_direction).toBe("up");
  });
});
