# sitefire-bing-mcp

Local stdio MCP server wrapping the Bing Webmaster API for Claude Desktop.

## Build and test

```bash
npx tsc          # build to dist/
npx vitest run   # 30 tests
```

## Bing Webmaster API: GET vs POST

The Bing Webmaster API is a WCF JSON service. Read endpoints (GetUserSites,
GetUrlInfo, GetKeywordStats, GetQueryStats, GetPageStats, GetCrawlStats,
GetCrawlIssues, GetFeeds, GetRankAndTrafficStats, GetSiteRoles) accept only
GET requests with parameters as query strings. Sending POST to a read endpoint
does not return a useful error - it returns an HTML "help page" from the WCF
framework, which looks like a successful HTTP 200 but contains no JSON.

Write endpoints (SubmitUrlBatch) use POST with a JSON body.

Our `bing-client.ts` defaults to GET. Pass `httpMethod: "POST"` explicitly for
write endpoints. This was discovered the hard way: the original implementation
used POST for everything, which caused every tool call to fail with a WcfReject
error in production while tests (using mocked fetch) passed fine.

## Architecture

- `src/bing-client.ts` - HTTP layer: OData unwrap, `__type` scrub, date parsing, 503 retry, typed errors
- `src/bing-errors.ts` - Maps BingApiError kinds to user-facing sentences
- `src/tools/*.ts` - One file per MCP tool (pure functions over BingClient)
- `src/index.ts` - MCP server, stdio transport, tool registration
- `test/fixtures/synthetic/` - Edge-case fixtures for unit tests

## Design doc

Full spec is in `DESIGN.md`. The `docs/bing-api-reference.md` pointer leads to
the canonical endpoint reference in the `geo-content` repo.
