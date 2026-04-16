#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { bingFetch, BingApiError } from "./bing-client.js";
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
  "Which sites are verified under your Bing Webmaster account? Returns all your sites with verification status. Good starting point to see what you have.",
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
  "Is everything configured correctly? Checks your API key, verified sites, sitemaps, and data availability. Run this first if you are new or something is not working.",
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
  "How is your site doing on Bing this week? Shows top queries, top pages, crawl health, crawl issues, and sitemap status. The main dashboard view.",
  { site_url: z.string().describe("Your verified site URL (e.g. https://example.com/)") },
  async ({ site_url }) => {
    const key = requireApiKey();
    const result = await weeklyReport(key, site_url);
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  },
);

// Tool 4: inspect_url
server.tool(
  "inspect_url",
  "What does Bing know about a specific URL? Shows when it was discovered, last crawled, whether it is indexed, and what to do if it is stale or missing.",
  {
    url: z.string().describe("The URL to inspect"),
    site_url: z.string().describe("The verified site this URL belongs to"),
  },
  async ({ url, site_url }) => {
    const key = requireApiKey();
    const result = await inspectUrl(key, url, site_url);
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  },
);

// Tool 5: keyword_opportunity
server.tool(
  "keyword_opportunity",
  "Is a keyword worth writing about for Bing and Copilot users? Shows 12-week impression trend and whether there is demand. Works without owning a site - great for research before creating content.",
  {
    keyword: z.string().describe("The keyword to research"),
    country: z.string().optional().describe("Country code (default: us)"),
    language: z.string().optional().describe("Language code (default: en-US)"),
  },
  async ({ keyword, country, language }) => {
    const key = requireApiKey();
    const result = await keywordOpportunity(key, keyword, country, language);
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  },
);

// Tool 6: push_to_bing
server.tool(
  "push_to_bing",
  "Just published a URL? Tell Bing about it. Submits the URL via the Bing Webmaster API and optionally via IndexNow for faster discovery across all search engines.",
  {
    url: z.string().describe("The URL you just published"),
    site_url: z.string().describe("The verified site this URL belongs to"),
  },
  async ({ url, site_url }) => {
    const key = requireApiKey();
    const result = await pushToBing(key, url, site_url);
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  },
);

// Tool 7: what_are_people_asking
server.tool(
  "what_are_people_asking",
  "What questions bring people to your site from Bing? Filters your search queries to find natural-language questions (5+ words or starting with how, what, why, etc.). Great for content ideas.",
  { site_url: z.string().describe("Your verified site URL") },
  async ({ site_url }) => {
    const key = requireApiKey();
    const result = await whatArePeopleAsking(key, site_url);
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
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
