#!/usr/bin/env node
/**
 * sitefire-bing-mcp entry point.
 *
 * Responsibilities:
 *  - Read BING_WEBMASTER_API_KEY from env (soft-warn if missing; we continue
 *    so the user can still reach `setup_check` when it lands).
 *  - Perform a startup validation call (GetUserSites, 3s timeout) and emit
 *    one of three stderr banners: connected / invalid-key / unreachable.
 *    Critically, we do NOT hard-fail on invalid key. See DESIGN.md §
 *    Startup behavior for why.
 *  - Register the walking-skeleton tool set and connect to stdio.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import {
  createBingClient,
  BingApiError,
  type BingClient,
} from "./bing-client.js";
import {
  listMySitesSafe,
  SiteEntrySchema,
} from "./tools/list-my-sites.js";

const SERVER_NAME = "sitefire-bing-mcp";
const SERVER_VERSION = "0.1.0";
const STARTUP_TIMEOUT_MS = 3_000;

const SETUP_CHECK_GUIDANCE =
  "Run `setup_check` to see your verified sites, or set BING_WEBMASTER_API_KEY in your Claude Desktop config and restart Claude.";

function banner(message: string): void {
  // stderr only; stdout is reserved for JSON-RPC over stdio.
  process.stderr.write(`[${SERVER_NAME} v${SERVER_VERSION}] ${message}\n`);
}

async function validateStartup(client: BingClient | null): Promise<void> {
  if (!client) {
    banner(
      "BING_WEBMASTER_API_KEY not set. The MCP will start but all tools will return setup guidance.",
    );
    return;
  }

  try {
    const sites = await withTimeout(
      client.call<unknown[]>("GetUserSites"),
      STARTUP_TIMEOUT_MS,
    );
    const count = Array.isArray(sites) ? sites.length : 0;
    banner(`connected. ${count} verified site${count === 1 ? "" : "s"} found.`);
  } catch (err) {
    if (err instanceof BingApiError && err.kind === "InvalidApiKey") {
      banner(
        "Your API key is invalid. Tools will route you to setup_check. Fix the key in your Claude Desktop config and restart.",
      );
      return;
    }
    banner(
      `Could not reach Bing to validate the key (${(err as Error).message}). Tools will retry on first invocation.`,
    );
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`timed out after ${ms}ms`));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

function buildClient(): BingClient | null {
  const apiKey = process.env.BING_WEBMASTER_API_KEY;
  if (!apiKey) return null;
  return createBingClient({ apiKey });
}

function registerTools(server: McpServer, client: BingClient | null): void {
  // ------- list_my_sites -------
  const listMySitesOutputSchema = {
    sites: z.array(SiteEntrySchema),
    count: z.number().int().nonnegative(),
    next_step: z.string().nullable(),
  };

  server.registerTool(
    "list_my_sites",
    {
      description:
        "List all sites under your Bing Webmaster account, with verification status. Start here to confirm which properties are available.",
      inputSchema: {},
      outputSchema: listMySitesOutputSchema,
      annotations: {
        title: "List my Bing-verified sites",
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async () => {
      if (!client) {
        return toolErrorResult(SETUP_CHECK_GUIDANCE);
      }
      const outcome = await listMySitesSafe(client);
      if (!outcome.ok) {
        return toolErrorResult(outcome.message);
      }
      return {
        content: [{ type: "text" as const, text: JSON.stringify(outcome.data, null, 2) }],
        structuredContent: outcome.data as unknown as Record<string, unknown>,
      };
    },
  );
}

function toolErrorResult(message: string): {
  content: Array<{ type: "text"; text: string }>;
  isError: true;
} {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

async function main(): Promise<void> {
  const client = buildClient();
  await validateStartup(client);

  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  registerTools(server, client);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  // Surfaces catastrophic failures (transport or SDK-level). Tool failures
  // are handled per-tool and do not reach here.
  process.stderr.write(
    `[${SERVER_NAME}] fatal: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
