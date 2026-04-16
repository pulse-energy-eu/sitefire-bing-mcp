import { describe, it, expect, vi, beforeEach } from "vitest";
import { whatArePeopleAsking } from "../../src/tools/what-are-people-asking.js";
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

describe("whatArePeopleAsking", () => {
  it("filter correctness: matches long queries and question words", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse(fixture("live/GetQueryStats.json")),
    );

    const result = await whatArePeopleAsking("key", "https://sitefire.ai/");

    expect(result.total_queries_seen).toBe(5);
    // Should match:
    // - "how to improve geo visibility for my website" (question word + 7 words)
    // - "what is generative engine optimization" (question word + 5 words)
    // - "is" queries would match if first word is "is"
    // Should NOT match: "sitefire ai" (2 words, no question word), "geo seo tools" (3 words), "bing webmaster api" (3 words)
    expect(result.matched_count).toBe(2);
    expect(
      result.natural_language_queries.some((q) =>
        q.query.includes("how to improve"),
      ),
    ).toBe(true);
    expect(
      result.natural_language_queries.some((q) =>
        q.query.includes("what is generative"),
      ),
    ).toBe(true);
  });

  it("empty site: returns zero matches", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse('{"d": []}'));

    const result = await whatArePeopleAsking("key", "https://fresh-site.com/");

    expect(result.total_queries_seen).toBe(0);
    expect(result.matched_count).toBe(0);
    expect(result.natural_language_queries).toHaveLength(0);
  });

  it("honest note is always present", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse(fixture("live/GetQueryStats.json")),
    );

    const result = await whatArePeopleAsking("key", "https://sitefire.ai/");

    expect(result.note).toContain("filtered view");
    expect(result.note).toContain("GetQueryStats");
  });

  it("invalid site: throws with translateError message", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse(fixture("synthetic/not-authorized.json")),
    );

    await expect(
      whatArePeopleAsking("key", "https://other.com/"),
    ).rejects.toThrow("not verified");
  });
});
