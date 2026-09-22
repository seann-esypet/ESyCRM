import { storage } from "./storage";
import { crawlWebsite, searchWithSerpApi } from "./lead-discovery";
import type { SalonEnrichmentBatch, SalonEnrichmentRow } from "@shared/schema";

type Evidence = Record<string, {
  value: string | null;
  source: string;
  sourceUrl?: string;
  fetchedAt: string;
  confidence: "high" | "medium" | "low";
  rationale?: string;
}>;

const activeProcessors = new Set<string>();

function tokens(value: string | null | undefined): string[] {
  return (value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
}

function normalized(value: string | null | undefined): string {
  return tokens(value).join(" ");
}

function overlap(left: string | null | undefined, right: string | null | undefined): number {
  const a = new Set(tokens(left));
  const b = new Set(tokens(right));
  if (!a.size || !b.size) return 0;
  return Array.from(a).filter(token => b.has(token)).length / Math.max(a.size, b.size);
}

function strongMatch(row: SalonEnrichmentRow, candidate: { title?: string; address?: string; placeId?: string }): boolean {
  if (row.placeId && candidate.placeId) {
    return normalized(row.placeId) === normalized(candidate.placeId);
  }
  const nameScore = overlap(row.businessName, candidate.title);
  const addressScore = overlap(row.address, candidate.address) || overlap(
    [row.address1, row.city, row.state, row.zipCode].filter(Boolean).join(" "),
    candidate.address,
  );
  return nameScore >= 0.6 && addressScore >= 0.45;
}

function evidence(value: string | null, source: string, confidence: "high" | "medium" | "low", sourceUrl?: string, rationale?: string) {
  return { value, source, sourceUrl, fetchedAt: new Date().toISOString(), confidence, rationale };
}

async function enrichRow(row: SalonEnrichmentRow): Promise<Partial<SalonEnrichmentRow>> {
  const evidenceMap: Evidence = {};
  let serpCallsUsed = 0;
  const zip = row.zipCode || "00000";
  const state = row.state || "US";
  const query = `"${row.businessName}" "${row.address || [row.city, row.state].filter(Boolean).join(" ")}"`;
  const queryTemplate = `salon-enrichment:${normalized(row.businessName)}:${normalized(row.address)}:maps`;
  let candidate: { title: string; link: string; phone?: string; address?: string; placeId?: string } | undefined;
  let serpResult: { results: any[]; fromCache: boolean } | undefined;
  let fallbackUsed = false;
  const runFallback = async () => {
    fallbackUsed = true;
    const fallback = await searchWithSerpApi(
      `"${row.businessName}" "${row.city || ""}" ${row.state || ""} grooming website contact booking`,
      zip,
      state,
      `salon-enrichment:${normalized(row.businessName)}:${normalized(row.address)}:fallback`,
    );
    if (!fallback.fromCache) serpCallsUsed++;
    return fallback.results.find(result => strongMatch(row, result));
  };

  try {
    serpResult = await searchWithSerpApi(query, zip, state, queryTemplate);
    if (!serpResult.fromCache) serpCallsUsed++;
    candidate = serpResult.results.find(result => strongMatch(row, result));
  } catch (error) {
    const message = error instanceof Error ? error.message : "SERP lookup failed";
    if (/quota|hourly serp limit|rate limit/i.test(message)) throw error;
    return {
      status: "failed",
      lastError: message,
      serpCallsUsed,
      evidence: evidenceMap,
      processedAt: new Date(),
    };
  }

  // One fallback query is allowed when Maps did not produce a strong match or
  // its matched listing has no website/contact data.
  if (!candidate || !candidate.link) {
    try {
      candidate = await runFallback() || candidate;
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (/quota|hourly serp limit|rate limit/i.test(message)) throw error;
      // The first lookup may still have yielded enough information to review.
    }
  }

  if (!candidate) {
    return {
      status: "enriched",
      identityMatchStatus: "unmatched",
      reviewStatus: "needs_review",
      usesSoftware: "Unknown",
      hasWebsite: "Unknown",
      audienceTrack: "directory_general",
      confidence: { identity: "low" },
      evidence: { identity: evidence(null, "serp_google_maps", "low", undefined, "No strong name/address match") },
      serpCallsUsed,
      processedAt: new Date(),
    };
  }

  const next: Partial<SalonEnrichmentRow> = {
    status: "enriched",
    identityMatchStatus: "strong",
    websiteUrl: candidate.link || null,
    phone: candidate.phone || null,
    hasWebsite: candidate.link ? "Yes" : "No",
    confidence: {},
    evidence: evidenceMap,
    serpCallsUsed,
    processedAt: new Date(),
  };
  evidenceMap.identity = evidence(row.businessName, "serp_google_maps", "high", candidate.link, "Quoted business name and address matched");
  if (candidate.link) evidenceMap.website = evidence(candidate.link, "serp_google_maps", "high", candidate.link);
  if (candidate.phone) evidenceMap.phone = evidence(candidate.phone, "serp_google_maps", "high", candidate.link);

  if (candidate.link) {
    try {
      const crawled = await crawlWebsite(candidate.link);
      if (crawled.email) {
        next.email = crawled.email;
        evidenceMap.email = evidence(crawled.email, "website", "high", candidate.link);
      }
      if (crawled.phone && !next.phone) {
        next.phone = crawled.phone;
        evidenceMap.phone = evidence(crawled.phone, "website", "high", candidate.link);
      }
      if (crawled.contactFormUrl) {
        next.contactRequestFormUrl = crawled.contactFormUrl;
        evidenceMap.contactFormUrl = evidence(crawled.contactFormUrl, "website", "medium", candidate.link);
      }
      if (crawled.bookingUrl) {
        next.bookingUrl = crawled.bookingUrl;
        next.currentSoftware = crawled.softwareName || "Unknown";
        next.usesSoftware = "Yes";
        next.audienceTrack = "directory_has_software";
        evidenceMap.bookingUrl = evidence(crawled.bookingUrl, "website", crawled.softwareName && crawled.softwareName !== "Unknown" ? "high" : "medium", candidate.link);
        evidenceMap.currentSoftware = evidence(crawled.softwareName || "Unknown", "website", crawled.softwareName && crawled.softwareName !== "Unknown" ? "high" : "medium", candidate.link);
      } else {
        next.usesSoftware = "No";
        next.audienceTrack = "directory_no_software";
        evidenceMap.usesSoftware = evidence("No", "website", "medium", candidate.link, "Canonical website crawled with no booking signal");
      }
      // Only after the canonical site has been crawled may one targeted SERP
      // fallback look for missing contact/booking data.
      if (!fallbackUsed && (!crawled.email || !crawled.bookingUrl)) {
        try {
          const fallbackCandidate = await runFallback();
          if (fallbackCandidate?.link && fallbackCandidate.link !== candidate.link) {
            const fallbackCrawl = await crawlWebsite(fallbackCandidate.link);
            if (!next.email && fallbackCrawl.email) {
              next.email = fallbackCrawl.email;
              evidenceMap.email = evidence(fallbackCrawl.email, "serp_fallback_website", "medium", fallbackCandidate.link);
            }
            if (!next.bookingUrl && fallbackCrawl.bookingUrl) {
              next.bookingUrl = fallbackCrawl.bookingUrl;
              next.currentSoftware = fallbackCrawl.softwareName || "Unknown";
              next.usesSoftware = "Yes";
              next.audienceTrack = "directory_has_software";
              evidenceMap.bookingUrl = evidence(fallbackCrawl.bookingUrl, "serp_fallback_website", "medium", fallbackCandidate.link);
            }
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : "";
          if (/quota|hourly serp limit|rate limit/i.test(message)) throw error;
        }
      }
      const confidence: Record<string, string> = { identity: "high", website: "high" };
      for (const [key, value] of Object.entries(evidenceMap)) confidence[key] = value.confidence;
      next.confidence = confidence;
      next.reviewStatus = next.email ? "needs_review" : "needs_review";
    } catch (error) {
      const message = error instanceof Error ? error.message : "Website crawl failed";
      if (/quota|hourly serp limit|rate limit/i.test(message)) throw error;
      next.reviewStatus = "needs_review";
      next.usesSoftware = "Unknown";
      next.audienceTrack = "directory_general";
      next.lastError = message;
      evidenceMap.website = evidence(candidate.link, "serp_google_maps", "medium", candidate.link, "Website found but could not be crawled");
      next.confidence = { identity: "high", website: "low" };
    }
  } else {
    next.reviewStatus = "needs_review";
    next.usesSoftware = "Unknown";
    next.audienceTrack = "directory_general";
  }
  next.evidence = evidenceMap;
  return next;
}

async function processBatch(batch: SalonEnrichmentBatch): Promise<void> {
  if (activeProcessors.has(batch.id)) return;
  activeProcessors.add(batch.id);
  try {
    while (true) {
      const current = await storage.getSalonEnrichmentBatch(batch.id, batch.userId);
      if (!current || current.status !== "running") return;
      const pendingRows = await storage.getSalonEnrichmentRows(batch.id, batch.userId, { status: "pending" });
      const processingRows = await storage.getSalonEnrichmentRows(batch.id, batch.userId, { status: "processing" });
      const rows = pendingRows.concat(processingRows);
      if (!rows.length) {
        await storage.updateSalonEnrichmentBatch(batch.id, { status: "completed", completedAt: new Date() }, batch.userId);
        await storage.refreshSalonEnrichmentBatchCounts(batch.id, batch.userId);
        return;
      }
      if (current.processedRows >= current.pilotLimit) {
        await storage.updateSalonEnrichmentBatch(batch.id, { status: "paused", pausedAt: new Date() }, batch.userId);
        return;
      }
      const limit = Math.min(current.pilotLimit - current.processedRows, rows.length);
      const work = rows.slice(0, limit);
      for (let i = 0; i < work.length; i += current.concurrency) {
        const chunk = work.slice(i, i + current.concurrency);
        await Promise.all(chunk.map(async row => {
          await storage.updateSalonEnrichmentRow(row.id, { status: "processing", lastError: null }, batch.userId);
          try {
            const result = await enrichRow(row);
            const candidateContact = {
              firstName: null, lastName: null, company: row.businessName,
              email: (result.email as string | null | undefined) ?? row.email,
              phone: (result.phone as string | null | undefined) ?? row.phone,
              usesSoftware: (result.usesSoftware as string | null | undefined) || "Unknown",
            } as any;
            const duplicates = await storage.findDuplicateContacts(candidateContact, row.userId);
            if (duplicates.length) {
              result.duplicateMetadata = { contactIds: duplicates.map(contact => contact.id), reason: "Existing contact match" };
              result.reviewStatus = "needs_review";
            }
            await storage.updateSalonEnrichmentRow(row.id, result, batch.userId);
          } catch (error) {
            const message = error instanceof Error ? error.message : "Enrichment failed";
            if (/quota|hourly serp limit|rate limit/i.test(message)) {
              await storage.updateSalonEnrichmentRow(row.id, {
                status: "pending", lastError: message, processedAt: null,
              }, batch.userId);
              await storage.updateSalonEnrichmentBatch(batch.id, {
                status: "paused", pausedAt: new Date(), errorMessage: message,
              }, batch.userId);
              return;
            }
            await storage.updateSalonEnrichmentRow(row.id, {
              status: "failed", lastError: message, processedAt: new Date(),
            }, batch.userId);
          }
        }));
        await storage.refreshSalonEnrichmentBatchCounts(batch.id, batch.userId);
        const after = await storage.getSalonEnrichmentBatch(batch.id, batch.userId);
        if (!after || after.status !== "running") return;
      }
    }
  } finally {
    activeProcessors.delete(batch.id);
  }
}

export function startSalonEnrichment(batch: SalonEnrichmentBatch): void {
  processBatch(batch).catch(async error => {
    console.error(`[SalonEnrichment] Batch ${batch.id} failed:`, error);
    await storage.updateSalonEnrichmentBatch(batch.id, {
      status: "failed", errorMessage: error instanceof Error ? error.message : "Batch failed", completedAt: new Date(),
    }, batch.userId);
  });
}

export { enrichRow };