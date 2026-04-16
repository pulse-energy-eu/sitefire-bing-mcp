import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { pushToBing } from "../../src/tools/push-to-bing.js";
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

beforeEach(() => {
  mockFetch.mockReset();
});

describe("pushToBing", () => {
  it("both succeed when INDEXNOW_KEY is set", async () => {
    process.env.INDEXNOW_KEY = "test-indexnow-key";
    mockFetch
      // Bing SubmitUrlBatch
      .mockResolvedValueOnce(mockResponse('{"d": null}'))
      // HEAD check for IndexNow key file
      .mockResolvedValueOnce(new Response("", { status: 200 }))
      // IndexNow POST
      .mockResolvedValueOnce(new Response("", { status: 202 }));

    const result = await pushToBing(
      "my-bing-key",
      "https://sitefire.ai/new-post",
      "https://sitefire.ai/",
    );

    expect(result.bing_submit.status).toBe("ok");
    expect(result.indexnow.status).toBe("ok");
    delete process.env.INDEXNOW_KEY;
  });

  it("quota exhausted on Bing side", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse(fixture("synthetic/quota-exhausted.json")),
    );

    const result = await pushToBing(
      "key",
      "https://sitefire.ai/post",
      "https://sitefire.ai/",
    );

    expect(result.bing_submit.status).toBe("quota_exhausted");
    expect(result.bing_submit.message).toContain("quota");
    expect(result.bing_submit.quota_remaining_today).toBe(0);
  });

  it("IndexNow key file 404: falls back to Bing-only", async () => {
    process.env.INDEXNOW_KEY = "test-indexnow-key";
    mockFetch
      // Bing SubmitUrlBatch succeeds
      .mockResolvedValueOnce(mockResponse('{"d": null}'))
      // HEAD check for IndexNow key file - 404
      .mockResolvedValueOnce(new Response("", { status: 404 }));

    const result = await pushToBing(
      "key",
      "https://sitefire.ai/post",
      "https://sitefire.ai/",
    );

    expect(result.bing_submit.status).toBe("ok");
    expect(result.indexnow.status).toBe("key_file_missing");
    expect(result.indexnow.message).toContain("key file not found");
    delete process.env.INDEXNOW_KEY;
  });

  it("no INDEXNOW_KEY: IndexNow skipped, Bing still works", async () => {
    delete process.env.INDEXNOW_KEY;
    mockFetch.mockResolvedValueOnce(mockResponse('{"d": null}'));

    const result = await pushToBing(
      "key",
      "https://sitefire.ai/post",
      "https://sitefire.ai/",
    );

    expect(result.bing_submit.status).toBe("ok");
    expect(result.indexnow.status).toBe("skipped");
    expect(result.indexnow.message).toContain("INDEXNOW_KEY");
    // Only 1 fetch call (Bing), no IndexNow calls
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("URL not under verified site: error from Bing", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse(fixture("synthetic/not-authorized.json")),
    );

    const result = await pushToBing(
      "key",
      "https://other.com/page",
      "https://other.com/",
    );

    expect(result.bing_submit.status).toBe("error");
    expect(result.bing_submit.message).toContain("not verified");
  });

  it("does not use Bing API key for IndexNow", async () => {
    process.env.INDEXNOW_KEY = "separate-indexnow-key";
    mockFetch
      .mockResolvedValueOnce(mockResponse('{"d": null}'))
      .mockResolvedValueOnce(new Response("", { status: 200 }))
      .mockResolvedValueOnce(new Response("", { status: 202 }));

    await pushToBing(
      "my-secret-bing-key",
      "https://sitefire.ai/post",
      "https://sitefire.ai/",
    );

    // HEAD request should use INDEXNOW_KEY, not the Bing API key
    const headUrl = mockFetch.mock.calls[1][0];
    expect(headUrl).toContain("separate-indexnow-key");
    expect(headUrl).not.toContain("my-secret-bing-key");

    // POST body should use INDEXNOW_KEY
    const postBody = JSON.parse(mockFetch.mock.calls[2][1].body);
    expect(postBody.key).toBe("separate-indexnow-key");
    expect(postBody.key).not.toBe("my-secret-bing-key");
    delete process.env.INDEXNOW_KEY;
  });
});
