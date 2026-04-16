#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { bingFetch, BingApiError } from "./bing-client.js";
import { translateError } from "./bing-errors.js";
import { listMySites } from "./tools/list-my-sites.js";
import { setupCheck } from "./tools/setup-check.js";
import { weeklyReport } from "./tools/weekly-report.js";
import { inspectUrl } from "./tools/inspect-url.js";
import { keywordOpportunity } from "./tools/keyword-opportunity.js";
import { pushToBing } from "./tools/push-to-bing.js";
import { whatArePeopleAsking } from "./tools/what-are-people-asking.js";

const VERSION = "0.1.0";

function log(msg: string): void {
  process.stderr.write(`[sitefire-bing-mcp] ${msg}\n`);
}

function getApiKey(): string {
  return process.env.BING_WEBMASTER_API_KEY ?? "";
}

function requireApiKey(): string {
  const key = getApiKey();
  if (!key) {
    throw new Error(
      "BING_WEBMASTER_API_KEY is not set. Add it to your Claude Desktop config and restart.",
    );
  }
  return key;
}

type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

function errorResult(error: unknown): ToolResult {
  const { message, suggested_tool } = translateError(error);
  const text = suggested_tool
    ? `${message} Try running ${suggested_tool}.`
    : message;
  return {
    content: [{ type: "text" as const, text }],
    isError: true,
  };
}

async function startupCheck(): Promise<void> {
  const key = getApiKey();

  if (!key) {
    log(
      "BING_WEBMASTER_API_KEY not set. The MCP will start but all tools will return setup guidance.",
    );
    return;
  }

  try {
    const result = await Promise.race([
      bingFetch({ apiKey: key, method: "GetUserSites" }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 3000),
      ),
    ]);
    const sites = result as unknown[];

    const verified = sites.filter(
      (s) => (s as Record<string, unknown>).IsVerified,
    );
    log(
      `v${VERSION} - connected. ${verified.length} verified site(s) found.`,
    );
  } catch (err) {
    if (err instanceof BingApiError && err.code === "INVALID_API_KEY") {
      log(
        "Your API key is invalid. Tools will route you to setup_check. Fix the key in your Claude Desktop config and restart.",
      );
    } else {
      log(
        "Could not reach Bing to validate the key. Tools will retry on first invocation.",
      );
    }
  }
}

const server = new McpServer({
  name: "sitefire-bing-mcp",
  version: VERSION,
});

// Tool 1: list_my_sites
server.tool(
  "list_my_sites",
  "Lists all sites in the user's Bing Webmaster account with verification status. Use when the user asks 'what sites do I have?' or 'which sites are verified?' Present results as a compact table (site URL, verified yes/no). Keep your response under 80 words.",
  {},
  async () => {
    const key = getApiKey();
    if (!key) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              sites: [],
              count: 0,
              next_step:
                "BING_WEBMASTER_API_KEY is not set. Add it to your Claude Desktop config and restart.",
            }),
          },
        ],
      };
    }
    const result = await listMySites(key);
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  },
);

// Tool 2: setup_check
server.tool(
  "setup_check",
  "Diagnoses configuration health: API key validity, site verification, sitemap submission, and data availability. Use when the user is setting up for the first time or something is broken. Show a checklist of pass/fail items and list any required next actions. Do not explain what each check means unless asked.",
  { site_url: z.string().optional().describe("Optional: check a specific site URL") },
  async ({ site_url }) => {
    const key = getApiKey();
    if (!key) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              key_valid: false,
              sites_count: 0,
              sites: [],
              target_site: null,
              checks: {
                site_verified: "n/a",
                sitemap_submitted: "n/a",
                data_available: "n/a",
                crawl_issues_clean: "n/a",
              },
              next_actions: [
                "BING_WEBMASTER_API_KEY is not set. Add it to your Claude Desktop config and restart.",
              ],
            }),
          },
        ],
      };
    }
    const result = await setupCheck(key, site_url);
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  },
);

// Tool 3: weekly_report
server.tool(
  "weekly_report",
  "Weekly Bing performance snapshot: top queries, top pages, crawl health, crawl issues, and sitemap status. Use when the user asks 'how is my site doing?' or wants a performance overview. Lead with the key numbers (clicks, impressions, crawl errors) in a compact table, then list top queries and pages as short bullet lists. Keep it under 150 words unless the user asks for detail.",
  { site_url: z.string().describe("Your verified site URL (e.g. https://example.com/)") },
  async ({ site_url }) => {
    try {
      const key = requireApiKey();
      const result = await weeklyReport(key, site_url);
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    } catch (err) {
      return errorResult(err);
    }
  },
);

// Tool 4: inspect_url
server.tool(
  "inspect_url",
  "Checks indexing status for a single URL: discovery date, last crawl, index status, and HTTP code. Use when the user asks 'is this page indexed?' or 'why is my page not showing up?' Show the status fields as a short key-value list. Only suggest next actions if the URL has a problem.",
  {
    url: z.string().describe("The URL to inspect"),
    site_url: z.string().describe("The verified site this URL belongs to"),
  },
  async ({ url, site_url }) => {
    try {
      const key = requireApiKey();
      const result = await inspectUrl(key, url, site_url);
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    } catch (err) {
      return errorResult(err);
    }
  },
);

// Tool 5: keyword_opportunity
server.tool(
  "keyword_opportunity",
  "Evaluates search demand for a keyword on Bing: 12-week impression trend and volume signal. Does not require owning a site. Use when the user asks 'is this keyword worth targeting?' or 'how much demand is there for X?' Show the verdict (worth it or not) first, then the trend as a compact sparkline or short table. Keep your response under 100 words.",
  {
    keyword: z.string().describe("The keyword to research"),
    country: z.string().optional().describe("Country code (default: us)"),
    language: z.string().optional().describe("Language code (default: en-US)"),
  },
  async ({ keyword, country, language }) => {
    try {
      const key = requireApiKey();
      const result = await keywordOpportunity(key, keyword, country, language);
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    } catch (err) {
      return errorResult(err);
    }
  },
);

// Tool 6: push_to_bing
server.tool(
  "push_to_bing",
  "Submits a URL to Bing for crawling (and optionally via IndexNow for all search engines). Use when the user says 'I just published a page' or 'submit this URL to Bing.' Confirm success or failure in one sentence. Do not explain the submission process.",
  {
    url: z.string().describe("The URL you just published"),
    site_url: z.string().describe("The verified site this URL belongs to"),
  },
  async ({ url, site_url }) => {
    try {
      const key = requireApiKey();
      const result = await pushToBing(key, url, site_url);
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    } catch (err) {
      return errorResult(err);
    }
  },
);

// Tool 7: what_are_people_asking
server.tool(
  "what_are_people_asking",
  "Extracts question-style search queries that bring traffic to your site from Bing (e.g. 'how to...', 'what is...', 'why does...'). Use when the user wants content ideas or asks 'what are people searching for?' Present results as a numbered list of questions sorted by impressions. Keep your response under 150 words.",
  { site_url: z.string().describe("Your verified site URL") },
  async ({ site_url }) => {
    try {
      const key = requireApiKey();
      const result = await whatArePeopleAsking(key, site_url);
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    } catch (err) {
      return errorResult(err);
    }
  },
);

async function main(): Promise<void> {
  await startupCheck();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  log(`Fatal: ${err}`);
  process.exit(1);
});
