---
name: Provider spending accounting
description: Why confirmed paid-search budgets need an attempt ledger independent of persisted row results.
---

Track initiated provider attempts independently of saved or returned research results. Neither a failed lookup nor a missing/deleted row refunds an attempt that may already have been billed.

**Why:** A later cache, usage, or reservation error once reset a row's displayed usage after an earlier paid search. Deriving the remaining batch allowance from that result let a later row reuse spent credits and exceed the confirmed cap.

**How to apply:** Record each attempt immediately before invoking the provider. Use that independent count for the remaining batch budget, including timeouts and concurrent deletion. Preserve candidates already collected when later infrastructure fails. If an unexpected error makes continued processing unsafe, stop rather than giving later rows a fresh allowance. Test faults after a successful phrase, not only provider failures on the first request.