import type { SalonEnrichmentRow } from "@shared/schema";
import { groomingIdentity, type GroomingChecks, type GroomingFinding } from "@shared/groomingChecks";
import { businessAndLocationMatch, stripHtml, searchSalonGroomingPages, fetchPublicResearchPage } from "./salonOwnerNames";
import type { SerpRequestPolicy } from "./serpRequestPolicy";

export type GroomingPage = { url: string; html: string };
const unknown = (reason: string): GroomingFinding => ({ answer: "Unknown", reason, sources: [] });
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function finish(finding: GroomingFinding): GroomingFinding {
  const answers = new Set(finding.sources.map(source => source.answer));
  if (answers.size > 1) return { ...finding, answer: "Unknown", reason: "Matching sources conflict. Review the evidence before deciding." };
  if (!answers.size) return finding;
  return { ...finding, answer: finding.sources[0].answer, reason: "Explicit statement on a live business/address-matched page; human review is still required." };
}

export function evaluateGroomingPages(row: SalonEnrichmentRow, pages: GroomingPage[]): GroomingChecks {
  const result: GroomingChecks = {
    version: 1, identity: groomingIdentity(row), checkedAt: new Date().toISOString(),
    offersGrooming: unknown("No explicit grooming-service evidence verified for this business and address."),
    groomingShop: unknown("No explicit grooming-shop evidence verified for this business and address."),
    businessType: "Unknown", providerCalls: 0, pagesFetched: 0, notes: [], aiAnswers: [],
  };
  const businessPattern = escape(row.businessName);
  const serviceNo = /\b(?:do not|don't|does not|doesn't|no longer|never)\s+(?:offer|provide|perform)\s+(?:(?:pet|dog|cat|animal)\s+)?grooming\b|\bgrooming(?: services| appointments)? (?:is|are|isn't|aren't) (?:not available|not offered|discontinued|no longer available|unavailable)\b|\b(?:pet|dog|cat|animal)\s+grooming\b[^.!?]{0,55}\b(?:not available|unavailable|not offered|not provided|discontinued|no longer available)\b/i;
  const serviceYes = /\b(?:pet|dog|cat|animal)\s+grooming\s+(?:services|appointments|packages)\b|\b(?:our|professional|full[- ]service)\s+(?:pet|dog|cat)\s+grooming\b|\b(?:book|schedule)\s+(?:your|a|an)\s+(?:pet|dog|cat)\s+grooming\b|\bwe (?:offer|provide|specialize in)\s+(?:(?:professional|full[- ]service)\s+)?(?:pet|dog|cat)\s+grooming\b|\b(?:we offer|we provide|our)\s+grooming(?: services)?\s+for\s+(?:dogs|cats|pets)\b/i;
  const shopYes = /\b(?:we are|we're|this business is)\s+(?:a|an)\s+(?:(?:dedicated|independent|professional|full[- ]service|local)\s+)*(?:(?:pet|dog|cat)\s+)?grooming\s+(?:shop|salon|studio)\b|\b(?:dedicated|independent)\s+(?:pet|dog|cat)\s+grooming\s+(?:shop|salon|studio)\b/i;
  const shopNo = /\b(?:not|no longer)\s+(?:a|an)\s+(?:(?:pet|dog|cat)\s+)?grooming\s+(?:shop|salon|studio)\b/i;
  const otherType = /\b(?:we are|we're|our|this is)\s+(?:(?:a|an|full[- ]service)\s+)*(pet store|veterinary clinic|animal hospital|boarding facility|dog daycare)\b/i;
  const mobileOnly = /\b(?:exclusively mobile|mobile[- ]only|only offer mobile grooming|no physical (?:salon|shop|location))\b/i;
  const add = (finding: GroomingFinding, page: GroomingPage, sentence: string, answer: "Yes" | "No", text: string) => {
    if (finding.sources.length >= 8 || finding.sources.some(source => source.url === page.url && source.answer === answer)) return;
    // Keep the assertion and identity evidence together for a reviewable source.
    const streetNumber = (row.address1 || row.address || "").match(/^\s*\d+\w*/)?.[0].trim();
    const addressAt = streetNumber ? text.search(new RegExp(`\\b${escape(streetNumber)}\\b`)) : -1;
    const nameAt = text.toLowerCase().indexOf(row.businessName.toLowerCase());
    finding.sources.push({ url: page.url, answer, excerpt: `${sentence.trim().slice(0, 500)}\nBusiness context: ${text.slice(Math.max(0, nameAt - 40), Math.max(0, nameAt - 40) + 300)}\nLocation context: ${text.slice(Math.max(0, addressAt - 40), Math.max(0, addressAt - 40) + 300)}` });
  };
  for (const page of pages) {
    if (!/^https?:\/\//i.test(page.url)) continue;
    const text = stripHtml(page.html.replace(/<blockquote\b[^>]*>[\s\S]*?<\/blockquote>/gi, " "));
    // A city-only/name-only hit or business category cannot answer either check.
    if (!/^\d/.test((row.address1 || row.address || "").trim()) || !businessAndLocationMatch(row, text)) continue;
    result.pagesFetched++;
    for (const raw of text.split(/(?<=[.!?])\s+|\n+/)) {
      if (/\?\s*$/.test(raw) || /\b(?:formerly|previously|used to|was a|were a|once offered|we offered|we provided)\b/i.test(raw)) continue;
      // Do not turn a business's name ("Dog Grooming") into a service claim.
      const sentence = raw.replace(new RegExp(businessPattern, "gi"), "This business");
      const noServices = serviceNo.test(sentence) || /\bgrooming(?: services| appointments)? (?:isn't|aren't) (?:available|offered|provided)\b/i.test(sentence);
      const yesServices = serviceYes.test(sentence);
      const petContext = /\b(?:pet|dog|cat|animal)\b/i.test(text) || yesServices;
      if (noServices && petContext) add(result.offersGrooming, page, raw, "No", text);
      else if (yesServices) add(result.offersGrooming, page, raw, "Yes", text);
      const kind = sentence.match(otherType)?.[1];
      if (kind) {
        result.businessType = kind;
        add(result.groomingShop, page, raw, "No", text);
      } else if (mobileOnly.test(sentence)) {
        result.businessType = "Mobile-only grooming service";
        add(result.groomingShop, page, raw, "No", text);
      }
      if (shopNo.test(sentence) && petContext) add(result.groomingShop, page, raw, "No", text);
      else if (shopYes.test(sentence) && petContext && !kind && !mobileOnly.test(sentence)) {
        result.businessType = "Dedicated grooming shop";
        add(result.groomingShop, page, raw, "Yes", text);
        if (!noServices) add(result.offersGrooming, page, raw, "Yes", text);
      }
    }
  }
  result.offersGrooming = finish(result.offersGrooming);
  result.groomingShop = finish(result.groomingShop);
  if (result.groomingShop.sources.some(source => source.answer === "Yes") &&
      result.groomingShop.sources.some(source => source.answer === "No")) result.businessType = "Unknown — conflicting sources";
  return result;
}

export const groomingResearchTools = { searchSalonGroomingPages, fetchPublicResearchPage };
export async function researchGroomingChecks(row: SalonEnrichmentRow, reusedPages: GroomingPage[], discoveredUrls: string[],
  beforePaid: (tool: string) => Promise<void>, policy?: SerpRequestPolicy,
  onProgress: (result: GroomingChecks) => void = () => {}, tools = groomingResearchTools): Promise<GroomingChecks> {
  const pages = [...reusedPages], visited = new Set(pages.map(page => page.url));
  let calls = 0, fetched = 0;
  const notes: string[] = [];
  const aiAnswers: GroomingChecks["aiAnswers"] = [];
  const current = () => {
    const result = evaluateGroomingPages(row, pages);
    result.providerCalls = calls; result.pagesFetched = pages.length;
    result.notes = notes.slice(-12); result.aiAnswers = aiAnswers.slice(0, 4); onProgress(result); return result;
  };
  const unresolved = () => {
    const result = current();
    // Conflicting positive/negative evidence is for human review, not more spending.
    return [result.offersGrooming, result.groomingShop].some(finding => finding.answer === "Unknown" && !finding.sources.length);
  };
  const inspect = async (urls: string[]) => {
    for (const url of urls) {
      if (fetched >= 4 || !unresolved()) break;
      if (visited.has(url) || !/^https?:\/\//i.test(url)) continue;
      visited.add(url); fetched++;
      try { pages.push(await tools.fetchPublicResearchPage(url)); }
      catch { notes.push(`Could not verify a live page: ${url.slice(0, 250)}. Missing pages do not establish No.`); }
      current();
    }
  };
  if (!/^\d/.test((row.address1 || row.address || "").trim())) {
    notes.push("An exact street address is needed to verify these checks. No additional search was made.");
    return current();
  }
  current();
  await inspect(discoveredUrls);
  for (const question of ["services", "shop"] as const) {
    const result = current(), finding = question === "services" ? result.offersGrooming : result.groomingShop;
    if (finding.answer !== "Unknown" || finding.sources.length) continue;
    const found = await tools.searchSalonGroomingPages(row, question, async () => {
      await beforePaid(question === "services" ? "grooming_services_search" : "grooming_shop_search");
      calls++; current();
    }, policy);
    if (found.error) throw new Error(found.error);
    if (found.notice) notes.push(found.notice);
    const summaries = found.results.filter(item => item.summaryKind === "google_ai_overview");
    for (const summary of summaries.slice(0, 2)) {
      aiAnswers.push({ question, text: (summary.snippet || "").slice(0, 4000),
        sourceUrl: summary.link || `https://www.google.com/search?q=${encodeURIComponent(row.businessName)}`,
        citations: (summary.citations || []).map(item => item.link!).filter(Boolean).slice(0, 6) });
    }
    if (!summaries.length) notes.push(`No inline Google AI answer was returned for the ${question} question. This does not establish No.`);
    await inspect([...summaries.flatMap(item => (item.citations || []).map(item => item.link!)),
      ...found.results.filter(item => !item.summaryKind).map(item => item.link!)].filter(Boolean));
  }
  if (fetched >= 4 && unresolved()) notes.push("The four-page verification limit was reached. Unverified findings remain Unknown, even when Google AI suggests an answer.");
  return current();
}
