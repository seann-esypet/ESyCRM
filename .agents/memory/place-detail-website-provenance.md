---
name: Place detail website provenance
description: Empirical provider response quirk for salon contact enrichment
---

An exact Google Place ID match does not prove that the listing's website field is the salon's own website. A live lookup returned a hosted booking-service page as the website while returning a valid business phone.

**Why:** Crawling a booking provider's page as if it were the salon's site could incorrectly attribute the provider's email or phone to the salon. The Place ID verifies listing identity, not website ownership.

**How to apply:** Classify provider-hosted booking URLs before crawling; retain them as booking evidence and keep listing-sourced phone evidence separate from website-sourced email evidence. When expanding provider support, validate redirects and URL provenance, not just Place ID equality.