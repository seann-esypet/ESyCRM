import type { SalonEnrichmentRow, InsertSalonEnrichmentRow } from "@shared/schema";
import { stageSalonListRows, normalizeSalonBusinessName, normalizeSalonPhone } from "./salonListStaging";
import { directoryEligibility, directoryObject } from "@shared/directoryEligibility";
import { salonEmailDomainRestriction } from "./salonEmailPolicy";
import { untrustedOwnerName } from "./salonSearchReport";

export const LEAD_LIMITS = { rows: 20000, bytes: 20 * 1024 * 1024, fieldChars: 64000, rowBytes: 256000 };
export const leadFieldAliases: Record<string, string[]> = {
  businessName: ["Business Name", "Business", "company", "varLocationName", "Source salon name", "Salon name"],
  email: ["Email", "candidateEmail", "Public email (review-only when marked)", "Email (verified or review-only as labeled)"],
  address: ["Address", "Source address", "FormattedAddress", "Full address"],
  city: ["City", "varLocationCity"], state: ["State", "varLocationState"],
  zipCode: ["ZIP Code", "zip", "varLocationZip"], placeId: ["Google Place ID", "GooglePlaceID", "placeId"],
  phone: ["Phone", "telephone"], websiteUrl: ["Website URL", "websiteUrl", "Web Site Address"],
  sourceUrl: ["Email Source URL", "Email evidence URL", "sourceUrl"],
  notes: ["notes", "Evidence and exceptions", "Evidence / exclusion", "evidenceNote", "outcomeNote"],
  firstName: ["First Name", "Owner First Name"], lastName: ["Last Name", "Owner Last Name"],
};
const key = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, "");
export function uploadField(raw: Record<string, unknown>, field: string, mapping: Record<string, string> = {}): string {
  const name = mapping[field] || Object.keys(raw).find(k => [field, ...(leadFieldAliases[field] || [])].some(alias => key(alias) === key(k)));
  const value = name ? raw[name] : null;
  return typeof value === "string" || typeof value === "number" ? field === "notes" ? String(value) : String(value).trim() : "";
}
export function validateLeadMaterial(rows: unknown[]) {
  if (!rows.length || rows.length > LEAD_LIMITS.rows) throw new Error(`A list must contain 1–${LEAD_LIMITS.rows.toLocaleString()} rows.`);
  if (Buffer.byteLength(JSON.stringify(rows)) > LEAD_LIMITS.bytes) throw new Error("List exceeds the 20 MB source-data limit; split the list before uploading.");
  function inspect(value: unknown) {
    if (typeof value === "string" && value.length > LEAD_LIMITS.fieldChars) throw new Error("A source field exceeds 64,000 characters. Split long notes; nothing has been truncated or saved.");
    if (value && typeof value === "object") Object.values(value).forEach(inspect);
  }
  for (const row of rows) {
    if (Buffer.byteLength(JSON.stringify(row)) > LEAD_LIMITS.rowBytes) throw new Error("A source row exceeds 256 KB. Split oversized evidence; nothing has been truncated or saved.");
    inspect(row);
  }
}
export function unifiedUploadRow(raw: Record<string, unknown>, index: number, owner: string, mapping: Record<string, string> = {}): InsertSalonEnrichmentRow | null {
  const normalized = Object.fromEntries(Object.keys(leadFieldAliases).map(field => [field, uploadField(raw, field, mapping)]));
  const prior = directoryObject(raw.previousReviewedFinding);
  normalized.email ||= String(prior.reviewedEmail || prior.reviewOnlyCandidate || "");
  normalized.sourceUrl ||= String(prior.sourceUrl || "");
  normalized.notes ||= String(prior.notes || "");
  const staged = stageSalonListRows([{ ...normalized, Email: normalized.email }], owner, "pending", []);
  const row = staged.rows[0];
  if (!row) return null;
  const historicalStatus = String(raw["Email Review Status"] || raw.Outcome || prior.status || raw.category || "");
  const historical = /^(confirmed_first_party|confirmed_public_directory|verified_first_party_email|verified_independent_directory_email)$/.test(historicalStatus);
  row.rowNumber = index + 1;
  row.sourceData = {
    ...directoryObject(row.sourceData), originalInput: raw, columnMapping: mapping,
    uploadedFields: { ...directoryObject(directoryObject(row.sourceData).uploadedFields), notes: normalized.notes },
    uploadedEmailCandidate: normalized.email || null,
    originalResearchDate: raw.researchDate || raw["Research date"] || raw.checkedAt || raw.researchedAt || null,
    historicalFinding: historical ? historicalStatus : null, originalClassification: historicalStatus,
    historicalSourceUrl: normalized.sourceUrl || null,
    category: normalized.email ? "review_only" : "no_verified_email",
  };
  row.city = normalized.city || null;
  const ownerName = untrustedOwnerName(raw.ownerName);
  row.evidence = { ...directoryObject(row.evidence), originalNotes: normalized.notes, sourceUrl: normalized.sourceUrl || null,
    ...(ownerName ? { ownerName } : {}),
    historicalFinding: historical ? { status: historicalStatus, email: normalized.email, sourceUrl: normalized.sourceUrl, note: normalized.notes } : null };
  return row;
}
export function leadIdentityIndex<T extends Pick<SalonEnrichmentRow, "businessName" | "phone" | "placeId" | "address" | "state">>(rows: T[] = []) {
  const byName = new Map<string, T[]>(), byPlace = new Map<string, T[]>();
  function add(row: T) {
    const name = normalizeSalonBusinessName(row.businessName);
    byName.set(name, [...(byName.get(name) || []), row]);
    if (row.placeId) byPlace.set(row.placeId.trim(), [...(byPlace.get(row.placeId.trim()) || []), row]);
  }
  rows.forEach(add);
  return { add, find: (row: T) => [...(row.placeId ? byPlace.get(row.placeId.trim()) || [] : []),
    ...(byName.get(normalizeSalonBusinessName(row.businessName)) || [])].find(saved => sameLead(saved, row)) };
}
export function sameLead(a: Pick<SalonEnrichmentRow, "businessName" | "phone" | "placeId" | "address" | "state">, b: typeof a) {
  if (a.placeId && b.placeId) return a.placeId.trim() === b.placeId.trim();
  if (normalizeSalonBusinessName(a.businessName) !== normalizeSalonBusinessName(b.businessName)) return false;
  if (a.phone && b.phone && normalizeSalonPhone(a.phone) === normalizeSalonPhone(b.phone) &&
    (!a.address || !b.address || key(a.address) === key(b.address))) return true;
  return !!a.address && !!b.address && key(a.address) === key(b.address) && key(a.state || "") === key(b.state || "");
}
export function leadView(row: SalonEnrichmentRow) {
  const source = directoryObject(row.sourceData), evidence = directoryObject(row.evidence), emailEvidence = directoryObject(evidence.email);
  const raw = directoryObject(source.originalInput);
  const candidateEmail = String(source.uploadedEmailCandidate || raw.Email || raw["Public email (review-only when marked)"] || source["Public email (review-only when marked)"] || "");
  const sourceUrl = String(emailEvidence.sourceUrl || source.historicalSourceUrl || evidence.sourceUrl || raw["Email Source URL"] || raw["Email evidence URL"] || "");
  const eligibility = directoryEligibility(row);
  let nextAction: string;
  if (row.importedContactId) nextAction = "Open the linked contact or add a pipeline deal. Scheduling outreach is separate.";
  else if (eligibility.blocked) nextAction = eligibility.reason || "Confirm this business offers grooming before email approval.";
  else if (row.reviewStatus === "rejected") nextAction = "Rejected by review. Correct the evidence and explicitly review again.";
  else if (!row.email && !candidateEmail) nextAction = "Find an email on the matched business website.";
  else if (row.duplicateMetadata && Object.keys(directoryObject(row.duplicateMetadata)).length) nextAction = "Resolve a duplicate: inspect the existing record and choose whether to link.";
  else if (row.identityMatchStatus !== "strong") nextAction = "Confirm business and location identity, then review the source evidence.";
  else if (row.reviewStatus !== "approved") nextAction = "Review source evidence and explicitly approve this email. A contact name is optional.";
  else nextAction = "Add to CRM. A missing contact name does not block a business email.";
  return { ...row, candidateEmail: candidateEmail || null, sourceUrl: sourceUrl || null,
    evidenceNote: String(evidence.originalNotes || raw.notes || source["Evidence and exceptions"] || directoryObject(source.uploadedFields).notes || evidence.note || ""),
    historicalFinding: source.historicalFinding || (source.stagingState !== "staged_unverified" && source.Outcome?.toString().startsWith("verified_") ? source.Outcome : null),
    category: source.category || (directoryObject(evidence.email).source === "manual_entry" ? "manually_entered_email" : directoryObject(evidence.email).source === "manual_approval" ? "manually_approved_email" : row.email ? "verified_public_email" : candidateEmail ? "review_only" : "no_verified_email"),
    nextAction, eligibility,
  };
}
export function historicalApprovalEvidence(row: SalonEnrichmentRow, input: Record<string, unknown>) {
  const view = leadView(row);
  if (input.email !== undefined && typeof input.email !== "string") throw new Error("Enter the email address as text.");
  const candidate = (typeof input.email === "string" ? input.email : row.email || view.candidateEmail || "").trim().toLowerCase();
  if (candidate.length > 254 || /[<>:,;]/.test(candidate) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate) || salonEmailDomainRestriction(candidate)) throw new Error("A usable business email is required; restricted service addresses cannot be saved or approved.");
  const sourceUrl = String(typeof input.sourceUrl === "string" ? input.sourceUrl : view.sourceUrl || "").trim();
  if (sourceUrl.length > 2000) throw new Error("The website source link must be at most 2,000 characters.");
  if (sourceUrl) {
    let url: URL;
    try { url = new URL(sourceUrl); } catch { throw new Error("If supplied, the source must be a valid public HTTPS URL."); }
    if (url.protocol !== "https:" || url.username || url.password) throw new Error("If supplied, the source must be a public HTTPS URL.");
  }
  const sourceReviewed = Boolean(sourceUrl && input.identityConfirmed === true && input.historicalEvidenceConfirmed === true);
  return { value: candidate, source: sourceReviewed ? "public_web_review" : "manual_approval", confidence: sourceReviewed ? "high" : "manual",
    sourceUrl: sourceUrl || null, purpose: "general",
    fetchedAt: sourceReviewed ? new Date().toISOString() : null, reviewedAt: new Date().toISOString(),
    reviewNote: typeof input.reviewNote === "string" ? input.reviewNote.trim().slice(0,1500) : "",
    identityConfirmed: input.identityConfirmed === true, sourceInspected: input.historicalEvidenceConfirmed === true };
}