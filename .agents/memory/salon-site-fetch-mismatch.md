---
name: Salon site fetch mismatch
description: Distinguishing website crawl failures from confirmed absence of a public email
---

A salon website may load with a plain HTTPS request while rejecting the crawler's browser-like request. Some sites reject both browser-like and custom CRM user agents but accept a minimal curl-style request profile. A crawl failure therefore cannot be counted as "no email found on the site."

**Why:** A live email-yield pilot encountered this mismatch; subsequent read-only checks recovered public contact addresses by changing the request profile alone. Treating a rejected request as a negative email finding would understate yield and direct rule changes toward the wrong cause.

**How to apply:** Keep crawl failures in a separate "not fully assessed" category. When improving the crawler, try bounded protocol, www/canonical-host, trailing-slash, and minimal request-profile alternatives without expanding to unrelated domains, then verify that any extracted address is visibly attributable to the salon. Validate every DNS resolution and redirect; never disable HTTPS certificate validation to recover a page.