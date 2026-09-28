import { readFileSync, writeFileSync } from "node:fs";
import XLSX from "xlsx";

const source = JSON.parse(readFileSync("reports/salon-site-crawl-evidence.json", "utf8")).results;
// Human decisions based on the retrieved HTML and read-only contact-page inspection.
// Emails and forms below are not added to the application contact database.
const decisions = {
  "The Pet Spaw": {
    form: "https://thepetspawpetstyling.com/",
    note: "Exact salon name and 73911 Highway 111 address; Contact Us includes Name, Email, Message and Send. Delivery not tested.",
  },
  "Fritzy's Pet Care Pros": {
    pendingEmail: "customerservice@fritzyspetcarepros.com",
    pendingEmailSource: "https://fritzyspetcarepros.com/Contactus.aspx",
    pendingForm: "https://fritzyspetcarepros.com/Contactus.aspx",
    note: "Brand-owned customer-service email and general message form, but the page does not confirm the source listing's Pomona address. Keep location attribution pending. Homepage-wide form match alone is not proof.",
  },
  "Paw Commons Pet Resort & Training Center - Hillcrest": {
    email: "infohillcrest@pawcommons.com",
    emailSource: "https://www.pawcommons.com/get-in-touch/",
    form: "https://www.pawcommons.com/get-in-touch/",
    note: "Contact page lists Hillcrest's exact 3915 9th Ave address and a separate Hillcrest mailbox; message form includes a location selector. Basic HTML extraction missed the mailbox; text-page review found it.",
  },
  "A Pet Villa Pet Boarding Daycare and Grooming": {
    email: "staff@apetvilla.com",
    emailSource: "https://apetvilla.com/",
    note: "First-party mailto link on site with grooming service; contact page confirms 1205 Laurelwood Rd. Its separate contact form has no confirmed free-message field, so it is not counted.",
  },
  "Head 2 Tails Professional Pet Salon & Spa": {
    email: "info@head2tails.com",
    emailSource: "https://www.head2tails.com/contact-us/",
    note: "Contact page lists salon email and 1928 S Seguin Ave, New Braunfels, matching the listing.",
  },
  "As The Fur Flies": {
    email: "info@asthefurfliesaustin.com",
    emailSource: "https://www.asthefurfliesaustin.com/contact-us-ready",
    note: "First-party mailto on the matching As The Fur Flies Austin grooming site; city and business name align, although street address was not independently shown in extracted page text.",
  },
  "Love Thou Dog": {
    email: "lovethoudog@gmail.com",
    emailSource: "https://lovethoudog.com/contacts/",
    form: "https://lovethoudog.com/contacts/",
    note: "Contact page lists exact 20-04 Utopia Pkwy address, business email, and a general question/comment message form with Submit. Other site copy contains a template remnant; recheck before outreach.",
  },
  "E Z GROOMER": {
    email: "ezgroomhudsonvalley@gmail.com",
    emailSource: "https://www.ezgroomerhudsonvalley.com/contact-us",
    note: "Email Us mailto on contact page with exact 7592 N Broadway Red Hook address. Reject email@example.com: it is a form placeholder. Visible Message UI did not establish a submitted HTML form.",
  },
  "Paws and Claws Pet Care, Inc.": {
    email: "pawsandclaws585@gmail.com",
    emailSource: "https://pawsandclaws585.com/contact-us/",
    note: "Matching business site advertises grooming and says to email this address with questions. The page's form enrolls new customers in Paw Partner, not a general inquiry; excluded.",
  },
  "Sancho and Lucky's Dog Spa": {
    status: "review_only_mixed_site",
    note: "Alternative text extraction revealed a tree-service phone/email and tree-service footer mixed into this dog-spa contact page; its quote form says 'Unable to find form'. Even the matching-domain address is not trusted.",
  },
  "Ali's Grooming": {
    status: "excluded_parked_domain",
    note: "The URL currently says 'This domain is for sale'; its Name/Email/Message form contacts the domain owner, not Ali's Grooming.",
  },
  "Paw Seasons": {
    note: "Contact page's mailto is explicitly for the co-located Manetto Hill Animal Hospital; another address appears on a trainer page. Neither is a verified general Paw Seasons salon email.",
  },
  "Sullivan County SPCA": {
    status: "excluded_non_grooming",
    note: "Animal shelter, not a grooming salon. Its public email and contact form are for shelter inquiries and are excluded.",
  },
  "Tractor Supply Co.": {
    status: "excluded_non_grooming",
    note: "Feed/retail chain, not a grooming salon. Store-page contact does not qualify.",
  },
  "Absolutely A Cut Above": {
    status: "partial_assessment",
    note: "Landing page was retrievable but linked page failed; no verified contact from pages that loaded. This is not evidence the business lacks a public contact.",
  },
  "LITTLE PAWS PET GROOMING": {
    note: "HTTP 403; site was not assessable.",
  },
  "Pet City Grooming": {
    note: "Returned URL was HTTP 404; site was not assessable.",
  },
  "Kenna’s Grooming Garage": {
    note: "Returned domain did not resolve; site was not assessable.",
  },
};

const review = source.map(row => {
  const decision = decisions[row.name] || {};
  const status = decision.status ||
    (decision.email || decision.form ? "verified_contact" :
      row.outcome === "crawl_failed" ? "not_assessed_fetch_failed" :
        row.outcome === "social_booking_or_directory_url" ? "not_assessed_third_party_link" :
          row.outcome === "unrelated_business_control" ? "excluded_unrelated_category" :
            "no_verified_contact_in_retrieved_pages");
  return {
    state: row.state, sourceName: row.name, category: row.category,
    stratum: row.stratum, placeId: row.placeId, returnedUrl: row.url,
    status, verifiedEmail: decision.email || "", emailSourceUrl: decision.emailSource || "",
    verifiedGeneralFormUrl: decision.form || "",
    reviewOnlyEmail: decision.pendingEmail || "",
    reviewOnlyEmailSourceUrl: decision.pendingEmailSource || "",
    reviewOnlyFormUrl: decision.pendingForm || "",
    pagesRetrieved: row.pages.length,
    pageUrls: row.pages.map(p => p.url).join(" | "),
    fetchIssues: row.errors.map(e => `${e.reason} (${e.url})`).join(" | "),
    reviewNote: decision.note ||
      (status === "excluded_unrelated_category" ? "Provider category is unrelated to grooming; no crawl." :
        status === "not_assessed_third_party_link" ? "Social profile, booking platform, or third-party directory: no broad crawl or automatic contact attribution." :
          status === "no_verified_contact_in_retrieved_pages" ? "Retrieved pages gave no salon-attributable email or verified general message form; limited crawl cannot prove absence." :
            "Not assessed."),
  };
});

const counts = {
  selected: review.length,
  pagesRetrieved: review.filter(x => x.pagesRetrieved > 0).length,
  fetchFailed: review.filter(x => x.status === "not_assessed_fetch_failed").length,
  thirdPartySkipped: review.filter(x => x.status === "not_assessed_third_party_link").length,
  unrelatedControls: review.filter(x => x.status === "excluded_unrelated_category").length,
  verifiedEmailBusinesses: review.filter(x => x.verifiedEmail).length,
  verifiedGeneralFormBusinesses: review.filter(x => x.verifiedGeneralFormUrl).length,
  verifiedEitherBusinesses: review.filter(x => x.verifiedEmail || x.verifiedGeneralFormUrl).length,
  brandContactLocationPending: review.filter(x => x.reviewOnlyEmail).length,
};

const workbook = XLSX.utils.book_new();
const summary = [
  ["Measure", "Count / explanation"],
  ...Object.entries(counts).map(([key, value]) => [key, value]),
  ["Selection", "32 deterministic state-balanced, deliberately stratified Place IDs from the 91 returned website URLs: 24 initial site candidates, 5 chain/social/booking, 3 unrelated controls. One planned chain stratum had no eligible NY row."],
  ["Interpretation", "Purposive selection enriched for apparent standalone sites; these rates must NOT be projected to the 91 URL hits or 13,847 Place IDs."],
  ["Verification", "Email requires matching salon/location or matching business identity and current first-party source URL. Form requires a general message field and submit control; delivery was NOT tested."],
  ["Activity", "Read-only GETs only; no provider lookup calls, email sends, form submissions, Facebook automation, contact import, or full-directory processing."],
];
XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(summary), "Summary");
const columns = [
  ["State", "state"], ["Listing", "sourceName"], ["Provider category", "category"],
  ["Selection stratum", "stratum"], ["Place ID", "placeId"], ["Returned URL", "returnedUrl"],
  ["Review outcome", "status"], ["Verified email", "verifiedEmail"],
  ["Exact email source URL", "emailSourceUrl"],
  ["Verified general form URL", "verifiedGeneralFormUrl"],
  ["Review-only email", "reviewOnlyEmail"], ["Review-only email source", "reviewOnlyEmailSourceUrl"],
  ["Review-only form URL", "reviewOnlyFormUrl"], ["Pages retrieved", "pagesRetrieved"],
  ["Retrieved page URLs", "pageUrls"], ["Fetch issues", "fetchIssues"], ["Review notes", "reviewNote"],
];
const sheet = XLSX.utils.aoa_to_sheet([
  columns.map(([label]) => label),
  ...review.map(row => columns.map(([, key]) => row[key])),
]);
sheet["!cols"] = columns.map(([label]) => ({ wch: label.includes("URL") || label.includes("page") ? 42 : 27 }));
sheet["!autofilter"] = { ref: `A1:Q${review.length + 1}` };
XLSX.utils.book_append_sheet(workbook, sheet, "Reviewed subset");
XLSX.writeFile(workbook, "reports/salon-site-audit-review.xlsx");
writeFileSync("reports/salon-site-audit-review.json", JSON.stringify({ counts, review }, null, 2));
console.log(counts);