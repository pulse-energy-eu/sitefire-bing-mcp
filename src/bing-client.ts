const BING_API_BASE = "https://ssl.bing.com/webmaster/api.svc/json";

export class BingApiError extends Error {
  constructor(
    public readonly code: BingErrorCode,
    message: string,
    public readonly rawCode?: number,
  ) {
    super(message);
    this.name = "BingApiError";
  }
}

export type BingErrorCode =
  | "INVALID_API_KEY"
  | "NOT_AUTHORIZED"
  | "INVALID_URL"
  | "MALFORMED_ERROR"
  | "DEPRECATED"
  | "WCF_REJECT"
  | "HTTP_FAIL"
  | "NETWORK_ERROR";

const ERROR_CODE_MAP: Record<number, BingErrorCode> = {
  3: "INVALID_API_KEY",
  14: "NOT_AUTHORIZED",
  7: "INVALID_URL",
  2: "MALFORMED_ERROR",
  16: "DEPRECATED",
};

/**
 * Parse Bing's OData date format: /Date(1234567890000-0700)/
 * Returns ISO 8601 string or the original value if not a date.
 */
export function parseBingDate(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const match = value.match(/^\/Date\((\d+)([+-]\d{4})?\)\/$/);
  if (!match) return value;
  return new Date(Number(match[1])).toISOString();
}

/**
 * Recursively walk an object and convert all /Date(ms)/ strings to ISO dates.
 */
function parseDatesDeep(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === "string") return parseBingDate(obj);
  if (Array.isArray(obj)) return obj.map(parseDatesDeep);
  if (typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
      result[key] = parseDatesDeep(val);
    }
    return result;
  }
  return obj;
}

/**
 * Strip OData __type annotations recursively.
 */
function stripODataType(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(stripODataType);
  if (typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
      if (key === "__type") continue;
      result[key] = stripODataType(val);
    }
    return result;
  }
  return obj;
}

interface BingFetchOptions {
  apiKey: string;
  method: string;
  params?: Record<string, string>;
  body?: unknown;
  httpMethod?: "GET" | "POST";
}

/**
 * Core Bing API fetch. Handles:
 * - OData `d` unwrap
 * - /Date(ms)/ parsing
 * - __type stripping
 * - WCF XML detection
 * - Error code translation to BingApiError
 * - 503 retry once after 250ms
 * - Non-retryable HTTP errors
 */
export async function bingFetch(options: BingFetchOptions): Promise<unknown> {
  const { apiKey, method, params, body, httpMethod = "GET" } = options;

  const url = new URL(`${BING_API_BASE}/${method}`);
  url.searchParams.set("apikey", apiKey);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }

  const fetchOptions: RequestInit = { method: httpMethod };
  if (body !== undefined) {
    fetchOptions.headers = { "Content-Type": "application/json" };
    fetchOptions.body = JSON.stringify(body);
  }

  let response: Response;
  try {
    response = await fetch(url.toString(), fetchOptions);
  } catch (err) {
    throw new BingApiError(
      "NETWORK_ERROR",
      "Could not reach the Bing Webmaster API. Check your internet connection and try again.",
    );
  }

  // 503: retry once after 250ms
  if (response.status === 503) {
    await sleep(250);
    try {
      response = await fetch(url.toString(), fetchOptions);
    } catch {
      throw new BingApiError(
        "NETWORK_ERROR",
        "Could not reach the Bing Webmaster API. Check your internet connection and try again.",
      );
    }
    if (response.status === 503) {
      throw new BingApiError(
        "HTTP_FAIL",
        "Bing is temporarily unavailable. Try again in a moment.",
      );
    }
  }

  // Read response body (even on non-2xx, Bing sometimes returns typed errors)
  let text: string;
  try {
    text = await response.text();
  } catch {
    if (!response.ok) {
      throw new BingApiError(
        "HTTP_FAIL",
        `Bing returned HTTP ${response.status}. Try again in a moment.`,
      );
    }
    throw new BingApiError(
      "NETWORK_ERROR",
      "Failed to read response from Bing. Try again.",
    );
  }

  // WCF XML help page detection (Bing returns HTML when params are wrong)
  if (text.trimStart().startsWith("<")) {
    throw new BingApiError(
      "WCF_REJECT",
      "Bing rejected the request shape. This is an API bug, not your fault. Please report it.",
    );
  }

  // Parse JSON, guarding against malformed or empty responses
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text);
  } catch {
    if (!response.ok) {
      throw new BingApiError(
        "HTTP_FAIL",
        `Bing returned HTTP ${response.status}. Try again in a moment.`,
      );
    }
    throw new BingApiError(
      "MALFORMED_ERROR",
      "Bing returned a response that could not be parsed. This is unexpected. Please report it.",
    );
  }

  // Bing sometimes returns error bodies on 200 or on non-2xx
  if (json.ErrorCode !== undefined && json.ErrorCode !== 0) {
    const code = ERROR_CODE_MAP[json.ErrorCode as number] ?? "HTTP_FAIL";
    throw new BingApiError(code, (json.Message as string) ?? "Unknown Bing error", json.ErrorCode as number);
  }

  // If we got valid JSON but the HTTP status was bad and no typed error, generic fail
  if (!response.ok) {
    throw new BingApiError(
      "HTTP_FAIL",
      `Bing returned HTTP ${response.status}. Try again in a moment.`,
    );
  }

  // OData unwrap: response is { d: payload } or { d: [...] }
  const payload = json.d !== undefined ? json.d : json;

  // Strip __type, parse dates
  return parseDatesDeep(stripODataType(payload));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
