---
name: Browser runtime availability
description: The workspace browser runtime and safe UI verification when live sign-in is inaccessible.
---

Check for a preinstalled Chromium executable before treating missing Playwright or Puppeteer packages as a blocker to browser testing.

**Why:** This workspace had no npm browser-testing package, but its preinstalled Chromium successfully ran controlled UI tests through the Chrome DevTools Protocol. The ordinary capture browser was instead blocked at Replit sign-in.

**How to apply:** Use an isolated browser profile and intercept every API request before navigating for fixture-based UI checks. Block unexpected mutations so tests cannot enroll real contacts or send emails. Keep production authentication unchanged. Fixture tests verify rendering and interactions, not live sign-in or the real authorization boundary; check server scoping separately and disclose that distinction.