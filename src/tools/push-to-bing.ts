import { bingFetch, BingApiError } from "../bing-client.js";
import { translateError } from "../bing-errors.js";

interface PushResult {
  url: string;
  bing_submit: {
    status: "ok" | "quota_exhausted" | "error";
    message: string;
    quota_remaining_today: number | null;
  };
  indexnow: {
    status: "ok" | "key_file_missing" | "error" | "skipped";
    message: string;
  };
}

export async function pushToBing(
  apiKey: string,
  url: string,
  siteUrl: string,
): Promise<PushResult> {
  const result: PushResult = {
    url,
    bing_submit: {
      status: "error",
      message: "",
      quota_remaining_today: null,
    },
    indexnow: {
      status: "skipped",
      message: "IndexNow submission skipped.",
    },
  };

  // Bing URL submission
  try {
    await bingFetch({
      apiKey,
      method: "SubmitUrlBatch",
      httpMethod: "POST",
      body: { siteUrl, urlList: [url] },
    });
    result.bing_submit = {
      status: "ok",
      message: `Successfully submitted ${url} to Bing for crawling.`,
      quota_remaining_today: null,
    };
  } catch (err) {
    if (err instanceof BingApiError) {
      if (err.rawCode === 18) {
        result.bing_submit = {
          status: "quota_exhausted",
          message:
            "Daily URL submission quota has been exhausted. Try again tomorrow.",
          quota_remaining_today: 0,
        };
      } else {
        const userErr = translateError(err, { url, siteUrl });
        result.bing_submit = {
          status: "error",
          message: userErr.message,
          quota_remaining_today: null,
        };
      }
    } else {
      result.bing_submit = {
        status: "error",
        message: "Unexpected error submitting to Bing. Try again.",
        quota_remaining_today: null,
      };
    }
  }

  // Skip IndexNow if Bing submission failed (no point notifying other engines)
  if (result.bing_submit.status !== "ok") {
    return result;
  }

  // IndexNow submission - uses a separate key, NOT the Bing API key
  const indexNowKey = process.env.INDEXNOW_KEY ?? "";
  if (!indexNowKey) {
    result.indexnow = {
      status: "skipped",
      message:
        "IndexNow skipped. Set the INDEXNOW_KEY environment variable to enable multi-engine URL submission via IndexNow.",
    };
    return result;
  }

  try {
    const keyFileUrl = `${siteUrl}${siteUrl.endsWith("/") ? "" : "/"}${indexNowKey}.txt`;
    let keyFileExists = false;
    try {
      const headResponse = await fetch(keyFileUrl, { method: "HEAD" });
      keyFileExists = headResponse.ok;
    } catch {
      keyFileExists = false;
    }

    if (!keyFileExists) {
      result.indexnow = {
        status: "key_file_missing",
        message: `IndexNow key file not found at ${keyFileUrl}. Create a text file at that URL containing your IndexNow key. Bing submission still worked independently.`,
      };
    } else {
      const indexNowResponse = await fetch(
        "https://api.indexnow.org/indexnow",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            host: new URL(siteUrl).hostname,
            key: indexNowKey,
            urlList: [url],
          }),
        },
      );

      if (indexNowResponse.ok || indexNowResponse.status === 202) {
        result.indexnow = {
          status: "ok",
          message: "IndexNow notification sent successfully.",
        };
      } else {
        result.indexnow = {
          status: "error",
          message: `IndexNow returned HTTP ${indexNowResponse.status}. The Bing submission still worked independently.`,
        };
      }
    }
  } catch {
    result.indexnow = {
      status: "error",
      message:
        "Could not reach the IndexNow API. The Bing submission still worked independently.",
    };
  }

  return result;
}
