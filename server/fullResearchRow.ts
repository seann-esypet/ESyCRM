import type { SalonEnrichmentRow } from "@shared/schema";
import { directoryObject } from "@shared/directoryEligibility";
import { EMPTY_OWNER_NAME_RESULT } from "@shared/salonOwnerName";
import { crawlWebsite, searchWithSerpApi } from "./lead-discovery";
import { enrichRow } from "./salonEnrichment";
import { businessAndLocationMatch, extractSalonOwnerCandidates, stripHtml, searchSalonContactPages, researchSalonOwnerCandidates } from "./salonOwnerNames";
import { safeWebsite } from "./salonListStaging";
import type { SerpRequestPolicy } from "./serpRequestPolicy";

export const fullResearchRowTools = { crawlWebsite, searchWithSerpApi, enrichRow, searchSalonContactPages, researchSalonOwnerCandidates };
export async function researchFullRow(
  row: SalonEnrichmentRow,
  beforePaid: (tool: string) => Promise<void>,
  tools = fullResearchRowTools,
  requestPolicy?: SerpRequestPolicy,
): Promise<Partial<SalonEnrichmentRow>> {
  const pages: { url: string; html: string }[] = [];
  const cached = new Map<string, Awaited<ReturnType<typeof crawlWebsite>>>();
  let patch: Partial<SalonEnrichmentRow> = {};
  let matchedWebsite = false;
  const crawl: typeof crawlWebsite = async (url, options) => {
    if (cached.has(url)) return cached.get(url)!;
    const result = await tools.crawlWebsite(url, { ...options, onPage: page => pages.push(page) });
    const matched = businessAndLocationMatch(row, stripHtml(result.html));
    const safe = matched ? result : { ...result, email: undefined, phone: undefined, ownerName: undefined,
      bookingUrl: undefined, softwareName: undefined,
      rejectedEmails: [...result.rejectedEmails, ...(result.email ? [{
        value: result.email, sourceUrl: result.emailSourceUrl || url, reason: "Business/location match was not confirmed.",
      }] : [])] };
    cached.set(url, safe);
    return safe;
  };
  if (row.websiteUrl && safeWebsite(row.websiteUrl)) {
    try {
      const site = await crawl(row.websiteUrl);
      matchedWebsite = businessAndLocationMatch(row, stripHtml(site.html));
      if (matchedWebsite) {
        patch = {
          hasWebsite: "Yes", websiteUrl: row.websiteUrl,
          ...(site.email ? { email: site.email } : {}),
          ...(site.bookingUrl ? { usesSoftware: "Yes", currentSoftware: site.softwareName || "Unknown", bookingUrl: site.bookingUrl } : {}),
          evidence: {
            ...(site.email ? { email: { value: site.email, source: "website", sourceUrl: site.emailSourceUrl || row.websiteUrl,
              confidence: "high", purpose: "general", rationale: "Public email on a business/location-matched website; manual review is required." } } : {}),
            ...(site.bookingUrl ? { usesSoftware: { value: "Yes", source: "website", sourceUrl: row.websiteUrl },
              currentSoftware: { value: site.softwareName || "Unknown", source: "website", sourceUrl: row.websiteUrl } } : {}),
          },
        };
      }
    } catch { /* Missing live pages are unknown, not evidence of no email or no software. */ }
  }
  const search: typeof searchWithSerpApi = (query, zip, state, template, options) =>
    tools.searchWithSerpApi(query, zip, state, template, {
      ...options, requestPolicy, beforeProviderRequest: async () => {
        await beforePaid("business_search");
        await options?.beforeProviderRequest?.();
      },
    });
  const fallbackSearch: typeof searchWithSerpApi = async () => {
    const found = await tools.searchSalonContactPages(row, 1, () => beforePaid("email_contact_search"), requestPolicy);
    if (found.error) throw new Error(found.error);
    return { results: found.results, fromCache: found.calls === 0 };
  };
  try {
    const enriched = await tools.enrichRow(row, { search, fallbackSearch, crawl, matchedWebsite });
    patch = { ...patch, ...enriched, evidence: { ...directoryObject(patch.evidence), ...directoryObject(enriched.evidence) } };
    if (patch.websiteUrl && !safeWebsite(patch.websiteUrl)) {
      patch.evidence = { ...directoryObject(patch.evidence),
        publicSource: { value: patch.websiteUrl, sourceUrl: patch.websiteUrl, source: "public_listing" } };
      patch.websiteUrl = null; patch.hasWebsite = "Unknown";
    }
    const websiteCandidates = pages.flatMap(page => {
      const text = stripHtml(page.html);
      return businessAndLocationMatch(row, text)
        ? extractSalonOwnerCandidates(text, { url: page.url, excerpt: text.slice(0, 800), kind: safeWebsite(page.url) ? "business_website" : "public_source" }, true, true, row.businessName)
        : [];
    });
    const priorName = directoryObject(directoryObject(row.evidence).ownerName);
    if (priorName.status !== "approved") {
      const names = websiteCandidates.some(candidate => candidate.roleConfirmed && candidate.businessMatched)
        ? { ...EMPTY_OWNER_NAME_RESULT, status: "needs_review", candidates: websiteCandidates, pagesFetched: pages.length }
        : await tools.researchSalonOwnerCandidates({ ...row, ...patch } as SalonEnrichmentRow, () => beforePaid("contact_name_search"), requestPolicy);
      patch.evidence = { ...directoryObject(patch.evidence), ownerName: names };
    }
  } catch (error) {
    patch.lastError = error instanceof Error ? error.message : "Research did not finish.";
    patch.status = "failed";
  }
  return { ...patch, reviewStatus: "needs_review", processedAt: new Date() };
}