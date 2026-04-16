import { bingFetch, BingApiError } from "../bing-client.js";
import { translateError } from "../bing-errors.js";

interface Site {
  url: string;
  is_verified: boolean;
}

interface SiteList {
  sites: Site[];
  count: number;
  next_step: string | null;
}

export async function listMySites(apiKey: string): Promise<SiteList> {
  let raw: unknown;
  try {
    raw = await bingFetch({ apiKey, method: "GetUserSites" });
  } catch (err) {
    const userError = translateError(err);
    return {
      sites: [],
      count: 0,
      next_step: userError.message,
    };
  }

  const sites = (raw as Array<Record<string, unknown>>).map(
    (s): Site => ({
      url: String(s.Url ?? ""),
      is_verified: Boolean(s.IsVerified),
    }),
  );

  return {
    sites,
    count: sites.length,
    next_step:
      sites.length === 0
        ? "You have no verified sites yet. Run setup_check for a step-by-step guide to adding your first one."
        : null,
  };
}
