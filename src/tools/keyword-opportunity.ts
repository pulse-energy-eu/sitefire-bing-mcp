import { bingFetch } from "../bing-client.js";
import { translateError } from "../bing-errors.js";

interface WeekData {
  week_start: string;
  exact_impressions: number;
  broad_impressions: number;
}

interface KeywordOpportunity {
  keyword: string;
  country: string;
  language: string;
  weekly_trend: WeekData[];
  trend_direction: "up" | "down" | "flat";
  latest_week_impressions: number;
  has_demand: boolean;
}

export async function keywordOpportunity(
  apiKey: string,
  keyword: string,
  country = "us",
  language = "en-US",
): Promise<KeywordOpportunity> {
  let raw: Array<Record<string, unknown>>;
  try {
    raw = (await bingFetch({
      apiKey,
      method: "GetKeywordStats",
      params: {
        q: keyword,
        country,
        language,
      },
    })) as Array<Record<string, unknown>>;
  } catch (err) {
    const userErr = translateError(err);
    throw new Error(userErr.message);
  }

  const weeklyTrend: WeekData[] = raw
    .map((row) => ({
      week_start: String(row.Date ?? ""),
      exact_impressions: Number(row.Impressions ?? row.ExactImpressions ?? 0),
      broad_impressions: Number(row.BroadImpressions ?? 0),
    }))
    .sort((a, b) => a.week_start.localeCompare(b.week_start))
    .slice(-12);

  const latestWeek = weeklyTrend[weeklyTrend.length - 1];
  const latestImpressions = latestWeek
    ? latestWeek.broad_impressions
    : 0;

  const hasDemand = weeklyTrend.some(
    (w) => w.broad_impressions > 0 || w.exact_impressions > 0,
  );

  const direction = computeTrendDirection(weeklyTrend);

  return {
    keyword,
    country,
    language,
    weekly_trend: weeklyTrend,
    trend_direction: direction,
    latest_week_impressions: latestImpressions,
    has_demand: hasDemand,
  };
}

function computeTrendDirection(
  trend: WeekData[],
): "up" | "down" | "flat" {
  if (trend.length < 2) return "flat";

  const firstHalf = trend.slice(0, Math.floor(trend.length / 2));
  const secondHalf = trend.slice(Math.floor(trend.length / 2));

  const avgFirst =
    firstHalf.reduce((sum, w) => sum + w.broad_impressions, 0) /
    firstHalf.length;
  const avgSecond =
    secondHalf.reduce((sum, w) => sum + w.broad_impressions, 0) /
    secondHalf.length;

  // Zero-to-nonzero is "up", nonzero-to-zero is "down"
  if (avgFirst === 0 && avgSecond > 0) return "up";
  if (avgFirst === 0) return "flat";

  const change = (avgSecond - avgFirst) / avgFirst;
  if (change > 0.1) return "up";
  if (change < -0.1) return "down";
  return "flat";
}
