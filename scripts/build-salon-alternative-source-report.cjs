const fs = require("fs");
const XLSX = require("xlsx");

const sourceFile = "attached_assets/0_CRM_Data_CA_NY_TX_Statewide_UNREGISTERED_Grooming_Salons_08_1790473643094.xlsx";
const directory = XLSX.readFile(sourceFile);
const sheet = directory.Sheets.Sheet1;
const original = XLSX.utils.sheet_to_json(sheet, { defval: "" });
const review = JSON.parse(fs.readFileSync("reports/salon-site-audit-review.json", "utf8")).review
  .filter(row => !row.verifiedEmail && !["excluded_unrelated_category", "excluded_non_grooming"].includes(row.status));
const selections = JSON.parse(fs.readFileSync("reports/salon-site-audit-selection.json", "utf8")).rows;
const bbbSearches = JSON.parse(fs.readFileSync("reports/salon-alternative-source-search-raw.json", "utf8")).searches;
const generalSearches = JSON.parse(fs.readFileSync("reports/salon-alternative-source-search-general.json", "utf8")).searches;

const decisions = {
  "The Pet Spaw": {
    email: "thepetspaw@gmail.com",
    source: "https://nextdoor.com/pages/the-pet-spaw-palm-desert-ca-1",
    status: "verified_public_directory_email",
    note: "Live Nextdoor business page lists this email and the same phone (760-346-3461) as the salon-owned site and BBB. Nextdoor lists 73905 East Palm Canyon Drive; current salon site lists 73911 Highway 111. Same business is supported by name, owner Wendy, and phone; confirm address/recency before use. Existing general form remains valid.",
  },
  "Songs Pet Grooming": {
    email: "songspetgrooming@gmail.com",
    source: "https://www.orangebook.com/biz/11443/songs-pet-grooming",
    status: "verified_public_directory_email",
    note: "Live Orange Book page gives the exact 573 W Vista Way # E address, the same Wix website as the source listing, and this email. Directory publication, not a first-party mailbox confirmation; review recency before outreach.",
  },
  "Dallas Dog Daycare and Boarding": {
    email: "LoveField@DallasDogDaycare.com",
    source: "https://www.dallasdogsdaycare.com/",
    status: "verified_first_party_email",
    note: "Salon-owned page lists Love Field email as a mailto beside exact 2739 Bachman Dr, Dallas address. Site advertises daycare, boarding and grooming. Its Downtown mailto is mismatched; do not assign Downtown to this Love Field listing.",
  },
  "LITTLE PAWS PET GROOMING": {
    email: "littlepawspetgrooming@hotmail.com",
    source: "https://www.facebook.com/littlepawspetgrooming",
    status: "review_only_indexed_social",
    note: "Search index shows the email and exact 1414 S Azusa Ave West Covina location, but the current Facebook page was inaccessible to page fetch. Not counted as verified.",
  },
  "Curly's Pet Grooming LLC": {
    email: "curlyspetgrooming@gmail.com",
    source: "https://www.facebook.com/p/Curlys-Pet-Grooming-LLC-100042493993218",
    status: "review_only_indexed_social",
    note: "Indexed Facebook result shows the email and Richmond, TX brand. Current page could not be checked, and the selected 24414 Peroni Dr location is not confirmed there. Not counted as verified.",
  },
  "Fritzy's Pet Care Pros": {
    email: "customerservice@fritzyspetcarepros.com",
    source: "https://fritzyspetcarepros.com/Contactus.aspx",
    status: "review_only_location_pending",
    note: "Previously found first-party brand mailbox. BBB profiles are in Corona and Irvine, not the selected Pomona location; do not assign it to Pomona without confirmation.",
  },
  "Sancho and Lucky's Dog Spa": {
    status: "unresolved",
    note: "Matching BBB profile found, but no attributable email. Prior salon website had tree-service contamination; no address from that page is trusted.",
  },
  "PAWsitive Pet Grooming": {
    status: "unresolved",
    note: "Search email for Pawsitive Tribe belongs to a different business in Davie, FL, not this Covina listing. Evaluated separately as a new lead.",
  },
  "PetSmart Grooming": {
    status: "unresolved",
    note: "No Bakersfield grooming-location email verified. Investor and other unrelated company/person mailboxes excluded.",
  },
  "Glam Grooming & Spa": {
    status: "unresolved",
    note: "GlamPet mailboxes belong to a separate Moriches, NY mobile groomer, not this Thousand Oaks booking page. Evaluated separately as a new lead.",
  },
  "Ali's Grooming": {
    status: "unresolved",
    note: "Listed domain is parked. No independent, location-matched salon email verified; do not use its domain-owner form.",
  },
  "Doggie Day Spa": {
    status: "unresolved",
    note: "Email-bearing results refer to other businesses/locations, including Wills Point, TX, not this Center, TX listing.",
  },
  "Pet City Grooming": {
    status: "unresolved",
    note: "Search result PetCityGrooming@company.com is a template/placeholder on a Netlify page with an implausible phone. Rejected; other Brooklyn groomers are separate businesses.",
  },
  "Paw Seasons": {
    status: "unresolved",
    note: "UK Paw Seasons address and co-located veterinary/trainer mailboxes are unrelated to a general Plainview grooming contact.",
  },
};

const additions = [
  {
    name: "Pawsitive Tribe Holistic Grooming",
    address: "6370 Griffin Road C-108, Davie, FL 33314",
    street: "6370 Griffin Road C-108",
    city: "Davie",
    state: "FL",
    zip: "33314",
    email: "pawsitivetribegrooming@gmail.com",
    source: "https://www.pawsitivetribe.pet/",
    note: "Current first-party HTML lists grooming, Davie street address, email and phone. Text-only extraction omitted footer email; checked raw public HTML. Different business from Covina PAWsitive Pet Grooming.",
  },
  {
    name: "GlamPet",
    address: "Moriches, NY (mobile grooming)",
    street: "",
    city: "Moriches",
    state: "NY",
    zip: "",
    email: "luabreo@glam-pet.com",
    source: "https://glam-pet.com/contact-us",
    note: "Current first-party contact page lists Moriches, NY, in-home pet grooming and two business-domain contact emails (also crisduran@glam-pet.com). Distinct from Thousand Oaks Glam Grooming & Spa. No street address supplied.",
  },
  {
    name: "Pampered Paws Private In Home Grooming",
    address: "Douglas, Carroll, Haralson, Paulding and Coweta counties, GA (mobile service)",
    street: "",
    city: "",
    state: "GA",
    zip: "",
    email: "pamperedpawsinfo@yahoo.com",
    source: "https://pamperedpawsinhomegrooming.com/contact",
    note: "Current first-party contact page gives this general email; first-party service-area page lists Georgia county ZIP codes and full-groom services. No physical business address claimed. Unrelated to Fredonia, NY Pampered Paws.",
  },
  {
    name: "Doggies Mobile Day Spa",
    address: "Northern Virginia, Washington DC and Maryland (mobile service)",
    street: "",
    city: "",
    state: "VA",
    zip: "",
    email: "doggiesmobiledayspa@gmail.com",
    source: "https://doggiesmobiledayspa.com/contact",
    note: "Current first-party contact page gives business email; homepage confirms mobile pet grooming in Northern Virginia, DC and Maryland. Different business from Center, TX Doggie Day Spa.",
  },
];

const normalize = s => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const existingEmails = new Set(original.map(row => String(row["Email Address"] || "").toLowerCase()).filter(Boolean));
for (const lead of additions) {
  if (existingEmails.has(lead.email.toLowerCase())) throw new Error(`Existing email: ${lead.email}`);
  const sameNameAndPlace = original.find(row =>
    normalize(row.varLocationName) === normalize(lead.name) &&
    normalize(row.varLocationState) === normalize(lead.state) &&
    (!lead.city || normalize(row.varLocationCity) === normalize(lead.city))
  );
  if (sameNameAndPlace) throw new Error(`Existing business: ${lead.name}`);
  if (lead.street && original.some(row =>
    normalize(row.FormattedAddress).includes(normalize(lead.street)) &&
    normalize(row.varLocationState) === normalize(lead.state)
  )) throw new Error(`Existing address: ${lead.name}`);
}

if (review.length !== 20 || bbbSearches.length !== 20 || generalSearches.length !== 20) {
  throw new Error("Expected all 20 selected no-email listings to have both search passes");
}
const reviewedRows = review.map(row => {
  const selected = selections.find(s => s.placeId === row.placeId);
  const decision = decisions[row.sourceName] || { status: "unresolved", note: "No business-and-location-attributable public email verified from this bounded search. This does not establish absence of an email." };
  return {
    "Business": row.sourceName,
    "State": row.state,
    "Source address": selected?.address || "",
    "Google Place ID": row.placeId,
    "Prior site outcome": row.status,
    "Email outcome": decision.status,
    "Email (verified or review-only as labeled)": decision.email || "",
    "Email evidence URL": decision.source || "",
    "Existing verified general form": row.verifiedGeneralFormUrl || "",
    "Evidence / exclusion": decision.note,
    "BBB-oriented results inspected": bbbSearches.find(x => x.placeId === row.placeId)?.pages?.length || 0,
    "General web results inspected": generalSearches.find(x => x.placeId === row.placeId)?.pages?.length || 0,
  };
});
const evidenceRows = additions.map(lead => ({
  Business: lead.name,
  "Area / address": lead.address,
  State: lead.state,
  "Public email": lead.email,
  "First-party evidence URL": lead.source,
  "Review state": "verified_public_email__manual_review_before_CRM_import",
  "Google Place ID": "",
  "Why not an existing row / source detail": lead.note,
}));
const headers = XLSX.utils.sheet_to_json(sheet, { header: 1, range: 0 })[0];
const emailColumn = headers.indexOf("Email Address");
let existingRowsUpdated = 0;
for (const reviewed of reviewedRows.filter(row => row["Email outcome"].startsWith("verified_"))) {
  const matches = original.map((row, index) => ({ row, index }))
    .filter(({ row }) => row.GooglePlaceID === reviewed["Google Place ID"]);
  if (!matches.length) throw new Error(`Source Place ID missing: ${reviewed.Business}`);
  for (const { row, index } of matches) {
    const email = reviewed["Email (verified or review-only as labeled)"];
    if (row["Email Address"] && row["Email Address"].toLowerCase() !== email.toLowerCase()) {
      throw new Error(`Conflicting existing email: ${reviewed.Business}`);
    }
    sheet[XLSX.utils.encode_cell({ r: index + 1, c: emailColumn })] = { t: "s", v: email };
    existingRowsUpdated++;
  }
}
const readme = [
  ["Sheet", "Purpose"],
  ["Sheet1", `${original.length} original source rows, with ${existingRowsUpdated} selected rows' emails filled, plus ${additions.length} verified, off-list grooming leads. Original uploaded workbook is untouched.`],
  ["Alternative source review", "Only the 20 grooming-relevant, no-verified-email listings from the 32-site audit; not all Place IDs."],
  ["Added lead evidence", "Sources and rationale for the off-list rows appended to Sheet1. Blank Google Place IDs are intentional."],
  ["Limit", "No CRM contact imports, messaging, form submissions, Facebook scraping, or broad paid provider searches. Review email recency before outreach."],
  ["Method", "Two bounded web-index passes per selected listing, plus targeted first-party/directory source checks. BBB profiles were inspected where matched; no local-news email verified."],
  ["Warning", "A matched phone/address on an independent listing supports attribution but does not prove mailbox delivery or present-day consent."],
];

const newRows = additions.map(lead => {
  const row = {
    varLocationName: lead.name,
    GooglePlaceID: "",
    FormattedAddress: lead.address,
    varLocationAddress1: lead.street,
    varLocationCity: lead.city,
    varLocationState: lead.state,
    varLocationZip: lead.zip,
    Country: "US",
    "Business Status": "UNVERIFIED",
    "Email Address": lead.email,
  };
  return headers.map(header => row[header] ?? "");
});
XLSX.utils.sheet_add_aoa(sheet, newRows, { origin: -1 });
directory.Sheets["Alternative source review"] = XLSX.utils.json_to_sheet(reviewedRows);
directory.SheetNames.push("Alternative source review");
directory.Sheets["Added lead evidence"] = XLSX.utils.json_to_sheet(evidenceRows);
directory.SheetNames.push("Added lead evidence");
directory.Sheets["Read Me"] = XLSX.utils.aoa_to_sheet(readme);
directory.SheetNames.push("Read Me");
const output = "reports/salon-directory-with-alternative-source-leads.xlsx";
XLSX.writeFile(directory, output);

const result = {
  scope: "20 grooming-relevant no-verified-email listings from the 32-site subset; separate off-list grooming leads incidentally found",
  originalRows: original.length,
  existingRowsUpdated,
  appendedOffListRows: additions.length,
  counts: {
    newVerifiedEmailsForSelectedListings: reviewedRows.filter(r => r["Email outcome"].startsWith("verified_")).length,
    reviewOnlyCandidates: reviewedRows.filter(r => r["Email outcome"].startsWith("review_only")).length,
    unresolvedSelectedListings: reviewedRows.filter(r => r["Email outcome"] === "unresolved").length,
  },
  reviewedRows,
  additions: evidenceRows,
  output,
};
fs.writeFileSync("reports/salon-alternative-source-email-review.json", JSON.stringify(result, null, 2));
fs.writeFileSync("reports/salon-alternative-source-email-review.md", [
  "# Alternative-source salon email review",
  "",
  "From the 32-site audit, **20** grooming-relevant businesses had no previously verified email. Two bounded public-web index passes per business (including BBB-targeted searches) and targeted page checks produced **3** newly source-verified public emails, **3** review-only candidate emails, and **14** still unresolved. The Pet Spaw's previously verified general inquiry form remains available; no form was submitted.",
  "",
  "Verified for selected listings:",
  ...reviewedRows.filter(r => r["Email outcome"].startsWith("verified_")).map(r => `- **${r.Business}** — ${r["Email (verified or review-only as labeled)"]} (${r["Email outcome"]}); ${r["Email evidence URL"]}. ${r["Evidence / exclusion"]}`),
  "",
  "Review-only candidates (not counted as verified):",
  ...reviewedRows.filter(r => r["Email outcome"].startsWith("review_only")).map(r => `- **${r.Business}** — ${r["Email (verified or review-only as labeled)"]}; ${r["Evidence / exclusion"]}`),
  "",
  `A separate discovery of **${additions.length} genuine, off-list grooming businesses** with emails on their current first-party pages was appended to a **copy** of the CA/NY/TX directory. The ${existingRowsUpdated} matching source rows for the three newly verified existing-list businesses also received emails in this review copy. Original rows: ${original.length}; copy rows: ${original.length + additions.length}.`,
  ...additions.map(l => `- **${l.name}** (${l.address}) — ${l.email}; ${l.source}. ${l.note}`),
  "",
  "Do not treat similar search hits as the same business: Pet-Spaw LLC in Florida offered pet sitting but no grooming on its site; the Colorado Pampered Paws site displayed unrelated gambling/retail content; the Neenah Doggy Day Spa email appeared only in an older search result, not its current page. Several plausible first-party email businesses were already in the original directory (Pup Culture Pet Spaw, Paw Paw Pet Grooming in Upland, House of Paws Doggie Day Spa, Dog City Pet Loft, Dawg Life, NYC Pet Grooming) and were not duplicated.",
  "",
  "The original uploaded workbook and CRM contacts were not changed. No emails sent, forms submitted, or paid SERP/Place-ID batch calls made. The new workbook requires human review before CRM import/outreach. The raw web-index results are in `salon-alternative-source-search-raw.json` and `salon-alternative-source-search-general.json`; per-listing outcomes and source URLs are in the workbook and JSON report. This deliberately selected sample cannot be used to estimate yield for the full directory.",
  "",
].join("\n"));
console.log(JSON.stringify({ output, originalRows: original.length, existingRowsUpdated, added: additions.length, counts: result.counts }, null, 2));