import { bingFetch, BingApiError } from "../bing-client.js";
import { translateError } from "../bing-errors.js";

type CheckStatus = "pass" | "fail" | "pending_48h" | "n/a";

interface SetupReport {
  key_valid: boolean;
  sites_count: number;
  sites: string[];
  target_site: string | null;
  checks: {
    site_verified: CheckStatus;
    sitemap_submitted: CheckStatus;
    data_available: CheckStatus;
    crawl_issues_clean: CheckStatus;
  };
  next_actions: string[];
}

export async function setupCheck(
  apiKey: string,
  siteUrl?: string,
): Promise<SetupReport> {
  const report: SetupReport = {
    key_valid: false,
    sites_count: 0,
    sites: [],
    target_site: null,
    checks: {
      site_verified: "n/a",
      sitemap_submitted: "n/a",
      data_available: "n/a",
      crawl_issues_clean: "n/a",
    },
    next_actions: [],
  };

  // Step 1: validate key by fetching sites
  let rawSites: Array<Record<string, unknown>>;
  try {
    const result = await bingFetch({ apiKey, method: "GetUserSites" });
    rawSites = result as Array<Record<string, unknown>>;
    report.key_valid = true;
  } catch (err) {
    if (err instanceof BingApiError && err.code === "INVALID_API_KEY") {
      report.next_actions.push(
        "Your API key is invalid. Regenerate it at bing.com/webmasters, then go to Settings and API Access.",
      );
      return report;
    }
    const userErr = translateError(err);
    report.next_actions.push(userErr.message);
    return report;
  }

  const verifiedSites = rawSites
    .filter((s) => s.IsVerified)
    .map((s) => String(s.Url));

  report.sites = verifiedSites;
  report.sites_count = verifiedSites.length;

  if (verifiedSites.length === 0) {
    report.checks.site_verified = "fail";
    report.next_actions.push(
      "Go to bing.com/webmasters and Import from Google Search Console.",
      "Or add a site manually with DNS, meta tag, or XML file verification.",
    );
    return report;
  }

  // Determine target site
  if (siteUrl) {
    if (verifiedSites.includes(siteUrl)) {
      report.target_site = siteUrl;
    } else {
      report.checks.site_verified = "fail";
      report.next_actions.push(
        `The site "${siteUrl}" is not in your verified sites. Your verified sites are: ${verifiedSites.join(", ")}`,
      );
      return report;
    }
  } else if (verifiedSites.length === 1) {
    report.target_site = verifiedSites[0];
  } else {
    // Multiple sites, no target specified
    report.checks.site_verified = "pass";
    report.next_actions.push(
      `You have ${verifiedSites.length} verified sites. Run setup_check with a specific site_url to check one: ${verifiedSites.join(", ")}`,
    );
    return report;
  }

  report.checks.site_verified = "pass";
  const target = report.target_site;

  // Step 2: check sitemaps
  try {
    const feeds = (await bingFetch({
      apiKey,
      method: "GetFeeds",
      params: { siteUrl: target },
    })) as Array<Record<string, unknown>>;
    report.checks.sitemap_submitted =
      feeds.length > 0 ? "pass" : "fail";
    if (feeds.length === 0) {
      report.next_actions.push(
        `No sitemap found for ${target}. Submit your sitemap at bing.com/webmasters or via push_to_bing.`,
      );
    }
  } catch {
    report.checks.sitemap_submitted = "n/a";
  }

  // Step 3: check data availability
  try {
    const stats = (await bingFetch({
      apiKey,
      method: "GetRankAndTrafficStats",
      params: { siteUrl: target },
    })) as Array<Record<string, unknown>>;
    if (stats.length > 0) {
      report.checks.data_available = "pass";
    } else {
      report.checks.data_available = "pending_48h";
      report.next_actions.push(
        "Traffic data is not yet available. It can take up to 48 hours after verification. In the meantime, try keyword_opportunity to research keywords.",
      );
    }
  } catch {
    report.checks.data_available = "pending_48h";
    report.next_actions.push(
      "Traffic data is not yet available. It can take up to 48 hours after verification. In the meantime, try keyword_opportunity to research keywords.",
    );
  }

  // Step 4: check crawl issues
  try {
    const issues = (await bingFetch({
      apiKey,
      method: "GetCrawlIssues",
      params: { siteUrl: target },
    })) as Array<Record<string, unknown>>;
    report.checks.crawl_issues_clean =
      issues.length === 0 ? "pass" : "fail";
    if (issues.length > 0) {
      report.next_actions.push(
        `${issues.length} crawl issue(s) found. Run weekly_report for details.`,
      );
    }
  } catch {
    report.checks.crawl_issues_clean = "n/a";
  }

  if (report.next_actions.length === 0) {
    report.next_actions.push(
      "Everything looks good. Run weekly_report to see your Bing performance.",
    );
  }

  return report;
}
