---
name: Published salon research workflow
description: The user's requirement to avoid repeated uploads and review incremental findings in the published app
---

The user does not want to keep uploading lists. The original salon directory should be accessible in the published app, with hourly research progress and newly verified findings available for review.

**Why:** The user explicitly wants to review good leads every hour, import approved contacts, and then add them to the pipeline.

**How to apply:** Keep unverified directory listings separate from approved contacts. Synchronize research evidence and progress without approving, importing, enrolling, or sending automatically. Show the authorized pilot separately from the full directory; visibility of the full directory is not authorization to research all of it.

Before directing the user to a new control in the published CRM, verify the published build includes that control. Features in an isolated project-task workspace must be completed and applied to the main version before republishing can expose them.

**Why:** The user repeatedly could not find the saved-directory control because the live build lacked it; republishing instructions given before the task was applied were premature.

**How to apply:** Distinguish task preview, main workspace, and published build. Confirm deployment assets/routes rather than assuming task code is live, and do not ask the user to upload the original directory as a workaround.

Closing a research pilot at the user's request is not permission to bypass its limits. Preserve untested rows as unknown and make the stopped state explicit.

**Why:** The user asked to stop waiting for further hourly batches and prioritize the unified lead workflow.

**How to apply:** Do not resume closed pilot lookups or increase limits without new authorization; later lead-workflow work should reuse saved evidence rather than wait for another comparison batch.