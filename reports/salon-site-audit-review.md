# DataForSEO website subset: read-only contact audit

## Scope and result

From the 91 URLs returned in the 120-Place-ID DataForSEO pilot, this review selected **32 distinct Place IDs**: CA 11, TX 11, NY 10. Selection was deterministic within deliberately chosen strata: 24 URLs initially labeled as site candidates, five chain/social/booking examples, and three unrelated-category controls. This is **not** a random sample of all directory businesses, so none of the counts below should be projected to the 91 URLs or the 13,847 distinct Place IDs.

| Outcome | Businesses |
|---|---:|
 Pages retrieved by bounded read-only crawl | 19 |
 Fetch failed or page too large; not fully assessed | 4 |
 Social, booking, or directory link skipped | 6 |
 Clearly unrelated-category control skipped | 3 |
 **Verified salon-attributable public email** | **7** |
 **Verified general-inquiry message form** | **3** |
 **Either verified path (distinct businesses)** | **8** |
 Brand-level contact kept review-only because source location was not confirmed | 1 |

The seven email businesses are Paw Commons **Hillcrest**, A Pet Villa, Head 2 Tails, As The Fur Flies, Love Thou Dog, E Z GROOMER, and Paws and Claws Pet Care. The three structurally verified general forms are The Pet Spaw, Paw Commons (with a Hillcrest location selector), and Love Thou Dog. Exact email-source and form URLs, source listing identity, excluded candidates, failed pages, and notes for **every selected Place ID** are in `salon-site-audit-review.xlsx`.

“Verified form” means the retrieved salon-matched page offered general-message fields and a submit control. **No form was submitted**, so successful backend delivery was not tested. A visible email was counted only after reviewing its surrounding business/location context; an exact Place ID or an apparently matching domain by itself was insufficient.

## Material exclusions and misses

- **Ali's Grooming:** the listed domain is for sale. Its Name/Email/Message form contacts the domain owner, not the salon.
- **Sancho and Lucky's:** a second text extraction exposed a tree-service email/phone and tree-service footer mixed into the dog-spa contact page. The matching-domain address also sits on this unreliable page; neither was counted. Its quote form said “Unable to find form.”
- **Paw Seasons:** the contact-page mailbox is presented as belonging to the co-located animal hospital; a separate training-page address is not a general salon mailbox.
- **Paws and Claws:** its public email is usable evidence, but its message-field form is specifically for new customers to receive a booking-system signup link, not a general inquiry.
- **E Z GROOMER:** `email@example.com` is a form placeholder, not a lead. The contact page's `Email Us` address is the counted one; an apparent Message interface without a verified HTML submission form was not counted as a form.
- **Fritzy's Pet Care Pros:** the company contact page contains a brand-owned customer-service mailbox and general form, but did not confirm the selected Pomona listing's location. Both remain review-only rather than in the confirmed counts.
- **Paw Commons Hillcrest:** the first HTML extractor missed the location-specific address; independent text-page review exposed it beside the exact Hillcrest street address. Other branches' mailboxes on the same page are not assigned to Hillcrest.
- **Other non-grooming and third-party URLs:** a shelter, feed retailer, grocery/supermarket, and restaurant must not become salon leads. Facebook links were **not crawled**; booking and directory pages were not searched for provider-wide contacts. Chain locations were viewed without treating corporate support as salon email.
- **Unassessed:** Little Paws returned 403, Pet City returned 404, Kenna's domain did not resolve, and Dallas Dog Daycare exceeded the 800 KB page-size limit. These are not “no email exists” results. Absolutely A Cut Above loaded only partially; linked-page fetch failed.

## Method and limits

Selection used SHA-256 of `salon-site-audit-v1:<Place ID>` within each state/type stratum, taking the first eligible IDs. The site audit attempted at most four same-domain HTML pages per listing using GET only, with a 10-second request timeout and 800 KB page-size cap. It recorded final page URLs, titles, extracted email/context, candidate form fields, and failures. A separate read-only text-page pass supported human review where HTML extraction missed evidence. The recorded script output is `salon-site-crawl-evidence.json`; the reviewed decisions are in `salon-site-audit-review.xlsx` and `salon-site-audit-review.json`.

There were **no new paid provider requests, contact imports, messages, form submissions, automated Facebook scraping, or full-list lookups**. This audit did not run the application's existing `crawlWebsite` function head-to-head, so it does not claim a measured production-crawler miss rate. The observed extraction miss and false-positive forms show why source-page evidence, site ownership, and form purpose must be reviewed before any scale-up.