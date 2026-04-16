# sitefire-bing-mcp

Get Bing search and AI visibility insights for your website, directly inside Claude Desktop.

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

- **Node.js 18 or newer** installed on your computer ([download here](https://nodejs.org))
- **Claude Desktop** installed on your computer ([download here](https://claude.ai/download))
- **A Bing Webmaster Tools account** (free - you can sign in with your existing Google, Microsoft, or Facebook account)
- **Your Bing API key** (generated inside Bing Webmaster Tools - see steps below)

## Get your Bing API key

1. Go to [bing.com/webmasters](https://www.bing.com/webmasters) and click **Get Started**.
2. Sign in with your **Google**, **Microsoft**, or **Facebook** account. If you have Google Search Console, use your Google account.
3. If your site is not yet in Bing, click **Import** on the My Sites page to pull your sites from Google Search Console. Select the sites you want and click **Import**.
4. Once your site appears in the dashboard, click **Settings** in the left sidebar.
5. Click **API Access**.
6. Click **Generate** to create your API key.
7. Copy the key. You will paste it in the next step.

Data from Bing may take up to 48 hours to appear after you first import your site.

## Install

Open your Claude Desktop configuration file:

- **Mac:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

Add the following to the file (replace `paste-your-key-here` with the API key you copied above):

```json
{
  "mcpServers": {
    "sitefire-bing": {
      "command": "npx",
      "args": ["-y", "github:pulse-energy-eu/sitefire-bing-mcp"],
      "env": {
        "BING_WEBMASTER_API_KEY": "paste-your-key-here"
      }
    }
  }
}
```

If the file already has other MCP servers configured, add the `"sitefire-bing": { ... }` block inside the existing `"mcpServers"` object.

Save the file and **restart Claude Desktop**.

## What you can ask Claude

Once installed, open Claude Desktop and try any of these:

| You ask | What happens |
|---|---|
| "Which sites are connected to my Bing account?" | Lists all your verified sites and their verification status. |
| "Is everything set up correctly for mysite.com?" | Runs a health check on your API key, site verification, sitemap, and data availability. Tells you exactly what to fix if something is off. |
| "How is my site doing on Bing this week?" | Gives you a weekly report with clicks, impressions, top queries, top pages, crawl health, and any issues. |
| "What does Bing know about this URL?" | Inspects a specific page to show when Bing last crawled it, whether it is fresh or stale, and what to do next. |
| "Is 'generative engine optimization' worth writing about?" | Checks Bing search demand for any keyword, including a 12-week trend. Works even before your site has any data. |
| "I just published a new blog post - tell Bing." | Submits a URL directly to Bing for crawling so it gets picked up faster. |
| "What questions bring people to my site from Bing?" | Filters your search queries to surface the natural-language questions real people are asking. |

## Why Bing matters

ChatGPT Search, Microsoft Copilot, and a significant share of Perplexity all pull results from the Bing index. Whatever Bing knows about your site is what these AI tools can cite when answering questions. If you are only tracking Google, you are missing a large piece of your AI visibility.

## Troubleshooting

**"Your Bing API key is invalid"**
Your key may have expired or been copied incorrectly. Go back to [bing.com/webmasters](https://www.bing.com/webmasters), then Settings, then API Access, and generate a new key. Paste it into your Claude Desktop config file and restart Claude Desktop.

**"No data yet" or empty reports**
If you just imported your site, Bing needs up to 48 hours to populate data. In the meantime, try asking about keyword demand for a topic you care about - that works immediately, even without site data.

**"Site not verified" errors**
The site you are asking about is not connected to your Bing account. Go to [bing.com/webmasters](https://www.bing.com/webmasters), click Import, and pull it in from Google Search Console. Then wait a few minutes and try again.

**Claude Desktop does not show the Bing tools**
Make sure your config file is valid JSON (watch for missing commas or extra brackets). Save the file and restart Claude Desktop completely.

## License

MIT. See [LICENSE](LICENSE).

Built by [sitefire](https://sitefire.ai) (YC W26).
