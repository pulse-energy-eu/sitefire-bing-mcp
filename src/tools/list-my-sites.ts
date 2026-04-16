/**
 * Tool: list_my_sites
 * Answers: "Which sites are under my Bing account?"
 *
 * Pure function over a BingClient. Kept separate from the MCP registration
 * glue so it is straightforward to unit-test with a stub client.
 */

import { z } from "zod";

import type { BingClient } from "../bing-client.js";
import { BingApiError } from "../bing-client.js";
import { translateError } from "../bing-errors.js";

/** One entry in GetUserSites, in our output shape (not Bing's). */
export const SiteEntrySchema = z.object({
  url: z.string(),
  is_verified: z.boolean(),
  verification_method: z.enum(["dns", "meta", "xml", "gsc_import", "unknown"]),
});
export type SiteEntry = z.infer<typeof SiteEntrySchema>;

export const SiteListSchema = z.object({
  sites: z.array(SiteEntrySchema),
  count: z.number().int().nonnegative(),
  next_step: z.string().nullable(),
});
export type SiteList = z.infer<typeof SiteListSchema>;

/** Shape of one entry in Bing's GetUserSites response, limited to fields we read. */
interface RawSite {
  Url?: string;
  IsVerified?: boolean;
  IsDnsVerified?: boolean;
  IsMetaTagVerified?: boolean;
  IsXmlFileVerified?: boolean;
}

const EMPTY_NEXT_STEP =
  "You have no verified sites yet. Run `setup_check` for a step-by-step guide to adding your first one.";

export async function listMySites(client: BingClient): Promise<SiteList> {
  const raw = await client.call<RawSite[]>("GetUserSites");

  // Defensive: if Bing ever returns something other than an array, treat as empty.
  const rows = Array.isArray(raw) ? raw : [];

  const sites: SiteEntry[] = rows.map((row) => ({
    url: typeof row.Url === "string" ? row.Url : "",
    is_verified: row.IsVerified === true,
    verification_method: deriveVerificationMethod(row),
  }));

  return {
    sites,
    count: sites.length,
    next_step: sites.length === 0 ? EMPTY_NEXT_STEP : null,
  };
}

/**
 * The Bing API exposes three explicit verification flags. GSC import is not
 * currently distinguishable from other verified-but-unknown states, so we
 * return "unknown" in that case. See DESIGN.md § list_my_sites.
 */
function deriveVerificationMethod(row: RawSite): SiteEntry["verification_method"] {
  if (row.IsDnsVerified) return "dns";
  if (row.IsMetaTagVerified) return "meta";
  if (row.IsXmlFileVerified) return "xml";
  return "unknown";
}

/**
 * Tool-level wrapper that returns either the structured SiteList payload or a
 * user-facing error string (via translateError). The MCP layer turns this into
 * a CallToolResult with isError set appropriately.
 */
export type ListMySitesOutcome =
  | { ok: true; data: SiteList }
  | { ok: false; message: string };

export async function listMySitesSafe(client: BingClient): Promise<ListMySitesOutcome> {
  try {
    const data = await listMySites(client);
    return { ok: true, data };
  } catch (err) {
    if (err instanceof BingApiError) {
      return { ok: false, message: translateError(err) };
    }
    return { ok: false, message: translateError(err) };
  }
}
