/**
 * bing-errors: translate BingApiError (and other thrown values) into a single
 * user-facing sentence that tells the user what to do next.
 *
 * The MCP's audience is non-technical. Every message:
 *  - avoids raw error codes and API jargon
 *  - names the next concrete action (usually the MCP tool that resolves it)
 *  - never blames the user when the fault is on Bing's side
 *
 * The mapping table lives in DESIGN.md under "Error translation table" and is
 * the authoritative spec for this module.
 */

import { BingApiError, type BingErrorKind } from "./bing-client.js";

export interface TranslateContext {
  /** Site URL the caller was acting on, if any. Used to interpolate NotAuthorized. */
  siteUrl?: string;
  /** URL the caller was acting on, if any. Used to interpolate InvalidUrl. */
  url?: string;
}

/**
 * Convert any thrown value into a user-facing sentence.
 *
 * Unknown shapes fall back to a generic sentence that tells the user to try
 * again and include the raw message for debuggability. This is the only branch
 * that may expose raw Bing text.
 */
export function translateError(err: unknown, context: TranslateContext = {}): string {
  if (err instanceof BingApiError) {
    return translateKind(err.kind, err.rawMessage, context);
  }
  if (err instanceof Error) {
    return `Something went wrong while talking to Bing: ${err.message}. If this keeps happening, please report it.`;
  }
  return "Something went wrong while talking to Bing. If this keeps happening, please report it.";
}

function translateKind(
  kind: BingErrorKind,
  rawMessage: string,
  context: TranslateContext,
): string {
  switch (kind) {
    case "InvalidApiKey":
      return "Your Bing API key is invalid. Regenerate it at bing.com/webmasters → Settings → API Access, then paste the new key into your Claude Desktop config and restart Claude.";

    case "NotAuthorized": {
      const site = context.siteUrl ? `\`${context.siteUrl}\`` : "that site";
      return `The site ${site} is not verified under your Bing account. Run \`setup_check\` to see your verified sites, or go to bing.com/webmasters and use Import from Google Search Console to add it.`;
    }

    case "InvalidUrl": {
      const url = context.url ? `\`${context.url}\`` : "that URL";
      return `The URL ${url} is malformed or does not belong to any of your verified sites. Run \`list_my_sites\` to see what you have.`;
    }

    case "DateTimeOrObjectRef":
      return "Bing returned a malformed error for this request. This is a known issue with some older endpoints; this tool should not have hit it. Please report it.";

    case "Deprecated":
      return "This capability was removed by Microsoft and is no longer available through the Bing Webmaster API.";

    case "WcfReject":
      return "Bing rejected the request shape. This is an API bug, not your fault. Please report it.";

    case "QuotaExhausted":
      return "You have hit your daily Bing submission quota. Try again tomorrow after the quota resets.";

    case "HttpFail":
      return "Bing is temporarily unavailable. Try again in a moment.";

    case "Unknown":
    default:
      return `Bing returned an unexpected error: ${rawMessage || "no details"}. If this keeps happening, please report it.`;
  }
}
