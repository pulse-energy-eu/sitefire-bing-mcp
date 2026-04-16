#!/usr/bin/env tsx
/**
 * scripts/record-fixtures.ts
 *
 * Capture live Bing Webmaster API responses into `test/fixtures/live/` for
 * use as golden inputs to unit tests. Sanitizes sensitive fields per
 * `test/fixtures/REDACTION.md` before writing.
 *
 * Usage:
 *   BING_WEBMASTER_API_KEY=... BING_SITE_URL=https://sitefire.ai/ \
 *     tsx scripts/record-fixtures.ts
 *
 * Optional env:
 *   BING_SAMPLE_URL   — a known-good URL under BING_SITE_URL for GetUrlInfo.
 *                       Defaults to BING_SITE_URL.
 *   BING_SAMPLE_KEYWORD — keyword for GetKeywordStats.
 *                       Defaults to "generative engine optimization".
 *
 * Intentionally one file, one script, no arg parsing. Future-us can split
 * per-endpoint captures out if that ever matters.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createBingClient, BingApiError } from "../src/bing-client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const liveDir = resolve(__dirname, "..", "test", "fixtures", "live");

interface Capture {
  /** Fixture filename (without directory). */
  file: string;
  /** Bing method name. */
  method: string;
  /** Request params. */
  params: Record<string, unknown>;
  /** Path redactions to apply. Each function mutates the payload in place. */
  redact: (payload: unknown) => void;
}

function main(): void {
  const apiKey = requireEnv("BING_WEBMASTER_API_KEY");
  const siteUrl = requireEnv("BING_SITE_URL");
  const sampleUrl = process.env.BING_SAMPLE_URL ?? siteUrl;
  const sampleKeyword = process.env.BING_SAMPLE_KEYWORD ?? "generative engine optimization";

  const client = createBingClient({ apiKey });

  // GetKeywordStats expects a date range; default to the last 12 weeks.
  const today = new Date();
  const twelveWeeksAgo = new Date(today.getTime() - 12 * 7 * 24 * 60 * 60 * 1000);

  const captures: Capture[] = [
    {
      file: "GetUserSites.json",
      method: "GetUserSites",
      params: {},
      redact: redactUserSites,
    },
    {
      file: "GetRankAndTrafficStats.json",
      method: "GetRankAndTrafficStats",
      params: { siteUrl },
      redact: noopRedact,
    },
    {
      file: "GetCrawlStats.json",
      method: "GetCrawlStats",
      params: { siteUrl },
      redact: noopRedact,
    },
    {
      file: "GetQueryStats.json",
      method: "GetQueryStats",
      params: { siteUrl },
      redact: redactQueryStats,
    },
    {
      file: "GetPageStats.json",
      method: "GetPageStats",
      params: { siteUrl },
      redact: redactPageStats,
    },
    {
      file: "GetCrawlIssues.json",
      method: "GetCrawlIssues",
      params: { siteUrl },
      redact: noopRedact,
    },
    {
      file: "GetUrlInfo.json",
      method: "GetUrlInfo",
      params: { siteUrl, url: sampleUrl },
      redact: noopRedact,
    },
    {
      file: "GetKeywordStats.json",
      method: "GetKeywordStats",
      params: {
        q: sampleKeyword,
        country: "us",
        language: "en-US",
        fromDate: toMsJsonDate(twelveWeeksAgo),
        toDate: toMsJsonDate(today),
      },
      redact: noopRedact,
    },
    {
      file: "GetFeeds.json",
      method: "GetFeeds",
      params: { siteUrl },
      redact: noopRedact,
    },
    {
      file: "GetSiteRoles.json",
      method: "GetSiteRoles",
      params: { siteUrl },
      redact: redactSiteRoles,
    },
  ];

  mkdirSync(liveDir, { recursive: true });

  void captureAll(client, captures);
}

async function captureAll(
  client: ReturnType<typeof createBingClient>,
  captures: Capture[],
): Promise<void> {
  for (const capture of captures) {
    try {
      process.stderr.write(`→ ${capture.method}… `);
      const payload = await client.call<unknown>(capture.method, capture.params);
      capture.redact(payload);
      const outPath = resolve(liveDir, capture.file);
      writeFileSync(outPath, JSON.stringify({ d: payload }, null, 2) + "\n", "utf8");
      process.stderr.write(`ok → ${capture.file}\n`);
    } catch (err) {
      if (err instanceof BingApiError) {
        process.stderr.write(`skipped (${err.kind}: ${err.rawMessage})\n`);
      } else {
        process.stderr.write(`FAILED (${(err as Error).message})\n`);
      }
    }
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    process.stderr.write(`Missing required env var: ${name}\n`);
    process.exit(1);
  }
  return value;
}

/**
 * Microsoft-JSON date literal that Bing's older endpoints accept as input.
 * Mirrors the output format bing-client.ts parses on the way back.
 */
function toMsJsonDate(d: Date): string {
  return `/Date(${d.getTime()})/`;
}

// ---------- Redactors ----------

function noopRedact(_payload: unknown): void {
  // Explicit noop — keeps the capture table uniform.
}

function redactUserSites(payload: unknown): void {
  if (!Array.isArray(payload)) return;
  for (const site of payload) {
    if (!isRecord(site)) continue;
    if ("DnsVerificationCode" in site) site.DnsVerificationCode = "REDACTED_DNS_CODE";
    if ("AuthenticationCode" in site) site.AuthenticationCode = "REDACTED_AUTH_CODE";
  }
}

function redactSiteRoles(payload: unknown): void {
  if (!Array.isArray(payload)) return;
  for (const role of payload) {
    if (!isRecord(role)) continue;
    if ("Email" in role) role.Email = "user@example.com";
    if ("DelegatorEmail" in role) role.DelegatorEmail = "delegator@example.com";
  }
}

function redactQueryStats(payload: unknown): void {
  if (!Array.isArray(payload)) return;
  payload.forEach((row, index) => {
    if (!isRecord(row)) return;
    if (typeof row.Query === "string") row.Query = `example query ${index + 1}`;
  });
}

function redactPageStats(payload: unknown): void {
  if (!Array.isArray(payload)) return;
  for (const row of payload) {
    if (!isRecord(row)) continue;
    if (typeof row.Page === "string") {
      row.Page = stripQueryString(row.Page);
    }
  }
}

function stripQueryString(url: string): string {
  const q = url.indexOf("?");
  return q === -1 ? url : url.slice(0, q);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

main();
