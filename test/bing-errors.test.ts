import { describe, it, expect } from "vitest";
import { translateError } from "../src/bing-errors.js";
import { BingApiError } from "../src/bing-client.js";

describe("translateError", () => {
  it("ErrorCode 3: INVALID_API_KEY user message", () => {
    const err = new BingApiError("INVALID_API_KEY", "raw msg", 3);
    const result = translateError(err);
    expect(result.message).toContain("API key is invalid");
    expect(result.message).toContain("bing.com/webmasters");
    expect(result.suggested_tool).toBe("setup_check");
  });

  it("ErrorCode 14: NOT_AUTHORIZED with site URL context", () => {
    const err = new BingApiError("NOT_AUTHORIZED", "raw msg", 14);
    const result = translateError(err, {
      siteUrl: "https://example.com/",
    });
    expect(result.message).toContain("example.com");
    expect(result.message).toContain("not verified");
    expect(result.message).toContain("Import from Google Search Console");
    expect(result.suggested_tool).toBe("setup_check");
  });

  it("ErrorCode 14: NOT_AUTHORIZED without site URL context", () => {
    const err = new BingApiError("NOT_AUTHORIZED", "raw msg", 14);
    const result = translateError(err);
    expect(result.message).toContain("not verified");
    expect(result.suggested_tool).toBe("setup_check");
  });

  it("ErrorCode 7: INVALID_URL with URL context", () => {
    const err = new BingApiError("INVALID_URL", "raw msg", 7);
    const result = translateError(err, {
      url: "https://bad-url.com/page",
    });
    expect(result.message).toContain("bad-url.com");
    expect(result.message).toContain("malformed");
    expect(result.suggested_tool).toBe("list_my_sites");
  });

  it("ErrorCode 2: MALFORMED_ERROR user message", () => {
    const err = new BingApiError("MALFORMED_ERROR", "raw msg", 2);
    const result = translateError(err);
    expect(result.message).toContain("malformed error");
    expect(result.message).toContain("report it");
    expect(result.suggested_tool).toBeNull();
  });

  it("ErrorCode 16: DEPRECATED user message", () => {
    const err = new BingApiError("DEPRECATED", "raw msg", 16);
    const result = translateError(err);
    expect(result.message).toContain("removed by Microsoft");
    expect(result.suggested_tool).toBeNull();
  });

  it("WCF_REJECT user message", () => {
    const err = new BingApiError("WCF_REJECT", "raw msg");
    const result = translateError(err);
    expect(result.message).toContain("rejected the request shape");
    expect(result.message).toContain("report it");
    expect(result.suggested_tool).toBeNull();
  });

  it("non-BingApiError returns generic message", () => {
    const result = translateError(new Error("random"));
    expect(result.message).toContain("unexpected error");
    expect(result.suggested_tool).toBeNull();
  });

  it("non-Error value returns generic message", () => {
    const result = translateError("some string");
    expect(result.message).toContain("unexpected error");
  });
});
