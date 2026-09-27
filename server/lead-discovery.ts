import { storage } from "./storage";
import type { LeadDiscoveryJob, LeadDiscoveryResult, InsertLeadDiscoveryResult, SerpUsage, LeadDiscoveryConfig } from "@shared/schema";
import { parseAddressString } from "@shared/utils";

// New reduced query set for budget management
const DEFAULT_QUERIES = [
  "Dog Groomer in {STATE}, Zip code {ZIP}",
  "Pet Grooming shop in {STATE}, Zip code {ZIP}",
];

const OPTIONAL_THIRD_QUERY = "Grooming salon in {STATE}, Zip code {ZIP}";

// Helper to get current month-year string
function getCurrentMonthYear(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

// Guardrail check functions
export async function getSerpUsageStatus(): Promise<{
  usage: SerpUsage;
  config: LeadDiscoveryConfig;
  isQuotaReached: boolean;
  warningLevel: 'none' | 'yellow' | 'red' | 'hardstop';
}> {
  const monthYear = getCurrentMonthYear();
  const usage = await storage.getOrCreateSerpUsage(monthYear);
  const config = await storage.getOrCreateLeadDiscoveryConfig("global");
  
  const used = usage.usedCredits || 0;
  const hardStop = usage.hardStopAt || 200;
  const quota = usage.monthlyQuota || 250;
  
  let warningLevel: 'none' | 'yellow' | 'red' | 'hardstop' = 'none';
  if (used >= hardStop) {
    warningLevel = 'hardstop';
  } else if (used >= 175) {
    warningLevel = 'red';
  } else if (used >= 100) {
    warningLevel = 'yellow';
  }
  
  return {
    usage,
    config,
    isQuotaReached: used >= hardStop,
    warningLevel
  };
}

export async function canRunDiscovery(userId: string, numZips: number, skipDailyCheck = false): Promise<{
  allowed: boolean;
  reason?: string;
}> {
  const status = await getSerpUsageStatus();
  
  // Check if quota is reached
  if (status.isQuotaReached) {
    return { allowed: false, reason: "SERP quota reached – upgrade required" };
  }
  
  // Check max ZIPs per run (only at job creation)
  if (!skipDailyCheck) {
    const maxZips = status.config.maxZipsPerRun || 3;
    if (numZips > maxZips) {
      return { allowed: false, reason: `Maximum ${maxZips} ZIP codes allowed per run` };
    }
    
    // Check runs per day (only at job creation)
    const runsToday = await storage.getRunsToday(userId);
    const maxRunsPerDay = status.config.maxRunsPerDay || 1;
    if (runsToday >= maxRunsPerDay) {
      return { allowed: false, reason: `Maximum ${maxRunsPerDay} run(s) per day reached` };
    }
  }
  
  // Check hourly rate limit
  const callsLastHour = await storage.getSerpCallsInLastHour();
  const maxCallsPerHour = status.config.maxSerpCallsPerHour || 5;
  if (callsLastHour >= maxCallsPerHour) {
    return { allowed: false, reason: `Hourly SERP limit reached (${maxCallsPerHour}/hour). Please wait.` };
  }
  
  return { allowed: true };
}

// Get the queries to use based on config
export async function getActiveQueries(): Promise<string[]> {
  const config = await storage.getOrCreateLeadDiscoveryConfig("global");
  const queries = [...DEFAULT_QUERIES];
  
  if (config.enableThirdQuery === "true") {
    queries.push(OPTIONAL_THIRD_QUERY);
  }
  
  return queries;
}

const BOOKING_SOFTWARE_PATTERNS: Record<string, string> = {
  "booking.moego.pet": "MoeGo",
  "moego.pet": "MoeGo",
  "petgroomerfinder.com": "PetGroomerFinder",
  "pocketsuite.io": "PocketSuite",
  "pawtastic.app": "Pawtastic",
  "runloyal.com": "RunLoyal",
  "vagaro.com": "Vagaro",
  "square.site": "Square",
  "squareup.com": "Square",
  "schedulicity.com": "Schedulicity",
  "genbook.com": "Genbook",
  "booksy.com": "Booksy",
  "acuityscheduling.com": "Acuity Scheduling",
  "calendly.com": "Calendly",
  "setmore.com": "Setmore",
  "pawfinity.com": "Pawfinity",
  "gingr.app": "Gingr",
  "gingrapp.com": "Gingr",
  "propetware.com": "ProPet",
  "gooseberry.app": "Gooseberry",
  "daysmart.com": "DaySmart",
  "petexec.net": "PetExec",
  "kennel.link": "Kennel Link",
  "precise-petcare.com": "Precise Petcare",
  "time2pet.com": "Time To Pet",
  "thryv.com": "Thryv",
  "mindbodyonline.com": "Mindbody",
  "wix.com": "Wix Booking",
  "booking.esypet.com": "EsyPet",
  "esypet.com": "EsyPet",
  "groomer.io": "Groomer.io",
};

const BOOKING_BUTTON_KEYWORDS = [
  "book", "book now", "book here", "schedule", "appointment", 
  "groom", "grooming", "reserve", "make an appointment"
];

// Well-known pet retail/grooming chains that always use their own internal software.
// They won't have third-party booking URLs but definitely have booking systems.
const KNOWN_ENTERPRISE_CHAINS: { pattern: RegExp; software: string }[] = [
  { pattern: /petco/i,              software: "Petco Internal" },
  { pattern: /petsmart/i,           software: "PetSmart Internal" },
  { pattern: /pet supplies plus/i,  software: "Pet Supplies Plus Internal" },
  { pattern: /petsuppliesplus/i,    software: "Pet Supplies Plus Internal" },
  { pattern: /petsense/i,           software: "PetSense Internal" },
  { pattern: /petpeople/i,          software: "Pet People Internal" },
  { pattern: /petland/i,            software: "Petland Internal" },
  { pattern: /pet supermarket/i,    software: "Pet Supermarket Internal" },
  { pattern: /banfield/i,           software: "Banfield Internal" },
  { pattern: /camp bow wow/i,       software: "Camp Bow Wow Internal" },
  { pattern: /dogtopia/i,           software: "Dogtopia Internal" },
  { pattern: /barkavenue/i,         software: "Bark Avenue Internal" },
  { pattern: /pawsitive/i,          software: "Pawsitive Internal" },
];

// Broad scheduling/appointment language that signals a business takes bookings
// even if we couldn't identify the specific software
const SCHEDULING_LANGUAGE = [
  "book online", "book an appointment", "book now", "schedule online",
  "schedule an appointment", "request an appointment", "make a reservation",
  "online booking", "appointment scheduling", "schedule your", "book your",
  "click to book", "online scheduler", "self-scheduling",
];

function checkKnownChain(companyName: string): { software: string } | null {
  for (const chain of KNOWN_ENTERPRISE_CHAINS) {
    if (chain.pattern.test(companyName)) {
      return { software: chain.software };
    }
  }
  return null;
}

function hasSchedulingLanguage(html: string): boolean {
  const lower = html.toLowerCase();
  return SCHEDULING_LANGUAGE.some(phrase => lower.includes(phrase));
}

interface SerpApiResult {
  title: string;
  link: string;
  snippet?: string;
  phone?: string;
  address?: string;
  placeId?: string;
}

interface BusinessData {
  company: string;
  websiteUrl?: string;
  phone?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  jobTitle?: string;
  googleBusinessProfileUrl?: string;
  address?: string;
}

export function buildGoogleMapsParams(apiKey: string, query: string, zipCode: string, placeId?: string): URLSearchParams {
  const params = new URLSearchParams({
    api_key: apiKey,
    engine: "google_maps",
    type: placeId ? "place" : "search",
  });
  if (placeId) params.set("place_id", placeId);
  else params.set("q", `${query.replace(", Zip code " + zipCode, "")} ${zipCode}`);
  return params;
}

export function parseGoogleMapsResults(data: {
  local_results?: Array<Record<string, any>>;
  place_results?: Record<string, any>;
}): SerpApiResult[] {
  const results: SerpApiResult[] = [];
  for (const local of data.local_results || []) {
    results.push({
      title: local.title || "",
      link: local.website || "",
      phone: local.phone,
      address: local.address,
      placeId: local.place_id,
      snippet: local.description || "",
    });
  }
  if (data.place_results) {
    const place = data.place_results;
    if (!results.some(result => result.title === place.title)) {
      results.push({
        title: place.title || "",
        link: place.website || "",
        phone: place.phone,
        address: place.address,
        placeId: place.place_id,
        snippet: place.description || "",
      });
    }
  }
  return results;
}

// Search using Google Maps engine with caching and usage tracking
export async function searchWithSerpApi(
  query: string, 
  zipCode: string,
  state: string,
  queryTemplate: string,
  options?: { placeId?: string },
): Promise<{ results: SerpApiResult[]; fromCache: boolean }> {
  const apiKey = process.env.SERPAPI_API_KEY;
  if (!apiKey) {
    throw new Error("SERPAPI_API_KEY not configured");
  }

  // Check cache first (30-day caching)
  const cached = await storage.getSerpCache(zipCode, queryTemplate, state, 30);
  if (cached) {
    console.log(`Using cached results for ${zipCode} - ${queryTemplate}`);
    return { results: cached.resultsJson as SerpApiResult[], fromCache: true };
  }

  const status = await getSerpUsageStatus();
  if (status.isQuotaReached) {
    throw new Error("SERP quota reached – upgrade required");
  }

  const maxCallsPerHour = status.config.maxSerpCallsPerHour || 5;
  const monthYear = getCurrentMonthYear();
  const reservationId = await storage.reserveSerpCall(monthYear, maxCallsPerHour);
  if (!reservationId) throw new Error(`SERP quota or hourly limit reached (${maxCallsPerHour}/hour). Please wait.`);

  let billableCallMade = false;
  try {
    // Use Google Maps engine for better local business results
    // Include location in query since ll parameter requires lat,long coordinates
    const params = buildGoogleMapsParams(apiKey, query, zipCode, options?.placeId);
    const searchQuery = `${query.replace(", Zip code " + zipCode, "")} ${zipCode}`;

    console.log(options?.placeId ? "Looking up Google Maps Place ID" : `Searching Google Maps: ${searchQuery}`);
    const response = await fetch(`https://serpapi.com/search?${params}`);
    // A completed provider response may consume credit even if the response
    // cannot be parsed or cached; never refund it as a network failure.
    billableCallMade = true;
    
    if (!response.ok) {
      console.error("SerpAPI request failed with status", response.status);
      throw new Error(response.status === 429 ? "SerpAPI rate limit reached" : `SerpAPI returned ${response.status}`);
    }
    const data = await response.json();
    if (data.error) {
      const isQuotaError = /quota|rate limit|credits|searches left|exhausted/i.test(String(data.error));
      throw new Error(isQuotaError ? "SERP quota reached" : "SerpAPI lookup failed");
    }
    
    const results = parseGoogleMapsResults(data);

    // Cache the results
    try {
      await storage.createSerpCache(zipCode, queryTemplate, state, results);
    } catch (cacheError) {
      console.error("SERP result cache failed; provider call remains counted:", cacheError);
    }
    
    console.log(`Found ${results.length} results for ${query}`);
    return { results, fromCache: false };
  } catch (error) {
    if (!billableCallMade) await storage.releaseSerpCall(reservationId, monthYear);
    console.error("SerpAPI search failed:", error);
    // NO automatic retries - require manual retry
    throw error;
  }
}

async function fetchPage(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

export async function crawlWebsite(url: string): Promise<{
  html: string;
  bookingUrl?: string;
  softwareName?: string;
  email?: string;
  phone?: string;
  contactFormUrl?: string;
  ownerName?: string;
  jobTitle?: string;
}> {
  try {
    let base: URL;
    try { base = new URL(url.startsWith("http") ? url : `https://${url}`); }
    catch { throw new Error(`Invalid URL: ${url}`); }

    const html = await fetchPage(base.href);
    if (!html) throw new Error(`HTTP error fetching ${base.href}`);

    const result: ReturnType<typeof crawlWebsite> extends Promise<infer T> ? T : never = { html };

    const bookingInfo = detectBookingSoftware(html, url);
    if (bookingInfo) {
      result.bookingUrl = bookingInfo.url;
      result.softwareName = bookingInfo.software;
    }

    // Scan homepage first
    result.email = extractEmail(html) ?? undefined;
    result.phone = extractPhone(html) ?? undefined;
    result.contactFormUrl = detectContactForm(html, url) ?? undefined;

    // If email or phone still missing, scan common sub-pages in parallel
    const subPaths = ["/contact", "/contact-us", "/about", "/about-us", "/reach-us", "/get-in-touch"];
    const needsMore = !result.email || !result.phone;
    if (needsMore) {
      const subPages = await Promise.allSettled(
        subPaths.map(path => fetchPage(`${base.origin}${path}`))
      );
      for (const settled of subPages) {
        if (settled.status !== "fulfilled" || !settled.value) continue;
        const subHtml = settled.value;
        if (!result.email) {
          const found = extractEmail(subHtml);
          if (found) result.email = found;
        }
        if (!result.phone) {
          const found = extractPhone(subHtml);
          if (found) result.phone = found;
        }
        if (result.email && result.phone) break;
      }
    }

    return result;
  } catch (error) {
    console.error(`Failed to crawl ${url}:`, error);
    throw error;
  }
}

function detectBookingSoftware(html: string, baseUrl: string): { url: string; software: string } | null {
  const lowerHtml = html.toLowerCase();

  // Pass 1: scan the entire HTML (case-insensitive) for any known software domain.
  // This catches direct links, iframe src attrs, JS variables, data- attrs, etc.
  for (const [pattern, software] of Object.entries(BOOKING_SOFTWARE_PATTERNS)) {
    if (lowerHtml.includes(pattern)) {
      const urlMatch = html.match(new RegExp(`https?://[^"'\\s<>]*${pattern.replace(/\./g, "\\.")}[^"'\\s<>]*`, "i"));
      return {
        url: urlMatch ? urlMatch[0] : `https://${pattern}`,
        software,
      };
    }
  }

  // Pass 2: look for any href or src that links to a booking-related URL.
  // Matches href AND src attributes (catches iframes and script-loaded widgets).
  // The booking-keyword check scans a wider window around the attribute so nested
  // tags (e.g. <a href="..."><span>Salon Booking</span></a>) still match.
  const attrPattern = /(?:href|src)=["']([^"']+)["']/gi;
  const bookingKeywords = /book|schedule|appointment|groom|salon|reserve/i;

  let match;
  while ((match = attrPattern.exec(html)) !== null) {
    const url = match[1];

    // Check if the URL itself is a known software domain
    for (const [pattern, software] of Object.entries(BOOKING_SOFTWARE_PATTERNS)) {
      if (url.toLowerCase().includes(pattern)) {
        return { url, software };
      }
    }

    // For unknown URLs, only count them if they look like a booking link.
    // Look at up to 300 chars before and after the attribute for booking context.
    const windowStart = Math.max(0, match.index - 300);
    const windowEnd   = Math.min(html.length, match.index + match[0].length + 300);
    const context = html.slice(windowStart, windowEnd);

    if (bookingKeywords.test(context)) {
      if (url.startsWith("http")) {
        return { url, software: "Unknown" };
      } else if (url.startsWith("/")) {
        try {
          const base = new URL(baseUrl);
          return { url: `${base.origin}${url}`, software: "Unknown" };
        } catch {}
      }
    }
  }

  return null;
}

function extractEmail(html: string): string | null {
  const NOISE_DOMAINS = ["example.com", "sentry.io", "wixpress.com", "w3.org", "schema.org", "cloudflare.com"];
  const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

  function pickValid(matches: RegExpMatchArray | null): string | null {
    if (!matches) return null;
    const valid = matches.filter(e =>
      NOISE_DOMAINS.every(d => !e.includes(d)) &&
      !e.endsWith(".png") &&
      !e.endsWith(".jpg") &&
      !e.endsWith(".gif") &&
      !e.endsWith(".svg")
    );
    return valid[0] || null;
  }

  // 1. Decode HTML entities that sites use to hide @ from scrapers (e.g. Wix: &#64;)
  const decoded = html
    .replace(/&#64;|&commat;/gi, "@")
    .replace(/&#46;/gi, ".")
    .replace(/&amp;/gi, "&");

  const direct = pickValid(decoded.match(EMAIL_RE));
  if (direct) return direct;

  // 2. Handle text obfuscation patterns: [at], (at), " at ", [dot], (dot)
  const deobfuscated = decoded
    .replace(/\s*\[at\]\s*/gi, "@")
    .replace(/\s*\(at\)\s*/gi, "@")
    .replace(/\s*\[dot\]\s*/gi, ".")
    .replace(/\s*\(dot\)\s*/gi, ".");

  return pickValid(deobfuscated.match(EMAIL_RE));
}

function extractPhone(html: string): string | null {
  // Separators are REQUIRED between groups (not optional) so we don't accidentally
  // match 10-digit tracking IDs, Unix timestamps, or URL parameters.
  // Area code must start with 2-9 (US area codes never start with 0 or 1).
  const phonePattern = /(?:\+?1[\s.-]?)?\(?([2-9]\d{2})\)?[\s.-]\d{3}[\s.-]\d{4}/g;

  // Strip scripts and style blocks first to avoid matching noise
  const cleaned = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ");

  const matches = cleaned.match(phonePattern);
  if (!matches) return null;

  // Prefer matches that look like formatted phone numbers (have non-digit separators)
  const formatted = matches.find(m => /[().\s-]/.test(m));
  return formatted ?? matches[0];
}

function detectContactForm(html: string, baseUrl: string): string | null {
  const contactPatterns = ["/contact", "/contact-us", "/get-in-touch", "/reach-us"];
  
  for (const pattern of contactPatterns) {
    if (html.toLowerCase().includes(`href="${pattern}"`)) {
      try {
        const base = new URL(baseUrl);
        return `${base.origin}${pattern}`;
      } catch {}
    }
  }
  
  if (/<form[^>]*>/i.test(html)) {
    const formMatch = html.match(/<form[^>]*action=["']([^"']+)["']/i);
    if (formMatch && formMatch[1].toLowerCase().includes("contact")) {
      try {
        const base = new URL(baseUrl);
        if (formMatch[1].startsWith("http")) {
          return formMatch[1];
        }
        return `${base.origin}${formMatch[1]}`;
      } catch {}
    }
  }
  
  return null;
}

function normalizeWebsiteUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

function normalizePhoneForDedup(phone: string): string {
  return phone.replace(/\D/g, "").slice(-10);
}

export function isDuplicate(
  business: BusinessData,
  existingResults: LeadDiscoveryResult[]
): boolean {
  for (const existing of existingResults) {
    if (business.websiteUrl && existing.websiteUrl) {
      if (normalizeWebsiteUrl(business.websiteUrl) === normalizeWebsiteUrl(existing.websiteUrl)) {
        return true;
      }
    }
    
    if (business.phone && existing.phone) {
      if (normalizePhoneForDedup(business.phone) === normalizePhoneForDedup(existing.phone)) {
        return true;
      }
    }
    
    if (business.company && existing.company) {
      if (business.company.toLowerCase().trim() === existing.company.toLowerCase().trim()) {
        return true;
      }
    }
  }
  
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTACT DETAIL SOURCES
// Each source is searched (in parallel) when a business's email/phone is still
// missing after crawling their own website. Add new sources to this list to
// extend coverage — each just needs a name and a fetch function.
// ─────────────────────────────────────────────────────────────────────────────

type ContactDetailResult = { email?: string; phone?: string };
type ContactDetailSource = {
  name: string;
  fetch: (businessName: string, serpKey: string) => Promise<ContactDetailResult>;
};

/** Shared email/phone extractor used by all contact detail sources */
function extractContactDetails(rawText: string): ContactDetailResult {
  const NOISE_DOMAINS = [
    "example.com", "sentry.io", "wixpress.com", "w3.org", "schema.org",
    "cloudflare.com", "facebook.com", "yelp.com", "google.com",
    "bbb.org", "yellowpages.com", "angi.com", "thumbtack.com",
  ];
  const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  // Separators required; area code must start with 2-9 (valid US area codes)
  const PHONE_RE = /(?:\+?1[\s.-]?)?\(?([2-9]\d{2})\)?[\s.-]\d{3}[\s.-]\d{4}/g;

  // Strip script/style noise before parsing
  const cleaned = rawText
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ");

  const decoded = cleaned
    .replace(/&#64;|&commat;/gi, "@")
    .replace(/&#46;/gi, ".")
    .replace(/&amp;/gi, "&")
    .replace(/\s*\[at\]\s*/gi, "@")
    .replace(/\s*\(at\)\s*/gi, "@");

  const emailMatches = decoded.match(EMAIL_RE);
  const email = emailMatches?.find(
    e =>
      NOISE_DOMAINS.every(d => !e.includes(d)) &&
      !e.endsWith(".png") && !e.endsWith(".jpg") &&
      !e.endsWith(".gif") && !e.endsWith(".svg")
  ) ?? undefined;

  const phoneMatches = decoded.match(PHONE_RE);
  // Prefer a formatted-looking match (has punctuation/spaces) over a bare digit string
  const phone = (phoneMatches?.find(m => /[().\s-]/.test(m)) ?? phoneMatches?.[0]) as string | undefined;

  return { email, phone };
}

/** Helper: fetch a page URL and return its raw HTML (or null on failure) */
async function fetchPageHtml(url: string, userAgent?: string): Promise<string | null> {
  try {
    const r = await fetch(url, {
      headers: {
        "User-Agent": userAgent ?? "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(14000),
    });
    return r.ok ? await r.text() : null;
  } catch {
    return null;
  }
}

/** Helper: run a SerpAPI Google search and return result objects */
async function serpSearch(serpKey: string, query: string, num = 5): Promise<any[]> {
  try {
    const params = new URLSearchParams({ api_key: serpKey, engine: "google", q: query, num: String(num) });
    const r = await fetch(`https://serpapi.com/search?${params}`, { signal: AbortSignal.timeout(12000) });
    if (!r.ok) return [];
    const data = await r.json() as any;
    return data.organic_results ?? [];
  } catch {
    return [];
  }
}

// ─── List of sources that may have the business's email/phone ────────────────

const CONTACT_DETAIL_SOURCES: ContactDetailSource[] = [
  // 1. Google — broad search; email often appears directly in result snippets
  {
    name: "Google",
    async fetch(businessName, serpKey) {
      const results = await serpSearch(serpKey, `"${businessName}" grooming email contact`, 5);
      const text = results.map((r: any) => `${r.title ?? ""} ${r.snippet ?? ""}`).join(" ");
      return extractContactDetails(text);
    },
  },

  // 2. Facebook — About section lists email, phone, and website
  {
    name: "Facebook",
    async fetch(businessName, serpKey) {
      const results = await serpSearch(serpKey, `site:facebook.com "${businessName}" grooming`, 3);
      const fbResult = results.find(
        (r: any) =>
          typeof r.link === "string" &&
          r.link.includes("facebook.com/") &&
          !r.link.includes("/search") &&
          !r.link.includes("/groups") &&
          !r.link.includes("/events")
      );
      if (!fbResult) return {};
      // Check snippet first (fastest)
      const snippetDetails = extractContactDetails(`${fbResult.title ?? ""} ${fbResult.snippet ?? ""}`);
      if (snippetDetails.email || snippetDetails.phone) return snippetDetails;
      // Fetch the actual page (Facebook externalhit UA gets About section)
      const html = await fetchPageHtml(
        fbResult.link,
        "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)"
      );
      return html ? extractContactDetails(html) : {};
    },
  },

  // 3. Yelp — business listing sometimes has contact email and always has phone
  {
    name: "Yelp",
    async fetch(businessName, serpKey) {
      const results = await serpSearch(serpKey, `site:yelp.com/biz "${businessName}" grooming`, 3);
      const yelpResult = results.find((r: any) => r.link?.includes("yelp.com/biz/"));
      if (!yelpResult) return {};
      const snippetDetails = extractContactDetails(`${yelpResult.title ?? ""} ${yelpResult.snippet ?? ""}`);
      if (snippetDetails.email || snippetDetails.phone) return snippetDetails;
      const html = await fetchPageHtml(yelpResult.link);
      return html ? extractContactDetails(html) : {};
    },
  },

  // 4. BBB — Principal Contacts and contact info are listed on profile pages
  {
    name: "BBB",
    async fetch(businessName, serpKey) {
      const results = await serpSearch(serpKey, `site:bbb.org/us "${businessName}" grooming`, 3);
      const bbbResult = results.find((r: any) => r.link?.includes("bbb.org") && r.link?.includes("/profile/"));
      if (!bbbResult) return {};
      const snippetDetails = extractContactDetails(`${bbbResult.title ?? ""} ${bbbResult.snippet ?? ""}`);
      if (snippetDetails.email || snippetDetails.phone) return snippetDetails;
      const html = await fetchPageHtml(bbbResult.link);
      return html ? extractContactDetails(html) : {};
    },
  },

  // 5. Yellow Pages — has business phone and sometimes email
  {
    name: "Yellow Pages",
    async fetch(businessName, serpKey) {
      const results = await serpSearch(serpKey, `site:yellowpages.com "${businessName}" grooming`, 3);
      const ypResult = results.find((r: any) => r.link?.includes("yellowpages.com/"));
      if (!ypResult) return {};
      const snippetDetails = extractContactDetails(`${ypResult.title ?? ""} ${ypResult.snippet ?? ""}`);
      if (snippetDetails.email || snippetDetails.phone) return snippetDetails;
      const html = await fetchPageHtml(ypResult.link);
      return html ? extractContactDetails(html) : {};
    },
  },
];

/**
 * Run all CONTACT_DETAIL_SOURCES in parallel and return the first email found
 * (and separately the first phone found), with which source provided each.
 */
async function findContactDetailsFromAlternativeSources(
  businessName: string,
): Promise<{ email?: string; emailSource?: string; phone?: string; phoneSource?: string }> {
  const serpKey = process.env.SERPAPI_API_KEY;
  if (!serpKey) return {};

  console.log(`[Discovery] Gap-fill: searching ${CONTACT_DETAIL_SOURCES.length} sources for "${businessName}"`);

  const results = await Promise.allSettled(
    CONTACT_DETAIL_SOURCES.map(async (source) => {
      const details = await source.fetch(businessName, serpKey);
      return { source: source.name, ...details };
    })
  );

  let email: string | undefined;
  let emailSource: string | undefined;
  let phone: string | undefined;
  let phoneSource: string | undefined;

  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    const { source, email: e, phone: p } = result.value;
    if (e && !email) {
      email = e;
      emailSource = source;
      console.log(`[Discovery] Gap-fill: email "${e}" found via ${source}`);
    }
    if (p && !phone) {
      phone = p;
      phoneSource = source;
      console.log(`[Discovery] Gap-fill: phone "${p}" found via ${source}`);
    }
  }

  return { email, emailSource, phone, phoneSource };
}

// Representative ZIP codes for each US state (largest city)
export const STATE_ZIPS: Record<string, string> = {
  AL: "35203", AK: "99501", AZ: "85001", AR: "72201", CA: "90001",
  CO: "80202", CT: "06103", DE: "19801", FL: "33101", GA: "30301",
  HI: "96813", ID: "83702", IL: "60601", IN: "46202", IA: "50309",
  KS: "66101", KY: "40202", LA: "70112", ME: "04101", MD: "21201",
  MA: "02101", MI: "48201", MN: "55401", MS: "39201", MO: "63101",
  MT: "59601", NE: "68102", NV: "89101", NH: "03101", NJ: "07102",
  NM: "87101", NY: "10001", NC: "28202", ND: "58102", OH: "44101",
  OK: "73102", OR: "97201", PA: "19102", RI: "02903", SC: "29201",
  SD: "57101", TN: "37201", TX: "77001", UT: "84101", VT: "05601",
  VA: "23219", WA: "98101", WV: "25301", WI: "53202", WY: "82001",
};

const ALL_STATES = Object.keys(STATE_ZIPS);

/** National search: runs one SERP query per state, stores up to maxPerState results, tracks progress. */
export async function runNationalSearchJob(nationalJobId: string, userId: string): Promise<void> {
  const MAX_HOURLY_RETRIES = 10;
  const RETRY_WAIT_MS = 65_000; // wait 65 s when hourly limit hit

  // Helper: terminate the national job as failed — atomic, never overwrites cancelled
  async function failNationalJob(message: string, statesCompleted: number, leadsFound: number): Promise<void> {
    await storage.updateNationalSearchJobIfNotCancelled(nationalJobId, {
      status: "failed",
      errorMessage: message,
      completedAt: new Date(),
      statesCompleted,
      leadsFound,
    });
  }

  try {
    // FIX 1: Hard-stop if quota is already exhausted before we even begin
    const initialQuota = await getSerpUsageStatus();
    if (initialQuota.isQuotaReached) {
      await failNationalJob("SERP quota reached — upgrade required to run a national search.", 0, 0);
      return;
    }

    // Load the job record to get targeted search settings
    const jobRecord = await storage.getNationalSearchJob(nationalJobId, null);
    if (!jobRecord) {
      console.error(`[NationalSearch] Job ${nationalJobId} not found`);
      return;
    }

    // Resolve the state list and per-state cap from the job record
    const statesToSearch = jobRecord.targetStates
      ? jobRecord.targetStates.split(",").map(s => s.trim()).filter(Boolean)
      : ALL_STATES;
    const MAX_PER_STATE = jobRecord.maxPerState ?? 3;
    const NO_SOFTWARE_ONLY = jobRecord.noSoftwareOnly === "true";

    // FIX 3: Transition to running atomically — if the job was cancelled while pending,
    // the conditional update returns undefined and we stop without resurrecting it.
    const started = await storage.updateNationalSearchJobIfNotCancelled(nationalJobId, {
      status: "running",
      statesTotal: statesToSearch.length,
    });
    if (!started) {
      console.log(`[NationalSearch] Job ${nationalJobId} was cancelled before it could start — aborting.`);
      return;
    }

    let totalLeadsFound = 0;
    let statesCompleted = 0; // FIX 2: track completed states explicitly

    for (let i = 0; i < statesToSearch.length; i++) {
      const stateCode = statesToSearch[i];
      const zip = STATE_ZIPS[stateCode];

      // FIX 3: Check for cancellation at start of each state — never overwrite cancelled
      const natJob = await storage.getNationalSearchJob(nationalJobId, null);
      if (natJob?.status === "cancelled") {
        console.log(`[NationalSearch] Cancelled at state ${stateCode}`);
        return; // exit immediately without touching status
      }

      // Create a sub-job for this state (for result grouping)
      const subJob = await storage.createLeadDiscoveryJob(
        {
          state: stateCode,
          zipCodes: zip,
          searchEngines: "google_maps",
          maxResultsPerZip: MAX_PER_STATE,
          status: "running",
          totalZipCodes: 1,
          processedZipCodes: 0,
          totalBusinessesFound: 0,
          duplicatesRemoved: 0,
        },
        userId,
        nationalJobId
      );

      const queryTemplate = DEFAULT_QUERIES[0]; // "Dog Groomer in {STATE}, Zip code {ZIP}"
      const query = queryTemplate.replace("{STATE}", stateCode).replace("{ZIP}", zip);

      let stateFound = 0;
      let retries = 0;
      let stateSucceeded = false; // FIX 2: track terminal success explicitly

      while (retries < MAX_HOURLY_RETRIES) {
        // FIX 1: Re-check quota before each attempt — quota exhaustion is a hard stop
        const quotaCheck = await getSerpUsageStatus();
        if (quotaCheck.isQuotaReached) {
          console.log(`[NationalSearch] Quota exhausted at state ${stateCode} — terminating job.`);
          await storage.updateLeadDiscoveryJob(subJob.id, {
            status: "failed",
            errorMessage: "SERP quota reached — national search stopped.",
            completedAt: new Date(),
          }, null);
          await failNationalJob(
            `SERP quota reached after ${statesCompleted} of ${statesToSearch.length} states. Export what was found so far.`,
            statesCompleted,
            totalLeadsFound,
          );
          return; // stop — don't mark as completed
        }

        // Check hourly rate limit
        const canRun = await canRunDiscovery(userId, 1, true);
        if (!canRun.allowed) {
          console.log(`[NationalSearch] Hourly rate limit for ${stateCode}, waiting ${RETRY_WAIT_MS / 1000}s… (retry ${retries + 1}/${MAX_HOURLY_RETRIES})`);
          await new Promise(resolve => setTimeout(resolve, RETRY_WAIT_MS));
          retries++;
          continue;
        }

        try {
          const { results: searchResults } = await searchWithSerpApi(query, zip, stateCode, queryTemplate);
          const existingResults: import("@shared/schema").LeadDiscoveryResult[] = [];

          for (const result of searchResults) {
            if (stateFound >= MAX_PER_STATE) break;
            if (!result.title || !result.link) continue;

            const businessData: BusinessData = {
              company: result.title,
              websiteUrl: result.link.startsWith("http") ? result.link : undefined,
              phone: result.phone,
              address: result.address,
            };

            if (isDuplicate(businessData, existingResults)) continue;

            // Crawl website for software detection
            let crawlData: Awaited<ReturnType<typeof crawlWebsite>> | null = null;
            let crawlStatus = "pending";
            let crawlError: string | undefined;
            if (businessData.websiteUrl) {
              try {
                crawlData = await crawlWebsite(businessData.websiteUrl);
                crawlStatus = "completed";
              } catch (err) {
                crawlStatus = "failed";
                crawlError = err instanceof Error ? err.message : "Unknown error";
              }
            }

            const knownChain = checkKnownChain(businessData.company);
            let usesSoftware: string;
            let currentSoftware: string | null = crawlData?.softwareName || null;

            if (crawlData?.bookingUrl) {
              usesSoftware = "Yes";
            } else if (knownChain) {
              usesSoftware = "Yes";
              currentSoftware = currentSoftware || knownChain.software;
            } else if (crawlStatus === "failed" || !businessData.websiteUrl) {
              usesSoftware = "Unknown";
            } else if (hasSchedulingLanguage(crawlData?.html ?? "")) {
              usesSoftware = "Unknown";
            } else {
              usesSoftware = "No";
            }

            // No-software filter: when enabled, skip any lead that definitively uses software
            if (NO_SOFTWARE_ONLY && usesSoftware === "Yes") {
              console.log(`[NationalSearch] Skipping ${businessData.company} (uses ${currentSoftware || "software"}) — noSoftwareOnly filter`);
              continue;
            }

            const leadResult: import("@shared/schema").InsertLeadDiscoveryResult = {
              jobId: subJob.id,
              company: businessData.company,
              phone: crawlData?.phone || businessData.phone || null,
              email: crawlData?.email || null,
              address: businessData.address || null,
              firstName: crawlData?.ownerName?.split(" ")[0] || null,
              lastName: crawlData?.ownerName?.split(" ").slice(1).join(" ") || null,
              jobTitle: crawlData?.jobTitle || null,
              hasWebsite: businessData.websiteUrl ? "Yes" : "No",
              websiteUrl: businessData.websiteUrl || null,
              bookingSoftwareUrl: crawlData?.bookingUrl || null,
              currentSoftware,
              usesSoftware,
              contactRequestFormUrl: crawlData?.contactFormUrl || null,
              leadSource: "Google Maps",
              notes: crawlError ? `Crawl failed: ${crawlError}` : null,
              zipCode: zip,
              searchQuery: query,
              isDuplicate: "false",
              isImported: "false",
              crawlStatus,
              crawlError,
            };

            const saved = await storage.createLeadDiscoveryResult(leadResult, userId);
            existingResults.push(saved);
            stateFound++;
            totalLeadsFound++;
          }

          await storage.updateLeadDiscoveryJob(subJob.id, {
            status: "completed",
            completedAt: new Date(),
            processedZipCodes: 1,
            totalBusinessesFound: stateFound, // counts only saved (post-filter) results
          }, null);

          stateSucceeded = true;
          break; // success — move to next state
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);

          // FIX 1: Quota errors are a hard stop — do not retry
          if (msg.toLowerCase().includes("quota")) {
            console.log(`[NationalSearch] Quota error at ${stateCode} — terminating.`);
            await storage.updateLeadDiscoveryJob(subJob.id, {
              status: "failed",
              errorMessage: msg,
              completedAt: new Date(),
            }, null);
            await failNationalJob(
              `SERP quota reached after ${statesCompleted} of ${statesToSearch.length} states. Export what was found so far.`,
              statesCompleted,
              totalLeadsFound,
            );
            return;
          }

          if (msg.includes("Hourly SERP limit") || msg.includes("hourly")) {
            console.log(`[NationalSearch] SERP hourly error at ${stateCode}, waiting…`);
            await new Promise(resolve => setTimeout(resolve, RETRY_WAIT_MS));
            retries++;
          } else {
            // Non-retryable, non-quota error: mark sub-job failed and move on
            console.error(`[NationalSearch] Search failed for ${stateCode}:`, msg);
            await storage.updateLeadDiscoveryJob(subJob.id, {
              status: "failed",
              errorMessage: msg,
              completedAt: new Date(),
            }, null);
            break;
          }
        }
      }

      // FIX 2: Only count state as completed when it had a definite terminal outcome.
      // Retry-exhausted states leave stateSucceeded=false and are NOT counted.
      if (!stateSucceeded && retries >= MAX_HOURLY_RETRIES) {
        const errorMsg = `Hourly rate-limit retry limit exceeded for state ${stateCode} — state skipped.`;
        console.error(`[NationalSearch] ${errorMsg}`);
        await storage.updateLeadDiscoveryJob(subJob.id, {
          status: "failed",
          errorMessage: errorMsg,
          completedAt: new Date(),
        }, null);
        // Update leads count but don't increment statesCompleted
        await storage.updateNationalSearchJob(nationalJobId, { leadsFound: totalLeadsFound });
      } else if (stateSucceeded) {
        statesCompleted++;
        await storage.updateNationalSearchJob(nationalJobId, { statesCompleted, leadsFound: totalLeadsFound });
      } else {
        // Non-retryable failure — still count as "processed" so progress advances
        statesCompleted++;
        await storage.updateNationalSearchJob(nationalJobId, { statesCompleted, leadsFound: totalLeadsFound });
      }

      // Small polite delay between states
      if (i < statesToSearch.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1200));
      }
    }

    // FIX 3: Use atomic conditional update — silently skips if job was cancelled
    await storage.updateNationalSearchJobIfNotCancelled(nationalJobId, {
      status: "completed",
      completedAt: new Date(),
      statesCompleted,
      leadsFound: totalLeadsFound,
    });
  } catch (error) {
    console.error("[NationalSearch] Unhandled error:", error);
    // FIX 3: Never overwrite cancelled status (atomic)
    await failNationalJob(
      error instanceof Error ? error.message : "Unknown error",
      0,
      0,
    );
  }
}

export async function runLeadDiscoveryJob(jobId: string, userId: string): Promise<void> {
  const job = await storage.getLeadDiscoveryJob(jobId, null);
  if (!job) {
    throw new Error("Job not found");
  }

  try {
    await storage.updateLeadDiscoveryJob(jobId, {
      status: "running",
      startedAt: new Date(),
    }, null);

    const zipCodes = job.zipCodes.split(",").map(z => z.trim()).filter(z => z);
    const state = job.state;
    
    // Get active queries based on config (2 default, 3rd optional)
    const activeQueries = await getActiveQueries();

    const allResults: LeadDiscoveryResult[] = [];
    let totalFound = 0;
    let duplicatesRemoved = 0;

    for (let zipIndex = 0; zipIndex < zipCodes.length; zipIndex++) {
      const zip = zipCodes[zipIndex];
      
      const currentJob = await storage.getLeadDiscoveryJob(jobId, null);
      if (currentJob?.status === "cancelled") {
        break;
      }

      // Check quota and hourly limits during execution (skip daily check since job already started)
      const canRun = await canRunDiscovery(userId, 1, true);
      if (!canRun.allowed) {
        console.log(`Stopping job: ${canRun.reason}`);
        await storage.updateLeadDiscoveryJob(jobId, {
          status: "failed",
          errorMessage: canRun.reason,
        }, null);
        return;
      }

      for (const queryTemplate of activeQueries) {
        const query = queryTemplate
          .replace("{STATE}", state)
          .replace("{ZIP}", zip);

        try {
          // Use Google Maps engine with caching
          const { results: searchResults, fromCache } = await searchWithSerpApi(query, zip, state, queryTemplate);
          
          if (fromCache) {
            console.log(`Using cached results for ${zip}`);
          }
          
          for (const result of searchResults) {
              if (!result.title || !result.link) continue;
              
              const businessData: BusinessData = {
                company: result.title,
                websiteUrl: result.link.startsWith("http") ? result.link : undefined,
                phone: result.phone,
                address: result.address,
              };

              if (isDuplicate(businessData, allResults)) {
                duplicatesRemoved++;
                continue;
              }

              let crawlData: Awaited<ReturnType<typeof crawlWebsite>> | null = null;
              let crawlStatus = "pending";
              let crawlError: string | undefined;

              if (businessData.websiteUrl) {
                try {
                  crawlData = await crawlWebsite(businessData.websiteUrl);
                  crawlStatus = "completed";
                } catch (err) {
                  crawlStatus = "failed";
                  crawlError = err instanceof Error ? err.message : "Unknown error";
                }
              }

              // Gap-fill: if email or phone is still missing after website crawl,
              // run all CONTACT_DETAIL_SOURCES in parallel to find them.
              const needsEmail = !crawlData?.email;
              const needsPhone = !crawlData?.phone && !businessData.phone;
              let gapFillEmail: string | undefined;
              let gapFillEmailSource: string | undefined;
              let gapFillPhone: string | undefined;
              let gapFillPhoneSource: string | undefined;
              if (needsEmail || needsPhone) {
                const gapFill = await findContactDetailsFromAlternativeSources(businessData.company);
                if (needsEmail && gapFill.email) {
                  gapFillEmail = gapFill.email;
                  gapFillEmailSource = gapFill.emailSource;
                }
                if (needsPhone && gapFill.phone) {
                  gapFillPhone = gapFill.phone;
                  gapFillPhoneSource = gapFill.phoneSource;
                }
              }

              // Determine software classification with improved logic
              const knownChain = checkKnownChain(businessData.company);
              let usesSoftware: string;
              let currentSoftware: string | null = crawlData?.softwareName || null;
              let classificationNote: string | null = null;

              if (crawlData?.bookingUrl) {
                // Found a recognizable booking link — confirmed Yes
                usesSoftware = "Yes";
              } else if (knownChain) {
                // Known enterprise chain — always uses software, even if not detectable via crawl
                usesSoftware = "Yes";
                currentSoftware = currentSoftware || knownChain.software;
                classificationNote = "Known enterprise chain — uses internal booking system";
              } else if (crawlStatus === "failed" || !businessData.websiteUrl) {
                // Couldn't crawl — can't determine
                usesSoftware = "Unknown";
              } else if (hasSchedulingLanguage(crawlData?.html ?? "")) {
                // Page has scheduling/booking language but no recognized system — probably uses something we can't detect
                usesSoftware = "Unknown";
                classificationNote = "Scheduling language found on site but specific software not identified";
              } else {
                // Crawl completed, no booking signals found — likely no online booking
                usesSoftware = "No";
              }

              const leadResult: InsertLeadDiscoveryResult = {
                jobId,
                company: businessData.company,
                phone: crawlData?.phone || businessData.phone || gapFillPhone || null,
                email: crawlData?.email || gapFillEmail || null,
                address: businessData.address || null,
                firstName: crawlData?.ownerName?.split(" ")[0] || null,
                lastName: crawlData?.ownerName?.split(" ").slice(1).join(" ") || null,
                jobTitle: crawlData?.jobTitle || null,
                hasWebsite: businessData.websiteUrl ? "Yes" : "No",
                websiteUrl: businessData.websiteUrl || null,
                bookingSoftwareUrl: crawlData?.bookingUrl || null,
                currentSoftware,
                usesSoftware,
                contactRequestFormUrl: crawlData?.contactFormUrl || null,
                leadSource: "Google Maps",
                notes: (() => {
                  const parts: string[] = [];
                  if (crawlError) parts.push(`Crawl failed: ${crawlError}`);
                  else if (classificationNote) parts.push(classificationNote);
                  else if (crawlData?.softwareName === "Unknown") parts.push("Booking link detected but software unclear");
                  if (gapFillEmail && gapFillEmailSource) parts.push(`Email found via ${gapFillEmailSource}`);
                  if (gapFillPhone && gapFillPhoneSource) parts.push(`Phone found via ${gapFillPhoneSource}`);
                  return parts.length ? parts.join(" | ") : null;
                })(),
                zipCode: zip,
                searchQuery: query,
                isDuplicate: "false",
                isImported: "false",
                crawlStatus,
                crawlError,
              };

              const savedResult = await storage.createLeadDiscoveryResult(leadResult, userId);
              allResults.push(savedResult);
              totalFound++;
            }
            
            await new Promise(resolve => setTimeout(resolve, 1000));
          } catch (err) {
            console.error(`Search failed for query "${query}":`, err);
            // NO automatic retries - log and continue
          }
      }

      await storage.updateLeadDiscoveryJob(jobId, {
        processedZipCodes: zipIndex + 1,
        totalBusinessesFound: totalFound,
        duplicatesRemoved,
      }, null);
    }

    await storage.updateLeadDiscoveryJob(jobId, {
      status: "completed",
      completedAt: new Date(),
      totalBusinessesFound: totalFound,
      duplicatesRemoved,
    }, null);

  } catch (error) {
    console.error("Lead discovery job failed:", error);
    await storage.updateLeadDiscoveryJob(jobId, {
      status: "failed",
      errorMessage: error instanceof Error ? error.message : "Unknown error",
      completedAt: new Date(),
    }, null);
  }
}

export async function importResultsToCRM(
  resultIds: string[],
  userId: string
): Promise<{ imported: number; errors: string[] }> {
  const errors: string[] = [];
  let imported = 0;
  const importedContactIds: string[] = [];

  for (const resultId of resultIds) {
    try {
      const leadResult = await storage.getLeadDiscoveryResultById(resultId);
      
      if (!leadResult) {
        errors.push(`Result ${resultId} not found`);
        continue;
      }

      if (leadResult.isImported === "true") {
        errors.push(`Result ${resultId} already imported`);
        continue;
      }

      const parsedAddr = parseAddressString(leadResult.address);

      const contact = await storage.createContact({
        firstName: leadResult.firstName || leadResult.company?.split(" ")[0] || "Unknown",
        lastName: leadResult.lastName || leadResult.company?.split(" ").slice(1).join(" ") || "Business",
        email: leadResult.email,
        phone: leadResult.phone,
        phoneWork: leadResult.phone,
        address: parsedAddr.street,
        city: parsedAddr.city,
        state: parsedAddr.state,
        zipCode: parsedAddr.zip ?? leadResult.zipCode ?? null,
        company: leadResult.company,
        jobTitle: leadResult.jobTitle,
        usesSoftware: leadResult.usesSoftware ?? "Unknown",
        currentSoftware: leadResult.currentSoftware,
        bookingSoftwareUrl: leadResult.bookingSoftwareUrl,
        hasWebsite: leadResult.hasWebsite,
        websiteUrl: leadResult.websiteUrl,
        contactRequestFormUrl: leadResult.contactRequestFormUrl,
        leadSource: leadResult.leadSource,
        notes: leadResult.notes,
        status: "active",
      }, userId);

      importedContactIds.push(contact.id);
      imported++;
    } catch (err) {
      errors.push(`Failed to import ${resultId}: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  }

  if (resultIds.length > 0 && importedContactIds.length > 0) {
    await storage.markResultsAsImported(
      resultIds.slice(0, importedContactIds.length), 
      importedContactIds, 
      null
    );
  }

  return { imported, errors };
}
