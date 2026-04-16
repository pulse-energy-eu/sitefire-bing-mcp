# sitefire-bing-mcp — v0 design doc

**Status:** v0 built and validated. Live-tested against 4 verified sites in Claude Desktop.
**Last reviewed:** 2026-04-15 by `/plan-eng-review` with Codex outside voice (all 4 cross-model tensions resolved Codex-aligned).
**Supersedes:** n/a (initial).

## TL;DR

A local stdio Model Context Protocol (MCP) server that wraps the Bing Webmaster API and ships as a lead magnet for sitefire's non-technical SEO/GEO audience. Users install it into Claude Desktop, paste their Bing Webmaster API key, and ask Claude questions about their site's Bing visibility. The MCP exposes seven composite, outcome-named tools (not 61 thin endpoint wrappers). No hosting required from sitefire. Time to v0: 3-4 focused days.

## Why this exists

Bing is the default web retrieval index for ChatGPT Search, Microsoft Copilot, and a meaningful slice of Perplexity. Whatever Bing knows about a site is, in practice, what generative engines can cite when answering questions about that site. Most SEO professionals have Google Search Console configured and ignore Bing Webmaster Tools entirely. That is precisely the gap this connector closes: one API key, five minutes, Bing-side visibility inside the AI assistant they already use.

The lead-magnet thesis: sitefire's target customer is a non-technical SEO/GEO marketer who uses Claude Desktop. A free, installable tool that delivers immediate insight positions sitefire as the serious player in GEO, independently of any paid product.

Bing itself now markets its Webmaster Tools as "free SEO/GEO tools" on the landing page (verified April 2026 via firecrawl scrape). The terminology match is a direct tailwind for positioning.

## Audience

Persona: SEO/GEO marketer at a small-to-mid business. Has GSC set up. Uses Claude Desktop or ChatGPT. Never touched Bing Webmaster Tools. Does not write code. Will not debug their own JSON config unless guided with screenshots.

**Hard constraints** this implies:
- Every error message is a user-readable sentence with a concrete next action. Never raw Bing error codes, never triple-bang strings.
- Every tool description is written for someone who asks "what does this do for my site?" not "what API does this call?"
- First tool invocation must succeed even when the user's own site has zero data yet (solved via `keyword_opportunity`, which works cross-site).
- Installation is `npx`, one paste into Claude Desktop config, restart, done. No package manager, no build step, no PATH manipulation.

## Product principles

1. **Outcome-named tools.** A tool is named for the customer question it answers, not the endpoint it calls. `weekly_report` not `get_query_stats`.
2. **Structured responses.** Tools return typed JSON. The model renders the table, prose, or emoji. No pre-rendered markdown inside tool output. This is MCP-idiomatic, cheaper to test, and future-proofs us for ChatGPT and other clients.
3. **Soft failures, guided recovery.** Any failure path surfaces the tool that fixes it. Bad key → "run `setup_check`". Site not verified → "run `setup_check`, then click Import from Google Search Console at bing.com/webmasters". Quota exhausted → "try again after {reset time}".
4. **Boring by default.** `@modelcontextprotocol/sdk` (official), stdio transport, native `fetch`, `zod` for schemas, `vitest` for tests. Zero innovation tokens spent on infra.
5. **Zero persistence.** No database, no user-identifying storage. Each MCP instance is a single-user process on that user's laptop. API key lives only in the Claude Desktop config on that machine.

## Scope

### In scope (v0)

- Seven composite MCP tools (detailed below)
- Central `bing-client.ts` handling OData unwrap, date parsing, 503 retry-once, typed errors
- Error translation layer (`bing-errors.ts`) mapping the five known Bing error patterns to user-facing messages
- Startup soft-warn on invalid key (does not hard-fail; tools route user to `setup_check`)
- Test fixtures: sitefire-live-captured + synthetic edge cases (empty account, wrong site format, WCF-XML error, NotAuthorized, quota exhausted)
- `@modelcontextprotocol/inspector` walkthrough checklist in README
- Install guide in README written for non-technical user: Bing setup steps (with screenshots), API key location, one Claude Desktop config snippet, restart instruction
- Distribution via `npx github:pulse-energy-eu/sitefire-bing-mcp`

### Explicitly NOT in scope (v0)

| Item | Why deferred |
|---|---|
| CI integration tests against live Bing API | Accepted manual-discipline risk; TODO captured for post-v0 |
| Remote MCP / SSE transport | Phase 2 only if distribution pain demands it |
| ChatGPT compatibility testing | Phase 1+; structured-response choice already future-proofs us |
| npm publish pipeline | Phase 1 (friendlies install via `npx github:...`) |
| Usage analytics / telemetry | Phase 1; v0 validation is direct customer interviews |
| Multi-site agency dashboard | v1+; `list_my_sites` is the minimum |
| Response caching | No latency wins worth the complexity |
| Pre-rendered markdown output | Dropped per MCP best-practice; model renders |

### What already exists (reuse, do not rebuild)

| Asset | Used for |
|---|---|
| `tools/bing-webmaster/README.md` | Full endpoint reference, quirks, error-code table. Source of truth for `bing-client.ts` and `bing-errors.ts`. |
| `sitefire/bing-webmaster-api-insights.html` | Structural reference for what `weekly_report`'s data shape covers (Claude renders from our structured output). |
| Live-verified curl patterns in our audit | Direct inputs to `scripts/record-fixtures.ts`. No re-derivation needed. |
| SOPS vault + push-secrets.py | Distributes `BING_WEBMASTER_API_KEY` for local development. |

## Architecture

### Data flow

```
┌──────────────┐   stdio (JSON-RPC)   ┌────────────────┐   HTTPS   ┌──────────────┐
│ Claude       │ ◄──────────────────► │ sitefire-bing  │ ────────► │ Bing         │
│ Desktop      │                      │ -mcp (local)   │           │ Webmaster API│
└──────────────┘                      └────────────────┘           └──────────────┘
       │                                       │
       │ user asks:                            │ reads BING_WEBMASTER_API_KEY
       │ "How is my site doing on Bing?"       │ from env at process start
       ▼                                       │
  [tool call: weekly_report]                   │
                                               ▼
                          ┌───────────────────────────────────┐
                          │ Promise.allSettled fan-out:       │
                          │   GetCrawlStats (last 7 days)     │
                          │   GetQueryStats                   │
                          │   GetPageStats                    │
                          │   GetCrawlIssues                  │
                          │   GetFeeds                        │
                          ├───────────────────────────────────┤
                          │ compose structured JSON           │
                          │ (handle partial failure, empty)   │
                          └───────────────────────────────────┘
                                               │
                                               ▼
                                 return to Claude Desktop
                                 Claude renders for the user
```

### Module layout

```
sitefire-bing-mcp/
├── src/
│   ├── index.ts                  # MCP server, tool registry, startup validation
│   ├── bing-client.ts            # bingFetch: OData unwrap, date parse, retry, typed errors
│   ├── bing-errors.ts            # translateError: raw Bing → user messages
│   └── tools/
│       ├── list-my-sites.ts
│       ├── setup-check.ts
│       ├── weekly-report.ts
│       ├── inspect-url.ts
│       ├── keyword-opportunity.ts
│       ├── push-to-bing.ts
│       └── what-are-people-asking.ts
├── scripts/
│   └── record-fixtures.ts        # Live capture → sanitized JSON fixtures
├── test/
│   ├── fixtures/
│   │   ├── live/                 # Recorded from real Bing API
│   │   ├── synthetic/            # Hand-crafted edge cases
│   │   └── REDACTION.md
│   ├── bing-client.test.ts
│   ├── bing-errors.test.ts
│   └── tools/*.test.ts
├── package.json
├── tsconfig.json
└── README.md
```

Nine source files, seven test files, one fixture directory. Under the 8-files-without-justification threshold; each file has a single reason to change.

### Error translation table

Every error the MCP surfaces to the user goes through `translateError()`. Mapping is authoritative:

| Bing raw | Trigger | User-facing message |
|---|---|---|
| `ErrorCode 3 (InvalidApiKey)` | Bad/expired key | "Your Bing API key is invalid. Regenerate it at bing.com/webmasters → Settings → API Access." |
| `ErrorCode 14 (NotAuthorized)` | Valid key, site not verified under this account | "The site `{site_url}` is not verified under your Bing account. Run `setup_check` to see your verified sites, or go to bing.com/webmasters and Import from Google Search Console." |
| `ErrorCode 7 (InvalidUrl)` | Malformed URL or URL not under site | "The URL `{url}` is malformed or does not belong to any of your verified sites. Run `list_my_sites` to see what you have." |
| `ErrorCode 2 (DateTime / ObjectReferenceNotSet)` | Bad parameter format or hitting a deprecated endpoint | "Bing returned a malformed error for this request. This is a known issue with some older endpoints; this tool should not have hit it. Please report it." |
| `ErrorCode 16 (Deprecated)` | Explicitly deprecated endpoint | "This capability was removed by Microsoft." (should be unreachable from our tools — never exposed) |
| Response body starts with `<` (WCF help page) | Parameter shape rejected at WCF layer | "Bing rejected the request shape. This is an API bug, not your fault. Please report it." |
| 503 from Bing | Transient | Automatic retry once after 250ms. On second failure: "Bing is temporarily unavailable. Try again in a moment." |

## API field name corrections (discovered during live testing)

The Bing Webmaster API documentation and our initial design assumptions had several field names wrong. These were discovered and corrected during live API testing against 4 verified sites.

| Endpoint | Assumed field name | Actual field name | Notes |
|---|---|---|---|
| `GetUrlInfo` | `DateDiscovered` | `DiscoveryDate` | |
| `GetCrawlStats` | `StatusCode2xx`, `StatusCode4xx`, `StatusCode5xx` | `Code2xx`, `Code4xx`, `Code5xx` | Shorter than expected |
| `GetPageStats` | `Page` | `Query` | Page URL lives in the `Query` field |
| `GetFeeds` | `LastCrawledDate`, `SubmittedDate`, etc. | `LastCrawled`, `Submitted`, `Status`, `Type`, `UrlCount` | No `Date` suffix on temporal fields |
| `GetKeywordStats` | `ExactImpressions` | `Impressions` | Query parameter must NOT be single-quoted (breaks the API). Returns 0 without country/language params. |
| `GetUserSites` | `VerificationMeta` (assumed) | Does not exist | Returns `AuthenticationCode` and `DnsVerificationCode` instead (both need redacting in fixtures) |

## The seven tools

Each tool spec defines: the customer question it answers, its signature, the structured return shape, the empty-state behavior, and the test-required branches.

### 1. `list_my_sites`

**Answers:** "Which sites are under my Bing account?"

**Signature:** `list_my_sites() → SiteList`

**Return shape:**
```ts
{
  sites: Array<{
    url: string,
    is_verified: boolean,
    verification_method: "dns" | "meta" | "xml" | "gsc_import" | "unknown"
  }>,
  count: number,
  next_step: string | null  // if zero sites: pointer to setup_check
}
```

**Underlying call:** `GetUserSites`.

**Empty state:** `{ sites: [], count: 0, next_step: "You have no verified sites yet. Run setup_check for a step-by-step guide to adding your first one." }`.

**Required tests:** happy path with 4 sites (sitefire fixture); empty-sites fixture; invalid-key fixture.

### 2. `setup_check`

**Answers:** "Is everything configured correctly?" / "Where do I get started?"

**Signature:** `setup_check(site_url?: string) → SetupReport`

**Return shape:**
```ts
{
  key_valid: boolean,
  sites_count: number,
  sites: string[],                     // URLs of verified sites
  target_site: string | null,          // if site_url provided or only-1-site
  checks: {
    site_verified: "pass" | "fail" | "n/a",
    sitemap_submitted: "pass" | "fail" | "n/a",
    data_available: "pass" | "pending_48h" | "n/a",
    crawl_issues_clean: "pass" | "fail" | "n/a"
  },
  next_actions: string[]               // ordered, concrete
}
```

**Underlying calls:** `GetUserSites`, optionally `GetFeeds(site_url)`, optionally `GetRankAndTrafficStats(site_url)`, optionally `GetCrawlIssues(site_url)`.

**Empty state for new key:** `next_actions = ["Go to bing.com/webmasters and Import from Google Search Console.", "Generate your API key at Settings → API Access.", ...]`

**Required tests:** all four check combinations (pass/fail × key valid/invalid); target_site inference when site_url omitted and user has exactly 1 site; `next_actions` includes GSC-import pointer when zero sites.

### 3. `weekly_report`

**Answers:** "How is my site doing on Bing this week?"

**Signature:** `weekly_report(site_url: string) → WeeklyReport`

**Return shape:**
```ts
{
  period: { start: ISO8601, end: ISO8601 },
  site_url: string,
  is_new_property: boolean,            // true if data_available is pending_48h
  rollup: {
    clicks: number,
    impressions: number,
    queries_count: number,
    pages_count: number
  } | null,                            // null when is_new_property
  top_queries: Array<QueryRow>,        // top 10, never more
  top_pages: Array<PageRow>,           // top 10
  crawl_health: {
    status_2xx_count: number,
    errors_4xx_count: number,
    errors_5xx_count: number,
    dns_failures: number,
    blocked_by_robots: number
  },
  crawl_issues: CrawlIssue[],
  sitemap_count: number,
  partial_failures: string[],          // endpoints that failed in allSettled
  empty_state_guidance: string | null  // non-null when is_new_property
}
```

**Underlying calls (parallel via `Promise.allSettled`):** `GetQueryStats`, `GetPageStats`, `GetCrawlStats`, `GetCrawlIssues`, `GetFeeds`.

**Empty state:** `is_new_property = true`; `empty_state_guidance = "This looks like a fresh Bing property. Data takes up to 48 hours to populate after verification. In the meantime, try keyword_opportunity() for a specific term you care about, or push_to_bing(url) for a new article."`

**Required tests:** happy path with sitefire fixtures; 1-of-5 endpoint fails → partial_failures populated, rest of report intact; all empty → is_new_property true + guidance set; invalid site → routes to translateError.

### 4. `inspect_url`

**Answers:** "What does Bing know about this specific URL?"

**Signature:** `inspect_url(url: string) → UrlInspection`

**Return shape:**
```ts
{
  url: string,
  is_page: boolean,
  discovered_at: ISO8601 | null,
  last_crawled_at: ISO8601 | null,
  crawl_age_days: number | null,
  anchor_count: number,
  document_size_bytes: number,
  http_status: number,
  interpretation: {
    state: "fresh" | "stale" | "never_crawled" | "not_a_page",
    summary: string,
    recommended_action: string | null
  }
}
```

Deliberately NOT named `is_this_indexed` — the underlying data is fuzzy (a URL can be known to Bing but not indexed for retrieval). The `interpretation` field makes this explicit.

**Underlying call:** `GetUrlInfo`.

**Required tests:** recent crawl → state=fresh; crawl >60 days → state=stale; IsPage=false → state=never_crawled + recommend push_to_bing; URL not under site → translateError.

### 5. `keyword_opportunity`

**Answers:** "Is {keyword} worth writing about for Bing/Copilot users?"

**Signature:** `keyword_opportunity(keyword: string, country?: string, language?: string) → KeywordOpportunity`

**Return shape:**
```ts
{
  keyword: string,
  country: string,                     // defaults "us"
  language: string,                    // defaults "en-US"
  weekly_trend: Array<{
    week_start: ISO8601,
    exact_impressions: number,
    broad_impressions: number
  }>,                                  // 12 weeks max
  trend_direction: "up" | "down" | "flat",
  latest_week_impressions: number,
  has_demand: boolean
}
```

**Underlying call:** `GetKeywordStats` (works cross-site — this is the day-1 value tool before the user's own site has data).

**Empty state:** `has_demand = false`; trend contains zeros; include in response: `"No measurable Bing demand for this exact term. Try a broader variant."`

**Required tests:** keyword with data (use "generative engine optimization" fixture captured live); keyword with zero impressions; invalid key → translateError. **Does NOT require site ownership** — this is the critical differentiator and must be test-asserted.

### 6. `push_to_bing`

**Answers:** "I just published this URL — tell Bing."

**Signature:** `push_to_bing(url: string, site_url: string) → PushResult`

**Return shape:**
```ts
{
  url: string,
  bing_submit: {
    status: "ok" | "quota_exhausted" | "error",
    message: string,
    quota_remaining_today: number | null
  },
  indexnow: {
    status: "ok" | "key_file_missing" | "error" | "skipped",
    message: string
  }
}
```

**Underlying calls:** `SubmitUrlBatch([url])` and a separate POST to `https://api.indexnow.org/indexnow` with the configured key.

**Graceful fallback:** if IndexNow key file is missing from the origin (checked via HEAD request), IndexNow status is `"key_file_missing"` with guidance; Bing submission still fires. Does not fail the tool.

**Required tests:** both succeed; quota exhausted on Bing side (fixture); IndexNow key file 404; URL not under site → translateError.

### 7. `what_are_people_asking`

**Answers:** "What questions bring people to my site from Bing?"

**Signature:** `what_are_people_asking(site_url: string) → FilteredQueries`

**Return shape:**
```ts
{
  site_url: string,
  period: { start: ISO8601, end: ISO8601 },
  natural_language_queries: Array<QueryRow>,  // filtered
  filter_criteria: {
    min_words: 5,
    or_has_question_word: true
  },
  total_queries_seen: number,
  matched_count: number,
  note: string                         // "This is a filtered view of GetQueryStats..."
}
```

Honest framing: this is a filter on query data, not magic insight. The `note` says so.

**Underlying call:** `GetQueryStats`. Filter: `words.length >= 5 OR words[0] in ["how","what","why","when","which","does","can","is"]`.

**Required tests:** filter correctness (happy + edge); empty site → guidance pointing at keyword_opportunity; invalid site → translateError.

## Startup behavior

When the MCP process starts:

1. Read `BING_WEBMASTER_API_KEY` from env. If absent: emit stderr banner "BING_WEBMASTER_API_KEY not set. The MCP will start but all tools will return setup guidance." Continue.
2. Call `GetUserSites` with a 3-second timeout. Three outcomes:
   - Success: emit stderr banner "sitefire-bing-mcp v0.X — connected. N verified sites found."
   - `InvalidApiKey`: emit stderr banner "Your API key is invalid. Tools will route you to setup_check. Fix the key in your Claude Desktop config and restart."
   - Network timeout/other: emit warning banner "Could not reach Bing to validate the key. Tools will retry on first invocation."
3. Register all seven tools. Server ready.

**Critical design choice:** do not hard-fail at startup even on invalid key. Hard-failing prevents the user from reaching `setup_check` which is the tool that tells them what to fix. Soft-warn + graceful in-tool messaging is strictly better UX. This is the single most important resolution from the Codex review.

## Test strategy

Three layers.

### Layer 1 — Unit tests with fixtures (run always, <2s)

- `vitest` for runner
- `fetch` mocked via test-level interception
- Fixtures live in `test/fixtures/live/` (captured from sitefire API key, sanitized) and `test/fixtures/synthetic/` (hand-crafted edge cases)
- One test file per module (`bing-client`, `bing-errors`, each tool)
- Target coverage: 100% of branches in the code-path diagram below

### Layer 2 — Integration tests against live Bing API

- Local only, guarded by `INTEGRATION=1` env var
- ~8 tests touching the real endpoints we depend on
- Run manually before each release to a friendly customer
- **Accepted risk:** Bing-side silent regressions (e.g., `GetRelatedKeywords` going empty in 2024) may escape this. TODO captured for post-v0 CI smoke.

### Layer 3 — Manual MCP inspector walkthrough

Pre-release checklist in README:
- [ ] Start MCP with `@modelcontextprotocol/inspector`
- [ ] `list_my_sites` returns expected sites
- [ ] `setup_check` with valid key → all green
- [ ] `setup_check` with deliberately-wrong site URL → appropriate guidance
- [ ] `keyword_opportunity("generative engine optimization")` → 12-week trend
- [ ] `weekly_report` against a site with known data → non-empty report
- [ ] `weekly_report` against a fresh property → empty_state_guidance set
- [ ] `inspect_url` against a known page → fresh state; against a bogus URL → never_crawled
- [ ] `push_to_bing` against a test URL with no IndexNow key → falls back to Bing-only cleanly
- [ ] `what_are_people_asking` → filtered queries + honest note
- [ ] Invalid key → stderr banner visible in Claude Desktop MCP log

### Fixtures — sources

| Source | Contents |
|---|---|
| `live/` | `GetUserSites.json`, `GetRankAndTrafficStats.json`, `GetCrawlStats.json`, `GetQueryStats.json`, `GetPageStats.json`, `GetCrawlIssues.json`, `GetUrlInfo.json`, `GetKeywordStats.json`, `GetFeeds.json`, `GetSiteRoles.json`. Captured by `scripts/record-fixtures.ts` against sitefire.ai. Sanitized per REDACTION.md. |
| `synthetic/` | `empty-account.json`, `wrong-site-format.json`, `wcf-xml-error.html`, `not-authorized.json`, `quota-exhausted.json`, `keyword-zero-demand.json`, `url-info-never-crawled.json`. Hand-crafted based on observed error shapes. |

Redaction rules: emails in `GetSiteRoles`, `DnsVerificationCode` and `AuthenticationCode` fields, any query text that could leak customer intent.

### Forward-looking coverage diagram

```
CODE PATH COVERAGE (v0 target)
════════════════════════════════════
[+] src/bing-client.ts
    bingFetch(method, params)
    ├── [REQUIRED] Happy path: returns d.payload, __type stripped, dates parsed
    ├── [REQUIRED] 200 with {ErrorCode, Message} → throws BingApiError
    ├── [REQUIRED] 200 with WCF XML → throws BingApiError("WCF_REJECT")
    ├── [REQUIRED] 503 transient → retry once after 250ms → success on retry
    ├── [REQUIRED] 503 transient → retry once → still 503 → throws "HTTP_FAIL"
    ├── [REQUIRED] Non-retryable 4xx → throws immediately
    ├── [REQUIRED] Empty d: [] → returns empty array (not an error)
    └── [REQUIRED] /Date(ms-TZ)/ → JS Date, verified cross-TZ

[+] src/bing-errors.ts
    translateError(raw)
    ├── [REQUIRED] ErrorCode 3 → InvalidApiKey user msg
    ├── [REQUIRED] ErrorCode 14 → NotAuthorized user msg
    ├── [REQUIRED] ErrorCode 7 → InvalidUrl user msg
    ├── [REQUIRED] ErrorCode 2 → DateTime/ObjectRef user msg
    ├── [REQUIRED] ErrorCode 16 → Deprecated user msg (unreachable from our tools)
    └── [REQUIRED] WCF_REJECT → bug report user msg

[+] src/tools/list-my-sites.ts
    ├── [REQUIRED] 4 sites → structured list
    └── [REQUIRED] 0 sites → setup_check pointer

[+] src/tools/setup-check.ts
    ├── [REQUIRED] All green (sitefire fixture)
    ├── [REQUIRED] Key valid, 0 sites → GSC-import pointer
    ├── [REQUIRED] Site verified, no sitemap → submit-sitemap action
    ├── [REQUIRED] Site verified, data pending_48h → keyword_opportunity pointer
    └── [REQUIRED] target_site inference when site_url omitted + single-site account

[+] src/tools/weekly-report.ts
    ├── [REQUIRED] Happy path: 5 allSettled calls compose
    ├── [REQUIRED] 1-of-5 rejects → partial_failures populated, rest intact
    ├── [REQUIRED] All empty → is_new_property=true, empty_state_guidance set
    └── [REQUIRED] Invalid site → routes to translateError

[+] src/tools/inspect-url.ts
    ├── [REQUIRED] Fresh crawl (<7 days) → state=fresh
    ├── [REQUIRED] Stale crawl (>60 days) → state=stale + action
    ├── [REQUIRED] IsPage=false → state=never_crawled + push_to_bing action
    └── [REQUIRED] URL not under site → translateError

[+] src/tools/keyword-opportunity.ts
    ├── [REQUIRED] Keyword with data → 12-week trend + direction
    ├── [REQUIRED] Keyword with zero impressions → has_demand=false + suggestion
    ├── [REQUIRED] Invalid key → translateError
    └── [REQUIRED] Asserts cross-site capability (no site_url passed)

[+] src/tools/push-to-bing.ts
    ├── [REQUIRED] Both succeed
    ├── [REQUIRED] Bing quota exhausted → status with reset time
    ├── [REQUIRED] IndexNow key file 404 → falls back to Bing-only
    └── [REQUIRED] URL not under verified site → translateError

[+] src/tools/what-are-people-asking.ts
    ├── [REQUIRED] Filter correctness: ≥5 words OR question word
    ├── [REQUIRED] Empty site → keyword_opportunity pointer
    └── [REQUIRED] Honest note present in response

USER FLOW COVERAGE (manual, pre-release)
════════════════════════════════════════
[+] Install flow
    ├── Fresh machine → README → Claude Desktop config → restart → success < 10 min
    └── Invalid key → stderr banner visible in Claude Desktop log

[+] First-call flow
    ├── First question "run setup_check" → green checklist
    └── First question "weekly_report" on new site → empty_state_guidance
```

## Failure mode analysis

Each new codepath, one realistic production failure, whether v0 covers it:

| Codepath | Failure scenario | Unit test | Error handling | User sees |
|---|---|---|---|---|
| `bingFetch` | WCF XML help page (bad params) | ✓ | ✓ | "Bing rejected shape" + bug report |
| `bingFetch` | 503 transient | ✓ | ✓ retry-once | Auto-recovered OR "temporarily unavailable" |
| `translateError` | Unknown error code | ✓ | ✓ | Generic msg + raw code (acceptable) |
| `weekly_report` | 1 of 5 rejects | ✓ | ✓ | Partial report + `partial_failures` |
| `weekly_report` | Completely empty data | ✓ | ✓ | `empty_state_guidance` set |
| `push_to_bing` | IndexNow key file 404 | ✓ | ✓ | Bing-only success |
| `push_to_bing` | Daily quota exhausted | ✓ | ✓ | Reset-time guidance |
| `inspect_url` | LastCrawled > 60 days | ✓ | ✓ | state=stale + action |
| `setup_check` | Zero verified sites | ✓ | ✓ | GSC-import pointer |
| `keyword_opportunity` | Zero impressions | ✓ | ✓ | has_demand=false + suggestion |
| startup | Invalid key | ✓ | ✓ | Soft-warn + tool routing |
| `list_my_sites` | Zero sites | ✓ | ✓ | setup_check pointer |

**No critical gaps.** The 503-retry-once closes what would have been the only "silent failure" path.

## Onboarding — verified and unverified

### What the firecrawl check confirms (April 2026 data)

- Bing Webmaster Tools landing page now markets itself with "SEO/GEO tools" language (direct quote). Terminology tailwind for positioning.
- "Import from Google Search Console" feature documented updated June 2025. Four-step flow:
  1. Sign in at `bing.com/toolbox/webmaster` (or create a Microsoft account)
  2. My Sites page → Import
  3. Sign in with Google, click Allow
  4. Select sites → Import (up to 100 at once)
- **Data availability:** Microsoft says "up to 48 hours to get traffic data." Our earlier estimate of 7 days was pessimistic.
- Periodic re-sync with Google Search Console. If GSC access is revoked, user must re-verify via alternative methods (DNS, meta tag, XML file, Domain Connect).
- Alternative verification paths documented: DNS TXT, meta tag, XML file upload, Domain Connect.

### What remains unvalidated

- End-to-end stopwatch timing. Microsoft says "a few minutes" but nobody has timed it from a cold-start Microsoft account.
- The specific UI path from sign-in to API key generation. The API-access help page is under "Advanced Topics" and could not be fully scraped (nav-gated).
- Behavior for agencies with 20+ GSC properties (pagination? selection UX?).
- Domain property vs URL-prefix property handling on import.

**De-risk before v0 ships to friendly #1:** a clean-browser dry-run (sitefire founder or designated person), stopwatch, screenshots of every screen. This produces the setup guide, de-risks the onboarding premise, and costs ~20 minutes.

## Parallelization lanes

| Lane | Modules | Depends on |
|---|---|---|
| A | `src/bing-client.ts`, `src/bing-errors.ts`, their tests | — |
| B | `scripts/record-fixtures.ts`, `test/fixtures/live/*`, `test/fixtures/synthetic/*`, `REDACTION.md` | — |
| C | 7 tool implementations in `src/tools/*.ts` with tests | A, B |
| D | `README.md`, install guide, trust-story copy, Inspector checklist | — |
| E | `src/index.ts` (MCP server setup, tool registry, startup behavior) | A, C |

**Execution:** A + B + D in parallel → C (tools, which can themselves be parallelized across 7 subtasks) → E. Worktree orchestration saves ~30% wall time. Whether worth the setup overhead is the builder's call.

## Time estimate

**Originally estimated 3-4 focused days. Actual: v0 was completed in a single focused session.** The original "1-2 days" estimate was rejected during review as optimistic, and the revised "3-4 days" turned out to be conservative. Parallel lane execution and live fixture capture happening alongside tool implementation compressed the timeline significantly.

Original breakdown (kept for reference):

- Day 1: Lanes A + B + D in parallel. Scaffold, bing-client, bing-errors, fixture script + initial capture + synthetics, README skeleton.
- Day 2: Lane C part 1. Four smaller tools (list_my_sites, setup_check, inspect_url, keyword_opportunity). Each with tests.
- Day 3: Lane C part 2. Three larger tools (weekly_report, push_to_bing, what_are_people_asking). Lane E server glue.
- Day 4: Inspector walkthrough, polish, README completion, one friendly-customer dry-run.

## Distribution and hosting

| Phase | Channel | Sitefire-side cost |
|---|---|---|
| v0 (internal + friendlies) | `npx github:pulse-energy-eu/sitefire-bing-mcp` | $0. GitHub public repos are free. |
| v0 local (dev install) | Claude Desktop config pointing to local `dist/index.js` | $0. Runs on user's laptop. |
| Phase 1 (remote connector) | Claude Desktop Connector at `app.sitefire.ai/api/mcp` | $0 incremental. Uses existing Vercel deployment. |
| Phase 1 npm (optional) | `npx @sitefire/bing-mcp` for developers who prefer local | $0. npm registry free for public packages. |

v0 runs locally. Phase 1 adds Bing tools to the existing sitefire remote MCP at `app.sitefire.ai/api/mcp`, reusing existing Vercel serverless infra. No new hosting required.

## Phase 1: Remote MCP connector (lead-magnet funnel)

### Architecture decision (Codex-reviewed, April 2026)

**Single endpoint, one connector, dynamic tool list based on entitlement.**

The original Phase 2 plan proposed a separate anonymous endpoint at `/api/mcp/bing`. Codex review identified that this creates more complexity than it solves:
- "No auth" is not zero friction when the user still has to generate a Bing API key
- Free Claude users are limited to 1 custom connector, so a two-connector funnel is clunky
- Anonymous session management in stateless Vercel is building a custom auth layer anyway
- Putting secrets in tool arguments (a `setup_bing` tool) risks leakage via logs
- Remote connector traffic comes from Anthropic's cloud, not the user's machine, so client-based session identity doesn't work

**Revised plan: one connector, lightweight auth, entitlement-based tools.**

### User journey

```
LEAD-MAGNET FUNNEL
════════════════════════════════════════════════════════════

Step 1: DISCOVERY
  User reads blog post or recommendation: "Free Bing SEO tools for Claude"
  Goes to Settings > Connectors > "+"
  Pastes: https://app.sitefire.ai/api/mcp
  OAuth flow redirects to sitefire.ai/bing-seo

Step 2: LIGHTWEIGHT AUTH (sitefire.ai/bing-seo)
  One page, one field:
  - "Paste your Bing Webmaster API key"
  - Optional: "Enter your email for updates" (lead capture)
  - Click "Connect"
  Server validates key via GetUserSites, stores it encrypted,
  mints a token, redirects back to Claude. Done.

Step 3: VALUE (immediate)
  "How is my site doing on Bing?" -> weekly_report with real data
  "Is 'seo tools' worth targeting?" -> keyword_opportunity
  All 7 Bing tools work. No sitefire account needed.

Step 4: NUDGE (contextual, not on every response)
  weekly_report includes: "This covers Bing search. Sitefire also
  tracks how ChatGPT, Gemini, and Perplexity cite your site."
  Only shown when relevant (e.g., after weekly_report, not after
  simple list_my_sites calls).

Step 5: CONVERSION
  User runs the sitefire onboarding (same connector, same URL).
  Their entitlement upgrades from "bing-only" to "full".
  tools/list now returns sitefire tools + Bing tools.
  No second connector needed.

════════════════════════════════════════════════════════════
```

### Technical implementation

**Where:** `pulse-geo/routes/api/mcp.ts` (existing Vercel serverless function)

**Auth flow (two tiers, same endpoint):**

```
                          ┌─────────────────────┐
                          │ app.sitefire.ai/     │
                          │ api/mcp              │
                          └──────────┬───────────┘
                                     │
                          ┌──────────▼───────────┐
                          │ Bearer token present? │
                          └──────────┬───────────┘
                                     │
                    ┌────────────────┤────────────────┐
                    │ No             │ Yes            │
                    ▼                ▼                │
               401 + PRM       Validate token        │
               (triggers       ┌─────┴─────┐         │
                OAuth)         │            │         │
                               ▼            ▼         │
                          bing-only    full sitefire   │
                          token        token           │
                               │            │         │
                               ▼            ▼         │
                          7 Bing       All sitefire    │
                          tools        + 7 Bing tools  │
                               │            │         │
                               └────────────┘         │
                                     │                │
                          ┌──────────▼───────────┐    │
                          │ Return tools/list     │    │
                          │ based on entitlement  │    │
                          └──────────────────────┘    │
```

**What changes in pulse-geo:**

1. **Auth page route** (`app.sitefire.ai/bing-seo`): Single-page form. User pastes Bing key. Server validates via `GetUserSites`, stores key encrypted in `bing_credentials` table, issues a lightweight Supabase token (anonymous auth or service-role-minted JWT). Redirects back to Claude's OAuth callback.

2. **MCP endpoint** (`routes/api/mcp.ts`): `createMcpServer()` accepts an entitlement parameter. If the token is bing-only, register only Bing tools. If full sitefire, register all tools + Bing tools. The `checkAuth()` function determines entitlement from the token claims.

3. **Bing tool registration**: Port the 7 tool functions from `sitefire-bing-mcp/src/tools/` into `pulse-geo/routes/api/_shared/bing-tools.ts`. Port `bing-client.ts` and `bing-errors.ts` alongside. Each tool reads the Bing API key from the `bing_credentials` table for the authenticated user.

4. **Supabase migration**: New `bing_credentials` table with columns: `id`, `user_id` (nullable for bing-only users), `api_key_encrypted`, `sites_count`, `created_at`, `last_used_at`. RLS policy scopes to the token's user.

5. **Upgrade path**: When a bing-only user creates a full sitefire account, their `bing_credentials` row gets linked to the new `user_id`. Their existing connector session continues working, tools/list expands to include sitefire tools on the next request.

**What stays in sitefire-bing-mcp repo:**
- The local stdio version (for developers who prefer `npx`)
- All tests and fixtures (source of truth for Bing API behavior)
- README for self-hosting
- DESIGN.md (this document)

### Key design decisions

| Decision | Choice | Why |
|---|---|---|
| One endpoint vs two | One (`/api/mcp`) | Free users limited to 1 custom connector. Two connectors = clunky upgrade. |
| Auth for free tier | Lightweight OAuth (key-paste page) | The user already has to generate a Bing key. Adding a 30-second auth page is not meaningful friction. |
| Credential handling | Server-side encrypted storage | Never in tool arguments, never in logs, persists across sessions. |
| Tool visibility | Dynamic based on entitlement | MCP spec supports different tools/list responses per auth state. |
| Upgrade mechanism | Entitlement change, not new connector | User's existing connector gains more tools. No reinstall. |
| Nudge placement | Contextual (weekly_report, setup_check) | Not on every response. Only at intent-rich moments. |
| push_to_bing for free tier | Yes (with rate limit) | Submitting URLs is the action that makes users feel the tool works. |

### Risks specific to Phase 1

| Risk | Severity | Mitigation |
|---|---|---|
| Bing API key stored server-side | High | Encrypted at rest in Supabase. Key only decrypted per-request. No logging. |
| Anonymous token abuse | Medium | Rate limiting per token. Token expiry after 30 days of inactivity. |
| Vercel cold start on first tool call | Low | Existing sitefire MCP already handles this. ~1-2s observed. |
| OAuth page adds friction vs "just paste URL" | Medium | The real friction is the Bing key, not the auth page. One field, one click. |
| Free-tier user hits Bing API quota | Low | Bing quotas are per-key, not per-sitefire-user. User's own key, user's own limits. |

## Watch list: upcoming Microsoft features (Q2 2026+)

### AI Performance report (Public Preview, Feb 10 2026)

Microsoft launched an AI Performance report in Bing Webmaster Tools (Feb 10 2026, public preview). The UI surfaces, per site: Total Citations, Average Cited Pages, Grounding queries, page-level citation activity, visibility trend line. Covers Microsoft Copilot, AI-generated summaries in Bing, and partner integrations.

**API status as of April 2026:** UI-only. No public API endpoints. Speculative probes (`GetAIPerformance`, `GetAIPerformanceStats`, `GetCopilotStats`, `GetAISearchStats`, `GetAIInsights`, etc.) all return the WCF help page, meaning the endpoints do not exist yet. Microsoft explicitly signaled API endpoints for daily citation series, page-level citations, and grounding query samples are planned for later in 2026.

**Why this matters for v0:** does not change scope (cannot wrap what does not exist) but strongly reinforces positioning. The moment Microsoft ships these endpoints, we add two tools:
- `citation_trend(site_url)` — daily/weekly Copilot citation counts, like `weekly_report` but AI-side
- `who_cited_this_page(url)` — per-URL citation history (which Copilot conversations referenced this page)

**Guidance in v0 README:** point users at the AI Performance UI in Bing Webmaster Tools with a screenshot showing where to find it. They can export the CSV manually until the API arrives. Frames sitefire as already aligned with where Microsoft is going, not catching up.

### Top Recommendations feed (UI-only, no API)

Bing's dashboard surfaces a "Top Recommendations" list (e.g., "identical titles", "meta descriptions too short", "insufficient content... improve user engagement and SEO/GEO"). This is structured SEO/GEO advice from Bing itself and would make an excellent composite tool.

**API status as of April 2026:** UI-only. `GetRecommendations`, `GetSiteRecommendations`, `GetSiteIssues` probes all return the WCF help page. No known endpoint.

**Status:** candidate for v1+ once an API is exposed. Not v0.

## Onboarding (firecrawl + first-person screenshot verification, April 2026)

Verified the current state of the Bing Webmaster Tools onboarding by running the flow live on 2026-04-15:

- **Landing page:** `bing.com/webmasters` — "Want more users for your site?" with a single `Get Started` CTA. Landing page copy now markets "free SEO/GEO tools" (direct quote).
- **Sign-in modal offers three options:** Microsoft, **Google**, Facebook. The Google option uses standard Google SSO (`accounts.google.com/Sign In to bing.com`). This is the most important finding of the dry-run: **users with existing GSC accounts do not need to create a Microsoft account at all.** Full sign-in including 2FA took ~2 minutes.
- **Dashboard after sign-in:** left-nav items visible: Home, Search Performance, AI Performance (BETA), URL Inspection, Site Explorer, Sitemaps, IndexNow, Backlinks, Keyword Research, Recommendations, Site Scan, Configuration, Tools & Enhancements, Security & Privacy, User Management, Microsoft Clarity. IndexNow and AI Performance are first-class nav items.
- **Import from Google Search Console** remains the recommended path per Microsoft (updated June 2025). Four steps, auto-verifies, imports sitemaps, up to 100 sites per batch. Microsoft documents "up to 48 hours" for traffic data to populate after verification.

**What this validates:**
- Google SSO sign-in path closes the "Microsoft account required" gap Codex flagged. Confirmed end-to-end by human, not speculated.
- Property already verified in this account's case (app.gpt-pulse.com). For a user with GSC-only-no-Bing, Import-from-GSC is the recommended next click.

**What remains un-tested:**
- The exact UI path from sign-in to **API key generation** (Settings → API Access). Our firecrawl scrape of the help page hit a nav-gated index. Screenshot walkthrough of that specific flow is a prerequisite for the v0 README.
- Agency UX with 20+ GSC properties (pagination? bulk select? still < 100-site cap per batch?).
- Domain property vs URL-prefix property handling on import.

These are the remaining de-risks for the written setup guide, not blockers for v0 code.

## Phase 1 implementation checklist

After v0 validates with friendly customers:

**In pulse-geo (the main product repo):**
- [ ] Build `sitefire.ai/bing-seo` auth page (one field: paste Bing key, optional email)
- [ ] Add OAuth metadata for bing-only entitlement tier
- [ ] Port Bing tool functions from sitefire-bing-mcp into `routes/api/_shared/bing-tools.ts`
- [ ] Port `bing-client.ts` and `bing-errors.ts` into pulse-geo shared modules
- [ ] Add entitlement-based tool registration in `createMcpServer()`
- [ ] Create Supabase migration for `bing_credentials` table
- [ ] Add encrypted key storage and per-request decryption
- [ ] Add contextual upgrade nudges in `weekly_report` and `setup_check` responses
- [ ] Rate limiting for bing-only tier tokens
- [ ] Test the full connector flow: add URL, auth page, tools work, upgrade path

**In sitefire-bing-mcp (this repo):**
- [ ] Optionally publish to npm as `@sitefire/bing-mcp` for developers who prefer local
- [ ] Add MCP tool annotations (readOnlyHint, idempotentHint, outputSchema)
- [ ] Add per-request timeout (AbortSignal with 15s) to bingFetch

**Marketing:**
- [ ] Short launch post on sitefire blog positioning the tool in the GEO narrative
- [ ] Update README to mention the hosted connector option alongside the npx install

## Open questions / known risks

| Risk | Severity | Mitigation |
|---|---|---|
| `GetKeywordStats` cross-site access removed by Microsoft | High, low likelihood | Alternative: fall back to `GetQueryStats` (site-scoped, requires ownership). Degrades `keyword_opportunity` to day-7 value instead of day-1. |
| Bing UI changes between v0 ship and Phase 1 | Medium, medium likelihood | Setup guide as markdown with dated screenshots; willing to re-shoot. |
| Non-technical user fails at `npx` install | High, medium likelihood | Phase 1 addresses with wizard. v0 friendlies are assumed able to follow a README with screenshots and one config paste. |
| Installation trust (random GitHub project asks for API key) | Medium | Public repo, MIT license, clear README on what the key does and what data leaves their machine (none — straight HTTPS to Microsoft). Consider SLSA-style provenance in Phase 1+. |
| Silent Bing API regression | Medium, low likelihood | Manual discipline in v0; TODO for cron smoke check in post-v0. |
| Claude Desktop MCP format changes | Low, low likelihood | Structured-response approach is MCP-spec-idiomatic, unlikely to break. |
| IndexNow key design | High (resolved) | Codex review caught that v0 was reusing the Bing API key as the IndexNow key. Fixed: IndexNow now uses a separate INDEXNOW_KEY env var. |
| Double-translation loses typed errors | High (resolved) | Tool functions now let BingApiError propagate; errorResult() in index.ts translates once. |
| No per-request timeout on bingFetch | Medium | Accepted for v0 local use. TODO: add AbortSignal with 15s timeout for Phase 1. |
| Startup network call blocks transport | High (resolved) | Transport now connects first; startupCheck() runs in background. |
| URL exact-match in setup_check | Medium (resolved) | URLs normalized via new URL().href before comparison. |
| No outputSchema or tool annotations | Low | Phase 1 item. Add readOnlyHint, idempotentHint, and outputSchema for typed responses. |
| Node.js prerequisite not documented | Medium (resolved) | Added to README prerequisites. |

## References

- [`geo-content/tools/bing-webmaster/README.md`](https://github.com/pulse-energy-eu/geo-content/blob/main/tools/bing-webmaster/README.md) — endpoint reference, error codes, tier audit
- [`geo-content/sitefire/bing-webmaster-api-insights.html`](https://github.com/pulse-energy-eu/geo-content/blob/main/sitefire/bing-webmaster-api-insights.html) — customer-facing report template, audit of the upstream MCP
- [Test plan artifact](/Users/jochenmadler/.gstack/projects/pulse-energy-eu-geo-content/jochenmadler-claude-amazing-jepsen-eng-review-test-plan-20260415-182344.md)
- [`geo-content/TODOS.md`](https://github.com/pulse-energy-eu/geo-content/blob/main/TODOS.md) — post-v0 CI smoke check captured
- [Bing Webmaster API reference](https://learn.microsoft.com/en-us/bingwebmaster/) — Microsoft primary docs
- [IndexNow protocol](https://www.indexnow.org/documentation) — multi-engine submission
- [Import from GSC (June 2025 update)](https://blogs.bing.com/webmaster/september-2019/Import-sites-from-Search-Console-to-Bing-Webmaster-Tools) — the four-step onboarding flow
- [Model Context Protocol SDK for TypeScript](https://github.com/modelcontextprotocol/typescript-sdk) — our foundation
