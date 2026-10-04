# Live salon research in Sales Lead Review

## What this adds

- One stored directory containing 13,847 distinct Place IDs from 13,928 original spreadsheet rows.
- A separately labeled 120-row provider-comparison pilot.
- Source-confirmed email findings, source links, reviewed general-contact forms, and unresolved listings.
- Research-status polling every 30 seconds; polling never makes a paid lookup.
- Existing manual approval, approved-contact import, and pipeline actions.

Research synchronization does not approve, import, enroll, send, submit forms, or start additional lookups. It preserves existing approvals, rejections, and imported records. Older snapshots are refused. Unchanged findings are not rewritten.

## One-time production setup — requires approval

1. Publish the tested application update. Publishing must include the additive `research_progress` column on `salon_enrichment_batches`. Do not copy the development database over production or run ad hoc production DDL.
2. Sign in as an administrator, open **Sales Lead Review**, and click **Load saved directory once**. This stores review records, not CRM contacts. Repeating the action returns the existing directory instead of duplicating it. The action works while synchronization is disconnected; the live bridge needs the directory to exist first.
3. After approval to synchronize research into production, set the non-secret **shared** environment variable `SALON_RESEARCH_SYNC_URL` to the current, verified publishing URL, with no path or query. Obtain the URL from publishing metadata; do not guess it from the development domain.
4. Restart the development application workflow so its research-only synchronization process reads that setting.
5. Confirm the published panel shows a received synchronization timestamp and a connected source. If it remains disconnected, inspect the source workflow and confirm the existing shared `SESSION_SECRET` configuration is usable by both environments. Never put credentials in chat.

The authenticated service bridge uses a domain-separated signature derived from the existing session secret. Raw secrets and session cookies are not transferred. Its endpoint accepts only the fixed pilot's IDs and cannot create CRM contacts or approve/send outreach.

## Runtime limits

The comparison worker was stopped at the user's request and is finalized on 81/120 recorded rows. The remaining 39 rows are untested; restarting the closed pilot is refused without new authorization. The application sync process may still deliver the saved findings and closed status. This is **not** a new always-on production research scheduler.

Generic batch start, resume, row retry, staged verification and paid owner-name lookup cannot execute this directory. Worker-level checks enforce the same restriction. Future research requires a separately approved execution path, not increasing this batch's pilot limit. Closing a worker persists an independent stop marker, interrupts allowance waits, checks again immediately before a provider request, and waits for in-flight results to be saved before final accounting. A stale worker cannot erase closure.

The current pilot keeps the $10 additional-spend ceiling, 200-call monthly application cap, and existing hourly allowance. The remaining 13,727 directory listings are browse-only, not authorized for additional research.

Disconnected or stale states are shown explicitly. Next-hour times are estimates based on this pilot's attempt ledger; other application searches may delay the next allowance. Initial published snapshots are labeled as snapshots until live synchronization has actually arrived.

The signed-in page could not be visually verified by the screenshot browser because the existing login redirects were blocked. Production build and isolated API/database fixture tests passed; CRM authentication was not bypassed.