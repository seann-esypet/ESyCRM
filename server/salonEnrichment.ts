import { storage } from "./storage";
import { crawlWebsite, searchWithSerpApi } from "./lead-discovery";
import { bookingPlatformForUrl, findSalonEmailOnBookingPage } from "./bookingPageEmail";
import { lookupSalonOwnerName } from "./salonOwnerNames";
import type { SalonEnrichmentBatch, SalonEnrichmentRow } from "@shared/schema";

type Evidence = Record<string, {
  value: string | null;
  source: string;
  sourceUrl?: string;
  fetchedAt: string;
  confidence: "high" | "medium" | "low";
  rationale?: string;
  sourceType?: string;
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

export function strongMatch(
  row: Pick<SalonEnrichmentRow, "placeId" | "businessName" | "address" | "address1" | "city" | "state" | "zipCode">,
  candidate: { title?: string; address?: string; placeId?: string },
): boolean {
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
  const placeId = row.placeId?.trim();
  const queryTemplate = placeId
    ? `salon-enrichment:place:${placeId}`
    : `salon-enrichment:${normalized(row.businessName)}:${normalized(row.address)}:maps`;
  const identitySource = placeId ? "serp_place_id" : "serp_google_maps";
  let candidate: { title: string; link: string; phone?: string; address?: string; placeId?: string } | undefined;
  let serpResult: { results: any[]; fromCache: boolean } | undefined;
  let candidateSource = identitySource;
  let phoneSource = identitySource;
  let phoneSourceUrl: string | undefined;
  let bookingEmail: string | null = null;
  let bookingEmailUrl: string | null = null;
  let initialPlaceIdMatch = false;
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
    serpResult = await searchWithSerpApi(query, zip, state, queryTemplate, placeId ? { placeId } : undefined);
    if (!serpResult.fromCache) serpCallsUsed++;
    candidate = serpResult.results.find(result => strongMatch(row, result));
    phoneSourceUrl = candidate?.link || undefined;
    initialPlaceIdMatch = Boolean(placeId && candidate?.placeId && normalized(placeId) === normalized(candidate.placeId));
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

  // A provider record with a different Place ID must never be repaired by a
  // name-only fallback. Keep the row unimportable for manual review instead.
  if (!candidate && placeId && serpResult?.results.some(
    result => result.placeId && normalized(result.placeId) !== normalized(placeId)
  )) {
    return {
      status: "enriched",
      identityMatchStatus: "unmatched",
      reviewStatus: "needs_review",
      usesSoftware: "Unknown",
      hasWebsite: "Unknown",
      audienceTrack: "directory_general",
      confidence: { identity: "low" },
      evidence: { identity: evidence(null, identitySource, "low", undefined, "Place ID did not match the uploaded record") },
      serpCallsUsed,
      processedAt: new Date(),
    };
  }

  // One fallback query is allowed when Maps did not produce a strong match or
  // its matched listing has no website/contact data.
  if (candidate?.link && bookingPlatformForUrl(candidate.link)) {
    bookingEmailUrl = candidate.link;
    bookingEmail = await findSalonEmailOnBookingPage(candidate.link, row.businessName);
  }
  if (!candidate || !candidate.link || (bookingPlatformForUrl(candidate.link) && !bookingEmail)) {
    try {
      const fallbackCandidate = await runFallback();
      if (fallbackCandidate && (!candidate || (
        fallbackCandidate.link && !bookingPlatformForUrl(fallbackCandidate.link)
      ))) {
        if (fallbackCandidate.phone) {
          phoneSource = "serp_fallback";
          phoneSourceUrl = fallbackCandidate.link || undefined;
        }
        candidate = { ...fallbackCandidate, phone: fallbackCandidate.phone || candidate?.phone };
        candidateSource = "serp_fallback";
      }
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
      evidence: { identity: evidence(null, identitySource, "low", undefined, "No strong Place ID or name/address match") },
      serpCallsUsed,
      processedAt: new Date(),
    };
  }

  const exactPlaceIdMatch = Boolean(
    initialPlaceIdMatch || (placeId && candidate.placeId && normalized(placeId) === normalized(candidate.placeId)),
  );
  const identityConfidence = placeId && !exactPlaceIdMatch ? "medium" : "high";
  const identityRationale = exactPlaceIdMatch
    ? "Returned Google Place ID matched the uploaded ID"
    : placeId
      ? "Business name and address matched; listing did not confirm the uploaded Place ID"
      : "Business name and address matched";
  const bookingPlatform = candidate.link ? bookingPlatformForUrl(candidate.link) : null;
  if (bookingPlatform && candidate.link !== bookingEmailUrl) {
    bookingEmailUrl = candidate.link;
    bookingEmail = await findSalonEmailOnBookingPage(candidate.link, row.businessName);
  }
  const next: Partial<SalonEnrichmentRow> = {
    status: "enriched",
    identityMatchStatus: "strong",
    contactRequestFormUrl: null,
    contactFormStatus: "unknown",
    websiteUrl: bookingPlatform ? null : candidate.link || null,
    phone: candidate.phone || null,
    hasWebsite: bookingPlatform ? "Unknown" : candidate.link ? "Yes" : "No",
    confidence: {},
    evidence: evidenceMap,
    serpCallsUsed,
    processedAt: new Date(),
  };
   evidenceMap.identity = evidence(row.businessName, initialPlaceIdMatch ? identitySource : candidateSource, identityConfidence, candidate.link, identityRationale);
  if (candidate.link && !bookingPlatform) evidenceMap.website = evidence(candidate.link, candidateSource, "high", candidate.link);
  if (candidate.phone) evidenceMap.phone = evidence(candidate.phone, phoneSource, "high", phoneSourceUrl);
  if (bookingEmail && bookingEmailUrl) {
    next.email = bookingEmail;
    evidenceMap.email = evidence(bookingEmail, "booking_page", "medium", bookingEmailUrl, "Public email on a booking page with a matching salon heading; review before using in sequences");
  } else if (bookingEmailUrl) {
    evidenceMap.email = evidence(null, "booking_page", "low", bookingEmailUrl, "No salon-specific email confirmed from this booking page");
  }

  if (bookingPlatform) {
    next.bookingUrl = candidate.link;
    next.currentSoftware = bookingPlatform;
    next.usesSoftware = "Yes";
    next.audienceTrack = "directory_has_software";
    next.reviewStatus = "needs_review";
    evidenceMap.bookingUrl = evidence(candidate.link, candidateSource, "high", candidate.link, "The listing links to a booking provider, not a verified salon website");
    evidenceMap.website = evidence(null, candidateSource, "low", candidate.link, "No standalone salon website confirmed");
    next.confidence = Object.fromEntries(Object.entries(evidenceMap).map(([key, item]) => [key, item.confidence]));
    next.evidence = evidenceMap;
    return next;
  }

  if (candidate.link) {
    let websiteConfidence: "high" | "low" = "high";
    try {
      const crawled = await crawlWebsite(candidate.link);
      if (crawled.email) {
        next.email = crawled.email;
        evidenceMap.email = {
          ...evidence(crawled.email, "website", "high", crawled.emailSourceUrl || crawled.resolvedWebsiteUrl || candidate.link),
          sourceType: crawled.emailSourceType || "visible",
        };
      }
      if (crawled.metadataEmail) {
        evidenceMap.emailMetadata = {
          ...evidence(
            crawled.metadataEmail,
            "website_metadata",
            "low",
            crawled.metadataEmailSourceUrl || crawled.resolvedWebsiteUrl || candidate.link,
            "First-party metadata-only address; review separately and not promoted to the usable email field",
          ),
          sourceType: "metadata",
        };
      }
      if (crawled.phone && !next.phone) {
        next.phone = crawled.phone;
        evidenceMap.phone = evidence(crawled.phone, "website", "high", crawled.resolvedWebsiteUrl || candidate.link);
      }
      if (crawled.resolvedWebsiteUrl || crawled.partialFailures.length) {
        evidenceMap.website = evidence(
          crawled.resolvedWebsiteUrl || candidate.link,
          "website",
          crawled.partialFailures.length ? "low" : "high",
          crawled.resolvedWebsiteUrl || candidate.link,
          crawled.partialFailures.length ? `Partially assessed; ${crawled.partialFailures.join("; ")}` : "Resolved website URL",
        );
      }
      if (crawled.contactFormUrl) {
        next.contactRequestFormUrl = crawled.contactFormUrl;
        next.contactFormStatus = "candidate";
        evidenceMap.contactFormUrl = evidence(
          crawled.contactFormUrl,
          "website",
          "medium",
          crawled.resolvedWebsiteUrl || candidate.link,
          "Candidate public inquiry form found; manual review required before use. Not verified.",
        );
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
      next.reviewStatus = "needs_review";
    } catch (error) {
      const message = error instanceof Error ? error.message : "Website crawl failed";
      if (/quota|hourly serp limit|rate limit/i.test(message)) throw error;
      next.reviewStatus = "needs_review";
      next.usesSoftware = "Unknown";
      next.audienceTrack = "directory_general";
      next.lastError = message;
      evidenceMap.website = evidence(candidate.link, candidateSource, "medium", candidate.link, "Website found but could not be crawled");
      websiteConfidence = "low";
    }
    // Email is the goal: a listing phone or booking link does not end the
    // search. Try one bounded fallback if the salon site yielded no email,
    // including when that site could not be crawled.
    if (!fallbackUsed && !next.email) {
      try {
        const fallbackCandidate = await runFallback();
        if (fallbackCandidate?.link && fallbackCandidate.link !== candidate.link &&
            !bookingPlatformForUrl(fallbackCandidate.link)) {
          const fallbackCrawl = await crawlWebsite(fallbackCandidate.link);
          if (fallbackCrawl.email) {
            next.email = fallbackCrawl.email;
            evidenceMap.email = {
              ...evidence(fallbackCrawl.email, "serp_fallback_website", "medium",
                fallbackCrawl.emailSourceUrl || fallbackCrawl.resolvedWebsiteUrl || fallbackCandidate.link,
                "Matched alternate salon website; review the email and source before import"),
              sourceType: fallbackCrawl.emailSourceType || "visible",
            };
          }
          if (fallbackCrawl.metadataEmail) {
            evidenceMap.emailMetadata = {
              ...evidence(fallbackCrawl.metadataEmail, "website_metadata", "low",
                fallbackCrawl.metadataEmailSourceUrl || fallbackCrawl.resolvedWebsiteUrl || fallbackCandidate.link,
                "First-party metadata-only address; review separately and not promoted to the usable email field"),
              sourceType: "metadata",
            };
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
    const confidence: Record<string, string> = { identity: identityConfidence };
    for (const [key, item] of Object.entries(evidenceMap)) confidence[key] = item.confidence;
    confidence.website = websiteConfidence;
    next.confidence = confidence;
  } else {
    next.reviewStatus = "needs_review";
    next.usesSoftware = "Unknown";
    next.audienceTrack = "directory_general";
  }
  next.serpCallsUsed = serpCallsUsed;
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
          const processingRow = await storage.updateSalonEnrichmentRow(
            row.id,
            { status: "processing", lastError: null },
            batch.userId,
          );
          if (!processingRow) return;
          try {
            const result = await enrichRow(processingRow);
            const candidateContact = {
              firstName: null, lastName: null, company: processingRow.businessName,
              email: (result.email as string | null | undefined) ?? processingRow.email,
              phone: (result.phone as string | null | undefined) ?? processingRow.phone,
              usesSoftware: (result.usesSoftware as string | null | undefined) || "Unknown",
            } as any;
            const duplicates = await storage.findDuplicateContacts(candidateContact, processingRow.userId);
            if (duplicates.length) {
              result.duplicateMetadata = { contactIds: duplicates.map(contact => contact.id), reason: "Existing contact match" };
              result.reviewStatus = "needs_review";
            }
            await storage.updateSalonEnrichmentRow(processingRow.id, result, batch.userId);
            const sourceData = processingRow.sourceData as { includeOwnerNames?: boolean } | null;
            if (sourceData?.includeOwnerNames === true &&
                result.status === "enriched" &&
                result.identityMatchStatus === "strong") {
              await lookupSalonOwnerName(processingRow.id, processingRow.userId, true);
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : "Enrichment failed";
            if (/quota|hourly serp limit|rate limit/i.test(message)) {
              await storage.updateSalonEnrichmentRow(processingRow.id, {
                status: "pending", lastError: message, processedAt: null,
              }, batch.userId);
              await storage.updateSalonEnrichmentBatch(batch.id, {
                status: "paused", pausedAt: new Date(), errorMessage: message,
              }, batch.userId);
              return;
            }
            await storage.updateSalonEnrichmentRow(processingRow.id, {
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