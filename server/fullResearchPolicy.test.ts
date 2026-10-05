import assert from "node:assert/strict";
import test from "node:test";
import { FULL_RESEARCH_DEFAULTS, fullResearchLimitsSchema } from "@shared/fullResearch";
import { newFullResearch, readFullResearch, researchAllowance, reserveResearchPaidCall, hasResearchLease, FULL_RESEARCH_HOUR } from "./fullResearchPolicy";

const now = Date.parse("2026-10-05T10:00:00Z");
const fresh = () => newFullResearch({ ...FULL_RESEARCH_DEFAULTS }, now);
test("user-confirmed defaults are 20 businesses/hour, 40 requests/hour, 200 per list", () => {
  assert.deepEqual(fresh().limits, { businessesPerHour: 20, paidCallsPerHour: 40, paidCallsPerList: 200 });
  for (const limits of [
    { ...FULL_RESEARCH_DEFAULTS, businessesPerHour: 0 },
    { ...FULL_RESEARCH_DEFAULTS, paidCallsPerHour: 101 },
    { ...FULL_RESEARCH_DEFAULTS, paidCallsPerList: 0 },
    { ...FULL_RESEARCH_DEFAULTS, paidCallsPerList: 0.5 },
  ]) assert.equal(fullResearchLimitsSchema.safeParse(limits).success, false);
});
test("21st business waits until rolling 60-minute allowance, not the next clock-hour boundary", () => {
  const run = fresh();
  run.startedRows = Array.from({ length: 20 }, (_, id) => ({ id: String(id), at: new Date(now).toISOString() }));
  const block = researchAllowance(run, "business", now + 59 * 60000)!;
  assert.equal(block.status, "waiting_hourly");
  assert.equal(block.nextRunAt, new Date(now + FULL_RESEARCH_HOUR).toISOString());
  assert.equal(researchAllowance(run, "business", now + FULL_RESEARCH_HOUR), null);
});
test("every initiated request uses allowance, including failures and deleted rows", () => {
  const run = fresh();
  for (let i = 0; i < 40; i++) assert.equal(reserveResearchPaidCall(run, `deleted-row-${i}`, "failed_provider", now), null);
  assert.equal(run.attempts.length, 40);
  assert.equal(reserveResearchPaidCall(run, "next", "name_search", now)?.status, "waiting_hourly");
  assert.equal(run.attempts.length, 40);
  assert.equal(reserveResearchPaidCall(run, "next", "name_search", now + FULL_RESEARCH_HOUR), null);
  assert.equal(run.attempts.length, 41);
});
test("business, contact email and name tools share one hourly and whole-list cap", () => {
  const run = fresh();
  for (let hour = 0; hour < 5; hour++) for (let i = 0; i < 40; i++) {
    assert.equal(reserveResearchPaidCall(run, `row-${hour}-${i}`, ["business_search", "email_contact_search", "contact_name_search"][i % 3], now + hour * FULL_RESEARCH_HOUR), null);
  }
  assert.equal(run.attempts.length, 200);
  assert.equal(researchAllowance(run, "paid", now + 10 * FULL_RESEARCH_HOUR)?.status, "budget_exhausted");
  assert.equal(researchAllowance(run, "business", now + 10 * FULL_RESEARCH_HOUR)?.status, "budget_exhausted");
});
test("pause, resume, republish/restart and cap increases retain all paid history", () => {
  const run = fresh();
  reserveResearchPaidCall(run, "row", "business_search", now);
  const restored = readFullResearch(JSON.parse(JSON.stringify(run)))!;
  restored.enabled = false;
  assert.equal(reserveResearchPaidCall(restored, "row", "name_search", now)?.status, "paused");
  restored.enabled = true; restored.limits.paidCallsPerList = 400;
  assert.equal(reserveResearchPaidCall(restored, "row", "name_search", now), null);
  assert.equal(restored.attempts.length, 2);
  assert.equal(restored.attempts[0].at, run.attempts[0].at);
});
test("separate state lists have independent allowances", () => {
  const california = fresh(), texas = fresh();
  for (let i = 0; i < 40; i++) reserveResearchPaidCall(california, String(i), "business_search", now);
  assert.equal(researchAllowance(california, "paid", now)?.status, "waiting_hourly");
  assert.equal(researchAllowance(texas, "paid", now), null);
});
test("allowance reservations serialize concurrent callers and never refund on failure", async () => {
  const run = fresh();
  let attempts = 0;
  await Promise.all(Array.from({ length: 100 }, async (_, i) => {
    if (!reserveResearchPaidCall(run, String(i), "business_search", now)) {
      attempts++;
      // Simulated downstream provider failure: deliberately do not remove ledger entry.
    }
  }));
  assert.equal(attempts, 40);
  assert.equal(run.attempts.length, 40);
});
test("leases persist across process restarts and expire conservatively", () => {
  const run = fresh();
  run.lease = { token: "fixture", expiresAt: new Date(now + 600000).toISOString() };
  const restored = readFullResearch(JSON.parse(JSON.stringify(run)))!;
  assert.equal(hasResearchLease(restored, now), true);
  assert.equal(hasResearchLease(restored, now + 600000), false);
});
test("invalid accounting fails explicitly instead of granting a fresh budget", () => {
  assert.equal(readFullResearch(null), null);
  assert.throws(() => readFullResearch({ ...fresh(), attempts: [{}] }), /accounting is invalid/);
});