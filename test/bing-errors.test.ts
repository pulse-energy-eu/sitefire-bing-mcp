import { describe, it, expect } from "vitest";

import { BingApiError } from "../src/bing-client.js";
import { translateError } from "../src/bing-errors.js";

describe("bing-errors: translateError", () => {
  it("ErrorCode 3 (InvalidApiKey) → regenerate-key guidance", () => {
    const err = new BingApiError({
      kind: "InvalidApiKey",
      rawMessage: "Invalid API key.",
      errorCode: 3,
    });
    const message = translateError(err);
    expect(message).toContain("Your Bing API key is invalid");
    expect(message).toContain("Settings → API Access");
    expect(message).toContain("restart");
    // Must not leak the raw Bing message or error code.
    expect(message).not.toContain("Invalid API key.");
    expect(message).not.toContain("ErrorCode");
  });

  it("ErrorCode 14 (NotAuthorized) → interpolates site URL and points at setup_check", () => {
    const err = new BingApiError({
      kind: "NotAuthorized",
      rawMessage: "User is not authorized to access this site.",
      errorCode: 14,
    });
    const message = translateError(err, { siteUrl: "https://sitefire.ai/" });
    expect(message).toContain("https://sitefire.ai/");
    expect(message).toContain("setup_check");
    expect(message).toContain("Import from Google Search Console");
  });

  it("ErrorCode 14 without a site URL in context → generic 'that site' phrasing", () => {
    const err = new BingApiError({
      kind: "NotAuthorized",
      rawMessage: "User is not authorized to access this site.",
      errorCode: 14,
    });
    const message = translateError(err);
    expect(message).toContain("that site");
  });

  it("ErrorCode 7 (InvalidUrl) → interpolates URL and points at list_my_sites", () => {
    const err = new BingApiError({
      kind: "InvalidUrl",
      rawMessage: "Invalid site url.",
      errorCode: 7,
    });
    const message = translateError(err, { url: "not-a-url" });
    expect(message).toContain("not-a-url");
    expect(message).toContain("list_my_sites");
  });

  it("ErrorCode 2 (DateTime/ObjectRef) → bug-report message (never blame user)", () => {
    const err = new BingApiError({
      kind: "DateTimeOrObjectRef",
      rawMessage: "Object reference not set to an instance of an object.",
      errorCode: 2,
    });
    const message = translateError(err);
    expect(message).toContain("report");
    expect(message).not.toContain("Object reference");
  });

  it("ErrorCode 16 (Deprecated) → removed-by-Microsoft message", () => {
    const err = new BingApiError({
      kind: "Deprecated",
      rawMessage: "Endpoint deprecated.",
      errorCode: 16,
    });
    const message = translateError(err);
    expect(message).toContain("removed by Microsoft");
  });

  it("WCF reject → 'API bug, not your fault' message", () => {
    const err = new BingApiError({
      kind: "WcfReject",
      rawMessage: "WCF help page returned",
    });
    const message = translateError(err);
    expect(message).toContain("rejected the request shape");
    expect(message).toContain("not your fault");
    expect(message).toContain("report");
  });

  it("HttpFail (503 retried twice) → temporarily-unavailable message", () => {
    const err = new BingApiError({
      kind: "HttpFail",
      rawMessage: "Bing returned 503 twice",
      httpStatus: 503,
    });
    expect(translateError(err)).toContain("temporarily unavailable");
  });

  it("Unknown error kind → preserves raw message for debuggability", () => {
    const err = new BingApiError({
      kind: "Unknown",
      rawMessage: "Some novel failure",
      errorCode: 999,
    });
    const message = translateError(err);
    expect(message).toContain("Some novel failure");
    expect(message).toContain("report");
  });

  it("plain Error → generic message with cause", () => {
    const message = translateError(new Error("fetch failed"));
    expect(message).toContain("fetch failed");
    expect(message).toContain("report");
  });

  it("non-Error value → fully generic message", () => {
    expect(translateError("oops")).toContain("Something went wrong");
    expect(translateError(null)).toContain("Something went wrong");
  });
});
