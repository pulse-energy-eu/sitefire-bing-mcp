import { bingFetch } from "../bing-client.js";

const QUESTION_WORDS = new Set([
  "how",
  "what",
  "why",
  "when",
  "which",
  "does",
  "can",
  "is",
]);

interface QueryRow {
  query: string;
  impressions: number;
  clicks: number;
}

interface FilteredQueries {
  site_url: string;
  period: { start: string; end: string };
  natural_language_queries: QueryRow[];
  filter_criteria: {
    min_words: 5;
    or_has_question_word: true;
  };
  total_queries_seen: number;
  matched_count: number;
  note: string;
}

function isNaturalLanguageQuery(query: string): boolean {
  const words = query.trim().split(/\s+/);
  if (words.length >= 5) return true;
  const firstWord = words[0]?.toLowerCase();
  if (firstWord && QUESTION_WORDS.has(firstWord)) return true;
  return false;
}

export async function whatArePeopleAsking(
  apiKey: string,
  siteUrl: string,
): Promise<FilteredQueries> {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const raw = (await bingFetch({
    apiKey,
    method: "GetQueryStats",
    params: { siteUrl },
  })) as Array<Record<string, unknown>>;

  const allQueries: QueryRow[] = raw.map((r) => ({
    query: String(r.Query ?? ""),
    impressions: Number(r.Impressions ?? 0),
    clicks: Number(r.Clicks ?? 0),
  }));

  const filtered = allQueries
    .filter((q) => isNaturalLanguageQuery(q.query))
    .sort((a, b) => b.impressions - a.impressions);

  return {
    site_url: siteUrl,
    period: {
      start: weekAgo.toISOString().split("T")[0],
      end: now.toISOString().split("T")[0],
    },
    natural_language_queries: filtered,
    filter_criteria: {
      min_words: 5,
      or_has_question_word: true,
    },
    total_queries_seen: allQueries.length,
    matched_count: filtered.length,
    note: "This is a filtered view of GetQueryStats. It shows queries with 5 or more words, or those starting with a question word (how, what, why, etc.). These tend to represent the natural-language questions people type into Bing and Copilot.",
  };
}
