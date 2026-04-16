# Fixture redaction rules

Live fixtures in `test/fixtures/live/` are captured from a real Bing Webmaster
API key via `scripts/record-fixtures.ts`. Before they are committed, the script
applies the redactions below.

If you add a new endpoint to the capture script, audit its response shape and
add any new sensitive fields here.

## Fields scrubbed

| Endpoint | Field path | Replacement |
|---|---|---|
| `GetUserSites` | `Sites[*].DnsVerificationCode` | `"REDACTED_DNS_CODE"` |
| `GetUserSites` | `Sites[*].AuthenticationCode` | `"REDACTED_AUTH_CODE"` |
| `GetSiteRoles` | `Roles[*].Email` | `"user@example.com"` |
| `GetSiteRoles` | `Roles[*].DelegatorEmail` | `"delegator@example.com"` |
| `GetQueryStats` | `[*].Query` | `"example query {n}"` (indexed so filter tests still hit edge cases) |
| `GetPageStats` | `[*].Page` | Only the query string is stripped; path kept. |

## Fields preserved verbatim

- `Url`, `SiteUrl`, `Page` hostnames and paths — these are public and necessary
  for URL-matching tests.
- Dates and timestamps — shape-critical and never sensitive.
- Counts, impressions, clicks, statuses — the test payload.

## How redaction is applied

`scripts/record-fixtures.ts` loads the raw Bing response, walks the known
sensitive paths, substitutes placeholders, then writes the file. It does not
re-format keys or reorder fields — diffs between fixture runs should be stable.

If you spot an unredacted secret in a fixture, delete the file, fix the script,
and re-record. Do not commit partial redactions.
