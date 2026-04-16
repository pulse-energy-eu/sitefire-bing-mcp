# Local setup notes — what we changed on this machine

Record of machine-local changes made during v0 development, so they can be
reverted cleanly. Each entry: what, where, when, why, how to revert.

## Claude Desktop config — register `sitefire-bing` as a local MCP server

**When:** 2026-04-15
**Why:** Walking-skeleton validation — wire the built MCP into Claude Desktop via the stdio/config-file path so we can test `list_my_sites` end-to-end before packaging as `.dxt` or hosting remotely.

**What changed:**

- File: `/Users/jochenmadler/Library/Application Support/Claude/claude_desktop_config.json`
- Added top-level `mcpServers` block with one entry: `sitefire-bing`, pointing at `dist/index.js` in this worktree.
- Pre-change backup: `claude_desktop_config.json.backup-before-sitefire-bing-mcp` in the same directory.
- Existing `preferences` block preserved verbatim.

**Caveat:** the path is absolute and points into a git worktree. If you delete
the worktree or rename the branch, the MCP will fail to launch. Claude Desktop
will log the failure in Settings → Developer → sitefire-bing → Logs; it does
not crash the app.

**How to revert:**

```bash
cp '/Users/jochenmadler/Library/Application Support/Claude/claude_desktop_config.json.backup-before-sitefire-bing-mcp' \
   '/Users/jochenmadler/Library/Application Support/Claude/claude_desktop_config.json'
rm  '/Users/jochenmadler/Library/Application Support/Claude/claude_desktop_config.json.backup-before-sitefire-bing-mcp'
```

Then quit and reopen Claude Desktop. The MCP entry disappears.

**How to update the path later (e.g. after merging to main and building in a non-worktree location):**

Edit the `args[0]` path in `mcpServers.sitefire-bing.args` to point at the new `dist/index.js`.

## API key placement

The config currently holds a real Bing Webmaster API key in plaintext at
`mcpServers.sitefire-bing.env.BING_WEBMASTER_API_KEY`. The key is the one
visible in chat screenshots on 2026-04-15 and is due for rotation once
validation passes. Until then it is sufficient for local testing.

The key is read from `env.BING_WEBMASTER_API_KEY` at MCP process start. If
absent, the server still starts but every tool call returns setup guidance
instead of failing. That is by design (see DESIGN.md § Startup behavior).

## Nothing else modified

No other files on the machine were changed by this setup. No global npm installs,
no shell profile edits, no LaunchAgents, no system keychain entries.
