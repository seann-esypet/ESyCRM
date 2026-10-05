---
name: Provider spending accounting
description: Why confirmed paid-search budgets need an attempt ledger independent of persisted row results.
---

Track initiated provider attempts independently of saved or returned research results. Neither a failed lookup nor a missing/deleted row refunds an attempt that may already have been billed.

**Why:** A later cache, usage, or reservation error once reset a row's displayed usage after an earlier paid search. Deriving the remaining batch allowance from that result let a later row reuse spent credits and exceed the confirmed cap.

**How to apply:** Record each attempt immediately before invoking the provider. Use that independent count for the remaining batch budget, including timeouts and concurrent deletion. Preserve candidates already collected when later infrastructure fails. If an unexpected error makes continued processing unsafe, stop rather than giving later rows a fresh allowance. Test faults after a successful phrase, not only provider failures on the first request.

An immediate SerpApi account-counter delta of zero does not establish that a lookup was free or nonbillable.

**Why:** During a Place-ID comparison, successful responses initially left the account counter unchanged; later snapshots reflected usage. Account-wide counters can lag and may also include concurrent application traffic.

**How to apply:** Keep initiated attempts, returned/cached results, observed credit-counter changes, and cash charges separate. Reconcile account totals after the run and state attribution uncertainty instead of treating each immediate counter delta as a definitive per-row bill.

Per-list research allowances do not override shared provider guards. Temporary hourly throttling is distinct from a failed business lookup or exhaustion of the confirmed total.

**Why:** A live uploaded-list run stopped at a lower shared hourly guard before reaching its new per-list allowance. Treating that stop as a terminal row failure also prevented automatic hourly continuation.

**How to apply:** Check both budget layers when explaining or changing limits. Preserve every initiated paid attempt, wait for hourly allowance without inventing new budget, and do not mark a business fully researched merely because its next provider request was throttled.