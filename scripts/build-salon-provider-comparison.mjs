import { readFileSync, writeFileSync, existsSync } from "node:fs";
import XLSX from "xlsx";

const progressPath = "reports/salon-provider-comparison-progress.json";
const reviewPath = "reports/salon-provider-comparison-review.json";
const state = JSON.parse(readFileSync(progressPath, "utf8"));
const reviewFile = existsSync(reviewPath) ? JSON.parse(readFileSync(reviewPath, "utf8")) : {};
const reviews = reviewFile.reviews || [];
const reviewSessions = reviewFile.timedReviewSessions || [];
const byId = new Map(reviews.map(review => [review.placeId, review]));
const rows = Object.values(state.rows);
const paired = rows.filter(row => row.serpApi);
const allLookupsComplete = paired.length === 120 && state.status === "lookups_complete_review_pending";
const closedByUser = state.status === "stopped_by_user";
function reviewFor(row, provider) {
  const decision = byId.get(row.sample["Google Place ID"]);
  if (!decision) return null;
  // Review applies only to the particular provider-returned page, not merely a
  // domain. This avoids assigning one location's contact to another branch.
  const key = row[provider]?.siteKey;
  return decision.sites?.find(site => site.siteKey === key) ?? null;
}
function verifiedEmailFor(review) {
  if (review?.websiteIdentity !== "verified" || !review.verifiedEmail ||
    !review.emailSourceUrl?.startsWith("https://") ||
    review.rejectedEmails?.some(candidate =>
      candidate.email.toLowerCase() === review.verifiedEmail.toLowerCase())) return "";
  return review.verifiedEmail;
}
function verifiedFormFor(review) {
  return review?.websiteIdentity === "verified" ? review.verifiedGeneralFormUrl || "" : "";
}
function metrics(records, provider) {
  return {
    rows: records.length,
    exactIdMatches: records.filter(row => row[provider]?.exactPlaceId).length,
    returnedUrls: records.filter(row => row[provider]?.returnedWebsite).length,
    sourceReviewed: records.filter(row => reviewFor(row, provider)).length,
    websiteAuditRetrieved: records.filter(row => state.sites[row[provider]?.siteKey]?.evidence?.outcome === "pages_retrieved_review_required").length,
    websiteAuditFailed: records.filter(row => state.sites[row[provider]?.siteKey]?.evidence?.outcome === "crawl_failed").length,
    websiteIdentityUnclear: records.filter(row => reviewFor(row, provider)?.websiteIdentity === "unclear").length,
    groomingUnconfirmed: records.filter(row => reviewFor(row, provider)?.websiteIdentity === "grooming_unconfirmed").length,
    thirdPartyUrls: records.filter(row => reviewFor(row, provider)?.websiteIdentity?.startsWith("third_party_")).length,
    rejectedSitesOrNonGroomingControls: records.filter(row => reviewFor(row, provider)?.websiteIdentity === "rejected").length,
    salonOwnedSiteVerified: records.filter(row => reviewFor(row, provider)?.websiteIdentity === "verified").length,
    verifiedEmailBusinesses: records.filter(row => verifiedEmailFor(reviewFor(row, provider))).length,
    verifiedFormBusinesses: records.filter(row => verifiedFormFor(reviewFor(row, provider))).length,
    verifiedContactPathBusinesses: records.filter(row => {
      const review = reviewFor(row, provider);
      return verifiedEmailFor(review) || verifiedFormFor(review);
    }).length,
    rejectedSelectedEmailBusinesses: records.filter(row => {
      const site = state.sites[row[provider]?.siteKey];
      const selected = site?.production?.email?.toLowerCase();
      return selected && reviewFor(row, provider)?.rejectedEmails?.some(candidate => candidate.email.toLowerCase() === selected);
    }).length,
    rejectedMetadataEmailBusinesses: records.filter(row => {
      const site = state.sites[row[provider]?.siteKey];
      const selected = site?.production?.metadataEmail?.toLowerCase();
      return selected && reviewFor(row, provider)?.rejectedEmails?.some(candidate => candidate.email.toLowerCase() === selected);
    }).length,
  };
}
const serp = metrics(paired, "serpApi");
const dataPaired = metrics(paired, "dataForSeo");
const dataAll = metrics(rows, "dataForSeo");
const allReviewsComplete = allLookupsComplete && rows.every(row =>
  ["serpApi", "dataForSeo"].every(provider => !row[provider].returnedWebsite || reviewFor(row, provider)));
const firstAccount = state.accountSnapshots[0];
const lastAccount = state.accountSnapshots.at(-1);
const accountDelta = lastAccount.usedThisMonth - firstAccount.usedThisMonth;
const started = state.attempts.length;
const cacheHits = paired.filter(row => row.serpApi.fromCache).length;
const auditMs = Object.values(state.sites).reduce((sum, site) => sum + site.elapsedMs, 0);
const reviewSeconds = reviewSessions.reduce((sum, session) => sum + (session.elapsedSeconds || 0), 0);
const reviewTable = rows.flatMap(row => ["serpApi", "dataForSeo"].map(provider => {
  const result = row[provider];
  const site = state.sites[result?.siteKey];
  const review = reviewFor(row, provider);
  return {
    "Google Place ID": row.sample["Google Place ID"],
    "Source Excel row": row.sample["Source Excel row"],
    "Salon name": row.sample["Salon name"],
    State: row.sample.State,
    Provider: provider === "serpApi" ? "SerpApi" : "DataForSEO (saved)",
    "Lookup status": result?.status || result?.providerStatus || (closedByUser ? "Not attempted — pilot closed" : "pending"),
    "Exact Place ID match": result?.exactPlaceId === true ? "Yes" : result?.exactPlaceId === false ? "No" : closedByUser ? "Not tested" : "Pending",
    "Returned website URL": result?.returnedWebsite || "",
    "Final crawled website URL": site?.production?.resolvedWebsiteUrl || site?.evidence?.pages?.[0]?.url || "",
    "Cached application lookup": result?.fromCache === undefined ? "" : result.fromCache ? "Yes" : "No",
    "Initiated request (not invoice)": provider === "serpApi" ? Number(state.attempts.some(attempt => attempt.placeId === row.sample["Google Place ID"])) : 1,
    "Observed account credit delta (may lag)": provider === "serpApi" ? result?.observedAccountCreditDelta ?? "Unknown" : "",
    "Saved provider-reported task charge USD": provider === "dataForSeo" ? 0.0015 : "",
    "Production crawler email CANDIDATE": site?.production?.email || "",
    "Candidate source URL": site?.production?.emailSourceUrl || "",
    "Metadata-only candidate": site?.production?.metadataEmail || "",
    "Metadata source URL": site?.production?.metadataEmailSourceUrl || "",
    "Production rejected candidates": JSON.stringify(site?.production?.rejectedEmails || []),
    "Production form CANDIDATE": site?.production?.contactFormUrl || "",
    "Audit outcome": site?.evidence?.outcome || (result?.returnedWebsite ? "pending" : result ? "no URL" : closedByUser ? "Not assessed — no lookup" : "pending"),
    "Website identity review": review?.websiteIdentity || (!result && closedByUser ? "Not assessed — no lookup" : "Not yet reviewed"),
    "Verified general-contact email": verifiedEmailFor(review),
    "Verified email source URL": verifiedEmailFor(review) ? review.emailSourceUrl : "",
    "Verified general-contact form URL": verifiedFormFor(review),
    "Review-only email (not salon yield)": review?.reviewOnlyEmail || "",
    "Review-only source URL": review?.reviewOnlyEmailSourceUrl || "",
    "Reviewer rejected emails": JSON.stringify(review?.rejectedEmails || []),
    "Review notes": review?.notes || "",
    "Read-only audit elapsed seconds": site ? Number((site.elapsedMs / 1000).toFixed(1)) : "",
    "Shared review active seconds per Place ID": "Not measured individually; see Review timing",
    "Reviewed at": byId.get(row.sample["Google Place ID"])?.reviewedAt || "",
    "Fetch limitations": (site?.production?.partialFailures || []).join(" | "),
  };
}));
const metricRows = Object.keys(serp).map(metric => ({
  Metric: metric, SerpApi: serp[metric], "DataForSEO on identical paired rows": dataPaired[metric],
  "DataForSEO all saved sample rows": dataAll[metric],
}));
const stateMetricRows = ["CA", "TX", "NY"].flatMap(region => {
  const matchedRows = paired.filter(row => row.sample.State === region);
  const left = metrics(matchedRows, "serpApi");
  const right = metrics(matchedRows, "dataForSeo");
  return Object.keys(left).map(metric => ({
    State: region, Metric: metric, SerpApi: left[metric], "DataForSEO identical rows": right[metric],
  }));
});
const availableReviewsComplete = rows.every(row =>
  ["serpApi", "dataForSeo"].every(provider =>
    !row[provider]?.returnedWebsite || reviewFor(row, provider)));
if (closedByUser && !availableReviewsComplete) {
  throw new Error("User-closed comparison still has unreviewed returned websites");
}
const status = closedByUser
  ? `FINAL — user closed at ${paired.length}/120 paired rows; remaining rows untested`
  : allReviewsComplete ? "COMPLETE" : "IN PROGRESS — not a final reliability ranking";
const md = `# Salon lookup provider comparison

**Status: ${status}**

Updated: ${state.updatedAt}. Runner status: ${state.status}.

${closedByUser ? `## User-approved early closure

The user asked not to wait for another hourly batch and to finish with existing findings. The worker is stopped, and accidental restart is refused. **${paired.length} SerpApi rows are recorded; ${120 - paired.length} remain unattempted**, not failed or presumed equivalent. The full fixed sample and all 120 saved DataForSEO rows are preserved. This is a final limited-sample report, **not a completed 120-versus-120 trial**. No application cap or spending authorization was increased.
` : ""}

## Scope and evidence

The original fixed sample has 120 distinct Place IDs, weighted CA 49 / TX 43 / NY 28, from 13,847 distinct input IDs. The user approved a $10 additional pilot ceiling and then requested SerpApi versus the existing DataForSEO results. Google is excluded from measured testing. No new DataForSEO requests are made.

This tests the existing application's Place-ID Maps lookup, cache, and production website crawler without CRM imports. It does not run owner-name enrichment or extra organic-search fallbacks. The same read-only website audit and production crawler are used on each provider's URLs. A shared normalized page receives a shared fetch and review, avoiding unequal repeated-page treatment. Branch paths remain separate. Page keys normalize http/https, www and trailing slash; equivalence of those aliases was not separately tested. Provider URLs have query strings removed, matching the saved DataForSEO workbook; routing-query loss is a limitation.

## Paired results

**${paired.length}/120 identical rows** have a SerpApi result (including recorded failures). Unattempted rows are not counted as failures or no-website outcomes.

| Measurement | SerpApi paired rows | DataForSEO identical paired rows | DataForSEO all saved 120 |
|---|---:|---:|---:|
${Object.keys(serp).map(metric => `| ${metric} | ${serp[metric]} | ${dataPaired[metric]} | ${dataAll[metric]} |`).join("\n")}

Counts of verified contacts are **source-reviewed counts only**. Pending reviews are unknown, not zero-yield findings. An extracted email or a Name/Email/Message form alone is not verification. “Verified form” means a matching salon's general-inquiry interface, not tested submission or delivery. Email source attribution does not establish deliverability, permission to send, or a mailbox addressee.

Machine audit failure and manual identity review are separate measurements: an independently resolved first-party page can recover identity after a crawler failure. “Verified salon-owned site” includes mixed veterinary/boarding businesses with confirmed grooming services, not just standalone salons. Websites for unconfirmed-grooming businesses, broken domains and third-party directories are reported separately.

### By state, identical paired rows only

| State | Paired rows | SerpApi exact IDs | DataForSEO exact IDs | SerpApi verified emails | DataForSEO verified emails | SerpApi verified forms | DataForSEO verified forms |
|---|---:|---:|---:|---:|---:|---:|---:|
${["CA", "TX", "NY"].map(region => {
  const records = paired.filter(row => row.sample.State === region);
  const a = metrics(records, "serpApi"), b = metrics(records, "dataForSeo");
  return `| ${region} | ${records.length} | ${a.exactIdMatches} | ${b.exactIdMatches} | ${a.verifiedEmailBusinesses} | ${b.verifiedEmailBusinesses} | ${a.verifiedFormBusinesses} | ${b.verifiedFormBusinesses} |`;
}).join("\n")}

State proportions vary because the runner interleaves states; the original full sample is CA 49 / TX 43 / NY 28. The early-closed subset is not the full weighted sample. Do not compare the 120-row saved-provider denominator with an incomplete SerpApi denominator as if they were matched contact-yield rates.

## Actual request and cost evidence

- SerpApi initiated-attempt ledger: **${started}**; local application-cache hits: **${cacheHits}**. Initiated attempts remain reserved in the pilot ledger even if later accounting, saving, or crawling fails.
- SerpApi account-wide usage counter: **${firstAccount.usedThisMonth} → ${lastAccount.usedThisMonth}**, observed delta **${accountDelta}**, last checked ${lastAccount.checkedAt}. Counters may lag and unrelated application traffic may contribute. A per-row zero immediate counter delta does **not** prove a nonbillable request. Account snapshots and individual attempts remain in the JSON evidence.
- The checked account has ${firstAccount.monthlyLimit} monthly credits. No subscription purchase, upgrade, balance exhaustion, or deliberate renewal is performed. Included search credits are not a per-request cash charge; an invoice is not available here. Conservative pilot budget allocation is $${(started * 0.025).toFixed(2)}, **not an actual bill**.
- DataForSEO: **120 saved Standard Business Info tasks, $0.18 saved provider-reported task charges**. This session makes **0** new DataForSEO requests. The original raw invoice/task ledger is not in the saved workbook, so $0.18 is reported historical evidence, not independently re-audited billing.
- No new Google requests. Existing application caps stay at 200/month and 20/hour (or any stricter current setting). The runner stops on exhausted monthly allowance, insufficient provider balance, failed lookup/account verification, or the $10 allocation limit; it does not retry uncertain initiated requests.
${closedByUser ? `- The remaining pilot is closed at the user's request. Final application ledger: ${state.applicationFinalUsage ? `${state.applicationFinalUsage.used} reserved credits, cap ${state.applicationFinalUsage.cap}` : "not independently refreshed"}. ${state.finalAccountingNote || "One final non-search account check was made; no additional paid lookup was initiated."}` : ""}

## Projected lookup-only full-run range against $300

Prices checked October 3, 2026; scenarios cover one or two lookup tasks per each of 13,847 distinct IDs. These are request-count scenarios, not statistical estimates of contact yield.

| Provider | One request per distinct ID | Two requests per distinct ID | Against $300 |
|---|---:|---:|---|
| DataForSEO Standard Business Info, $0.0015/task | $20.77 | $41.54 | Below ceiling for task usage |
| SerpApi prospective one-month plan | $150 / 15,000 searches | $275 / 30,000 searches | Below ceiling only for lookup credits and only if higher application allowance is separately approved |

DataForSEO's advertised $50 minimum deposit may exceed task usage but is credit funding, not an additional $50 consumption charge; existing available credits are not confirmed here. Retries/repeated tasks can be chargeable. SerpApi plans are monthly subscriptions, not automatic per-request billing, and unused monthly searches generally do not roll over. Neither scenario purchases a plan or authorizes a cap change.

At the unchanged **200/month** application hard stop, an uncached SerpApi full run requires at least **70 monthly allowances** for one request/ID or **139** for two. A $150/$275 one-month quote is therefore **not executable under the present cap**. Multi-month paid subscriptions, organic fallbacks, identity repair, retries above two requests/ID, taxes, managed-search charges, hosting, and review labor can push total cost above these scenarios. The comparison does not prove that either provider can produce a verified email for every listing.

## Review time and uncertainty

Recorded timed source-recheck sessions: **${reviewSeconds.toFixed(1)} elapsed seconds**; ${reviews.length} Place IDs have recorded decisions. This is a partial timing measure, includes tool waits, and excludes earlier unrecorded exploration. Per-row active review labor was not individually measured and is not invented. Machine audit time summed over unique pages/sites: **${(auditMs / 60000).toFixed(1)} minutes**, including network waits. These are separate; machine waits must not be represented as human labor. A shared website review is not billed twice when both providers return the same page. Historical 32-row review timing was not recorded and is not invented.

Saved DataForSEO data predates the SerpApi run; listing changes, domain changes, inaccessible pages, malformed/parked sites, chain contacts, non-grooming listings, page extraction failures, and stripped queries all affect comparability. All ${reviews.length} currently returned business/site decisions have been recorded; inconclusive decisions remain inconclusive. No full-directory reliability or contact-yield claim is justified by the early-closed subset.

## Applicable terms and sources

- DataForSEO pricing: https://dataforseo.com/pricing/business-data/business-data-api — Standard Business Info $0.0015 per task; billing applies when setting a task.
- DataForSEO terms: https://dataforseo.com/terms-of-service — sections 7.1–7.2 address search-engine data use and user indemnity; section 8.2 excludes refunds for user-side repeat-task errors. Its service is not a blanket waiver of upstream rights.
- DataForSEO funding: https://dataforseo.com/apis/serp-api/pricing — advertised minimum deposit $50; verify account-specific funding before buying.
- SerpApi pricing: https://serpapi.com/pricing — Starter $25/1,000, Developer $75/5,000, Production $150/15,000, Big Data $275/30,000. The current checked account's 250-credit limit aligns with its advertised free allowance, but no invoice was inspected.
- SerpApi credit rules/legal shield: https://serpapi.com/faq — successful noncached searches count; cached/errored/failed searches do not. Empty successful results still count. Legal Shield concerns lawful collection, not downstream misuse, privacy obligations, or blanket outreach consent.
- Google was excluded by the user's revised scope; its websiteUri field triggers Place Details Enterprise pricing ($20/1,000, 1,000 monthly free events). No Google quality or billing result is claimed. Sources: https://developers.google.com/maps/billing-and-pricing/pricing and https://cloud.google.com/maps-platform/terms (3.2.3 export/caching/directory restrictions).

## Recommendation

${closedByUser ? `**DataForSEO Standard is the preferred lookup-only budget option for a separately authorized next phase, not a universally proven reliability winner.** On the same ${paired.length} rows, SerpApi and DataForSEO yield respectively **${serp.verifiedEmailBusinesses}/${dataPaired.verifiedEmailBusinesses} source-confirmed email businesses**, **${serp.verifiedFormBusinesses}/${dataPaired.verifiedFormBusinesses} general-form businesses**, and **${serp.verifiedContactPathBusinesses}/${dataPaired.verifiedContactPathBusinesses} distinct businesses with either path**. Form counts overlap email counts and must not be added as separate leads. The observed matched source-reviewed outcomes are ${serp.verifiedEmailBusinesses === dataPaired.verifiedEmailBusinesses && serp.verifiedFormBusinesses === dataPaired.verifiedFormBusinesses ? "equal" : "not identical"}; this is not evidence of statistical equivalence.

DataForSEO's $20.77–$41.54 lookup-usage scenarios are below the $300 services ceiling. The current SerpApi account has included credits rather than an observed incremental invoice, so DataForSEO is **not claimed cheaper in actual pilot cash paid**. For an uncached large run, advertised SerpApi $150–$275 monthly-plan scenarios require separately approved higher application allowance and do not include owner/organic fallbacks or review labor. No full run, plan purchase or further pilot is authorized by this report.

Across all 120 saved DataForSEO rows, the independently reviewed findings are ${dataAll.verifiedEmailBusinesses} email businesses and ${dataAll.verifiedFormBusinesses} form businesses, covering ${dataAll.verifiedContactPathBusinesses} distinct businesses. Those all-sample figures are not compared against the ${paired.length}-row SerpApi subset as matched yields.` : "**DataForSEO is the lower advertised-cost lookup option; reliability ranking is pending the matched-row run and source review.** Website-return rate alone cannot determine cost per usable salon contact."}

Evidence: salon-provider-comparison-progress.json; separate source-review decisions in salon-provider-comparison-review.json when recorded; spreadsheet salon-provider-comparison-results.xlsx. No leads are imported or used for outreach by this research.
`;
writeFileSync("reports/salon-provider-comparison-results.md", md);
const workbook = XLSX.utils.book_new();
for (const [name, data] of [
  ["Status and method", [{ Status: status, "Updated at": state.updatedAt, "Paired rows": paired.length,
    "Scope": "SerpApi versus saved DataForSEO; Google not tested", "Maximum additional pilot USD": 10,
    "No imports / sends / submissions": true, "Do not use unreviewed candidates": true }]],
  ["Provider metrics", metricRows],
  ["Paired state metrics", stateMetricRows],
  ["Row evidence", reviewTable],
  ["Attempt ledger", state.attempts],
  ["Account counts", state.accountSnapshots],
  ["Review timing", reviewSessions.length ? reviewSessions : [{ Status: "No timed review sessions yet" }]],
  ["Cost scenarios", [{ Provider: "DataForSEO Standard", "One task per ID USD": 20.7705,
    "Two tasks per ID USD": 41.541, "Caveat": "Usage only; $50 deposit may apply" },
  { Provider: "SerpApi prospective monthly plans", "One task per ID USD": 150,
    "Two tasks per ID USD": 275, "Caveat": "Not executable in one month at the unchanged 200-call application cap" }]],
]) {
  const sheet = XLSX.utils.json_to_sheet(data);
  sheet["!cols"] = Object.keys(data[0] || {}).map(key => ({ wch: Math.min(55, Math.max(16, key.length + 2)) }));
  XLSX.utils.book_append_sheet(workbook, sheet, name);
}
XLSX.writeFile(workbook, "reports/salon-provider-comparison-results.xlsx");
console.log(JSON.stringify({ status, paired: paired.length, attempts: started, reviewedPlaceIds: reviews.length }));