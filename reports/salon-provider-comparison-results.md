# Salon lookup provider comparison

**Status: FINAL — user closed at 81/120 paired rows; remaining rows untested**

Updated: 2026-10-04T01:37:04.446Z. Runner status: stopped_by_user.

## User-approved early closure

The user asked not to wait for another hourly batch and to finish with existing findings. The worker is stopped, and accidental restart is refused. **81 SerpApi rows are recorded; 39 remain unattempted**, not failed or presumed equivalent. The full fixed sample and all 120 saved DataForSEO rows are preserved. This is a final limited-sample report, **not a completed 120-versus-120 trial**. No application cap or spending authorization was increased.


## Scope and evidence

The original fixed sample has 120 distinct Place IDs, weighted CA 49 / TX 43 / NY 28, from 13,847 distinct input IDs. The user approved a $10 additional pilot ceiling and then requested SerpApi versus the existing DataForSEO results. Google is excluded from measured testing. No new DataForSEO requests are made.

This tests the existing application's Place-ID Maps lookup, cache, and production website crawler without CRM imports. It does not run owner-name enrichment or extra organic-search fallbacks. The same read-only website audit and production crawler are used on each provider's URLs. A shared normalized page receives a shared fetch and review, avoiding unequal repeated-page treatment. Branch paths remain separate. Page keys normalize http/https, www and trailing slash; equivalence of those aliases was not separately tested. Provider URLs have query strings removed, matching the saved DataForSEO workbook; routing-query loss is a limitation.

## Paired results

**81/120 identical rows** have a SerpApi result (including recorded failures). Unattempted rows are not counted as failures or no-website outcomes.

| Measurement | SerpApi paired rows | DataForSEO identical paired rows | DataForSEO all saved 120 |
|---|---:|---:|---:|
| rows | 81 | 81 | 120 |
| exactIdMatches | 80 | 81 | 120 |
| returnedUrls | 55 | 57 | 91 |
| sourceReviewed | 55 | 57 | 91 |
| websiteAuditRetrieved | 36 | 37 | 54 |
| websiteAuditFailed | 8 | 9 | 17 |
| websiteIdentityUnclear | 7 | 7 | 12 |
| groomingUnconfirmed | 9 | 9 | 11 |
| thirdPartyUrls | 8 | 8 | 18 |
| rejectedSitesOrNonGroomingControls | 4 | 6 | 9 |
| salonOwnedSiteVerified | 27 | 27 | 41 |
| verifiedEmailBusinesses | 13 | 13 | 17 |
| verifiedFormBusinesses | 6 | 6 | 8 |
| verifiedContactPathBusinesses | 13 | 13 | 19 |
| rejectedSelectedEmailBusinesses | 0 | 0 | 0 |
| rejectedMetadataEmailBusinesses | 2 | 2 | 2 |

Counts of verified contacts are **source-reviewed counts only**. Pending reviews are unknown, not zero-yield findings. An extracted email or a Name/Email/Message form alone is not verification. “Verified form” means a matching salon's general-inquiry interface, not tested submission or delivery. Email source attribution does not establish deliverability, permission to send, or a mailbox addressee.

Machine audit failure and manual identity review are separate measurements: an independently resolved first-party page can recover identity after a crawler failure. “Verified salon-owned site” includes mixed veterinary/boarding businesses with confirmed grooming services, not just standalone salons. Websites for unconfirmed-grooming businesses, broken domains and third-party directories are reported separately.

### By state, identical paired rows only

| State | Paired rows | SerpApi exact IDs | DataForSEO exact IDs | SerpApi verified emails | DataForSEO verified emails | SerpApi verified forms | DataForSEO verified forms |
|---|---:|---:|---:|---:|---:|---:|---:|
| CA | 27 | 27 | 27 | 5 | 5 | 3 | 3 |
| TX | 27 | 26 | 27 | 3 | 3 | 2 | 2 |
| NY | 27 | 27 | 27 | 5 | 5 | 1 | 1 |

State proportions vary because the runner interleaves states; the original full sample is CA 49 / TX 43 / NY 28. The early-closed subset is not the full weighted sample. Do not compare the 120-row saved-provider denominator with an incomplete SerpApi denominator as if they were matched contact-yield rates.

## Actual request and cost evidence

- SerpApi initiated-attempt ledger: **80**; local application-cache hits: **1**. Initiated attempts remain reserved in the pilot ledger even if later accounting, saving, or crawling fails.
- SerpApi account-wide usage counter: **2 → 82**, observed delta **80**, last checked 2026-10-04T01:37:04.410Z. Counters may lag and unrelated application traffic may contribute. A per-row zero immediate counter delta does **not** prove a nonbillable request. Account snapshots and individual attempts remain in the JSON evidence.
- The checked account has 250 monthly credits. No subscription purchase, upgrade, balance exhaustion, or deliberate renewal is performed. Included search credits are not a per-request cash charge; an invoice is not available here. Conservative pilot budget allocation is $2.00, **not an actual bill**.
- DataForSEO: **120 saved Standard Business Info tasks, $0.18 saved provider-reported task charges**. This session makes **0** new DataForSEO requests. The original raw invoice/task ledger is not in the saved workbook, so $0.18 is reported historical evidence, not independently re-audited billing.
- No new Google requests. Existing application caps stay at 200/month and 20/hour (or any stricter current setting). The runner stops on exhausted monthly allowance, insufficient provider balance, failed lookup/account verification, or the $10 allocation limit; it does not retry uncertain initiated requests.
- The remaining pilot is closed at the user's request. Final application ledger: 80 reserved credits, cap 200. One final non-search account check was made; no additional paid lookup was initiated.

## Projected lookup-only full-run range against $300

Prices checked October 3, 2026; scenarios cover one or two lookup tasks per each of 13,847 distinct IDs. These are request-count scenarios, not statistical estimates of contact yield.

| Provider | One request per distinct ID | Two requests per distinct ID | Against $300 |
|---|---:|---:|---|
| DataForSEO Standard Business Info, $0.0015/task | $20.77 | $41.54 | Below ceiling for task usage |
| SerpApi prospective one-month plan | $150 / 15,000 searches | $275 / 30,000 searches | Below ceiling only for lookup credits and only if higher application allowance is separately approved |

DataForSEO's advertised $50 minimum deposit may exceed task usage but is credit funding, not an additional $50 consumption charge; existing available credits are not confirmed here. Retries/repeated tasks can be chargeable. SerpApi plans are monthly subscriptions, not automatic per-request billing, and unused monthly searches generally do not roll over. Neither scenario purchases a plan or authorizes a cap change.

At the unchanged **200/month** application hard stop, an uncached SerpApi full run requires at least **70 monthly allowances** for one request/ID or **139** for two. A $150/$275 one-month quote is therefore **not executable under the present cap**. Multi-month paid subscriptions, organic fallbacks, identity repair, retries above two requests/ID, taxes, managed-search charges, hosting, and review labor can push total cost above these scenarios. The comparison does not prove that either provider can produce a verified email for every listing.

## Review time and uncertainty

Recorded timed source-recheck sessions: **959.0 elapsed seconds**; 91 Place IDs have recorded decisions. This is a partial timing measure, includes tool waits, and excludes earlier unrecorded exploration. Per-row active review labor was not individually measured and is not invented. Machine audit time summed over unique pages/sites: **6.2 minutes**, including network waits. These are separate; machine waits must not be represented as human labor. A shared website review is not billed twice when both providers return the same page. Historical 32-row review timing was not recorded and is not invented.

Saved DataForSEO data predates the SerpApi run; listing changes, domain changes, inaccessible pages, malformed/parked sites, chain contacts, non-grooming listings, page extraction failures, and stripped queries all affect comparability. All 91 currently returned business/site decisions have been recorded; inconclusive decisions remain inconclusive. No full-directory reliability or contact-yield claim is justified by the early-closed subset.

## Applicable terms and sources

- DataForSEO pricing: https://dataforseo.com/pricing/business-data/business-data-api — Standard Business Info $0.0015 per task; billing applies when setting a task.
- DataForSEO terms: https://dataforseo.com/terms-of-service — sections 7.1–7.2 address search-engine data use and user indemnity; section 8.2 excludes refunds for user-side repeat-task errors. Its service is not a blanket waiver of upstream rights.
- DataForSEO funding: https://dataforseo.com/apis/serp-api/pricing — advertised minimum deposit $50; verify account-specific funding before buying.
- SerpApi pricing: https://serpapi.com/pricing — Starter $25/1,000, Developer $75/5,000, Production $150/15,000, Big Data $275/30,000. The current checked account's 250-credit limit aligns with its advertised free allowance, but no invoice was inspected.
- SerpApi credit rules/legal shield: https://serpapi.com/faq — successful noncached searches count; cached/errored/failed searches do not. Empty successful results still count. Legal Shield concerns lawful collection, not downstream misuse, privacy obligations, or blanket outreach consent.
- Google was excluded by the user's revised scope; its websiteUri field triggers Place Details Enterprise pricing ($20/1,000, 1,000 monthly free events). No Google quality or billing result is claimed. Sources: https://developers.google.com/maps/billing-and-pricing/pricing and https://cloud.google.com/maps-platform/terms (3.2.3 export/caching/directory restrictions).

## Recommendation

**DataForSEO Standard is the preferred lookup-only budget option for a separately authorized next phase, not a universally proven reliability winner.** On the same 81 rows, SerpApi and DataForSEO yield respectively **13/13 source-confirmed email businesses**, **6/6 general-form businesses**, and **13/13 distinct businesses with either path**. Form counts overlap email counts and must not be added as separate leads. The observed matched source-reviewed outcomes are equal; this is not evidence of statistical equivalence.

DataForSEO's $20.77–$41.54 lookup-usage scenarios are below the $300 services ceiling. The current SerpApi account has included credits rather than an observed incremental invoice, so DataForSEO is **not claimed cheaper in actual pilot cash paid**. For an uncached large run, advertised SerpApi $150–$275 monthly-plan scenarios require separately approved higher application allowance and do not include owner/organic fallbacks or review labor. No full run, plan purchase or further pilot is authorized by this report.

Across all 120 saved DataForSEO rows, the independently reviewed findings are 17 email businesses and 8 form businesses, covering 19 distinct businesses. Those all-sample figures are not compared against the 81-row SerpApi subset as matched yields.

Evidence: salon-provider-comparison-progress.json; separate source-review decisions in salon-provider-comparison-review.json when recorded; spreadsheet salon-provider-comparison-results.xlsx. No leads are imported or used for outreach by this research.
