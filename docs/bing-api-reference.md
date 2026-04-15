# Bing Webmaster API reference

The canonical, live-probed reference for every Bing Webmaster API endpoint we use is maintained in the `geo-content` repo:

> **[pulse-energy-eu/geo-content/tools/bing-webmaster/README.md](https://github.com/pulse-energy-eu/geo-content/blob/main/tools/bing-webmaster/README.md)**

That document covers:

- The cadence table (what to call when: per-publish, daily, weekly, monthly)
- Tier A / B / C / X audit of all 61 tools in the community upstream MCP
- Working endpoints with response shapes verified against `sitefire.ai`
- Broken and deprecated endpoints (`GetRelatedKeywords`, `GetKeyword`, `GetDeepLinkAlgoUrls`) with explanations
- Quirks to code against (`/Date(ms-TZ)/` format, OData `d` unwrap, WCF help page on bad params, numeric error codes)
- Primary sources

It is the source of truth for `bing-client.ts` and `bing-errors.ts` in this repo.

The companion marketing-facing report, with live sitefire data visualized, lives at:

> **[pulse-energy-eu/geo-content/sitefire/bing-webmaster-api-insights.html](https://github.com/pulse-energy-eu/geo-content/blob/main/sitefire/bing-webmaster-api-insights.html)**

That file is the structural reference for what `weekly_report` returns (though in this MCP, we return structured JSON and let the model render; the HTML is human-facing only).
