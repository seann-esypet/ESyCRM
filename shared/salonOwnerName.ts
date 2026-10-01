export type SalonOwnerNameStatus =
  | "not_searched"
  | "searching"
  | "needs_review"
  | "not_found"
  | "failed"
  | "excluded";

export interface SalonOwnerNameSource {
  url: string;
  excerpt: string;
  kind: string;
}

export interface SalonOwnerNameCandidate {
  id: string;
  firstName: string;
  lastName: string | null;
  role: string;
  roleConfirmed: boolean;
  businessMatched: boolean;
  confidence: "high" | "medium" | "low";
  sources: SalonOwnerNameSource[];
}

export interface OwnerNameResult {
  status: SalonOwnerNameStatus;
  candidates: SalonOwnerNameCandidate[];
  selectedCandidateId: string | null;
  approvedAt: string | null;
  usePersonalName: boolean;
  providerCalls: number;
  pagesFetched: number;
  error?: string;
  lookedUpAt?: string;
}

export const EMPTY_OWNER_NAME_RESULT: OwnerNameResult = {
  status: "not_searched",
  candidates: [],
  selectedCandidateId: null,
  approvedAt: null,
  usePersonalName: false,
  providerCalls: 0,
  pagesFetched: 0,
};

/**
 * Approval is deliberately evidence-based: a search summary, team mention, or
 * uploaded assertion can never satisfy the fetched-page owner-role check.
 */
export function isStrongApprovedOwnerCandidate(
  ownerName: OwnerNameResult | null | undefined,
): SalonOwnerNameCandidate | null {
  if (!ownerName?.approvedAt || !ownerName.selectedCandidateId) return null;
  const candidate = Array.isArray(ownerName.candidates)
    ? ownerName.candidates.find(item => item?.id === ownerName.selectedCandidateId)
    : undefined;
  return hasStrongOwnerNameEvidence(candidate) ? candidate : null;
}

export function hasStrongOwnerNameEvidence(
  candidate: SalonOwnerNameCandidate | null | undefined,
): candidate is SalonOwnerNameCandidate {
  if (!candidate?.roleConfirmed || !candidate.businessMatched || !Array.isArray(candidate.sources)) return false;
  return candidate.sources.some(source => source && typeof source.kind === "string" &&
    /^(website|organic)_(homepage|about|team|page)$/.test(source.kind) &&
    typeof source.url === "string" && !!source.url &&
    typeof source.excerpt === "string" && !!source.excerpt.trim(),
  );
}

export function salonOwnerNameForImport(ownerName: OwnerNameResult | null | undefined): {
  firstName: string | null;
  lastName: string | null;
  useBusinessNameForEmail: "Yes" | "No";
  candidate: SalonOwnerNameCandidate | null;
} {
  const candidate = isStrongApprovedOwnerCandidate(ownerName);
  return {
    firstName: candidate?.firstName || null,
    lastName: candidate?.lastName || null,
    useBusinessNameForEmail: candidate && ownerName?.usePersonalName ? "No" : "Yes",
    candidate,
  };
}