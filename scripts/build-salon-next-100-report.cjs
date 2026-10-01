const fs = require("fs");
const XLSX = require("xlsx");

const selection = JSON.parse(fs.readFileSync("reports/salon-public-web-next-100-selection.json", "utf8"));
const stateReviews = ["ca", "ny", "tx"].map(state =>
  JSON.parse(fs.readFileSync(`reports/salon-next-100-${state}-review.json`, "utf8")));
const rawById = new Map(stateReviews.flatMap(review => review.rows).map(row => [row.placeId, row]));
const ownerValidationPath = "reports/salon-owner-name-validation.json";
const ownerValidation = JSON.parse(fs.readFileSync(ownerValidationPath, "utf8"));
if (rawById.size !== 100 || stateReviews.reduce((total, review) => total + review.rows.length, 0) !== 100) {
  throw new Error("Expected exactly 100 distinct reviewed Place IDs");
}
if (ownerValidation.sampleSize !== 3 || ownerValidation.rows?.length !== 3 ||
    ownerValidation.budget?.actualProviderCalls !== 0 || ownerValidation.budget?.managedSearchCalls !== 0) {
  throw new Error("Owner-name validation report must contain the reviewed three-row, zero-provider-call sample");
}
for (const row of ownerValidation.rows) {
  const raw = rawById.get(row.placeId);
  if (!raw?.ownerName || JSON.stringify(raw.ownerName) !== JSON.stringify(row.ownerName)) {
    throw new Error(`Missing or inconsistent bundled owner-name seed: ${row.business}`);
  }
}

const override = {
  // A city-wide site and a separately indexed, different street address do
  // not prove this specific directory listing belongs to the mailbox.
  "Uncle Sylvio": {
    status: "review_only_location_pending",
    note: "First-party email and grooming service confirmed, but site gives only New York City. Another current directory places the same named business at 335 E 116th St while the selected listing says 116 E 117th St. Do not assign the email to this Place ID until the location is resolved.",
  },
};
const normalized = selection.selected.map(selected => {
  const raw = rawById.get(selected.placeId);
  if (!raw || raw.name !== selected.name || raw.address !== selected.address || raw.state !== selected.state) {
    throw new Error(`Missing or changed row: ${selected.name}`);
  }
  const change = override[selected.name] || {};
  const status = change.status || raw.status;
  const sourcePages = raw.search?.pages || raw.searchPages || raw.searchEvidence?.pages || [];
  const bookingOnly = /^booking@/i.test(raw.email || "");
  return {
    "State": selected.state,
    "Business": selected.name,
    "Source address": selected.address,
    "Google Place ID": selected.placeId,
    "Source Excel row": selected.sourceRow,
    "Outcome": status,
    "Public email (review-only when marked)": raw.email || "",
    "Email evidence URL": raw.sourceUrl || "",
    "Email use": bookingOnly ? "Bookings/customer appointments only — not general outreach" :
      status.startsWith("verified_") ? "Public business contact — manual review before any import/outreach" :
      status.startsWith("review_only") ? "Do not import or use until confirmed" : "",
    "Evidence and exceptions": [raw.evidenceNote || "", change.note || ""].filter(Boolean).join(" | "),
    "Search result pages retained": Array.isArray(sourcePages) ? sourcePages.length : "",
    ...(raw.ownerName ? { ownerName: raw.ownerName } : {}),
  };
});
const allStatuses = new Set([
  "verified_first_party_email", "verified_independent_directory_email",
  "review_only_candidate", "review_only_location_pending", "no_verified_email",
  "excluded_non_grooming", "inaccessible",
]);
for (const row of normalized) {
  if (!allStatuses.has(row.Outcome)) throw new Error(`Unrecognized outcome ${row.Outcome}`);
  if (row.Outcome.startsWith("verified_") && (!row["Public email (review-only when marked)"] || !row["Email evidence URL"])) {
    throw new Error(`Verified result without email/source: ${row.Business}`);
  }
}

const firstParty = normalized.filter(row => row.Outcome === "verified_first_party_email");
const directory = normalized.filter(row => row.Outcome === "verified_independent_directory_email");
const verified = [...firstParty, ...directory];
const bookingOnly = verified.filter(row => row["Email use"].startsWith("Bookings/"));
const generalContact = verified.filter(row => !row["Email use"].startsWith("Bookings/"));
const reviewOnly = normalized.filter(row => row.Outcome.startsWith("review_only"));
const noVerified = normalized.filter(row => row.Outcome === "no_verified_email");
const excluded = normalized.filter(row => row.Outcome === "excluded_non_grooming");
const inaccessible = normalized.filter(row => row.Outcome === "inaccessible");
const byState = Object.fromEntries(["CA", "NY", "TX"].map(state => {
  const rows = normalized.filter(row => row.State === state);
  return [state, {
    selected: rows.length,
    verifiedPublicEmails: rows.filter(row => row.Outcome.startsWith("verified_")).length,
    bookingOnly: rows.filter(row => row["Email use"].startsWith("Bookings/")).length,
    reviewOnly: rows.filter(row => row.Outcome.startsWith("review_only")).length,
    noVerifiedInBoundedSearch: rows.filter(row => row.Outcome === "no_verified_email").length,
    excludedNonGrooming: rows.filter(row => row.Outcome === "excluded_non_grooming").length,
    inaccessible: rows.filter(row => row.Outcome === "inaccessible").length,
  }];
}));
const offList = stateReviews.flatMap(review => review.offListBusinesses || []);
if (offList.length !== 1) throw new Error("Expected one independently reviewed off-list candidate");
const additional = offList[0];
const ownerNameEvidenceRows = normalized.flatMap(row => {
  const ownerName = row.ownerName || {};
  const candidates = Array.isArray(ownerName.candidates) ? ownerName.candidates : [];
  const base = {
    "State": row.State,
    "Business": row.Business,
    "Google Place ID": row["Google Place ID"],
    "Lookup status": ownerName.status || "not_searched",
    "Selected candidate ID": ownerName.selectedCandidateId || "",
    "Approved at": ownerName.approvedAt || "",
    "Use personal name": ownerName.usePersonalName ? "Yes" : "No",
    "Provider calls": ownerName.providerCalls ?? 0,
    "Pages fetched": ownerName.pagesFetched ?? 0,
    "Lookup error": ownerName.error || "",
  };
  if (!candidates.length) return [{ ...base, "First name": "", "Last name": "", "Role": "", "Role confirmed": "", "Business matched": "", "Confidence": "", "Source URL": "", "Source kind": "", "Source excerpt": "" }];
  return candidates.flatMap(candidate => {
    const sources = Array.isArray(candidate.sources) && candidate.sources.length
      ? candidate.sources
      : [{ url: "", kind: "", excerpt: "" }];
    return sources.map(source => ({
      ...base,
      "Candidate ID": candidate.id || "",
      "First name": candidate.firstName || "",
      "Last name": candidate.lastName || "",
      "Role": candidate.role || "",
      "Role confirmed": candidate.roleConfirmed ? "Yes" : "No",
      "Business matched": candidate.businessMatched ? "Yes" : "No",
      "Confidence": candidate.confidence || "",
      "Source URL": source.url || "",
      "Source kind": source.kind || "",
      "Source excerpt": source.excerpt || "",
    }));
  });
});
const workbookReviewed = normalized.map(row => {
  const { ownerName, ...emailReview } = row;
  const candidates = Array.isArray(ownerName?.candidates) ? ownerName.candidates : [];
  return {
    ...emailReview,
    "Owner lookup status": ownerName?.status || "not_searched",
    "Owner candidate names": candidates.map(candidate =>
      [candidate.firstName, candidate.lastName].filter(Boolean).join(" "),
    ).join("; "),
    "Owner approved at": ownerName?.approvedAt || "",
    "Owner uses personal name": ownerName?.usePersonalName ? "Yes" : "No",
  };
});
const offListEvidence = [{
  Business: additional.name,
  "Service area": additional.serviceArea,
  "Public email": additional.email,
  "First-party source": additional.sourceUrl,
  "Use restriction": "Site directs existing clients to email; not a general outreach mailbox",
  "Review state": "Distinct mobile groomer, not an outreach-ready contact; verify location/recency before any CRM import",
  "Evidence": additional.evidenceNote,
}];

const basePath = "reports/salon-directory-with-alternative-source-leads.xlsx";
const workbook = XLSX.readFile(basePath);
const baseSheet = workbook.Sheets.Sheet1;
const baseRows = XLSX.utils.sheet_to_json(baseSheet, { defval: "" });
const headers = XLSX.utils.sheet_to_json(baseSheet, { header: 1, range: 0 })[0];
const emailColumn = headers.indexOf("Email Address");
if (emailColumn === -1) throw new Error("Directory email column missing");
let rowsUpdated = 0;
for (const lead of verified) {
  // Booking-specific mailboxes are recorded as findings, not placed in the
  // importable directory's general Email Address column.
  if (lead["Email use"].startsWith("Bookings/")) continue;
  const matches = baseRows.map((row, index) => ({ row, index }))
    .filter(item => item.row.GooglePlaceID === lead["Google Place ID"]);
  if (!matches.length) throw new Error(`Directory ID missing: ${lead.Business}`);
  for (const { row, index } of matches) {
    const email = lead["Public email (review-only when marked)"];
    if (row["Email Address"] && row["Email Address"].toLowerCase() !== email.toLowerCase()) {
      throw new Error(`Conflicting directory email: ${lead.Business}`);
    }
    baseSheet[XLSX.utils.encode_cell({ r: index + 1, c: emailColumn })] = { t: "s", v: email };
    rowsUpdated++;
  }
}
const normalizedName = value => String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
if (baseRows.some(row => String(row["Email Address"] || "").toLowerCase() === additional.email.toLowerCase())) {
  throw new Error("Off-list email already present");
}
const sourceNamesInArea = baseRows.filter(row =>
  normalizedName(row.varLocationName).includes("hairofthedogpetspa") &&
  row.varLocationState === "CA" &&
  /Morgan Hill|Gilroy|San Jose|Santa Clara|San Bruno|Sunnyvale|Redwood City/i.test(row.FormattedAddress));
if (sourceNamesInArea.length) throw new Error("Possible same-name source row in mobile service area");
const summary = [
  ["Measure", "Value"],
  ["Selection", "100 distinct operational Place IDs (34 CA, 33 NY, 33 TX), blank source email; exclude all 120 Place IDs from previous pilot and obvious non-salon names before selection"],
  ["Verified public email businesses", verified.length],
  ["First-party", firstParty.length],
  ["Independent directory", directory.length],
  ["Booking-only subset (not copied into general Email Address)", bookingOnly.length],
  ["General-contact candidates (review before outreach)", generalContact.length],
  ["Other verified public email rows filled in directory copy", rowsUpdated],
  ["Review-only candidates", reviewOnly.length],
  ["No email verified in bounded search", noVerified.length],
  ["Clearly not professional grooming", excluded.length],
  ["Inaccessible/identity unresolved", inaccessible.length],
  ["Off-list mobile business held in evidence sheet only (email restricted to existing clients)", offList.length],
  ["Owner-name sample checked", `${ownerValidation.sampleSize} rows; ${ownerValidation.budget.actualPublicPages} public pages; ${ownerValidation.budget.actualProviderCalls} paid provider calls`],
  ["Owner-name sample source", ownerValidationPath],
  ["Owner-name lookups outside the sample", "97 of these 100 email-review rows are unsearched; no owner-name yield extrapolated"],
  ["Method", "One managed public-web search per listing with two query angles; targeted public GET/webFetch page checks. Extra bounded checks on review-only candidates. No paid DataForSEO/SerpAPI calls in this phase; managed search usage not costed here."],
  ["Limit", "Not representative of all 13,847 IDs: equal state quotas, operational-only and obvious-name filtering. No outreach, form submissions, social-page scraping, or CRM imports. Negative results do not prove no public email exists."],
];
workbook.Sheets["Next 100 email review"] = XLSX.utils.json_to_sheet(workbookReviewed);
workbook.SheetNames.push("Next 100 email review");
workbook.Sheets["Owner Name Evidence"] = XLSX.utils.json_to_sheet(ownerNameEvidenceRows);
workbook.SheetNames.push("Owner Name Evidence");
workbook.Sheets["Next 100 off-list evidence"] = XLSX.utils.json_to_sheet(offListEvidence);
workbook.SheetNames.push("Next 100 off-list evidence");
workbook.Sheets["Next 100 summary"] = XLSX.utils.aoa_to_sheet(summary);
workbook.SheetNames.push("Next 100 summary");
const directoryOutput = "reports/salon-directory-with-next-100-leads.xlsx";
XLSX.writeFile(workbook, directoryOutput);

const pilot = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(pilot, XLSX.utils.aoa_to_sheet(summary), "Summary");
XLSX.utils.book_append_sheet(pilot, XLSX.utils.json_to_sheet(workbookReviewed), "100 reviewed");
XLSX.utils.book_append_sheet(pilot, XLSX.utils.json_to_sheet(ownerNameEvidenceRows), "Owner Name Evidence");
XLSX.utils.book_append_sheet(pilot, XLSX.utils.json_to_sheet(offListEvidence), "Off-list");
const pilotOutput = "reports/salon-next-100-email-review.xlsx";
XLSX.writeFile(pilot, pilotOutput);

const result = {
  selection: "reports/salon-public-web-next-100-selection.json",
  perStateRawEvidence: ["ca", "ny", "tx"].map(state => `reports/salon-next-100-${state}-review.json`),
  ownerNameValidationSource: ownerValidationPath,
  ownerNameValidation: ownerValidation,
  directoryOutput, pilotOutput,
  counts: {
    selected: 100, verifiedPublicEmails: verified.length, generalContactCandidates: generalContact.length, firstParty: firstParty.length,
    independentDirectory: directory.length, bookingOnly: bookingOnly.length,
    directoryRowsUpdated: rowsUpdated, reviewOnly: reviewOnly.length,
    noVerifiedInBoundedSearch: noVerified.length, excludedNonGrooming: excluded.length,
    inaccessible: inaccessible.length, offListReviewOnly: offList.length,
  },
  byState,
  reviewed: normalized,
  offList: offListEvidence,
};
fs.writeFileSync("reports/salon-next-100-summary.json", JSON.stringify(result, null, 2));
fs.writeFileSync("reports/salon-next-100-summary.md", [
  "# Next 100 salon email review",
  "",
  `This bounded follow-up selected 100 new Place IDs from the original CA/NY/TX directory: 34 CA, 33 NY and 33 TX. It excluded every one of the earlier 120 provider-pilot IDs, existing email rows, non-operational entries and obvious non-salon names before selection. Result: **${generalContact.length} source-verified general-contact candidates** for manual review, **${bookingOnly.length} booking-only public business addresses** (not general-contact yield), **${reviewOnly.length} other review-only**, **${noVerified.length} no verified email in this bounded search**, **${excluded.length} non-grooming**, **${inaccessible.length} inaccessible/unresolved**. There are ${verified.length} source-confirmed business mailboxes in total (${firstParty.length} first-party, ${directory.length} independent directory).`,
  "",
  `Owner-name validation is a separate three-salon sample documented in \`${ownerValidationPath}\`: six public-page fetches and zero paid-provider calls. Curly Tails Grooming has the source-backed candidate Eliud Jimenez, explicitly titled Founder & Groomer and described as a business owner on its first-party page; this remains review-only, not approved. A Dog's Tail has Jacqueline and Elizabeth only in a public neighborhood-summary team mention, not owner evidence, so both remain unresolved. Dog Folks had no named owner in the two checked pages; this is not a claim that no owner exists elsewhere. The other 97 of these 100 email-review rows are unsearched for owner names; no owner-name yield is extrapolated.`,
  "",
  `Of the ${verified.length} published business emails, ${bookingOnly.length} are explicitly appointment/booking addresses and were not filled into the general Email Address column. ${rowsUpdated} other existing directory rows were filled in the review copy. An additional distinct Peninsula mobile grooming business was found, but its site directs only existing clients to email, so it was retained in the off-list evidence sheet rather than appended to the general directory. Neither original uploaded workbook nor CRM contacts changed.`,
  "",
  "Source-confirmed public business mailboxes by state (including booking-only): " + Object.entries(byState).map(([state, stats]) => `${state} ${stats.verifiedPublicEmails}/${stats.selected}`).join("; ") + ". These are counts within this screened, state-balanced pilot, **not a projected full-directory yield**.",
  "",
  "Specific cautions: Uncle Sylvio's site confirms a groomer and mailbox but not this Place ID's street address, so it is review-only. Pooch N Pups has conflicting current structured-data and visible-footer addresses; the source street is independently indexed, but confirm location before use. Wig-Wagz's first-party site gives a nearby intersection/ZIP rather than the source's street pin. Booking-only emails, social snippets, and other-location mailboxes are never treated as general outreach-ready contacts.",
  "",
  "Method: one managed public-web search with two query angles per selected listing, followed by targeted first-party or exact directory page checks, with an extra bounded raw-HTML pass on unresolved candidates where scripted text extraction missed content. No paid DataForSEO/SerpAPI provider requests were made in this phase. Managed search usage was not priced here, so this report does not claim a cost per email. No email sending, contact import, form submission, or automated Facebook scraping occurred. All decisions, source URLs and exceptions are in the workbook. State JSON reports retain search results and checked-page evidence.",
  "",
].join("\n"));
console.log(JSON.stringify(result.counts));