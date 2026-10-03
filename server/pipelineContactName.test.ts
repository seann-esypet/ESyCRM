import assert from "node:assert/strict";
import test from "node:test";
import { pipelineContactOwnerName } from "../shared/pipelineContactName";
const ownerName = {
  status: "needs_review", approvedAt: "2026-10-03T12:00:00Z", selectedCandidateId: "owner-jane",
  usePersonalName: false, providerCalls: 0, pagesFetched: 1,
  candidates: [{ id: "owner-jane", firstName: "Jane", lastName: "Smith", role: "owner",
    roleConfirmed: true, businessMatched: true, confidence: "high", sources: [] }],
};
test("pipeline displays an approved imported owner even when personal email greetings are disabled", () => {
  const contact = { firstName: "Jane", lastName: "Smith", company: "Fixture Salon", notes: JSON.stringify({
    enrichmentRowId: "row", evidence: { ownerName: { ...ownerName, approvedAt: null } },
    salonOwnerNameApplication: { rowId: "row", candidateId: "owner-jane", firstName: "Jane", lastName: "Smith" },
  }) };
  assert.equal(pipelineContactOwnerName(contact), "Jane Smith");
  assert.equal(pipelineContactOwnerName({ ...contact, firstName: null, lastName: null }), null);
  assert.equal(pipelineContactOwnerName({ ...contact, firstName: "Updated", lastName: "Owner" }), "Updated Owner");
  assert.equal(pipelineContactOwnerName({ ...contact, notes: JSON.stringify({
    enrichmentRowId: "row", evidence: { ownerName: { ...ownerName, approvedAt: null } }, firstName: null,
  }), firstName: null, lastName: null }), null);
});
test("pipeline preserves manually saved names, handles first-name-only owners and never substitutes the company", () => {
  assert.equal(pipelineContactOwnerName({ firstName: "Jane", lastName: null }), "Jane");
  assert.equal(pipelineContactOwnerName({ firstName: "Jane", lastName: "Smith", notes: "Manual contact" }), "Jane Smith");
  assert.equal(pipelineContactOwnerName({ firstName: "Fixture Salon", company: "Fixture Salon" }), null);
  assert.equal(pipelineContactOwnerName({ firstName: null, lastName: null, company: "Fixture Salon" }), null);
  assert.equal(pipelineContactOwnerName({ firstName: "Unknown" }), null);
});