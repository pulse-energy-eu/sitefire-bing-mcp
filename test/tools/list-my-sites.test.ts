import { describe, it, expect, vi, beforeEach } from "vitest";
import { listMySites } from "../../src/tools/list-my-sites.js";
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

describe("listMySites", () => {
  it("happy path: returns 4 sites from fixture", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse(fixture("live/GetUserSites.json")),
    );

    const result = await listMySites("valid-key");

    expect(result.count).toBe(4);
    expect(result.sites).toHaveLength(4);
    expect(result.sites[0].url).toBe("https://app.gpt-pulse.com/");
    expect(result.sites[0].is_verified).toBe(true);
    expect(result.next_step).toBeNull();
  });

  it("empty sites: returns setup_check pointer", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse(fixture("synthetic/empty-account.json")),
    );

    const result = await listMySites("valid-key");

    expect(result.count).toBe(0);
    expect(result.sites).toHaveLength(0);
    expect(result.next_step).toContain("setup_check");
  });

  it("invalid key: returns error message as next_step", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse(fixture("synthetic/invalid-api-key.json")),
    );

    const result = await listMySites("bad-key");

    expect(result.count).toBe(0);
    expect(result.next_step).toBeTruthy();
    expect(result.next_step).toContain("API key");
  });
});
