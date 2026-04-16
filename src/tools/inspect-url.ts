import { bingFetch } from "../bing-client.js";
import { translateError } from "../bing-errors.js";

interface UrlInspection {
  url: string;
  is_page: boolean;
  discovered_at: string | null;
  last_crawled_at: string | null;
  crawl_age_days: number | null;
  anchor_count: number;
  document_size_bytes: number;
  http_status: number;
  interpretation: {
    state: "fresh" | "stale" | "never_crawled" | "not_a_page";
    summary: string;
    recommended_action: string | null;
  };
}

export async function inspectUrl(
  apiKey: string,
  url: string,
  siteUrl: string,
): Promise<UrlInspection> {
  let raw: Record<string, unknown>;
  try {
    raw = (await bingFetch({
      apiKey,
      method: "GetUrlInfo",
      params: { siteUrl, url },
    })) as Record<string, unknown>;
  } catch (err) {
    const userErr = translateError(err, { url, siteUrl });
    throw new Error(userErr.message);
  }

  const isPage = Boolean(raw.IsPage);
  const discoveredAt = (raw.DiscoveryDate ?? raw.DateDiscovered ?? null) as string | null;
  const lastCrawledAt = (raw.LastCrawledDate ?? null) as string | null;

  let crawlAgeDays: number | null = null;
  if (lastCrawledAt) {
    const crawlDate = new Date(lastCrawledAt);
    crawlAgeDays = Math.floor(
      (Date.now() - crawlDate.getTime()) / (1000 * 60 * 60 * 24),
    );
  }

  const interpretation = interpretState(isPage, lastCrawledAt, crawlAgeDays);

  return {
    url: String(raw.Url ?? url),
    is_page: isPage,
    discovered_at: discoveredAt,
    last_crawled_at: lastCrawledAt,
    crawl_age_days: crawlAgeDays,
    anchor_count: Number(raw.AnchorCount ?? 0),
    document_size_bytes: Number(raw.DocumentSize ?? 0),
    http_status: Number(raw.HttpStatus ?? 0),
    interpretation,
  };
}

function interpretState(
  isPage: boolean,
  lastCrawledAt: string | null,
  crawlAgeDays: number | null,
): UrlInspection["interpretation"] {
  if (!isPage && !lastCrawledAt) {
    return {
      state: "never_crawled",
      summary:
        "Bing has not crawled this URL. It may be new or not yet discovered.",
      recommended_action:
        "Submit it with push_to_bing to notify Bing about this URL.",
    };
  }

  if (!isPage) {
    return {
      state: "not_a_page",
      summary:
        "Bing knows about this URL but does not consider it a page (it may be a redirect, a resource file, or blocked by robots.txt).",
      recommended_action: null,
    };
  }

  if (crawlAgeDays !== null && crawlAgeDays > 60) {
    return {
      state: "stale",
      summary: `Bing last crawled this page ${crawlAgeDays} days ago. The content in Bing's index may be outdated.`,
      recommended_action:
        "Submit it with push_to_bing to request a fresh crawl.",
    };
  }

  return {
    state: "fresh",
    summary: crawlAgeDays !== null
      ? `Bing crawled this page ${crawlAgeDays} day(s) ago. The index is up to date.`
      : "Bing has crawled this page recently.",
    recommended_action: null,
  };
}
