import type { SalonEnrichmentRow } from "@shared/schema";
import { mentionsOwnerBusiness } from "@shared/salonOwnerDiscoveryRelevance";

type Identity = Pick<SalonEnrichmentRow, "businessName" | "address" | "city" | "state">;
type OrganicResult = { title?: string; link?: string; snippet?: string };
const normalized = (value: string) => value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

// Recover locality for discovery only; never relax the exact-location approval check.
export function ownerDiscoveryLocation(row: Identity): string {
  const parts = (row.address || "").split(",").map(part => part.trim());
  const stateIndex = parts.findIndex((part, index) => index > 1 && /^[A-Z]{2}(?:\s+\d{5}(?:-\d{4})?)?$/i.test(part));
  const city = row.city?.trim() || (stateIndex > 1 ? parts[stateIndex - 1] : "");
  const state = row.state?.trim() || (stateIndex > 1 ? parts[stateIndex].slice(0, 2) : "");
  return [city, state].filter(Boolean).join(", ");
}

export function prioritizeOwnerResults(row: Identity, results: OrganicResult[]): OrganicResult[] {
  const business = normalized(row.businessName);
  const score = (result: OrganicResult) => {
    const text = [result.title, result.snippet].filter(Boolean).join(" ");
    const mentionsBusiness = business && mentionsOwnerBusiness(row.businessName, text);
    const ownerRole = /\b(?:owner|owners|founder|co-founder|proprietor|owned and operated)\b/i.test(text);
    let path = "";
    try { path = new URL(result.link || "").pathname; } catch { /* Invalid URLs are filtered before fetching. */ }
    return (mentionsBusiness ? 4 : 0) + (ownerRole ? 4 : 0)
      + (mentionsBusiness && /\/(?:interview|about|meet-|our-story)/i.test(path) ? 2 : 0)
      - (/\/(?:search|category|tag)(?:\/|$)/i.test(path) ? 2 : 0);
  };
  return results.map((result, index) => ({ result, index, score: score(result) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(item => item.result);
}

// A fetched interview without the full street address can suggest a name, but
// cannot establish business/location identity or become approved evidence.
export function ownerInterviewDiscoveryText(row: Identity, text: string): string {
  const business = normalized(row.businessName);
  if (!business) return "";
  const lines = text.split(/\n+/).map(line => line.trim()).filter(Boolean);
  const blocks: string[] = [];
  for (let index = 0; index < lines.length; index++) {
    for (let size = 1; size <= 3 && index + size <= lines.length; size++) {
      const block = lines.slice(index, index + size).join("\n");
      if (block.length > 4000) continue;
      if (mentionsOwnerBusiness(row.businessName, block) &&
          /\bmy name is\b/i.test(block) && /\b(?:owner|founder|proprietor)\b/i.test(block)) {
        blocks.push(block);
        index += size - 1;
        break;
      }
    }
  }
  return blocks.join("\n");
}