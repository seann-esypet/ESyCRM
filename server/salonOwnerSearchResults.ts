import { mentionsOwnerBusiness } from "@shared/salonOwnerDiscoveryRelevance";

export type OwnerSearchResult = {
  title?: string;
  link?: string;
  snippet?: string;
  summaryKind?: "google_ai_overview";
  citations?: OwnerSearchResult[];
};

export type OwnerSearchResponse = {
  results: OwnerSearchResult[];
  notice?: string;
};

type JsonObject = Record<string, unknown>;
const object = (value: unknown): JsonObject =>
  value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
const string = (value: unknown): string => typeof value === "string" ? value.slice(0, 8000) : "";
const array = (value: unknown): unknown[] => Array.isArray(value) ? value.slice(0, 40) : [];
const publicLink = (value: unknown): string | undefined => {
  try {
    const url = new URL(string(value));
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : undefined;
  } catch { return undefined; }
};

// An overview is a discovery summary, never fetched-page ownership evidence.
// Retain block-level citations separately so an AI claim is not attributed to
// the cited page as though we had read and verified it.
export function parseOwnerSearchResponse(payload: unknown, businessName: string, query: string): OwnerSearchResponse {
  const data = object(payload);
  const results: OwnerSearchResult[] = array(data.organic_results).slice(0, 10).map(value => {
    const item = object(value);
    return { title: string(item.title), snippet: string(item.snippet), link: publicLink(item.link) };
  });
  const overview = object(data.ai_overview);
  const references = array(overview.references).map(value => object(value));
  let context = "";
  let visited = 0;
  const visit = (values: unknown[], inheritedIndexes: unknown[] = [], depth = 0) => {
    if (depth > 5) return;
    for (const value of values) {
      if (++visited > 100) return;
      const block = object(value);
      const text = [string(block.title), string(block.snippet)].filter(Boolean).join(": ");
      const indexes = Array.isArray(block.reference_indexes) ? array(block.reference_indexes) : inheritedIndexes;
      const cited = references.filter((reference, index) => indexes.includes(reference.index ?? index))
        .map(reference => ({
          title: string(reference.title), snippet: string(reference.snippet), link: publicLink(reference.link),
        }));
      const relevantCitations = cited.filter(item =>
        mentionsOwnerBusiness(businessName, `${item.title} ${item.snippet}`));
      if (mentionsOwnerBusiness(businessName, text)) context = text;
      else if ((block.type === "paragraph" && !relevantCitations.length) || (block.type === "heading" &&
        !/^(?:business details|details|overview|about|owner(?:ship)?|staff|team)\s*:?\s*$/i.test(text))) context = "";
      const summary = mentionsOwnerBusiness(businessName, text) ? text : context ? `${context}\n${text}` : "";
      if (text && summary && /\b(?:owner|founder|proprietor|owned)\b/i.test(text)) {
        // A citation naming an unrelated business must not lend relevance to
        // a name merely because another overview paragraph mentioned our salon.
        if (!cited.length || relevantCitations.length) {
          results.push({
            title: "Google AI Overview (unverified)",
            snippet: summary.slice(0, 8000),
            link: `https://www.google.com/search?q=${encodeURIComponent(query)}`,
            summaryKind: "google_ai_overview",
            citations: relevantCitations.filter(item => item.link),
          });
        }
      }
      visit(array(block.list), indexes, depth + 1);
      visit(array(block.text_blocks), indexes, depth + 1);
    }
  };
  visit(array(overview.text_blocks));
  const notice = !array(overview.text_blocks).length && string(overview.page_token)
    ? "Google supplied an AI Overview retrieval token, not its text. Reading it requires another provider request; the app did not make that extra paid request."
    : undefined;
  return { results, ...(notice ? { notice } : {}) };
}

// Keep existing organic-only caches free to reuse. New responses preserve
// inline overview suggestions and missing-overview diagnostics as well.
export function readOwnerSearchCache(value: unknown): OwnerSearchResponse {
  if (Array.isArray(value)) return { results: value as OwnerSearchResult[] };
  const envelope = object(value);
  return {
    results: Array.isArray(envelope.results) ? envelope.results as OwnerSearchResult[] : [],
    ...(typeof envelope.notice === "string" ? { notice: envelope.notice } : {}),
  };
}