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
