---
name: Browser runtime availability
description: The workspace browser runtime and safe UI verification when live sign-in is inaccessible.
---

Check for a preinstalled Chromium executable before treating missing Playwright or Puppeteer packages as a blocker to browser testing.

**Why:** This workspace had no npm browser-testing package, but its preinstalled Chromium successfully ran controlled UI tests through the Chrome DevTools Protocol. The ordinary capture browser was instead blocked at Replit sign-in.

**How to apply:** Use an isolated browser profile and intercept every API request before navigating for fixture-based UI checks. Block unexpected mutations so tests cannot enroll real contacts or send emails. Keep production authentication unchanged. Fixture tests verify rendering and interactions, not live sign-in or the real authorization boundary; check server scoping separately and disclose that distinction.

For Chrome DevTools Protocol checks, evaluate DOM existence as a boolean instead of returning a DOM element by value. Use keyboard or pointer input for Radix tab changes rather than assuming a synthetic click changes the selected tab.

**Why:** React attaches cyclic state to DOM nodes, which can exceed CDP's object serialization depth. Radix tab activation may depend on input events that a programmatic click does not emit.

**How to apply:** Wrap wait conditions in `Boolean(...)`, and focus the tab before sending Enter (or dispatch the expected pointer event). These are test-harness requirements, not reasons to alter the application.

Workflow fixtures must represent lifecycle changes, not just return successful mutations: include a null contact before CRM linking, a refreshed actual-recipient preview after linking, and delayed research progress/completion.

**Why:** A success-only mocked walkthrough can conceal stale previews and incompatible progress response shapes even while all visible buttons appear to work.

**How to apply:** Wait for the completed confirmation controls rather than generic row-count text. Verify that asynchronous results appear without navigation and that missing or stale previews disable scheduling. Keep fixture verification distinct from real signed-in verification.

Navigation checks from a dialog must verify the final keyboard-focus destination after asynchronous results render, not just that the dialog disappeared or the URL changed.

**Why:** A research-results action navigated successfully, but changing the filter temporarily removed the destination. The initial focus-restoration check therefore missed a real keyboard-accessibility failure.

**How to apply:** Test both cached and newly fetched destinations, and wait for focus to reach the intended results control. Also assert that ordinary dismissal restores focus to a usable status control.

Browser fixtures must reproduce complete HTTP response contracts, not just the output of lower-level policy helpers.

**Why:** An otherwise successful Leads browser walkthrough omitted owner review entirely because its fixture lacked metadata added by the real HTTP response. Passing contact-creation checks did not establish that owner review had rendered or refreshed.

**How to apply:** Match the actual endpoint envelope and assert the relevant review panel and its refreshed results are present. Missing fixture fields must not silently turn a feature test into a test of an unrelated path.

Responsive fixture checks must confirm the page is unobstructed, not merely that the underlying elements have the expected dimensions.

**Why:** Pipeline mobile checks passed while Email History remained open; the captured image exposed that the badges were behind a modal overlay. Element existence and layout measurements alone did not establish that a salesperson could see the status.

**How to apply:** Assert that transient dialogs have actually closed before responsive checks and inspect at least one captured fixture image of the changed content. Keep that fixture evidence separate from verification of the real signed-in screen.

Authorization checks need endpoint tests with authentication-shaped principals, not only intercepted browser responses or role strings supplied directly to a service.

**Why:** Both browser and service tests accepted a budget update, but a real administrator was rejected because the request handler searched identity-provider claims for the CRM role. Browser fixtures never exercised the backend guard, and service tests skipped the role extraction.

**How to apply:** Match the existing authentication middleware's principal shape: the refreshed CRM role is separate from identity-provider claims. Exercise the registered route with an administrator whose identity claims have no CRM role, and verify that conflicting claims cannot grant a salesperson administrative access. Do not move CRM permissions into provider claims to accommodate a mistaken handler.