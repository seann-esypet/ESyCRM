import { storage } from "./storage";
import type { LeadDiscoveryJob, LeadDiscoveryResult, InsertLeadDiscoveryResult, SerpUsage, LeadDiscoveryConfig } from "@shared/schema";

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
};

const BOOKING_BUTTON_KEYWORDS = [
  "book", "book now", "book here", "schedule", "appointment", 
  "groom", "grooming", "reserve", "make an appointment"
];

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
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const html = await response.text();
    
    const result: ReturnType<typeof crawlWebsite> extends Promise<infer T> ? T : never = {
      html,
    };

    const bookingInfo = detectBookingSoftware(html, url);
    if (bookingInfo) {
      result.bookingUrl = bookingInfo.url;
      result.softwareName = bookingInfo.software;
    }

    const email = extractEmail(html);
    if (email) result.email = email;

    const phone = extractPhone(html);
    if (phone) result.phone = phone;

    const contactForm = detectContactForm(html, url);
    if (contactForm) result.contactFormUrl = contactForm;

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
  const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const matches = html.match(emailPattern);
  
  if (matches) {
    const validEmails = matches.filter(email => 
      !email.includes("example.com") &&
      !email.includes("sentry.io") &&
      !email.includes("wixpress.com") &&
      !email.endsWith(".png") &&
      !email.endsWith(".jpg")
    );
    return validEmails[0] || null;
  }
  
  return null;
}

function extractPhone(html: string): string | null {
  const phonePattern = /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
  const matches = html.match(phonePattern);
  return matches ? matches[0] : null;
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

              const leadResult: InsertLeadDiscoveryResult = {
                jobId,
                company: businessData.company,
                phone: crawlData?.phone || businessData.phone || null,
                email: crawlData?.email || null,
                firstName: crawlData?.ownerName?.split(" ")[0] || null,
                lastName: crawlData?.ownerName?.split(" ").slice(1).join(" ") || null,
                jobTitle: crawlData?.jobTitle || null,
                hasWebsite: businessData.websiteUrl ? "Yes" : "No",
                websiteUrl: businessData.websiteUrl || null,
                bookingSoftwareUrl: crawlData?.bookingUrl || null,
                currentSoftware: crawlData?.softwareName || null,
                usesSoftware: crawlData?.bookingUrl 
                  ? "Yes" 
                  : (crawlStatus === "completed" ? "No" : "Unknown"),
                contactRequestFormUrl: crawlData?.contactFormUrl || null,
                leadSource: "Google Maps",
                notes: crawlError 
                  ? `Crawl failed: ${crawlError}` 
                  : (crawlData?.softwareName === "Unknown" ? "Booking link detected but software unclear" : null),
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

      const contact = await storage.createContact({
        firstName: leadResult.firstName || leadResult.company?.split(" ")[0] || "Unknown",
        lastName: leadResult.lastName || leadResult.company?.split(" ").slice(1).join(" ") || "Business",
        email: leadResult.email,
        phone: leadResult.phone,
        company: leadResult.company,
        jobTitle: leadResult.jobTitle,
        usesSoftware: leadResult.usesSoftware,
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
