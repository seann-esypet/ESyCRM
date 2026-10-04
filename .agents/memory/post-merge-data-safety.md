---
name: Post-merge data safety
description: Limits on automatic setup after task merges in this CRM.
---

Keep automatic post-merge setup limited to dependency reconciliation and application builds. Do not add blanket database schema pushes or run research/import/outreach scripts as setup.

**Why:** Merging code is not approval to change existing CRM data, spend provider credits, enroll contacts, or send outreach. A blanket schema push can introduce destructive changes without a scoped migration review.

**How to apply:** Schema-changing tasks must supply a reviewed, scoped migration strategy rather than silently adding `db:push --force` to the generic setup hook. Let Replit reconcile workflows after setup instead of launching duplicate servers.

For this app's managed database, adding a field to the Drizzle source does not itself add the database column. Apply reviewed changes to the actual development schema, then let Publish migrate production. Include a read-only application query in merge verification rather than relying on compilation and mocked fixtures alone.

**Why:** A merged lead workflow compiled and passed fixture tests while both databases still lacked a required progress column, preventing saved-list reads and search staging in the live CRM.

**How to apply:** Validate mapped lead-table columns without reading or changing records, inspect the development-to-production diff for destructive changes, and distinguish a development repair from a live fix that still requires Publish.