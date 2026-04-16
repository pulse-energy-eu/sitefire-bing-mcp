# Handoff: Claude Desktop config + remaining work

**Context:** We built the v0 walking skeleton of sitefire-bing-mcp (a local
stdio MCP wrapping the Bing Webmaster API). The code is committed and pushed
to `claude/zealous-jennings`. Tests pass (30/30). The MCP server works over
stdio (verified via raw JSON-RPC smoke test). But Claude Desktop is not
picking it up because it overwrites `claude_desktop_config.json` on quit.

## Immediate task: wire up Claude Desktop

Claude Desktop writes its in-memory preferences to
`~/Library/Application Support/Claude/claude_desktop_config.json` on quit.
Our edit got clobbered. Fix:

1. **Quit Claude Desktop** (cmd-Q fully).
2. **Write the config file** with the `mcpServers` block:

```bash
cat > ~/Library/Application\ Support/Claude/claude_desktop_config.json << 'CONF'
{
  "preferences": {
    "launchPreviewPersistSession": true,
    "localAgentModeTrustedFolders": [
      "/Users/jochenmadler/Downloads",
      "/Users/jochenmadler/Library/CloudStorage/GoogleDrive-jochen@sitefire.ai/Shared drives/GDrive | pulse Energy/00 Company Building (Orga, Law, Invest)/05 Y Combinator W26/Company flip"
    ],
    "allowAllBrowserActions": true,
    "dispatchCodeTasksPermissionMode": "bypassPermissions",
    "coworkScheduledTasksEnabled": true,
    "ccdScheduledTasksEnabled": true,
    "sidebarMode": "epitaxy",
    "bypassPermissionsModeEnabled": true,
    "coworkWebSearchEnabled": true,
    "keepAwakeEnabled": true,
    "coworkOnboardingResumeStep": null,
    "chicagoEnabled": true
  },
  "mcpServers": {
    "sitefire-bing": {
      "command": "node",
      "args": [
        "/Users/jochenmadler/programming/work/sitefire-bing-mcp/.claude/worktrees/zealous-jennings/dist/index.js"
      ],
      "env": {
        "BING_WEBMASTER_API_KEY": "64c05cc69cd04be48b7aadde8940a283"
      }
    }
  }
}
CONF
```

3. **Reopen Claude Desktop.**
4. Go to Settings → Developer. `sitefire-bing` should appear in the list.
5. In a new chat, ask: "run `list_my_sites`"

**Expected:** Claude calls the tool and returns verified sites. In the
Developer → sitefire-bing → Logs panel, the stderr banner should say:
`[sitefire-bing-mcp v0.1.0] connected. N verified sites found.`

**Backup** of the original config is at:
`~/Library/Application Support/Claude/claude_desktop_config.json.backup-before-sitefire-bing-mcp`

**Revert:**
```bash
cp ~/Library/Application\ Support/Claude/claude_desktop_config.json.backup-before-sitefire-bing-mcp \
   ~/Library/Application\ Support/Claude/claude_desktop_config.json
```

## What's built (Lanes A + B + D)

- `src/bing-client.ts` — HTTP layer: OData unwrap, `__type` scrub,
  `/Date(ms)/` parsing, 503 retry-once, typed BingApiError
- `src/bing-errors.ts` — translateError mapping all error kinds to
  user-facing sentences
- `src/tools/list-my-sites.ts` — first tool (GetUserSites)
- `src/index.ts` — MCP server, stdio transport, startup validation,
  soft-fail on invalid/missing key
- `scripts/record-fixtures.ts` — live fixture capture with redaction
- `test/fixtures/synthetic/` — 7 edge-case fixtures
- 30/30 tests, clean tsc build

## What's left to build

### Lane C: six remaining tools (each in `src/tools/*.ts` + test)

Order by complexity:
1. `inspect_url` — 4 branches (fresh/stale/never_crawled/not-under-site)
2. `keyword_opportunity` — 4 branches (cross-site, zero-demand, trend dir)
3. `list_my_sites` — DONE
4. `setup_check` — 5 branches (composite: calls up to 4 endpoints)
5. `what_are_people_asking` — 3 branches (query filter + honest note)
6. `weekly_report` — 4 branches (Promise.allSettled fan-out over 5 endpoints)
7. `push_to_bing` — 4 branches (Bing submit + IndexNow graceful fallback)

### Lane E: expand `src/index.ts`

Register all seven tools (currently only `list_my_sites` is registered).

### Pre-v0 checklist

- Record live fixtures: `BING_WEBMASTER_API_KEY=... BING_SITE_URL=https://sitefire.ai/ npm run record-fixtures`
- Inspector walkthrough per README checklist
- Rotate the exposed API key (screenshots in chat showed it)

## Repo location

- Branch: `claude/zealous-jennings`
- Remote: `origin` at `github.com:pulse-energy-eu/sitefire-bing-mcp`
- Worktree: `/Users/jochenmadler/programming/work/sitefire-bing-mcp/.claude/worktrees/zealous-jennings`

## Key design doc

`DESIGN.md` in repo root is the full spec. `docs/bing-api-reference.md`
points to the canonical Bing endpoint reference in the `geo-content` repo.
