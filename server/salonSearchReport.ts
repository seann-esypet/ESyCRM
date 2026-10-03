import { z } from "zod";
import { directoryEligibility } from "@shared/directoryEligibility";
import type { InsertSalonEnrichmentRow } from "@shared/schema";
import type { OwnerNameResult } from "@shared/salonOwnerName";
import { bookingPlatformForUrl, importableSalonEmail, importableSalonEmailCandidate } from "./bookingPageEmail";

const reviewedSalonSchema = z.object({
  State: z.string().trim().min(1),
  Business: z.string().trim().min(1),
  "Source address": z.string().trim().min(1),
  "Google Place ID": z.string().trim().min(1),
  Outcome: z.enum([
    "verified_first_party_email",
    "verified_independent_directory_email",
    "review_only_candidate",
    "review_only_location_pending",
    "booking_only",
    "no_verified_email",
    "excluded_non_grooming",
    "inaccessible",
  ]),
  "Public email (review-only when marked)": z.string().trim().optional().default(""),
  "Email evidence URL": z.string().trim().optional().default(""),
  "Email use": z.string().trim().optional().default(""),
  "Evidence and exceptions": z.string().trim().min(1),
  ownerName: z.unknown().optional(),
});

export const salonSearchReportBatchSchema = z.object({
  name: z.string().trim().min(1).max(200),
  reviewed: z.array(reviewedSalonSchema).min(1).max(200),
});

export type ReviewedSalonReportEntry = z.infer<typeof reviewedSalonSchema>;

function untrustedOwnerName(value: unknown): OwnerNameResult | undefined {
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return undefined;
    }
  }
  if (!value || typeof value !== "object") return undefined;
  const input = value as Partial<OwnerNameResult>;
  const candidates = Array.isArray(input.candidates) ? input.candidates.slice(0, 50).flatMap((candidate, index) => {
    if (!candidate || typeof candidate !== "object") return [];
    const item = candidate as OwnerNameResult["candidates"][number];
    if (typeof item.firstName !== "string" || !item.firstName.trim()) return [];
    const sources = Array.isArray(item.sources) ? item.sources.slice(0, 10).flatMap(source => {
      if (!source || typeof source !== "object" ||
          typeof source.url !== "string" || typeof source.excerpt !== "string") return [];
      try {
        const url = new URL(source.url);
        if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return [];
        return [{
          url: url.toString(),
          excerpt: source.excerpt.trim().slice(0, 800),
          kind: "uploaded_report_evidence",
        }];
      } catch {
        return [];
      }
    }) : [];
    return [{
      id: typeof item.id === "string" && item.id.trim() ? item.id.slice(0, 100) : `uploaded-owner-${index}`,
      firstName: item.firstName.trim().slice(0, 100),
      lastName: typeof item.lastName === "string" && item.lastName.trim() ? item.lastName.trim().slice(0, 100) : null,
      role: typeof item.role === "string" && item.role.trim() ? item.role.trim().slice(0, 160) : "Unconfirmed imported mention",
      roleConfirmed: false,
      businessMatched: false,
      confidence: "low" as const,
      sources,
    }];
  }) : [];
  return {
    status: candidates.length ? "needs_review" : "not_searched",
    candidates,
    selectedCandidateId: null,
    approvedAt: null,
    usePersonalName: false,
    providerCalls: 0,
    pagesFetched: 0,
  };
}

export function reportCategory(entry: Pick<ReviewedSalonReportEntry, "Outcome" | "Email use">): string {
  if (entry.Outcome === "excluded_non_grooming") return "non_grooming";
  if (entry.Outcome === "inaccessible") return "inaccessible";
  if (entry.Outcome === "booking_only" || /book(?:ing|ings)?|appointment|customer.{0,20}only/i.test(entry["Email use"])) return "booking_only";
  if (entry.Outcome === "verified_first_party_email" || entry.Outcome === "verified_independent_directory_email") {
    return "verified_public_email";
  }
  if (entry.Outcome.startsWith("review_only")) return "review_only";
  return "no_verified_email";
}

export function convertSalonSearchReportEntry(
  entry: ReviewedSalonReportEntry,
  rowNumber: number,
  batchId = "pending",
  userId = "pending",
): InsertSalonEnrichmentRow {
  const category = reportCategory(entry);
  const candidateOutcome = entry.Outcome === "verified_first_party_email" ||
    entry.Outcome === "verified_independent_directory_email";
  const emailCandidate = candidateOutcome ? entry["Public email (review-only when marked)"]?.toLowerCase() : "";
  const sourceUrl = entry["Email evidence URL"];
  const emailEvidencePresent = !!emailCandidate && z.string().email().safeParse(emailCandidate).success &&
    !!sourceUrl && (() => {
      try {
        const url = new URL(sourceUrl);
        return url.protocol === "https:" && !url.username && !url.password;
      } catch {
        return false;
      }
    })() && /public business contact/i.test(entry["Email use"]);
  const emailEvidence = emailEvidencePresent ? {
    value: emailCandidate,
    source: "public_web_review",
    confidence: "high",
    sourceUrl,
    purpose: "general",
  } : undefined;
  const email = emailEvidence ? emailCandidate : null;
  const ownerName = untrustedOwnerName(entry.ownerName);
  const base = {
    batchId,
    userId,
    rowNumber,
    sourceData: { ...entry, category },
    placeId: entry["Google Place ID"],
    businessName: entry.Business,
    address: entry["Source address"],
    address1: null,
    city: null,
    state: entry.State,
    zipCode: null,
    latitude: null,
    longitude: null,
    businessStatus: null,
    email,
    websiteUrl: null,
    phone: null,
    contactRequestFormUrl: null,
    contactFormStatus: "unknown",
    bookingUrl: null,
    currentSoftware: null,
    usesSoftware: "Unknown",
    hasWebsite: "Unknown",
    audienceTrack: "directory_general",
    evidence: {
      note: entry["Evidence and exceptions"],
      sourceUrl: sourceUrl || null,
      ...(emailEvidence ? { email: emailEvidence } : {}),
      ...(ownerName ? { ownerName } : {}),
    },
    confidence: {},
    identityMatchStatus: emailEvidence ? "strong" : "unmatched",
    status: emailEvidence ? "enriched" : "rejected",
    reviewStatus: category === "non_grooming" || (candidateOutcome && !emailEvidence) ? "rejected" : "needs_review",
    duplicateMetadata: {},
    importedContactId: null,
    serpCallsUsed: 0,
    lastError: null,
    processedAt: new Date(),
  };
  return base as InsertSalonEnrichmentRow;
}

export function duplicateReportPlaceIds(
  incomingIds: string[],
  existingIds: string[],
): string[] {
  const existing = new Set(existingIds.map(id => id.trim().toLowerCase()));
  return Array.from(new Set(incomingIds.filter(id => existing.has(id.trim().toLowerCase()))));
}

export function allReportPlaceIdsExist(incomingIds: string[], existingIds: string[]): boolean {
  const existing = new Set(existingIds.map(id => id.trim().toLowerCase()));
  return incomingIds.length > 0 && incomingIds.every(id => existing.has(id.trim().toLowerCase()));
}

export function reportPlaceIdsAreDistinct(placeIds: string[]): boolean {
  const ids = placeIds.map(id => id.trim().toLowerCase());
  return new Set(ids).size === ids.length;
}

export function canApproveSalonReportRow(row: Parameters<typeof importableSalonEmailCandidate>[0] & {
  sourceData?: unknown;
  status?: string;
}): boolean {
  if (directoryEligibility(row).blocked) return false;
  const sourceData = row.sourceData as { category?: string } | null;
  return sourceData?.category === "verified_public_email" &&
    row.status === "enriched" &&
    importableSalonEmailCandidate(row) !== null;
}

/**
 * A raw list row becomes a reviewed-report candidate only when ordinary
 * enrichment actually found a visible general email on a strongly matched
 * business website. The uploaded email suggestion itself is never promoted.
 */
export function promoteVerifiedStagedReportEmail(
  row: { sourceData: unknown; websiteUrl?: string | null; bookingUrl?: string | null } & {
    status?: string | null;
    identityMatchStatus?: string | null;
    email?: string | null;
  },
  enrichment: {
    status?: string;
    identityMatchStatus?: string | null;
    email?: string | null;
    websiteUrl?: string | null;
    bookingUrl?: string | null;
    evidence?: unknown;
  },
): Pick<InsertSalonEnrichmentRow, "sourceData" | "evidence"> | null {
  const rawData = row.sourceData as Record<string, unknown> | null;
  if (!["staged_unverified", "verification_attempted"].includes(String(rawData?.stagingState)) ||
      enrichment.status !== "enriched" ||
      enrichment.identityMatchStatus !== "strong" ||
      !enrichment.email?.trim() ||
      !z.string().email().safeParse(enrichment.email.trim()).success) return null;
  const evidence = enrichment.evidence && typeof enrichment.evidence === "object" && !Array.isArray(enrichment.evidence)
    ? enrichment.evidence as Record<string, unknown>
    : {};
  const emailEvidence = evidence.email && typeof evidence.email === "object"
    ? evidence.email as Record<string, unknown>
    : null;
  if (!emailEvidence ||
      !["website", "serp_fallback_website"].includes(String(emailEvidence.source)) ||
      !["visible", "mailto", "cloudflare"].includes(String(emailEvidence.sourceType)) ||
      !["high", "medium"].includes(String(emailEvidence.confidence)) ||
      String(emailEvidence.value || "").trim().toLowerCase() !== enrichment.email.trim().toLowerCase()) return null;
  let sourceUrl: URL;
  try {
    sourceUrl = new URL(String(emailEvidence.sourceUrl || ""));
  } catch {
    return null;
  }
  if (sourceUrl.protocol !== "https:" || sourceUrl.username || sourceUrl.password) return null;
  const source = String(emailEvidence.source);
  const websiteUrl = enrichment.websiteUrl || row.websiteUrl;
  if (source === "website") {
    if (!websiteUrl || emailEvidence.sourceUrl !== websiteUrl || bookingPlatformForUrl(websiteUrl)) return null;
  } else if (bookingPlatformForUrl(sourceUrl.href)) {
    return null;
  }

  const email = enrichment.email.trim();
  const verifiedEvidence = { ...emailEvidence, value: email, purpose: "general" };
  return {
    sourceData: {
      ...rawData,
      category: "verified_public_email",
      stagingState: "verified_by_enrichment",
      Outcome: "verified_first_party_email",
      "Public email (review-only when marked)": email,
      "Email evidence URL": sourceUrl.href,
      "Email use": "Public business contact",
      "Evidence and exceptions": "Visible general-contact email found during deliberate business-site verification.",
    },
    evidence: { ...evidence, email: verifiedEvidence },
  };
}

export function salonReportScheduleRejection(input: {
  row: Parameters<typeof importableSalonEmail>[0] & {
    status: string;
    importedContactId: string | null;
    audienceTrack: string | null;
  };
  contact: { userId: string; email: string | null; sequenceTrack: string | null };
  sequence: { userId: string; sequenceTrack: string; sequenceNumber: number; isActive: string };
  userId: string;
  hasOwnedDeal: boolean;
  scheduledSendAt: Date;
  now?: Date;
}): string | null {
  if (directoryEligibility(input.row).blocked) return "Confirm grooming suitability before enrolling this business in outreach";
  if (input.row.status !== "imported" || !input.row.importedContactId) return "Import this report row as a contact first";
  if (input.contact.userId !== input.userId || !input.contact.email?.trim()) return "An owned contact with an email address is required";
  const sourceData = input.row.sourceData as {
    category?: string;
    "Public email (review-only when marked)"?: string;
  } | null;
  const importableEmail = importableSalonEmail(input.row);
  if (sourceData?.category !== "verified_public_email" ||
      sourceData["Public email (review-only when marked)"]?.trim().toLowerCase() !== input.row.email?.trim().toLowerCase() ||
      input.row.reviewStatus !== "approved" ||
      input.row.identityMatchStatus !== "strong" ||
      !importableEmail ||
      importableEmail.trim().toLowerCase() !== input.contact.email.trim().toLowerCase()) {
    return "The report row must remain approved with verified public email evidence matching the contact";
  }
  if (!input.hasOwnedDeal) return "Create a pipeline deal for this contact before scheduling";
  if (input.sequence.userId !== input.userId ||
      input.sequence.sequenceTrack !== "directory_general" ||
      input.sequence.sequenceNumber !== 1 ||
      input.sequence.isActive !== "true") return "Choose an active directory_general step 1 sequence owned by you";
  if (input.row.audienceTrack !== "directory_general" ||
      input.contact.sequenceTrack !== input.row.audienceTrack) return "The row, contact, and sequence tracks must match";
  if (!(input.scheduledSendAt instanceof Date) ||
      Number.isNaN(input.scheduledSendAt.getTime()) ||
      input.scheduledSendAt.getTime() <= (input.now ?? new Date()).getTime()) {
    return "scheduledSendAt must be a valid future date";
  }
  return null;
}

export function salonReportSendRejection(
  row: Parameters<typeof importableSalonEmail>[0] & { userId: string; status: string },
  contact: { userId: string; email: string | null },
  ownerId: string,
): string | null {
  if (directoryEligibility(row).blocked) return "Grooming suitability is unconfirmed or this business was excluded";
  if (row.userId !== ownerId || contact.userId !== ownerId) return "Salon report row or contact is no longer owned by the sequence owner";
  if (row.status !== "imported") return "Salon report row is no longer imported";
  if (row.reviewStatus !== "approved") return "Salon report approval was revoked";
  const sourceData = row.sourceData as {
    category?: string;
    "Public email (review-only when marked)"?: string;
  } | null;
  if (sourceData?.category !== "verified_public_email" ||
      sourceData["Public email (review-only when marked)"]?.trim().toLowerCase() !== row.email?.trim().toLowerCase() ||
      row.identityMatchStatus !== "strong") {
    return "Salon report email evidence is no longer approved for sending";
  }
  const approvedEmail = importableSalonEmail(row);
  if (!approvedEmail) return "Salon report email evidence is incomplete or no longer importable";
  if (!contact.email || contact.email !== row.email) return "Contact email no longer matches the approved salon report email";
  return null;
}