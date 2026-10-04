import type { SalonOwnerNameCandidate } from "./salonOwnerName";

// Discovery relevance is not business/location verification or approval.
const businessText = (value: string) => value.toLocaleLowerCase()
  .replace(/['’‘]/g, "")
  .replace(/[^\p{L}\p{N}]+/gu, " ").trim();

export function mentionsOwnerBusiness(businessName: string, text: string): boolean {
  const business = businessText(businessName);
  return Boolean(business && ` ${businessText(text)} `.includes(` ${business} `));
}

// Older lookups may have saved unrelated search-summary names. Hide those
// suggestions without editing the saved evidence, approvals, or contact names.
export function relevantOwnerCandidate(candidate: SalonOwnerNameCandidate, businessName: string): boolean {
  return candidate.sources.some(source => source.kind !== "organic_summary" ||
    mentionsOwnerBusiness(businessName, source.excerpt));
}