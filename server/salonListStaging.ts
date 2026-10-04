import type { InsertSalonEnrichmentRow, LeadDiscoveryResult, SalonEnrichmentRow } from "@shared/schema";

export const MAX_SALON_LIST_ROWS = 5000;
export const MAX_SALON_LIST_JSON_BYTES = 2 * 1024 * 1024;

export interface SalonListInput {
  businessName: string;
  emailCandidate: string | null;
  phone: string | null;
  address: string | null;
  state: string | null;
  zipCode: string | null;
  websiteUrl: string | null;
  placeId: string | null;
  firstNameSuggestion: string | null;
  lastNameSuggestion: string | null;
  uploadedFields: Record<string, string>;
}

export interface SalonListStageResult {
  rows: InsertSalonEnrichmentRow[];
  inputCount: number;
  stagedCount: number;
  duplicateCount: number;
  invalidCount: number;
}

const aliases: Record<keyof Omit<SalonListInput, "uploadedFields">, string[]> = {
  businessName: ["Business Name", "Business", "company", "Company", "businessName", "Source salon name", "Salon name"],
  emailCandidate: ["Email", "email", "Public email (review-only when marked)"],
  phone: ["Phone", "phone", "telephone"],
  address: ["Address", "address", "Street Address", "Source address", "Full address"],
  state: ["State", "state"],
  zipCode: ["ZIP Code", "Zip Code", "zipCode", "zip", "Zip"],
  websiteUrl: ["Website URL", "Website", "Web Site Address", "websiteUrl", "Website URL (query removed)"],
  placeId: ["Google Place ID", "googlePlaceId", "placeId"],
  firstNameSuggestion: ["Owner First Name", "First Name", "firstName", "first_name"],
  lastNameSuggestion: ["Owner Last Name", "Last Name", "lastName", "last_name"],
};

const uploadedFieldNames = [
  "Currently uses software", "Software Used", "Booking Software URL",
  "Has Web Site", "Contact Request Form URL",
  "source", "notes", "jobTitle", "Job Title",
  "Provider category", "Provider business name", "Provider address", "Provider Place ID",
  "Provider contact URL (NOT a verified form)", "Booking URL (query removed)", "Exact Place ID match",
];
const forbiddenWebHosts = [
  "facebook.com", "instagram.com", "linkedin.com", "tiktok.com", "twitter.com",
  "x.com", "youtube.com", "yelp.com", "square.site", "squareup.com",
  "vagaro.com", "booksy.com", "styleseat.com", "fresha.com", "mindbodyonline.com",
  "schedulicity.com", "acuityscheduling.com", "setmore.com", "zenoti.com",
  "bbb.org", "yellowpages.com", "angi.com", "thumbtack.com",
];

function text(value: unknown, maxLength = 1000): string | null {
  if (value === null || value === undefined || typeof value === "object") return null;
  const clean = String(value).trim().slice(0, maxLength);
  return clean || null;
}

function headerKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function valueFor(row: Record<string, unknown>, field: keyof Omit<SalonListInput, "uploadedFields">): string | null {
  const wanted = new Set(aliases[field].map(headerKey));
  const key = Object.keys(row).find(candidate => wanted.has(headerKey(candidate)));
  return key ? text(row[key]) : null;
}

export function safeWebsite(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (!host.includes(".") || forbiddenWebHosts.some(domain => host === domain || host.endsWith(`.${domain}`))) return null;
    return url.toString().slice(0, 1000);
  } catch {
    return null;
  }
}

export function normalizeSalonBusinessName(value: string | null | undefined): string {
  return (value || "").normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

export function normalizeSalonPhone(value: string | null | undefined): string {
  const digits = (value || "").replace(/\D/g, "");
  return digits.length > 10 && digits.startsWith("1") ? digits.slice(1) : digits;
}

export function isRetryableStagedSalonRow(row: Pick<SalonEnrichmentRow,
  "sourceData" | "status" | "email" | "reviewStatus" | "importedContactId"
>): boolean {
  const data = row.sourceData as Record<string, unknown> | null;
  return ["staged_unverified", "verification_attempted"].includes(String(data?.stagingState)) &&
    ["pending", "failed", "enriched"].includes(row.status) &&
    !row.email &&
    row.reviewStatus !== "approved" &&
    row.reviewStatus !== "rejected" &&
    !row.importedContactId;
}

export function cumulativeStagedSalonSerpCallsUsed(sourceData: unknown, previousCalls: number, attemptedCalls: number): number {
  const data = sourceData as Record<string, unknown> | null;
  return ["staged_unverified", "verification_attempted"].includes(String(data?.stagingState))
    ? previousCalls + attemptedCalls
    : attemptedCalls;
}

export function parseSalonListRow(input: Record<string, unknown>): SalonListInput | null {
  const businessName = valueFor(input, "businessName");
  if (!businessName) return null;
  const uploadedFields: Record<string, string> = {};
  for (const name of uploadedFieldNames) {
    const match = Object.keys(input).find(key => headerKey(key) === headerKey(name));
    const value = match ? text(input[match]) : null;
    if (value) uploadedFields[name] = value;
  }
  const websiteUrl = safeWebsite(valueFor(input, "websiteUrl"));
  if (websiteUrl) uploadedFields["Web Site Address"] = websiteUrl;
  return {
    businessName,
    emailCandidate: valueFor(input, "emailCandidate"),
    phone: valueFor(input, "phone"),
    address: valueFor(input, "address"),
    state: valueFor(input, "state"),
    zipCode: valueFor(input, "zipCode"),
    websiteUrl,
    placeId: valueFor(input, "placeId"),
    firstNameSuggestion: valueFor(input, "firstNameSuggestion"),
    lastNameSuggestion: valueFor(input, "lastNameSuggestion"),
    uploadedFields,
  };
}

function recoverNationwideData(candidate: SalonListInput, existing: LeadDiscoveryResult[]): Partial<SalonListInput> {
  const name = normalizeSalonBusinessName(candidate.businessName);
  const phone = normalizeSalonPhone(candidate.phone);
  if (!name || !phone) return {};
  const matches = existing.filter(row =>
    normalizeSalonBusinessName(row.company) === name &&
    normalizeSalonPhone(row.phone) === phone,
  );
  if (matches.length !== 1) return {};
  const match = matches[0];
  const stateMatch = match.address?.match(/,\s*([A-Z]{2})(?:\s+\d{5}(?:-\d{4})?)?\s*$/i);
  return {
    address: candidate.address || text(match.address),
    state: candidate.state || (stateMatch ? stateMatch[1].toUpperCase() : null),
    zipCode: candidate.zipCode || text(match.zipCode),
    websiteUrl: candidate.websiteUrl || safeWebsite(text(match.websiteUrl)),
  };
}

function naturalKeys(row: { businessName: string; phone?: string | null; placeId?: string | null }): string[] {
  const keys: string[] = [];
  const placeId = text(row.placeId);
  if (placeId) keys.push(`place:${placeId.toLowerCase()}`);
  const name = normalizeSalonBusinessName(row.businessName);
  const phone = normalizeSalonPhone(row.phone);
  if (name && phone.length >= 7) keys.push(`name-phone:${name}:${phone}`);
  return keys;
}

export function stageSalonListRows(
  inputRows: unknown[],
  userId: string,
  batchId: string,
  existingReportRows: Pick<SalonEnrichmentRow, "businessName" | "phone" | "placeId">[],
  ownedNationwideRows: LeadDiscoveryResult[] = [],
): SalonListStageResult {
  const seen = new Set<string>();
  for (const row of existingReportRows) for (const key of naturalKeys(row)) seen.add(key);
  const staged: InsertSalonEnrichmentRow[] = [];
  let invalidCount = 0;
  let duplicateCount = 0;

  inputRows.forEach((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      invalidCount++;
      return;
    }
    const parsed = parseSalonListRow(raw as Record<string, unknown>);
    if (!parsed) {
      invalidCount++;
      return;
    }
    Object.assign(parsed, recoverNationwideData(parsed, ownedNationwideRows));
    const keys = naturalKeys({ businessName: parsed.businessName, phone: parsed.phone, placeId: parsed.placeId });
    if (keys.some(key => seen.has(key))) {
      duplicateCount++;
      return;
    }
    keys.forEach(key => seen.add(key));

    const sourceData = {
      category: "review_only",
      stagingState: "staged_unverified",
      uploadedEmailCandidate: parsed.emailCandidate,
      uploadedFirstNameSuggestion: parsed.firstNameSuggestion,
      uploadedLastNameSuggestion: parsed.lastNameSuggestion,
      uploadedFields: parsed.uploadedFields,
      ...(parsed.emailCandidate ? { "Public email (review-only when marked)": parsed.emailCandidate } : {}),
      ...(parsed.firstNameSuggestion ? { "Owner First Name": parsed.firstNameSuggestion } : {}),
      ...(parsed.lastNameSuggestion ? { "Owner Last Name": parsed.lastNameSuggestion } : {}),
    };
    staged.push({
      batchId,
      userId,
      rowNumber: index + 1,
      sourceData,
      placeId: parsed.placeId,
      businessName: parsed.businessName,
      address: parsed.address,
      address1: null,
      city: null,
      state: parsed.state,
      zipCode: parsed.zipCode,
      latitude: null,
      longitude: null,
      businessStatus: null,
      websiteUrl: parsed.websiteUrl,
      email: null,
      phone: parsed.phone,
      contactRequestFormUrl: null,
      contactFormStatus: "unknown",
      bookingUrl: null,
      currentSoftware: null,
      usesSoftware: "Unknown",
      hasWebsite: parsed.websiteUrl ? "Yes" : "Unknown",
      audienceTrack: "directory_general",
      evidence: {
        note: "Uploaded list data only; business identity, website and contact details are unverified.",
        ...(parsed.emailCandidate ? {
          uploadedEmailCandidate: {
            value: parsed.emailCandidate,
            source: "uploaded_list",
            confidence: "low",
            rationale: "Unverified uploaded candidate; not approved for contact or sending.",
          },
        } : {}),
      },
      confidence: {},
      identityMatchStatus: "unmatched",
      status: "enriched",
      reviewStatus: "needs_review",
      duplicateMetadata: {},
      importedContactId: null,
      serpCallsUsed: 0,
      lastError: null,
      processedAt: new Date(),
    } as InsertSalonEnrichmentRow);
  });

  return {
    rows: staged,
    inputCount: inputRows.length,
    stagedCount: staged.length,
    duplicateCount,
    invalidCount,
  };
}