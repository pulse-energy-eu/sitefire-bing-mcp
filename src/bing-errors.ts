import { BingApiError, type BingErrorCode } from "./bing-client.js";

interface UserError {
  message: string;
  suggested_tool: string | null;
}

const ERROR_MESSAGES: Record<BingErrorCode, (ctx?: ErrorContext) => UserError> = {
  INVALID_API_KEY: () => ({
    message:
      "Your Bing API key is invalid. Regenerate it at bing.com/webmasters, then go to Settings and API Access.",
    suggested_tool: "setup_check",
  }),
  NOT_AUTHORIZED: (ctx) => ({
    message: ctx?.siteUrl
      ? `The site "${ctx.siteUrl}" is not verified under your Bing account. Run setup_check to see your verified sites, or go to bing.com/webmasters and Import from Google Search Console.`
      : "This site is not verified under your Bing account. Run setup_check to see your verified sites, or go to bing.com/webmasters and Import from Google Search Console.",
    suggested_tool: "setup_check",
  }),
  INVALID_URL: (ctx) => ({
    message: ctx?.url
      ? `The URL "${ctx.url}" is malformed or does not belong to any of your verified sites. Run list_my_sites to see what you have.`
      : "The URL is malformed or does not belong to any of your verified sites. Run list_my_sites to see what you have.",
    suggested_tool: "list_my_sites",
  }),
  MALFORMED_ERROR: () => ({
    message:
      "Bing returned a malformed error for this request. This is a known issue with some older endpoints; this tool should not have hit it. Please report it.",
    suggested_tool: null,
  }),
  DEPRECATED: () => ({
    message: "This capability was removed by Microsoft.",
    suggested_tool: null,
  }),
  WCF_REJECT: () => ({
    message:
      "Bing rejected the request shape. This is an API bug, not your fault. Please report it.",
    suggested_tool: null,
  }),
  HTTP_FAIL: () => ({
    message: "Bing is temporarily unavailable. Try again in a moment.",
    suggested_tool: null,
  }),
  NETWORK_ERROR: () => ({
    message:
      "Could not reach the Bing Webmaster API. Check your internet connection and try again.",
    suggested_tool: null,
  }),
};

export interface ErrorContext {
  siteUrl?: string;
  url?: string;
}

/**
 * Translate a BingApiError into a user-facing message with optional suggested tool.
 * If the error is not a BingApiError, returns a generic message.
 */
export function translateError(
  error: unknown,
  context?: ErrorContext,
): UserError {
  if (error instanceof BingApiError) {
    const handler = ERROR_MESSAGES[error.code];
    return handler(context);
  }

  return {
    message:
      "An unexpected error occurred while talking to Bing. Try again, and if it persists, please report it.",
    suggested_tool: null,
  };
}
