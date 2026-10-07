import assert from "node:assert/strict";
import test from "node:test";
import type { SalonEnrichmentRow } from "@shared/schema";
import { leadResearchResults, filterLeadResearchRows } from "./leadResearchResults";

const row = (id: string, patch = {}) => ({
  id, businessName: `Business ${id}`, status: "rejected", reviewStatus: "needs_review",
  sourceData: { stagingState: "staged_unverified" }, processedAt: new Date(), ...patch,
} as SalonEnrichmentRow);

test("uploaded/reviewable rows are not research successes; six attempts remain discoverable beyond pagination", () => {
  const rows = Array.from({ length: 4906 }, (_, i) => row(String(i)));
  const researched = rows.slice(4800, 4806);
  for (const item of researched.slice(0, 5)) {
    item.status = "enriched"; item.identityMatchStatus = "strong";
  }
  researched[5].status = "failed";
  researched[5].lastError = "SERP quota or hourly limit reached (20/hour). Please wait.";
  const progress = { fullResearch: { startedRows: researched.map(item => ({ id: item.id })),
    attempts: [], processedIds: researched.map(item => item.id) } };
  const result = leadResearchResults(rows, progress);
  assert.deepEqual(result.summary, { uploaded: 4906, attempted: 6, finished: 5, waiting: 1, failed: 0, emails: 0,
    notResearched: 4900, needsReview: 5, readyForContacts: 0, addedToContacts: 0 });
  assert.equal(result.states.get("0"), "not_started");
  const found = filterLeadResearchRows(rows, result.states, "researched", "");
  assert.equal(found.length, 6);
  assert.deepEqual(found.slice(0, 50).map(item => item.id), researched.map(item => item.id));
  assert.equal(filterLeadResearchRows(rows, result.states, "researched", "4805").length, 1);
  assert.equal(filterLeadResearchRows(rows, result.states, "all", "").length, 4906);
  assert.equal(filterLeadResearchRows(rows, result.states, "needs_review", "").length, 5);
  assert.equal(filterLeadResearchRows(rows, result.states, "ready_for_contacts", "").length, 0);
});

test("researching, new hourly waits, genuine failures and review-only email findings have distinct counts", () => {
  const rows = [
    row("running", { status: "processing" }),
    row("waiting", { status: "pending", sourceData: { stagingState: "verification_attempted", fullResearchState: "waiting_hourly" } }),
    row("failed", { status: "failed", lastError: "Provider failed", sourceData: { stagingState: "verification_attempted" } }),
    row("email", { status: "enriched", email: "contact@fixture.example", reviewStatus: "needs_review", sourceData: { stagingState: "verification_attempted" } }),
    row("uploaded", { email: "uploaded@fixture.example" }),
  ];
  const result = leadResearchResults(rows, {});
  assert.deepEqual(result.summary, { uploaded: 5, attempted: 4, finished: 1, waiting: 1, failed: 1, emails: 1,
    notResearched: 1, needsReview: 1, readyForContacts: 0, addedToContacts: 0 });
  assert.equal(result.states.get("running"), "researching");
  assert.equal(result.states.get("failed"), "failed");
  assert.equal(result.states.get("uploaded"), "not_started");
  assert.equal(rows[3].reviewStatus, "needs_review", "classification never approves findings");
});

test("failed research, rejected reviews and approved reviews sort last without hiding any businesses", () => {
  const rows = [
    row("approved", { reviewStatus: "approved" }),
    row("failed", { status: "failed", sourceData: { stagingState: "verification_attempted" } }),
    row("review-first", { status: "enriched", sourceData: { stagingState: "verification_attempted" } }),
    row("rejected", { reviewStatus: "rejected" }),
    row("hourly", { status: "failed", lastError: "SERP quota or hourly limit reached (20/hour). Please wait.",
      sourceData: { stagingState: "verification_attempted" } }),
    row("staged", { status: "rejected", reviewStatus: "needs_review" }),
    row("review-second", { status: "enriched", sourceData: { stagingState: "verification_attempted" } }),
  ];
  const original = rows.map(item => item.id);
  const { states } = leadResearchResults(rows, {});
  assert.deepEqual(filterLeadResearchRows(rows, states, "all", "").map(item => item.id),
    ["review-first", "hourly", "staged", "review-second", "approved", "failed", "rejected"]);
  assert.deepEqual(rows.map(item => item.id), original, "sorting never mutates the stored/input order");
  assert.equal(states.get("hourly"), "waiting_hourly");
  assert.deepEqual(filterLeadResearchRows(rows, states, "needs_review", "").map(item => item.id),
    ["review-first", "review-second"]);
  assert.deepEqual(filterLeadResearchRows(rows, states, "all", "approved").map(item => item.id), ["approved"]);
  assert.deepEqual(filterLeadResearchRows(rows, states, "researched", "").map(item => item.id),
    ["review-first", "hourly", "review-second", "failed"]);
});

test("outstanding reviews appear ahead of completed reviews across pagination boundaries", () => {
  const rows = [
    ...Array.from({ length: 150 }, (_, i) => row(`approved-${i}`, { reviewStatus: "approved" })),
    ...Array.from({ length: 125 }, (_, i) => row(`review-${i}`, {
      status: "enriched", sourceData: { stagingState: "verification_attempted" },
    })),
  ];
  const { states, summary } = leadResearchResults(rows, {});
  const sorted = filterLeadResearchRows(rows, states, "all", "");
  assert.equal(sorted.length, 275);
  assert.deepEqual(sorted.slice(0, 100).map(item => item.id),
    Array.from({ length: 100 }, (_, i) => `review-${i}`));
  assert.equal(sorted[124].id, "review-124");
  assert.equal(sorted[125].id, "approved-0");
  assert.equal(new Set(sorted.map(item => item.id)).size, 275);
  assert.equal(summary.needsReview, 125, "display ordering never changes research/review counts");
});

test("status changes move a business down and reopening review restores its original priority", () => {
  const rows = ["first", "second", "third", "fourth"].map(id => row(id, {
    status: "enriched", sourceData: { stagingState: "verification_attempted" },
  }));
  const order = () => filterLeadResearchRows(rows, leadResearchResults(rows, {}).states, "all", "").map(item => item.id);
  assert.deepEqual(order(), ["first", "second", "third", "fourth"]);
  rows[0].reviewStatus = "approved";
  assert.deepEqual(order(), ["second", "third", "fourth", "first"]);
  rows[1].reviewStatus = "rejected";
  rows[2].status = "failed";
  assert.deepEqual(order(), ["fourth", "first", "second", "third"]);
  rows[0].reviewStatus = "needs_review";
  assert.deepEqual(order(), ["first", "fourth", "second", "third"]);
});
