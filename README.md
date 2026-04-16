# sitefire-bing-mcp

> Local Model Context Protocol server for Bing Webmaster insights, inside Claude Desktop. One API key, zero hosting. Designed for non-technical SEO/GEO professionals.

**Status:** v0 in progress. Client layer (`bing-client`, `bing-errors`) + fixtures + tests landed. Tool implementations next. Design doc: [DESIGN.md](DESIGN.md).

## What this is

A Claude Desktop MCP that wraps the Bing Webmaster API behind seven composite, outcome-named tools. Drop your Bing API key into one config file, restart Claude Desktop, ask Claude questions about your site's Bing and generative-engine visibility.

**Why Bing:** ChatGPT Search, Microsoft Copilot, and a significant slice of Perplexity all retrieve from the Bing index. Whatever Bing knows about your site is, in practice, what generative engines can cite.

## The seven tools

| Tool | Answers |
|---|---|
| `list_my_sites` | Which sites are under my Bing account? |
| `setup_check` | Is everything configured correctly? Where do I start? |
| `weekly_report` | How is my site doing on Bing this week? |
| `inspect_url` | What does Bing know about this specific URL? |
| `keyword_opportunity` | Is this keyword worth writing about for Bing/Copilot users? |
| `push_to_bing` | I just published this URL — tell Bing. |
| `what_are_people_asking` | What questions bring people to my site from Bing? |

See [DESIGN.md § The seven tools](DESIGN.md#the-seven-tools) for the full contract of each one.

## What you need

- Claude Desktop
- A free Bing Webmaster Tools account (sign in with your existing Google, Microsoft, or Facebook account at [bing.com/webmasters](https://www.bing.com/webmasters))
- Your site verified under that Bing account (one-click if you already use Google Search Console — use **Import from Google Search Console**)
- An API key generated at Bing Webmaster Tools → **Settings → API Access**

## Install

_Not yet published. This section describes the target install experience._

Once v0 is released, add the following to your Claude Desktop config (Settings → Developer → Edit Config):

```json
{
  "mcpServers": {
    "sitefire-bing": {
      "command": "npx",
      "args": ["-y", "github:pulse-energy-eu/sitefire-bing-mcp"],
      "env": {
        "BING_WEBMASTER_API_KEY": "YOUR_KEY_HERE"
      }
    }
  }
}
```

Then quit and reopen Claude Desktop. The MCP will appear in the tool list; ask Claude "run `setup_check`" to confirm it is wired up.

## Development

```bash
npm install
npm test                # vitest run, unit tests only (<2s)
npm run dev             # run the MCP directly with tsx (stdio)
npm run build           # emit dist/
npm run inspector       # walk the tools with @modelcontextprotocol/inspector
```

### Recording live fixtures

Unit tests run against hand-crafted synthetic fixtures plus captures taken from
a real Bing account. To refresh the live captures:

```bash
BING_WEBMASTER_API_KEY=... \
BING_SITE_URL=https://sitefire.ai/ \
  npm run record-fixtures
```

The script sanitizes per [test/fixtures/REDACTION.md](test/fixtures/REDACTION.md)
before writing. Review the diff before committing — if you see an unredacted
email, DNS code, or customer query, delete the file, fix the redactor in
`scripts/record-fixtures.ts`, and re-run.

### Project layout

```
src/
  bing-client.ts       # HTTP layer, OData unwrap, date parse, 503 retry, typed errors
  bing-errors.ts       # translateError: BingApiError → user-facing sentence
  tools/               # one file per MCP tool (coming in Lane C)
  index.ts             # MCP server, tool registry, startup validation (Lane E)
scripts/
  record-fixtures.ts   # live Bing API → sanitized golden fixtures
test/
  bing-client.test.ts
  bing-errors.test.ts
  fixtures/
    live/              # captured; populated by record-fixtures.ts
    synthetic/         # hand-crafted edge cases
    REDACTION.md
DESIGN.md              # v0 spec; source of truth
docs/
  bing-api-reference.md
```

### Pre-release checklist (manual)

Before each friendly-customer release, run the inspector and walk these:

- [ ] `list_my_sites` returns the expected sites
- [ ] `setup_check` with a valid key → all checks green
- [ ] `setup_check` with a deliberately-wrong site URL → guided recovery
- [ ] `keyword_opportunity("generative engine optimization")` → 12-week trend
- [ ] `weekly_report` against a site with data → non-empty report
- [ ] `weekly_report` against a fresh property → `empty_state_guidance` set
- [ ] `inspect_url` against a known page → `state=fresh`
- [ ] `inspect_url` against an unknown URL → `state=never_crawled`
- [ ] `push_to_bing` with no IndexNow key file → falls back to Bing-only cleanly
- [ ] `what_are_people_asking` → filtered queries + honest note
- [ ] Invalid API key → stderr banner visible in Claude Desktop MCP log

## Trust and data handling

- Your API key lives in your Claude Desktop config on your own machine. Nothing is ever sent to sitefire.
- Requests go directly from the MCP process on your laptop to Microsoft over HTTPS.
- No database, no telemetry, no analytics in v0.
- Source is MIT-licensed and public; read `src/` before you paste a key if you want to verify.

## Next step

See **[DESIGN.md](DESIGN.md)** for the full v0 architecture, tool specs, test strategy, failure-mode analysis, and timeline.

API reference lives next door: [docs/bing-api-reference.md](docs/bing-api-reference.md).

## Licence

MIT. See [LICENSE](LICENSE).

Built by [sitefire](https://sitefire.ai) (YC W26). Released as a free lead-magnet tool for the GEO community.
