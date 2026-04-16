import { bingFetch } from "../bing-client.js";
import { translateError } from "../bing-errors.js";

interface QueryRow {
  query: string;
  impressions: number;
  clicks: number;
}

interface PageRow {
  page: string;
  impressions: number;
  clicks: number;
}

interface CrawlIssue {
  severity: number;
  issue_code: number;
  message: string;
  count: number;
}

interface WeeklyReport {
  period: { start: string; end: string };
  site_url: string;
  is_new_property: boolean;
  rollup: {
    clicks: number;
    impressions: number;
    queries_count: number;
    pages_count: number;
  } | null;
  top_queries: QueryRow[];
  top_pages: PageRow[];
  crawl_health: {
    status_2xx_count: number;
    errors_4xx_count: number;
    errors_5xx_count: number;
    dns_failures: number;
    blocked_by_robots: number;
  };
  crawl_issues: CrawlIssue[];
  sitemap_count: number;
  partial_failures: string[];
  empty_state_guidance: string | null;
}

export async function weeklyReport(
  apiKey: string,
  siteUrl: string,
): Promise<WeeklyReport> {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const period = {
    start: weekAgo.toISOString().split("T")[0],
    end: now.toISOString().split("T")[0],
  };

  const partialFailures: string[] = [];

  const [queriesResult, pagesResult, crawlResult, issuesResult, feedsResult] =
    await Promise.allSettled([
      bingFetch({
        apiKey,
        method: "GetQueryStats",
        params: { siteUrl },
      }),
      bingFetch({
        apiKey,
        method: "GetPageStats",
        params: { siteUrl },
      }),
      bingFetch({
        apiKey,
        method: "GetCrawlStats",
        params: { siteUrl },
      }),
      bingFetch({
        apiKey,
        method: "GetCrawlIssues",
        params: { siteUrl },
      }),
      bingFetch({
        apiKey,
        method: "GetFeeds",
        params: { siteUrl },
      }),
    ]);

  // Extract queries
  let allQueries: QueryRow[] = [];
  let topQueries: QueryRow[] = [];
  if (queriesResult.status === "fulfilled") {
    const raw = queriesResult.value as Array<Record<string, unknown>>;
    allQueries = raw.map((r) => ({
      query: String(r.Query ?? ""),
      impressions: Number(r.Impressions ?? 0),
      clicks: Number(r.Clicks ?? 0),
    }));
    topQueries = [...allQueries]
      .sort((a, b) => b.impressions - a.impressions)
      .slice(0, 10);
  } else {
    partialFailures.push("GetQueryStats");
  }

  // Extract pages
  let allPages: PageRow[] = [];
  let topPages: PageRow[] = [];
  if (pagesResult.status === "fulfilled") {
    const raw = pagesResult.value as Array<Record<string, unknown>>;
    allPages = raw.map((r) => ({
      page: String(r.Query ?? r.Page ?? ""),
      impressions: Number(r.Impressions ?? 0),
      clicks: Number(r.Clicks ?? 0),
    }));
    topPages = [...allPages]
      .sort((a, b) => b.impressions - a.impressions)
      .slice(0, 10);
  } else {
    partialFailures.push("GetPageStats");
  }

  // Extract crawl health
  let crawlHealth = {
    status_2xx_count: 0,
    errors_4xx_count: 0,
    errors_5xx_count: 0,
    dns_failures: 0,
    blocked_by_robots: 0,
  };
  if (crawlResult.status === "fulfilled") {
    const raw = crawlResult.value as Array<Record<string, unknown>>;
    if (raw.length > 0) {
      const sorted = [...raw].sort((a, b) =>
        String(a.Date ?? "").localeCompare(String(b.Date ?? "")),
      );
      const latest = sorted[sorted.length - 1];
      crawlHealth = {
        status_2xx_count: Number(latest.Code2xx ?? latest.StatusCode2xx ?? 0),
        errors_4xx_count: Number(latest.Code4xx ?? latest.StatusCode4xx ?? 0),
        errors_5xx_count: Number(latest.Code5xx ?? latest.StatusCode5xx ?? 0),
        dns_failures: Number(latest.DnsFailures ?? 0),
        blocked_by_robots: Number(latest.BlockedByRobotsTxt ?? 0),
      };
    }
  } else {
    partialFailures.push("GetCrawlStats");
  }

  // Extract crawl issues
  let crawlIssues: CrawlIssue[] = [];
  if (issuesResult.status === "fulfilled") {
    const raw = issuesResult.value as Array<Record<string, unknown>>;
    crawlIssues = raw.map((r) => ({
      severity: Number(r.Severity ?? 0),
      issue_code: Number(r.IssueCode ?? 0),
      message: String(r.Message ?? ""),
      count: Number(r.Count ?? 0),
    }));
  } else {
    partialFailures.push("GetCrawlIssues");
  }

  // Extract sitemaps count
  let sitemapCount = 0;
  if (feedsResult.status === "fulfilled") {
    const raw = feedsResult.value as Array<Record<string, unknown>>;
    sitemapCount = raw.length;
  } else {
    partialFailures.push("GetFeeds");
  }

  // Compute rollup from ALL queries, not just top 10
  const totalClicks = allQueries.reduce((s, q) => s + q.clicks, 0);
  const totalImpressions = allQueries.reduce(
    (s, q) => s + q.impressions,
    0,
  );

  const isNewProperty =
    allQueries.length === 0 &&
    allPages.length === 0 &&
    totalImpressions === 0;

  const rollup = isNewProperty
    ? null
    : {
        clicks: totalClicks,
        impressions: totalImpressions,
        queries_count: allQueries.length,
        pages_count: allPages.length,
      };

  const emptyStateGuidance = isNewProperty
    ? "This looks like a fresh Bing property. Data takes up to 48 hours to populate after verification. In the meantime, try keyword_opportunity for a specific term you care about, or push_to_bing for a new article."
    : null;

  return {
    period,
    site_url: siteUrl,
    is_new_property: isNewProperty,
    rollup,
    top_queries: topQueries,
    top_pages: topPages,
    crawl_health: crawlHealth,
    crawl_issues: crawlIssues,
    sitemap_count: sitemapCount,
    partial_failures: partialFailures,
    empty_state_guidance: emptyStateGuidance,
  };
}
