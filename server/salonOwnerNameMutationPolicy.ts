import {
  EMPTY_OWNER_NAME_RESULT,
  isStrongApprovedOwnerCandidate,
  type OwnerNameResult,
  type SalonOwnerNameCandidate,
} from "@shared/salonOwnerName";
import type { Contact, SalonEnrichmentRow } from "@shared/schema";

const SALON_IDENTITY_FIELDS = [
  "businessName",
  "address",
  "address1",
  "city",
  "state",
  "zipCode",
  "websiteUrl",
  "placeId",
] as const;

const OWNER_NAME_EVIDENCE_KEYS = ["ownerName", "ownerNameLookupToken"] as const;

export function salonOwnerNameLookupBlockedByRowStatus(status: string): boolean {
  return !["enriched", "imported", "failed"].includes(status);
}

export function salonIdentityFieldsChanged(
  current: Partial<SalonEnrichmentRow>,
  updates: Partial<SalonEnrichmentRow>,
): boolean {
  return SALON_IDENTITY_FIELDS.some(field =>
    Object.prototype.hasOwnProperty.call(updates, field) && current[field] !== updates[field],
  );
}

export function salonIdentityEditBlocked(
  rowStatus: string,
  ownerName: OwnerNameResult,
  identityChanged: boolean,
  rejectDuringEnrichment = true,
): boolean {
  return identityChanged && (
    salonOwnerNameMutationBlocked(ownerName) ||
    (rejectDuringEnrichment && rowStatus === "processing")
  );
}

export function mergeSalonOwnerNameMetadata(
  incomingEvidence: Record<string, unknown>,
  currentEvidence: Record<string, unknown>,
): Record<string, unknown> {
  const merged = { ...incomingEvidence };
  for (const key of OWNER_NAME_EVIDENCE_KEYS) {
    delete merged[key];
    if (Object.prototype.hasOwnProperty.call(currentEvidence, key)) {
      merged[key] = currentEvidence[key];
    }
  }
  return merged;
}

export function resetSalonOwnerNameForIdentityChange(
  evidence: Record<string, unknown>,
): Record<string, unknown> {
  const reset: Record<string, unknown> = { ...evidence, ownerName: { ...EMPTY_OWNER_NAME_RESULT } };
  delete reset.ownerNameLookupToken;
  return reset;
}

export interface SalonOwnerNameContactApplication {
  rowId?: string;
  candidateId?: string;
  firstName?: string | null;
  lastName?: string | null;
}

export function salonOwnerNameMutationBlocked(ownerName: OwnerNameResult): boolean {
  return ownerName.status === "searching";
}

export function salonOwnerNameImportBlocked(ownerName: OwnerNameResult): boolean {
  return salonOwnerNameMutationBlocked(ownerName);
}

export function ownerNameLookupStarted(ownerName: OwnerNameResult): OwnerNameResult {
  return {
    ...ownerName,
    status: "searching",
    selectedCandidateId: null,
    approvedAt: null,
    usePersonalName: false,
    error: undefined,
  };
}

export function shouldApplyBundledOwnerNameSeed(
  current: OwnerNameResult | undefined,
  hasSeed: boolean,
): boolean {
  if (!hasSeed) return false;
  if (!current || current.status === "not_searched") return true;
  return current.status === "needs_review" &&
    !current.selectedCandidateId && !current.approvedAt && !current.usePersonalName &&
    Array.isArray(current.candidates) &&
    current.candidates.every(candidate =>
      Array.isArray(candidate.sources) &&
      candidate.sources.every(source => source.kind === "uploaded_report_evidence"),
    );
}

export function shouldStageBundledOwnerNameOnRow(
  row: Pick<SalonEnrichmentRow, "importedContactId" | "evidence">,
  hasSeed: boolean,
): boolean {
  const evidence = row.evidence && typeof row.evidence === "object" && !Array.isArray(row.evidence)
    ? row.evidence as Record<string, unknown>
    : {};
  return shouldApplyBundledOwnerNameSeed(evidence.ownerName as OwnerNameResult | undefined, hasSeed);
}

export function mergeBundledOwnerNameEvidence(
  evidence: Record<string, unknown>,
  ownerName: OwnerNameResult,
): Record<string, unknown> {
  return { ...evidence, ownerName };
}

export function salonOwnerNamePreviewMode(contact: Pick<Contact, "firstName" | "useBusinessNameForEmail">): "personal_name" | "business_name" {
  return contact.useBusinessNameForEmail === "Yes" || !contact.firstName
    ? "business_name"
    : "personal_name";
}

export function plannedSalonOwnerNamePreview(
  row: Pick<SalonEnrichmentRow, "id" | "businessName" | "email" | "city">,
  ownerName: OwnerNameResult,
  userId: string,
): {
  contact: {
    id: string;
    userId: string;
    firstName: string | null;
    lastName: string | null;
    useBusinessNameForEmail: "Yes" | "No";
    company: string;
    email: string | null;
    city: string | null;
  };
  mode: "personal_name" | "business_name";
  candidate: SalonOwnerNameCandidate | null;
} {
  const candidate = isStrongApprovedOwnerCandidate(ownerName);
  const contact = {
    id: row.id,
    userId,
    firstName: candidate?.firstName || null,
    lastName: candidate?.lastName || null,
    useBusinessNameForEmail: candidate && ownerName.usePersonalName ? "No" as const : "Yes" as const,
    company: row.businessName,
    email: row.email,
    city: row.city,
  };
  return {
    contact,
    mode: salonOwnerNamePreviewMode(contact),
    candidate,
  };
}

export function contactNameMatchesOwnerApplication(
  contact: { firstName: string | null; lastName: string | null },
  application: SalonOwnerNameContactApplication | undefined,
  rowId: string,
  candidateId: string | null | undefined,
): boolean {
  return !!application &&
    application.rowId === rowId &&
    !!candidateId &&
    application.candidateId === candidateId &&
    contact.firstName === (application.firstName || null) &&
    contact.lastName === (application.lastName || null);
}

export function contactHasManualName(
  contact: { firstName: string | null; lastName: string | null },
  application: SalonOwnerNameContactApplication | undefined,
  rowId: string,
  candidateId: string,
): boolean {
  const hasName = !!(contact.firstName?.trim() || contact.lastName?.trim());
  return hasName && !contactNameMatchesOwnerApplication(contact, application, rowId, candidateId);
}
