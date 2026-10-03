import type { SalonEnrichmentRow } from "@shared/schema";
import { salonEmailDomainRestriction, salonEmailHtmlContextRestriction } from "./salonEmailPolicy";
import { directoryEligibility } from "@shared/directoryEligibility";

const bookingProviders: Record<string, string> = {
  "book.cuddlesapp.com": "CuddlesApp",
  "booksy.com": "Booksy",
  "vagaro.com": "Vagaro",
  "schedulicity.com": "Schedulicity",
  "acuityscheduling.com": "Acuity Scheduling",
  "calendly.com": "Calendly",
  "pocketsuite.io": "PocketSuite",
  "setmore.com": "Setmore",
  "pawfinity.com": "Pawfinity",
  "booking.moego.pet": "MoeGo",
};

export function bookingPlatformForUrl(value: string): string | null {
  try {
    const url = new URL(value.startsWith("http") ? value : `https://${value}`);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if ((host === "groomer.io" || host.endsWith(".groomer.io")) &&
        /^\/(?:request|book|booking)(?:\/|$)/i.test(url.pathname)) return "Groomer.io";
    for (const [domain, software] of Object.entries(bookingProviders)) {
      if (host === domain || host.endsWith(`.${domain}`)) return software;
    }
  } catch {
    // Invalid links cannot be treated as a booking page.
  }
  return null;
}

function decodeEmailEntities(value: string): string {
  return value
    .replace(/&#(?:64|x40);|&commat;/gi, "@")
    .replace(/&#(?:46|x2e);/gi, ".")
    .replace(/&amp;/gi, "&");
}

function compactName(value: string): string {
  return value.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function extractSalonEmailFromBookingHtml(
  html: string,
  businessName: string,
  bookingUrl: string,
): string | null {
  if (!bookingPlatformForUrl(bookingUrl)) return null;
  const body = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1];
  if (!body) return null;

  // Never use scripts, hidden form values, or the booking provider's shared
  // footer/contact pages as evidence of a salon's email.
  const content = decodeEmailEntities(body
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|svg|template|noscript|footer|nav)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<input\b[^>]*>/gi, " ")
    .replace(/<textarea\b[^>]*>[\s\S]*?<\/textarea>/gi, " "));
  const name = compactName(businessName);
  const headings = Array.from(content.matchAll(/<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/gi));
  if (name.length < 8 || !headings.some(match =>
    compactName(match[1].replace(/<[^>]*>/g, " ")).includes(name)
  )) return null;

  const mailtoAddresses = Array.from(content.matchAll(/mailto:([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/gi))
    .map(match => match[1]);
  const visibleText = decodeEmailEntities(content.replace(/<[^>]*>/g, " "));
  const visibleAddresses = visibleText.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) || [];
  const excludedDomains = ["groomer.io", "moego.pet", ...Object.keys(bookingProviders), "example.com", "sentry.io", "cloudflare.com"];
  for (const email of [...mailtoAddresses, ...visibleAddresses]) {
    const domain = email.split("@")[1]?.toLowerCase();
    if (domain && !salonEmailDomainRestriction(email) &&
        !salonEmailHtmlContextRestriction(email, content) &&
        excludedDomains.every(excluded => domain !== excluded && !domain.endsWith(`.${excluded}`))) {
      return email.toLowerCase();
    }
  }
  return null;
}

export function importableSalonEmail(
  row: Pick<SalonEnrichmentRow, "email" | "evidence" | "bookingUrl" | "websiteUrl" | "identityMatchStatus" | "reviewStatus" | "sourceData">,
): string | null {
  if (directoryEligibility(row).blocked) return null;
  const email = importableSalonEmailCandidate(row);
  if (!email || row.reviewStatus !== "approved") return null;
  return email;
}

/**
 * Validate the email/evidence/identity without requiring the human review
 * decision to have already been recorded. Approval routes use this before
 * changing reviewStatus; imports use importableSalonEmail above.
 */
export function importableSalonEmailCandidate(
  row: Pick<SalonEnrichmentRow, "email" | "evidence" | "bookingUrl" | "websiteUrl" | "identityMatchStatus" | "sourceData">,
): string | null {
  const email = row.email?.trim();
  const evidence = (row.evidence as { email?: {
    value?: string; source?: string; confidence?: string; sourceUrl?: string; purpose?: string;
  } } | null)?.email;
  if (!email || salonEmailDomainRestriction(email) || !evidence || evidence.value?.trim().toLowerCase() !== email.toLowerCase()) return null;
  if (row.identityMatchStatus !== "strong") return null;
  if (evidence.purpose && evidence.purpose !== "general") return null;
  if (evidence.source === "public_web_review" && evidence.confidence === "high" &&
      evidence.purpose === "general") {
    const sourceData = row.sourceData as { Outcome?: string } | null;
    if (sourceData?.Outcome !== "verified_first_party_email" &&
        sourceData?.Outcome !== "verified_independent_directory_email") return null;
    try {
      const source = new URL(evidence.sourceUrl || "");
      if (source.protocol === "https:" && !source.username && !source.password) return email;
    } catch {
      // An invalid source URL is not usable email evidence.
    }
  }
  if (evidence.source === "website" && evidence.confidence === "high" &&
      evidence.sourceUrl && row.websiteUrl && !bookingPlatformForUrl(row.websiteUrl)) {
    try {
      const website = new URL(row.websiteUrl);
      const source = new URL(evidence.sourceUrl);
      const host = (url: URL) => url.hostname.toLowerCase().replace(/^www\./, "");
      if ([website, source].every(url => ["http:", "https:"].includes(url.protocol) &&
          !url.username && !url.password) && host(website) === host(source)) return email;
    } catch {
      // The contact page must belong to the matched salon website.
    }
  }
  if (evidence.source === "serp_fallback_website" && evidence.confidence === "medium" && evidence.sourceUrl) {
    try {
      const source = new URL(evidence.sourceUrl);
      if (source.protocol === "https:" && !source.username && !source.password &&
          !bookingPlatformForUrl(source.href)) return email;
    } catch {
      // An invalid source URL is not evidence of a salon website.
    }
  }
  if (evidence.source === "booking_page" && evidence.confidence === "medium" &&
      evidence.sourceUrl === row.bookingUrl && row.bookingUrl && bookingPlatformForUrl(row.bookingUrl)) return email;
  return null;
}

export async function findSalonEmailOnBookingPage(url: string, businessName: string): Promise<string | null> {
  if (!bookingPlatformForUrl(url)) return null;
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(parsed.href, {
      redirect: "manual",
      headers: { Accept: "text/html", "User-Agent": "Mozilla/5.0" },
      signal: controller.signal,
    });
    if (!response.ok || !response.headers.get("content-type")?.toLowerCase().includes("text/html")) return null;
    if (Number(response.headers.get("content-length") || 0) > 1_000_000) return null;
    const html = await response.text();
    if (html.length > 1_000_000) return null;
    return extractSalonEmailFromBookingHtml(html, businessName, parsed.href);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}