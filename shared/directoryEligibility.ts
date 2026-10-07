export interface DirectoryListing {
  categories: string[];
  name: string | null;
  address: string | null;
  placeId: string | null;
  provider: string;
  sourceUrl: string | null;
}
export interface GroomingReview {
  decision: "approved" | "excluded";
  note: string;
  identityKey: string;
  reviewedAt: string;
}
export type EligibilityRow = {
  evidence?: unknown; sourceData?: unknown; notes?: string | null;
  businessName?: string | null; company?: string | null; address?: string | null;
  placeId?: string | null; reviewStatus?: string | null;
};
export interface DirectoryEligibility {
  listing: DirectoryListing;
  classification: "grooming" | "ambiguous" | "unrelated" | "unknown";
  decision: "approved" | "excluded" | "pending";
  flagged: boolean;
  blocked: boolean;
  reason: string;
  reviewNote: string | null;
  identityKey: string;
}
export const DIRECTORY_NOTES_MARKER = "\n[Directory eligibility] ";
export function directoryObject(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}
function clean(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 1500) : null;
}
function publicLink(value: unknown): string | null {
  try {
    const url = new URL(clean(value) || "");
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
export function providerCategories(value: unknown): string[] {
  const values = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[,;|]/) : [];
  return Array.from(new Set(values.map(item => clean(typeof item === "object" ? item?.title || item?.name : item))
    .filter((item): item is string => !!item))).slice(0, 30);
}
export function directoryNotesEvidence(notes: string | null | undefined): Record<string, any> {
  const index = notes?.lastIndexOf(DIRECTORY_NOTES_MARKER) ?? -1;
  if (index < 0) return {};
  try { return directoryObject(JSON.parse(notes!.slice(index + DIRECTORY_NOTES_MARKER.length))); }
  catch { return {}; }
}
export function withDirectoryNotes(notes: string | null | undefined, metadata: unknown): string {
  const index = notes?.lastIndexOf(DIRECTORY_NOTES_MARKER) ?? -1;
  const original = index < 0 ? notes || "" : notes!.slice(0, index);
  return original + DIRECTORY_NOTES_MARKER + JSON.stringify(metadata);
}
export function directoryEligibility(row: EligibilityRow): DirectoryEligibility {
  const source = directoryObject(row.sourceData);
  const uploaded = directoryObject(source.uploadedFields);
  const evidence = { ...directoryNotesEvidence(row.notes), ...directoryObject(row.evidence) };
  const listingEvidence = directoryObject(evidence.directoryListing);
  const categories = providerCategories(listingEvidence.categories ?? source["Provider category"] ??
    uploaded["Provider category"] ?? source.providerCategory ?? source.businessCategory ??
    source["Business Category"] ?? source["Category"] ?? source["category"]);
  // Report workflow labels are not provider business categories.
  const workflow = new Set(["verified_public_email", "review_only", "no_verified_email", "booking_only",
    "inaccessible", "staged_unverified", "verification_attempted"]);
  const filteredCategories = categories.filter(category => !workflow.has(category.toLowerCase()));
  const listing: DirectoryListing = {
    categories: filteredCategories,
    name: clean(listingEvidence.name ?? source["Provider business name"] ?? uploaded["Provider business name"]),
    address: clean(listingEvidence.address ?? source["Provider address"] ?? uploaded["Provider address"]),
    placeId: clean(listingEvidence.placeId ?? source["Provider Place ID"] ?? uploaded["Provider Place ID"]),
    provider: clean(listingEvidence.provider) || (source["Provider category"] || uploaded["Provider category"] ? "Uploaded provider report" : "Source listing"),
    sourceUrl: publicLink(listingEvidence.sourceUrl),
  };
  const labels = filteredCategories.map(category => category.toLowerCase().replace(/[_-]/g, " "));
  const grooming = labels.some(label => /\b(?:pet|dog|cat|animal)\s+groom(?:er|ers|ing)\b|\bgrooming (?:salon|service)\b/.test(label));
  const unrelated = labels.some(label => /\b(?:restaurant|grocery|supermarket|pharmacy|drug ?store|dollar store|department store|convenience store|general (?:store|retail)|hair salon|beauty salon|barber|non grooming|excluded non grooming)\b/.test(label));
  const pet = labels.some(label => /\b(?:pet|dog|cat|animal|veterinar|kennel|boarding|day care|daycare|grooming supply)\b/.test(label));
  const classification = unrelated ? grooming || pet ? "ambiguous" : "unrelated"
    : grooming ? "grooming" : pet || labels.length ? "ambiguous" : "unknown";
  const identityKey = JSON.stringify([row.businessName || row.company || "", row.address || "", row.placeId || "",
    listing.name, listing.address, listing.placeId, [...filteredCategories].sort()]);
  const review = directoryObject(evidence.groomingReview);
  const validReview = review.identityKey === identityKey && typeof review.note === "string" &&
    typeof review.reviewedAt === "string" && !Number.isNaN(Date.parse(review.reviewedAt));
  const decision = validReview && ["approved", "excluded"].includes(review.decision) ? review.decision : "pending";
  const blocked = decision === "excluded" || (decision !== "approved" && ["unrelated", "ambiguous"].includes(classification));
  const reason = decision === "excluded" ? "Human reviewer excluded this business from grooming outreach."
    : decision === "approved" ? "Human reviewer confirmed grooming services. Email approval remains separate."
    : classification === "unrelated" ? "Clearly unrelated category. Confirm grooming services or exclude before outreach."
    : classification === "ambiguous" ? "Category alone does not establish grooming services. Keep for human review."
    : classification === "grooming" ? "Provider lists grooming services. Identity and email still need approval."
    : "No provider category available. Review business identity before approving outreach.";
  return { listing, classification, decision, blocked, reason, flagged: classification === "unrelated" && decision === "pending",
    reviewNote: validReview ? clean(review.note) : null, identityKey };
}
export function groomingReviewFor(row: EligibilityRow, decision: GroomingReview["decision"], note: string): GroomingReview {
  return { decision, note: note.trim().slice(0, 1500), identityKey: directoryEligibility(row).identityKey, reviewedAt: new Date().toISOString() };
}
export function directoryEligibilitySummary(rows: EligibilityRow[]) {
  const summary = { total: rows.length, flagged: 0, needsGroomingReview: 0, approved: 0, excluded: 0 };
  for (const row of rows) {
    const eligibility = directoryEligibility(row);
    if (eligibility.flagged) summary.flagged++;
    if (eligibility.blocked && eligibility.decision !== "excluded") summary.needsGroomingReview++;
    if (eligibility.decision === "excluded" || row.reviewStatus === "rejected") summary.excluded++;
    else if (!eligibility.blocked && (row.reviewStatus === "approved" || eligibility.decision === "approved")) summary.approved++;
  }
  return summary;
}
export function isBookingOrOrderingUrl(value: string | null | undefined): boolean {
  try {
    const url = new URL(value || "");
    const host = url.hostname.toLowerCase();
    const platforms = ["opentable.com", "doordash.com", "ubereats.com", "grubhub.com", "toasttab.com",
      "order.online", "booksy.com", "vagaro.com", "acuityscheduling.com", "setmore.com", "fresha.com",
      "groomer.io", "moego.pet", "petexec.net", "book.cuddlesapp.com", "schedulicity.com"];
    const path = decodeURIComponent(url.pathname).replace(/([a-z])([A-Z])/g, "$1-$2");
    return platforms.some(platform => host === platform || host.endsWith(`.${platform}`)) ||
      /(?:^|\.)(?:book|booking|orders?|ordering|appointments?|reservations?|schedule)\./i.test(host) ||
      /(?:^|[/.?&#=_-])(?:book(?:ing|ings)?|bookgrooming|petcoservicesbookgrooming|appointments?|reservations?|reserve|schedule|scheduling|orders?|ordering|checkout|cart)(?:[/.?&#=_-]|$)/i.test(path + url.search + url.hash);
  } catch { return true; }
}