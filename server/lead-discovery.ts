import { storage } from "./storage";
import type { LeadDiscoveryJob, LeadDiscoveryResult, InsertLeadDiscoveryResult } from "@shared/schema";

const SEARCH_QUERIES = [
  "Grooming shop in {STATE}, Zip code {ZIP}",
  "Grooming salon in {STATE}, Zip code {ZIP}",
  "Pet Grooming shop in {STATE}, Zip code {ZIP}",
  "Pet Grooming salon in {STATE}, Zip code {ZIP}",
  "Dog Groomer in {STATE}, Zip code {ZIP}",
  "Dog Grooming shop in {STATE}, Zip code {ZIP}",
  "Cat Grooming shop in {STATE}, Zip code {ZIP}",
  "Dog Grooming salon in {STATE}, Zip code {ZIP}",
];

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

export async function searchWithSerpApi(
  query: string, 
  engine: "google" | "bing" = "google",
  maxResults: number = 10
): Promise<SerpApiResult[]> {
  const apiKey = process.env.SERPAPI_API_KEY;
  if (!apiKey) {
    throw new Error("SERPAPI_API_KEY not configured");
  }

  try {
    const params = new URLSearchParams({
      api_key: apiKey,
      q: query,
      num: String(maxResults),
    });

    if (engine === "google") {
      params.set("engine", "google");
      params.set("google_domain", "google.com");
    } else if (engine === "bing") {
      params.set("engine", "bing");
    }

    const response = await fetch(`https://serpapi.com/search?${params}`);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error("SerpAPI error:", errorText);
      throw new Error(`SerpAPI returned ${response.status}`);
    }

    const data = await response.json();
    
    const results: SerpApiResult[] = [];
    
    if (data.local_results) {
      for (const local of data.local_results) {
        results.push({
          title: local.title || "",
          link: local.website || local.link || "",
          phone: local.phone,
          address: local.address,
          snippet: local.snippet,
        });
      }
    }
    
    if (data.organic_results) {
      for (const organic of data.organic_results) {
        if (!results.some(r => r.link === organic.link)) {
          results.push({
            title: organic.title || "",
            link: organic.link || "",
            snippet: organic.snippet,
          });
        }
      }
    }

    return results.slice(0, maxResults);
  } catch (error) {
    console.error("SerpAPI search failed:", error);
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
    const engines = (job.searchEngines || "google").split(",") as ("google" | "bing")[];
    const state = job.state;
    const maxPerZip = job.maxResultsPerZip || 20;

    const allResults: LeadDiscoveryResult[] = [];
    let totalFound = 0;
    let duplicatesRemoved = 0;

    for (let zipIndex = 0; zipIndex < zipCodes.length; zipIndex++) {
      const zip = zipCodes[zipIndex];
      
      const currentJob = await storage.getLeadDiscoveryJob(jobId, null);
      if (currentJob?.status === "cancelled") {
        break;
      }

      for (const queryTemplate of SEARCH_QUERIES) {
        const query = queryTemplate
          .replace("{STATE}", state)
          .replace("{ZIP}", zip);

        for (const engine of engines) {
          try {
            const searchResults = await searchWithSerpApi(query, engine, Math.ceil(maxPerZip / SEARCH_QUERIES.length));
            
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
                leadSource: `${engine.charAt(0).toUpperCase() + engine.slice(1)} Search`,
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
            console.error(`Search failed for query "${query}" on ${engine}:`, err);
          }
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
      const result = await storage.getLeadDiscoveryResults(resultId, null);
      const leadResult = result.find(r => r.id === resultId);
      
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
