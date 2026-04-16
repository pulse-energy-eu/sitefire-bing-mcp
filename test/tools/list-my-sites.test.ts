import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { createBingClient } from "../../src/bing-client.js";
import { listMySites, listMySitesSafe, SiteListSchema } from "../../src/tools/list-my-sites.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureDir = resolve(__dirname, "..", "fixtures", "synthetic");
const readFixture = (name: string): string => readFileSync(resolve(fixtureDir, name), "utf8");

const respond = (body: string, status = 200): Response =>
  new Response(body, { status, headers: { "Content-Type": "application/json" } });

const noSleep = async (): Promise<void> => {};

describe("list_my_sites", () => {
  it("returns structured sites with verification method derived from Bing flags", async () => {
    const fixture = readFixture("get-user-sites-happy.json");
    const client = createBingClient({
      apiKey: "k",
      sleepImpl: noSleep,
      fetchImpl: async () => respond(fixture),
    });

    const result = await listMySites(client);

    // Schema round-trip proves the response matches the documented contract.
    expect(() => SiteListSchema.parse(result)).not.toThrow();

    expect(result.count).toBe(2);
    expect(result.next_step).toBeNull();
    expect(result.sites).toEqual([
      {
        url: "https://sitefire.ai/",
        is_verified: true,
        verification_method: "xml",
      },
      {
        url: "https://www.sitefire.ai/",
        is_verified: true,
        verification_method: "dns",
      },
    ]);
  });

  it("returns an empty list with a setup_check pointer when the account has no sites", async () => {
    const fixture = readFixture("empty-account.json");
    const client = createBingClient({
      apiKey: "k",
      sleepImpl: noSleep,
      fetchImpl: async () => respond(fixture),
    });

    const result = await listMySites(client);

    expect(result.count).toBe(0);
    expect(result.sites).toEqual([]);
    expect(result.next_step).not.toBeNull();
    expect(result.next_step).toContain("setup_check");
  });

  it("surfaces invalid-key errors via translateError when called safely", async () => {
    const client = createBingClient({
      apiKey: "bad",
      sleepImpl: noSleep,
      fetchImpl: async () =>
        respond(JSON.stringify({ ErrorCode: 3, Message: "Invalid API key." })),
    });

    const outcome = await listMySitesSafe(client);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("unreachable");
    expect(outcome.message).toContain("Your Bing API key is invalid");
  });

  it("safe wrapper returns ok on the happy path", async () => {
    const fixture = readFixture("get-user-sites-happy.json");
    const client = createBingClient({
      apiKey: "k",
      sleepImpl: noSleep,
      fetchImpl: async () => respond(fixture),
    });

    const outcome = await listMySitesSafe(client);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("unreachable");
    expect(outcome.data.count).toBe(2);
  });
});
