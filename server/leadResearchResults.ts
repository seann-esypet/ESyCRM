import type { SalonEnrichmentRow } from "@shared/schema";
import { directoryObject, directoryEligibility } from "@shared/directoryEligibility";
import { isHourlyResearchError } from "./fullResearchPolicy";

export type LeadResearchState = "not_started" | "researching" | "researched" | "waiting_hourly" | "failed";
export function leadNeedsReview(row: SalonEnrichmentRow, state: LeadResearchState | undefined) {
  return state === "researched" && !row.importedContactId && !["approved", "rejected"].includes(row.reviewStatus);
}
export function leadReadyForContacts(row: SalonEnrichmentRow) {
  return !!row.email?.trim() && row.reviewStatus === "approved" && !row.importedContactId && !directoryEligibility(row).blocked;
}

export function leadResearchResults(rows: SalonEnrichmentRow[], progress: unknown) {
  const run = directoryObject(directoryObject(progress).fullResearch);
  const started = new Set(
    (Array.isArray(run.startedRows) ? run.startedRows : []).map(item => String(directoryObject(item).id)),
  );
  for (const attempt of Array.isArray(run.attempts) ? run.attempts : []) {
    started.add(String(directoryObject(attempt).rowId));
  }
  const states = new Map<string, LeadResearchState>();
  const summary = { uploaded: rows.length, attempted: 0, finished: 0, waiting: 0, failed: 0, emails: 0,
    notResearched: 0, needsReview: 0, readyForContacts: 0, addedToContacts: 0 };
  for (const row of rows) {
    const source = directoryObject(row.sourceData);
    const attempted = started.has(row.id) || source.stagingState === "verification_attempted" || row.status === "processing";
    let state: LeadResearchState = "not_started";
    if (attempted) {
      if (row.status === "processing") state = "researching";
      else if (source.fullResearchState === "waiting_hourly" ||
          (row.status === "failed" && isHourlyResearchError(row.lastError))) state = "waiting_hourly";
      else if (row.status === "failed" || source.fullResearchState === "paused") state = "failed";
      else state = "researched";
      summary.attempted++;
      if (state === "researched") summary.finished++;
      if (state === "waiting_hourly") summary.waiting++;
      if (state === "failed") summary.failed++;
      if (row.email?.trim()) summary.emails++;
    }
    states.set(row.id, state);
    if (state === "not_started") summary.notResearched++;
    if (leadNeedsReview(row, state)) summary.needsReview++;
    if (leadReadyForContacts(row)) summary.readyForContacts++;
    if (row.importedContactId) summary.addedToContacts++;
  }
  return { states, summary };
}

export function filterLeadResearchRows(rows: SalonEnrichmentRow[], states: Map<string, LeadResearchState>,
  view: string, search: string) {
  const term = search.trim().toLocaleLowerCase();
  return rows.filter(row =>
    (view !== "researched" || states.get(row.id) !== "not_started") &&
    (view !== "needs_review" || leadNeedsReview(row, states.get(row.id))) &&
    (view !== "ready_for_contacts" || leadReadyForContacts(row)) &&
    (!term || [row.businessName, row.city, row.email].some(value => value?.toLocaleLowerCase().includes(term))));
}
