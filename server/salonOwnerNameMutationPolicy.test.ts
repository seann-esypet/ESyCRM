import assert from "node:assert/strict";
import test from "node:test";
import {
  EMPTY_OWNER_NAME_RESULT,
  salonOwnerNameForImport,
  type OwnerNameResult,
} from "@shared/salonOwnerName";
import type { SalonEnrichmentRow } from "@shared/schema";
import {
  contactHasManualName,
  contactNameMatchesOwnerApplication,
  mergeBundledOwnerNameEvidence,
  mergeSalonOwnerNameMetadata,
  ownerNameLookupStarted,
  plannedSalonOwnerNamePreview,
  resetSalonOwnerNameForIdentityChange,
  salonOwnerNameImportBlocked,
  salonOwnerNameLookupBlockedByRowStatus,
  salonOwnerNameMutationBlocked,
  salonOwnerNamePreviewMode,
  salonIdentityEditBlocked,
  salonIdentityFieldsChanged,
  shouldStageBundledOwnerNameOnRow,
} from "./salonOwnerNameMutationPolicy";
import { replaceTemplateVariables } from "./sendgrid";

const contact = { firstName: "Eliud", lastName: "Jimenez" };
const application = {
  rowId: "row-1",
  candidateId: "owner-eliud",
  firstName: "Eliud",
  lastName: "Jimenez",
};

test("apply conflict checks preserve manually edited names regardless of salutation preference", () => {
  assert.equal(contactHasManualName(
    { firstName: "Taylor", lastName: "Manual" },
    undefined,
    "row-1",
    "owner-eliud",
  ), true);
  assert.equal(contactHasManualName(contact, application, "row-1", "owner-eliud"), false);
});

test("approved contact name is independent of the business-name salutation preference", () => {
  const ownerName: OwnerNameResult = {
    status: "needs_review",
    candidates: [{
      id: "owner-eliud",
      firstName: "Eliud",
      lastName: "Jimenez",
      role: "founder",
      roleConfirmed: true,
      businessMatched: true,
      confidence: "high",
      sources: [{
        url: "https://example.com/about",
        excerpt: "Eliud Jimenez is the current owner of Curly Tails.",
        kind: "website_about",
      }],
    }],
    selectedCandidateId: "owner-eliud",
    approvedAt: "2026-01-01T00:00:00.000Z",
    usePersonalName: false,
    providerCalls: 0,
    pagesFetched: 1,
  };
  assert.deepEqual(salonOwnerNameForImport(ownerName), {
    firstName: "Eliud",
    lastName: "Jimenez",
    useBusinessNameForEmail: "Yes",
    candidate: ownerName.candidates[0],
  });
});

test("a source name is revocable only while row, candidate, and applied contact name all match", () => {
  assert.equal(contactNameMatchesOwnerApplication(contact, application, "row-1", "owner-eliud"), true);
  assert.equal(contactNameMatchesOwnerApplication(
    { firstName: "Eliud", lastName: "Manual Edit" },
    application,
    "row-1",
    "owner-eliud",
  ), false);
  assert.equal(contactNameMatchesOwnerApplication(contact, application, "row-2", "owner-eliud"), false);
  assert.equal(contactNameMatchesOwnerApplication(contact, application, "row-1", "owner-other"), false);
});

test("review/apply mutations are blocked while an owner lookup is in progress", () => {
  const searching: OwnerNameResult = {
    status: "searching",
    candidates: [],
    selectedCandidateId: null,
    approvedAt: null,
    usePersonalName: false,
    providerCalls: 0,
    pagesFetched: 0,
  };
  const ready = { ...searching, status: "needs_review" as const };
  assert.equal(salonOwnerNameMutationBlocked(searching), true);
  assert.equal(salonOwnerNameImportBlocked(searching), true);
  assert.equal(salonOwnerNameMutationBlocked(ready), false);
});

test("begin lookup atomically invalidates approval before parallel apply can use it", () => {
  const approved: OwnerNameResult = {
    status: "needs_review",
    candidates: [{
      id: "owner-eliud",
      firstName: "Eliud",
      lastName: "Jimenez",
      role: "owner",
      roleConfirmed: true,
      businessMatched: true,
      confidence: "high",
      sources: [{ url: "https://example.com/about", excerpt: "Eliud Jimenez is the current owner.", kind: "website_about" }],
    }],
    selectedCandidateId: "owner-eliud",
    approvedAt: "2026-01-01T00:00:00.000Z",
    usePersonalName: true,
    providerCalls: 0,
    pagesFetched: 1,
  };
  const searching = ownerNameLookupStarted(approved);
  assert.equal(searching.status, "searching");
  assert.equal(searching.selectedCandidateId, null);
  assert.equal(searching.approvedAt, null);
  assert.equal(searching.usePersonalName, false);
  assert.equal(salonOwnerNameMutationBlocked(searching), true);
  assert.equal(salonOwnerNameImportBlocked(searching), true);
});

test("owner lookup starts only after ordinary enrichment reaches a terminal row state", () => {
  for (const status of ["pending", "processing", "rejected", "unknown"]) {
    assert.equal(salonOwnerNameLookupBlockedByRowStatus(status), true, status);
  }
  for (const status of ["enriched", "imported", "failed"]) {
    assert.equal(salonOwnerNameLookupBlockedByRowStatus(status), false, status);
  }
});

test("ordinary whole-evidence writers preserve the fresh owner result and lookup token", () => {
  const currentEvidence = {
    ownerName: {
      status: "searching",
      candidates: [{ id: "fresh-candidate" }],
      selectedCandidateId: null,
      approvedAt: null,
      usePersonalName: false,
      providerCalls: 0,
      pagesFetched: 0,
    },
    ownerNameLookupToken: "active-lookup-token",
    oldEmailEvidence: { source: "first-party" },
  };
  const staleWorkerEvidence = {
    email: { value: "new@example.com", source: "worker" },
    ownerName: { status: "not_found", candidates: [] },
    ownerNameLookupToken: "stale-token",
  };
  const merged = mergeSalonOwnerNameMetadata(staleWorkerEvidence, currentEvidence);
  assert.equal((merged.ownerName as any).candidates[0].id, "fresh-candidate");
  assert.equal(merged.ownerNameLookupToken, "active-lookup-token");
  assert.deepEqual(merged.email, staleWorkerEvidence.email);
});

test("identity edits are rejected during lookup and reset all owner evidence after a completed search", () => {
  const current = {
    businessName: "Curly Tails",
    address: "5651 Tourist Dr",
    city: "North Richland Hills",
    state: "TX",
    zipCode: "76117",
    websiteUrl: "https://example.com",
    placeId: "place-1",
  } as SalonEnrichmentRow;
  const locationCorrection = { city: "North Richland Hills East" } as Partial<SalonEnrichmentRow>;
  assert.equal(salonIdentityFieldsChanged(current, locationCorrection), true);
  const searching = { ...EMPTY_OWNER_NAME_RESULT, status: "searching" as const };
  assert.equal(salonIdentityEditBlocked("enriched", searching, true), true);
  assert.equal(salonIdentityEditBlocked("processing", EMPTY_OWNER_NAME_RESULT, true), true);
  assert.equal(salonIdentityEditBlocked("processing", EMPTY_OWNER_NAME_RESULT, true, false), false);
  assert.equal(salonIdentityEditBlocked("enriched", EMPTY_OWNER_NAME_RESULT, true), false);
  assert.equal(salonIdentityFieldsChanged(current, { city: current.city }), false);

  const reset = resetSalonOwnerNameForIdentityChange({
    email: { value: "new@example.com", status: "approved" },
    ownerNameLookupToken: "stale-token",
    ownerName: {
      status: "needs_review",
      candidates: [{ id: "old-identity-candidate" }],
      selectedCandidateId: "old-identity-candidate",
      approvedAt: "2026-01-01T00:00:00.000Z",
      usePersonalName: true,
    },
  });
  assert.equal((reset.ownerName as OwnerNameResult).status, "not_searched");
  assert.deepEqual((reset.ownerName as OwnerNameResult).candidates, []);
  assert.equal("ownerNameLookupToken" in reset, false);
  assert.deepEqual(reset.email, { value: "new@example.com", status: "approved" });
});

test("bundled owner seeds may enrich imported rows once without replacing reviewed/email evidence", () => {
  const row = {
    importedContactId: "contact-1",
    evidence: {
      ownerName: { status: "not_searched", candidates: [], selectedCandidateId: null, approvedAt: null, usePersonalName: false, providerCalls: 0, pagesFetched: 0 },
      email: { value: "salon@example.com", source: "public_web_review" },
      note: "Email review remains unchanged",
    },
  } as unknown as Pick<SalonEnrichmentRow, "importedContactId" | "evidence">;
  const seed: OwnerNameResult = {
    status: "needs_review",
    candidates: [{
      id: "owner-eliud",
      firstName: "Eliud",
      lastName: "Jimenez",
      role: "Founder & Groomer",
      roleConfirmed: true,
      businessMatched: true,
      confidence: "high",
      sources: [{ url: "https://example.com/", excerpt: "Eliud Jimenez Founder & Groomer", kind: "website_homepage" }],
    }],
    selectedCandidateId: null,
    approvedAt: null,
    usePersonalName: false,
    providerCalls: 0,
    pagesFetched: 1,
  };
  assert.equal(shouldStageBundledOwnerNameOnRow(row, true), true);
  const firstPass = mergeBundledOwnerNameEvidence(row.evidence as Record<string, unknown>, seed);
  assert.equal((firstPass.email as { value: string }).value, "salon@example.com");
  assert.equal(shouldStageBundledOwnerNameOnRow({ ...row, evidence: firstPass } as typeof row, true), false);
  const untouchedReviewed = {
    ...row,
    evidence: {
      ...firstPass,
      ownerName: {
        ...seed,
        status: "needs_review",
        candidates: seed.candidates.map(candidate => ({
          ...candidate,
          sources: candidate.sources.map(source => ({ ...source, kind: "website_homepage" })),
        })),
      },
    },
  } as typeof row;
  assert.equal(shouldStageBundledOwnerNameOnRow(untouchedReviewed, true), false);
  const approved = {
    ...untouchedReviewed,
    evidence: {
      ...untouchedReviewed.evidence as Record<string, unknown>,
      ownerName: { ...(untouchedReviewed.evidence as any).ownerName, selectedCandidateId: "owner-eliud", approvedAt: "2026-01-01T00:00:00.000Z" },
    },
  } as typeof row;
  const rejected = {
    ...untouchedReviewed,
    evidence: {
      ...untouchedReviewed.evidence as Record<string, unknown>,
      ownerName: { ...(untouchedReviewed.evidence as any).ownerName, status: "excluded" },
    },
  } as typeof row;
  assert.equal(shouldStageBundledOwnerNameOnRow(approved, true), false);
  assert.equal(shouldStageBundledOwnerNameOnRow(rejected, true), false);
});

test("sequence preview uses the real linked import when present and separates name from salutation preference", () => {
  const ownerName: OwnerNameResult = {
    status: "needs_review",
    candidates: [{
      id: "owner-eliud",
      firstName: "Eliud",
      lastName: "Jimenez",
      role: "owner",
      roleConfirmed: true,
      businessMatched: true,
      confidence: "high",
      sources: [{ url: "https://example.com/about", excerpt: "Eliud Jimenez is the current owner.", kind: "website_about" }],
    }],
    selectedCandidateId: "owner-eliud",
    approvedAt: "2026-01-01T00:00:00.000Z",
    usePersonalName: true,
    providerCalls: 0,
    pagesFetched: 1,
  };
  const row = { id: "row-1", businessName: "Curly Tails", email: "info@example.com", city: "North Richland Hills" } as SalonEnrichmentRow;
  const staged = plannedSalonOwnerNamePreview(row, ownerName, "user-1");
  assert.equal(staged.contact.firstName, "Eliud");
  assert.equal(staged.mode, "personal_name");

  const linked = {
    id: "contact-1",
    userId: "user-1",
    firstName: null,
    lastName: null,
    useBusinessNameForEmail: "Yes",
    company: "Curly Tails",
    email: "info@example.com",
    city: "North Richland Hills",
  };
  assert.equal(salonOwnerNamePreviewMode(linked), "business_name");
  assert.equal(replaceTemplateVariables(
    "[Contact_First_Name]",
    linked as any,
    { firstName: "Sales", lastName: "", email: "sales@example.com" } as any,
  ), "Curly Tails");
  const businessPreference = plannedSalonOwnerNamePreview(row, { ...ownerName, usePersonalName: false }, "user-1");
  assert.equal(businessPreference.contact.firstName, "Eliud");
  assert.equal(businessPreference.mode, "business_name");
  assert.equal(replaceTemplateVariables(
    "[Contact_First_Name]",
    businessPreference.contact as any,
    { firstName: "Sales", lastName: "", email: "sales@example.com" } as any,
  ), "Curly Tails");
});
