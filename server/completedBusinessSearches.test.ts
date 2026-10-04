import assert from "node:assert/strict";
import test from "node:test";
import { completedBusinessSearches } from "../shared/completedBusinessSearches";
test("legacy ZIP searches use real state, ZIP and result fields, including zero", () => {
  const rows = completedBusinessSearches([
    { id: "wy", state: "WY", zipCodes: "82001", status: "completed", totalBusinessesFound: 1 },
    { id: "pa", state: "PA", zipCodes: "19120\n19124\n17603", status: "completed", totalBusinessesFound: 26 },
    { id: "empty", state: "PA", zipCodes: "19102", status: "completed", totalBusinessesFound: 0 },
  ], []);
  assert.equal(rows[0].title, "WY · ZIP 82001");
  assert.equal(rows[1].title, "PA · ZIP 19120, 19124, 17603");
  assert.equal(rows[1].resultCount, 26);
  assert.equal(rows[2].resultCount, 0);
});
test("completed nationwide runs group their state jobs without hiding orphaned or unfinished-parent results", () => {
  const rows = completedBusinessSearches([
    { id: "child", state: "WY", status: "completed", nationalJobId: "national", totalBusinessesFound: 1 },
    { id: "orphan", state: "WI", status: "completed", nationalJobId: "missing", totalBusinessesFound: 2 },
    { id: "partial", state: "TX", status: "completed", nationalJobId: "running", totalBusinessesFound: 3 },
    { id: "failed", status: "failed" },
  ], [
    { id: "national", status: "completed", statesTotal: 50, leadsFound: 51 },
    { id: "running", status: "running" },
  ]);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].title, "Nationwide search · 50 states");
  assert.equal(rows[0].resultCount, 51);
  assert.equal(rows[0].children[0].job.id, "child");
  assert.deepEqual(rows.slice(1).map(row => row.job.id), ["orphan", "partial"]);
});
test("unknown counts are not invented and completed named fixtures remain compatible", () => {
  const [row] = completedBusinessSearches([{ id: "x", name: "Named search", status: "complete" }], []);
  assert.equal(row.title, "Named search");
  assert.equal(row.resultCount, null);
});