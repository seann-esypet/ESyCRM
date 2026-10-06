import assert from "node:assert/strict";
import test from "node:test";
import { createProviderCreditsReader } from "./providerCredits";

const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
test("only account metadata is requested; only safe credit fields are returned", async () => {
  let calls = 0;
  const reader = createProviderCreditsReader(async input => {
    calls++;
    const url = new URL(String(input));
    assert.equal(url.origin, "https://serpapi.com");
    assert.equal(url.pathname, "/account.json");
    assert.equal(url.searchParams.get("api_key"), "fixture-key");
    return response({ total_searches_left: 0, searches_per_month: 250, this_month_usage: 250,
      api_key: "must-not-leak", account_email: "must-not-leak", account_id: "must-not-leak" });
  }, () => "fixture-key", () => 1000);
  assert.deepEqual(await reader(), { status: "available", remaining: 0, monthlyLimit: 250,
    usedThisMonth: 250, checkedAt: new Date(1000).toISOString() });
  assert.equal(calls, 1);
});

test("concurrent and repeated checks share a cached request, including failures, then refresh", async () => {
  let calls = 0, now = 1000;
  const reader = createProviderCreditsReader(async () => {
    calls++;
    return calls === 1 ? response({ error: "private failure" }, 429) :
      response({ total_searches_left: 30, searches_per_month: 250, this_month_usage: 220 });
  }, () => "fixture-key", () => now);
  const results = await Promise.all([reader(), reader(), reader()]);
  assert.ok(results.every(result => result.status === "unavailable" && result.remaining === null));
  await reader();
  assert.equal(calls, 1);
  now += 60000;
  assert.equal((await reader()).remaining, 30);
  assert.equal(calls, 2);
});

test("missing credentials, malformed metadata, network, HTTP and JSON errors never pretend balance is zero", async () => {
  for (const fetcher of [
    async () => response({ total_searches_left: -1 }),
    async () => response({ total_searches_left: "0" }),
    async () => response({ total_searches_left: 1.5 }),
    async () => response({ error: "sensitive", total_searches_left: 10 }),
    async () => response({}, 401),
    async () => new Response("not json"),
    async () => { throw new Error("credential in URL must not escape"); },
  ]) {
    const result = await createProviderCreditsReader(fetcher, () => "fixture-key")();
    assert.equal(result.status, "unavailable");
    assert.equal(result.remaining, null);
    assert.equal(JSON.stringify(result).includes("sensitive"), false);
  }
  let calls = 0;
  const result = await createProviderCreditsReader(async () => { calls++; return response({}); }, () => undefined)();
  assert.equal(result.remaining, null);
  assert.equal(calls, 0);
});
