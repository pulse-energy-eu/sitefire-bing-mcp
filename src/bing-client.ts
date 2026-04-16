/**
 * bing-client: the single HTTP layer for the Bing Webmaster API.
 *
 * Responsibilities:
 *  - OData unwrap: the API wraps every response as { d: <payload> }. Callers
 *    should never see the envelope.
 *  - `__type` scrub: the WCF serializer tags every object with a "__type"
 *    discriminator. We strip it; it is never useful to consumers.
 *  - Microsoft-JSON date parsing: date fields arrive as "/Date(1234567890000)/"
 *    or "/Date(1234567890000+0000)/". We walk the payload and convert them
 *    to native Date objects in place.
 *  - Typed errors: the Bing API returns HTTP 200 with an { ErrorCode, Message }
 *    body to signal failure, and HTML (a WCF help page) when the request shape
 *    is rejected at the framework layer. Both paths throw BingApiError.
 *  - Transient 503: retried once after a short delay. Everything else is
 *    surfaced immediately.
 *
 * The module is framework-agnostic. It is called from tool implementations and
 * from scripts/record-fixtures.ts.
 */

export const BING_API_BASE = "https://ssl.bing.com/webmaster/api.svc/json/";

/** Discriminated kinds of Bing API failure — translated to user-facing text by bing-errors.ts. */
export type BingErrorKind =
  | "InvalidApiKey"
  | "NotAuthorized"
  | "InvalidUrl"
  | "DateTimeOrObjectRef"
  | "Deprecated"
  | "QuotaExhausted"
  | "WcfReject"
  | "HttpFail"
  | "Unknown";

export interface BingApiErrorDetails {
  kind: BingErrorKind;
  /** Raw message as returned by Bing (or a short description for transport failures). */
  rawMessage: string;
  /** Numeric Bing ErrorCode when present. */
  errorCode?: number;
  /** HTTP status of the final response (after any retries). */
  httpStatus?: number;
}

export class BingApiError extends Error {
  readonly kind: BingErrorKind;
  readonly rawMessage: string;
  readonly errorCode?: number;
  readonly httpStatus?: number;

  constructor(details: BingApiErrorDetails) {
    super(details.rawMessage);
    this.name = "BingApiError";
    this.kind = details.kind;
    this.rawMessage = details.rawMessage;
    this.errorCode = details.errorCode;
    this.httpStatus = details.httpStatus;
  }
}

/** Documented Bing error codes. See geo-content/tools/bing-webmaster/README.md. */
export const BING_ERROR_CODES = {
  DATETIME_OR_OBJECT_REF: 2,
  INVALID_API_KEY: 3,
  INVALID_URL: 7,
  NOT_AUTHORIZED: 14,
  DEPRECATED: 16,
} as const;

export function kindFromErrorCode(code: number): BingErrorKind {
  switch (code) {
    case BING_ERROR_CODES.INVALID_API_KEY:
      return "InvalidApiKey";
    case BING_ERROR_CODES.NOT_AUTHORIZED:
      return "NotAuthorized";
    case BING_ERROR_CODES.INVALID_URL:
      return "InvalidUrl";
    case BING_ERROR_CODES.DATETIME_OR_OBJECT_REF:
      return "DateTimeOrObjectRef";
    case BING_ERROR_CODES.DEPRECATED:
      return "Deprecated";
    default:
      return "Unknown";
  }
}

export interface BingClientConfig {
  apiKey: string;
  /** Override for tests. Defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Override for tests. Defaults to `setTimeout`-based sleep. */
  sleepImpl?: (ms: number) => Promise<void>;
  /** Retry delay for the single 503 retry. Default 250ms. */
  retryDelayMs?: number;
  /** Override base URL for tests or staging environments. */
  baseUrl?: string;
}

export interface BingClient {
  /**
   * Call the Bing Webmaster API and return the unwrapped, scrubbed, date-parsed payload.
   * Defaults to GET (most endpoints). Use httpMethod: "POST" for write endpoints like SubmitUrlBatch.
   *
   * @throws BingApiError on any non-success response.
   */
  call<T = unknown>(method: string, params?: Record<string, unknown>, httpMethod?: "GET" | "POST"): Promise<T>;
}

const DEFAULT_RETRY_DELAY_MS = 250;

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export function createBingClient(config: BingClientConfig): BingClient {
  const fetchImpl = config.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error("createBingClient: no fetch implementation available");
  }
  const sleepImpl = config.sleepImpl ?? defaultSleep;
  const retryDelayMs = config.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const baseUrl = config.baseUrl ?? BING_API_BASE;

  async function doRequest(method: string, params: Record<string, unknown>, httpMethod: "GET" | "POST"): Promise<Response> {
    const url = new URL(`${baseUrl}${method}`);
    url.searchParams.set("apikey", config.apiKey);

    if (httpMethod === "GET") {
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, String(value));
      }
      return fetchImpl(url.toString(), {
        method: "GET",
        headers: { Accept: "application/json" },
      });
    }

    return fetchImpl(url.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Accept: "application/json",
      },
      body: JSON.stringify(params),
    });
  }

  async function call<T = unknown>(method: string, params: Record<string, unknown> = {}, httpMethod: "GET" | "POST" = "GET"): Promise<T> {
    let response: Response;
    try {
      response = await doRequest(method, params, httpMethod);
    } catch (err) {
      throw new BingApiError({
        kind: "HttpFail",
        rawMessage: `Network error calling ${method}: ${(err as Error).message}`,
      });
    }

    // 503 → retry once after retryDelayMs, then give up.
    if (response.status === 503) {
      await sleepImpl(retryDelayMs);
      try {
        response = await doRequest(method, params, httpMethod);
      } catch (err) {
        throw new BingApiError({
          kind: "HttpFail",
          rawMessage: `Network error on retry for ${method}: ${(err as Error).message}`,
        });
      }
      if (response.status === 503) {
        throw new BingApiError({
          kind: "HttpFail",
          rawMessage: `Bing returned 503 twice for ${method}`,
          httpStatus: 503,
        });
      }
    }

    return parseResponse<T>(method, response);
  }

  return { call };
}

async function parseResponse<T>(method: string, response: Response): Promise<T> {
  const body = await response.text();

  // WCF rejects a request at the framework layer with an HTML help page.
  // This is distinct from a typed error body and must be surfaced as WcfReject.
  if (body.trimStart().startsWith("<")) {
    throw new BingApiError({
      kind: "WcfReject",
      rawMessage: `Bing returned a WCF help page for ${method} (request shape rejected)`,
      httpStatus: response.status,
    });
  }

  if (!response.ok) {
    // Non-503 HTTP failure with no JSON error body. We still attempt to parse
    // it as a typed error below, but if that fails we fall through to HttpFail.
    const parsed = safeParseJson(body);
    const typed = extractTypedError(parsed);
    if (typed) {
      throw new BingApiError({
        kind: kindFromErrorCode(typed.errorCode),
        rawMessage: typed.message,
        errorCode: typed.errorCode,
        httpStatus: response.status,
      });
    }
    throw new BingApiError({
      kind: "HttpFail",
      rawMessage: `HTTP ${response.status} from Bing for ${method}: ${body.slice(0, 200)}`,
      httpStatus: response.status,
    });
  }

  // Happy path: JSON body. May still carry an error payload (HTTP 200 + ErrorCode).
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (err) {
    throw new BingApiError({
      kind: "HttpFail",
      rawMessage: `Bing returned non-JSON body for ${method}: ${(err as Error).message}`,
      httpStatus: response.status,
    });
  }

  const typed = extractTypedError(parsed);
  if (typed) {
    throw new BingApiError({
      kind: kindFromErrorCode(typed.errorCode),
      rawMessage: typed.message,
      errorCode: typed.errorCode,
      httpStatus: response.status,
    });
  }

  const unwrapped = unwrapOData(parsed);
  return scrubAndParse(unwrapped) as T;
}

function safeParseJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

interface TypedError {
  errorCode: number;
  message: string;
}

/**
 * Bing error bodies are observed in two shapes:
 *   { ErrorCode: 3, Message: "..." }
 *   { d: { ErrorCode: 3, Message: "...", __type: "..." } }
 * Either is treated as an error.
 */
function extractTypedError(raw: unknown): TypedError | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const asRecord = raw as Record<string, unknown>;
  const candidate =
    typeof asRecord.ErrorCode === "number"
      ? asRecord
      : asRecord.d && typeof asRecord.d === "object"
        ? (asRecord.d as Record<string, unknown>)
        : undefined;
  if (!candidate) return undefined;
  if (typeof candidate.ErrorCode !== "number") return undefined;
  return {
    errorCode: candidate.ErrorCode,
    message: typeof candidate.Message === "string" ? candidate.Message : "",
  };
}

/** Strip the `{ d: ... }` OData envelope if present. */
function unwrapOData(raw: unknown): unknown {
  if (raw && typeof raw === "object" && "d" in (raw as Record<string, unknown>)) {
    return (raw as { d: unknown }).d;
  }
  return raw;
}

/**
 * Walk the payload, removing `__type` fields and converting Microsoft-JSON
 * date strings to native Date objects. Array order and object key order are
 * preserved; nothing else is touched.
 */
function scrubAndParse(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => scrubAndParse(item));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, rawValue] of Object.entries(value as Record<string, unknown>)) {
      if (key === "__type") continue;
      out[key] = scrubAndParse(rawValue);
    }
    return out;
  }
  if (typeof value === "string") {
    const parsedDate = parseMsJsonDate(value);
    if (parsedDate) return parsedDate;
  }
  return value;
}

/**
 * Parse Microsoft-JSON date literals: `/Date(1234567890000)/` or
 * `/Date(1234567890000+0200)/`. The offset is informational only; the
 * timestamp is already in UTC milliseconds so we ignore it for construction.
 * Returns undefined for anything else — including ordinary strings.
 */
export function parseMsJsonDate(value: string): Date | undefined {
  const match = /^\/Date\((-?\d+)(?:[+-]\d{4})?\)\/$/.exec(value);
  if (!match) return undefined;
  const ms = Number(match[1]);
  if (!Number.isFinite(ms)) return undefined;
  return new Date(ms);
}
