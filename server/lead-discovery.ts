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

// Search using Google Maps engine with caching and usage tracking
export async function searchWithSerpApi(
  query: string, 
  zipCode: string,
  state: string,
  queryTemplate: string
): Promise<{ results: SerpApiResult[]; fromCache: boolean }> {
  const apiKey = process.env.SERPAPI_API_KEY;
  if (!apiKey) {
    throw new Error("SERPAPI_API_KEY not configured");
  }

  // Check quota before making request
  const status = await getSerpUsageStatus();
  if (status.isQuotaReached) {
    throw new Error("SERP quota reached – upgrade required");
  }

  // Check cache first (30-day caching)
  const cached = await storage.getSerpCache(zipCode, queryTemplate, state, 30);
  if (cached) {
    console.log(`Using cached results for ${zipCode} - ${queryTemplate}`);
    return { results: cached.resultsJson as SerpApiResult[], fromCache: true };
  }

  // Check hourly rate limit
  const callsLastHour = await storage.getSerpCallsInLastHour();
  const maxCallsPerHour = status.config.maxSerpCallsPerHour || 5;
  if (callsLastHour >= maxCallsPerHour) {
    throw new Error(`Hourly SERP limit reached (${maxCallsPerHour}/hour). Please wait.`);
  }

  try {
    // Use Google Maps engine for better local business results
    // Include location in query since ll parameter requires lat,long coordinates
    const searchQuery = `${query.replace(", Zip code " + zipCode, "")} ${zipCode}`;
    const params = new URLSearchParams({
      api_key: apiKey,
      engine: "google_maps",
      q: searchQuery,
      type: "search",
    });

    console.log(`Searching Google Maps: ${searchQuery}`);
    const response = await fetch(`https://serpapi.com/search?${params}`);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error("SerpAPI error:", errorText);
      throw new Error(`SerpAPI returned ${response.status}`);
    }

    const data = await response.json();
    
    const results: SerpApiResult[] = [];
    
    // Google Maps returns local_results
    if (data.local_results) {
      for (const local of data.local_results) {
        results.push({
          title: local.title || "",
          link: local.website || "",
          phone: local.phone,
          address: local.address,
          snippet: local.description || "",
        });
      }
    }
    
    // Also check place_results for single place searches
    if (data.place_results) {
      const place = data.place_results;
      if (!results.some(r => r.title === place.title)) {
        results.push({
          title: place.title || "",
          link: place.website || "",
          phone: place.phone,
          address: place.address,
          snippet: place.description || "",
        });
      }
    }

    // Increment usage ONLY on successful response
    const monthYear = getCurrentMonthYear();
    await storage.incrementSerpUsage(monthYear);
    
    // Cache the results
    await storage.createSerpCache(zipCode, queryTemplate, state, results);
    
    console.log(`Found ${results.length} results for ${query}`);
    return { results, fromCache: false };
  } catch (error) {
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
  
  for (const [pattern, software] of Object.entries(BOOKING_SOFTWARE_PATTERNS)) {
    if (html.includes(pattern)) {
      const urlMatch = html.match(new RegExp(`https?://[^"'\\s]*${pattern.replace(/\./g, "\\.")}[^"'\\s]*`, "i"));
      return {
        url: urlMatch ? urlMatch[0] : `https://${pattern}`,
        software,
      };
    }
  }

  const hrefPattern = /href=["']([^"']+)["'][^>]*>([^<]*(?:book|schedule|appointment)[^<]*)/gi;
  let match;
  while ((match = hrefPattern.exec(html)) !== null) {
    const href = match[1];
    for (const [pattern, software] of Object.entries(BOOKING_SOFTWARE_PATTERNS)) {
      if (href.includes(pattern)) {
        return { url: href, software };
      }
    }
    
    if (href.startsWith("http")) {
      return { url: href, software: "Unknown" };
    } else if (href.startsWith("/")) {
      try {
        const base = new URL(baseUrl);
        return { url: `${base.origin}${href}`, software: "Unknown" };
      } catch {}
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
