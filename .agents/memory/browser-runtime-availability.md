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