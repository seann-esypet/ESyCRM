---
name: Place detail website provenance
description: Empirical provider response quirk for salon contact enrichment
---

An exact Google Place ID match does not prove that the listing's website field is the salon's own website. A live lookup returned a hosted booking-service page as the website while returning a valid business phone. The public booking page had no email.

**Why:** Crawling a booking provider's generic contact pages as if they were the salon's site could attribute the provider's email or phone to the salon. The Place ID verifies listing identity, not website ownership. Some salon-specific booking pages may nevertheless publish the salon's own email.

**How to apply:** Classify booking URLs before crawling. Inspect only the exact salon-specific booking page for a visible email after matching its heading to the salon; exclude provider support domains and require human review before import for sequences. Do not crawl the provider's shared contact pages. Keep listing-sourced phone, salon-site email, and booking-page email evidence distinct. When expanding provider support, validate redirects and URL provenance, not just Place ID equality.