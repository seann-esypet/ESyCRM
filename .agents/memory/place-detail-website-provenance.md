---
name: Place detail website provenance
description: Empirical provider response quirk for salon contact enrichment
---

An exact Google Place ID match does not prove that the listing's website field is the salon's own website. A live lookup returned a hosted booking-service page as the website while returning a valid business phone. The public booking page had no email.

**Why:** Crawling a booking provider's generic contact pages as if they were the salon's site could attribute the provider's email or phone to the salon. The Place ID verifies listing identity, not website ownership. Some salon-specific booking pages may nevertheless publish the salon's own email.

**How to apply:** Classify booking URLs before crawling. Inspect only the exact salon-specific booking page for a visible email after matching its heading to the salon; exclude provider support domains and require human review before import for sequences. Do not crawl the provider's shared contact pages. Keep listing-sourced phone, salon-site email, and booking-page email evidence distinct. When expanding provider support, validate redirects and URL provenance, not just Place ID equality.

Google Sites can expose a salon's own email on its visible page while wrapping its booking-service link in an encoded Google redirect. Nearby booking text can also make an image asset look like a booking link to a loose crawler. Treat visible site email as site evidence, unwrap only a validated HTTPS booking destination, and reject image assets as booking links; the booking page may itself have no email.

Opening-hours restrictions are not mailbox-use restrictions.

**Why:** A public footer email was discarded because a separate opening-hours section said a weekday was “Appointment Only.” This described availability, not who could email the business.

**How to apply:** Evaluate purpose in the mailbox's own context. Do not inherit unrelated hours labels, but retain explicit booking-only, existing-client-only and vaccination-paperwork inbox restrictions.

Public hosted salon pages can be legitimate evidence, but a shared hostname is not a shared business identity.

**Why:** Blocking an entire platform domain skipped the salon's public pages before owner research; treating every page on that domain as the same site could attribute another tenant's contacts.

**How to apply:** Keep a per-business path boundary for shared hosted sites, including navigation and redirects. Do not follow generic platform contact pages or other tenants; retain public-network and evidence-matching safeguards.