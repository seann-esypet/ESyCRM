---
name: Salon email-first evaluation
description: Product priority and safe evaluation criteria for salon contact enrichment
---

The primary outcome of salon enrichment is an email attributable to the salon that can be reviewed for sequence use. A phone number or booking link alone is not equivalent success; booking information is useful but secondary.

**Why:** The user explicitly prioritized email outreach. Optimizing for booking-link coverage can consume provider credits without producing contacts who can be emailed, while loosely attributed emails create false positives.

**How to apply:** Measure verified-by-review email yield and false attribution, not merely sites or booking links found. Improve rules from small, manually checked samples before scaling. Budget live pilots by provider calls rather than row count: a row without an email may need a second search, subject to hourly and monthly stops. Never auto-import, enroll, or send during a rules pilot.

An email extracted from a salon-associated page is not necessarily a usable salon contact: site-builder support addresses and mailboxes explicitly designated for client paperwork should not count as general outreach leads. Indexed snippets that are not confirmed on a current matching page remain review-only.

**Why:** A capped pilot surfaced both a website builder's support address and a salon-hosted client form's vaccination-record mailbox. Counting either as a verified general contact would overstate email yield.

**How to apply:** Read the email's immediate context and confirm the live source identifies the same salon/location. Put vendor and purpose-restricted addresses in review evidence, not the workbook's main email field or verified-yield numerator.

An exact Place ID match confirms the lookup returned the intended listing, not that the listing is a grooming salon. Treat provider business categories as screening evidence rather than proof of eligibility.

**Why:** A state-balanced lookup pilot returned exact Place ID matches for every tested row, but several listings were plainly unrelated businesses, including a restaurant and general retail stores. A returned website could also be a booking or ordering page.

**How to apply:** Flag clearly unrelated categories for review before outreach, check ambiguous pet-business categories for an actual grooming service, and independently classify any website or contact link before counting it as a usable contact path.

A matching-domain email or a page with Name/Email/Message fields can still be a false positive when a site has been repurposed, contains unrelated template content, or the domain is parked for sale. Conversely, a location-specific mailbox may be present in rendered page text but absent from a basic HTML regex extraction.

**Why:** In a read-only website subset review, a dog-spa contact page included a tree-service footer and unrelated address, a parked domain offered a form for contacting its owner, and a multi-location pet-care contact page exposed the correct branch email only in an alternate text extraction.

**How to apply:** Review the *surrounding page identity and purpose*, not just domain equality or field names. Exclude parked or mixed-identity pages, match branch email to the exact location when possible, and keep extraction misses separate from confirmed absence of contact information.

For a source-reviewed salon contact, approval and email attribution must still be valid when a scheduled sequence actually sends, not only when the contact is imported or enrolled.

**Why:** CRM contact emails and review decisions can change after a send is queued. Otherwise a queued message or later follow-up can go to an address that was never verified for that salon.

**How to apply:** Before each scheduled send, compare the contact's current address with the approved source-backed address and block delivery when attribution or approval has changed. Keep this check on chained follow-ups as well as the first message.