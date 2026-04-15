# sitefire-bing-mcp

> Local Model Context Protocol server for Bing Webmaster insights, inside Claude Desktop. One API key, zero hosting. Designed for non-technical SEO/GEO professionals.

**Status:** v0 not yet built. Design doc complete and reviewed. Target: 3-4 focused days to friendly-customer validation.

## What this is

A Claude Desktop MCP that wraps the Bing Webmaster API behind seven composite, outcome-named tools. Drop your Bing API key into one config file, restart Claude Desktop, ask Claude questions about your site's Bing and generative-engine visibility.

**Why Bing:** ChatGPT Search, Microsoft Copilot, and a significant slice of Perplexity all retrieve from the Bing index. Whatever Bing knows about your site is, in practice, what generative engines can cite.

## What you need

- Claude Desktop
- A free Bing Webmaster Tools account (sign in with your existing Google / Microsoft / Facebook account)
- Your site verified under that Bing account (one-click if you already use Google Search Console)
- An API key generated in Bing Webmaster Tools → Settings → API Access

## Next step

See **[DESIGN.md](DESIGN.md)** for the v0 architecture, tool specs, test strategy, failure-mode analysis, and timeline. That document is the spec. Implementation follows.

API reference lives next door: [docs/bing-api-reference.md](docs/bing-api-reference.md).

## Licence

MIT. See [LICENSE](LICENSE).

Built by [sitefire](https://sitefire.ai) (YC W26). Released as a free lead-magnet tool for the GEO community.
