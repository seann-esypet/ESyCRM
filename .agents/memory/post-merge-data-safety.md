---
name: Post-merge data safety
description: Limits on automatic setup after task merges in this CRM.
---

Keep automatic post-merge setup limited to dependency reconciliation and application builds. Do not add blanket database schema pushes or run research/import/outreach scripts as setup.

**Why:** Merging code is not approval to change existing CRM data, spend provider credits, enroll contacts, or send outreach. A blanket schema push can introduce destructive changes without a scoped migration review.

**How to apply:** Schema-changing tasks must supply a reviewed, scoped migration strategy rather than silently adding `db:push --force` to the generic setup hook. Let Replit reconcile workflows after setup instead of launching duplicate servers.