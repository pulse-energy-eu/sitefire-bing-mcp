# sitefire-bing-mcp

Local stdio MCP server wrapping the Bing Webmaster API for Claude Desktop.
Seven composite tools, 59 tests, live-validated against 4 verified sites.

## Build and test

```bash
npm install       # install deps
npx tsc           # build to dist/
npx vitest run    # 59 tests, <2s
```

## Bing Webmaster API: GET vs POST

The Bing Webmaster API is a WCF JSON service. Read endpoints (GetUserSites,
GetUrlInfo, GetKeywordStats, GetQueryStats, GetPageStats, GetCrawlStats,
GetCrawlIssues, GetFeeds, GetRankAndTrafficStats) accept only GET requests
with parameters as query strings. Sending POST to a read endpoint returns an
HTML "help page" from the WCF framework (HTTP 200, no JSON).

Write endpoints (SubmitUrlBatch) use POST with a JSON body.

`bing-client.ts` defaults to GET. Pass `httpMethod: "POST"` explicitly for
write endpoints.

## Architecture

- `src/bing-client.ts` - HTTP layer: OData unwrap, `__type` scrub, `/Date(ms)/` parsing, 503 retry, typed errors
- `src/bing-errors.ts` - Maps BingApiError codes to user-facing sentences with suggested next tools
- `src/tools/*.ts` - One file per MCP tool (7 tools, pure functions)
- `src/index.ts` - MCP server, stdio transport, tool registration with annotations, error wrapping
- `test/fixtures/live/` - Captured from real Bing API, sanitized per REDACTION.md
- `test/fixtures/synthetic/` - Hand-crafted edge cases

## Tool annotations

All read-only tools are annotated with `readOnlyHint: true, idempotentHint: true`.
`push_to_bing` is the only mutating tool (`readOnlyHint: false, idempotentHint: false`).

## Design doc

Full spec is in `DESIGN.md`. The `docs/bing-api-reference.md` pointer leads to
the canonical endpoint reference in the `geo-content` repo.
