import { test } from "node:test";
import assert from "node:assert/strict";
import type { SalonEnrichmentRow } from "@shared/schema";
import { canEnrollFormRow, htmlToFormText, nextFormDueAt, validFormUrl } from "./formOutreachPolicy";

const verified = {
  status: "enriched",
  identityMatchStatus: "strong",
  contactFormStatus: "verified",
  contactRequestFormUrl: "https://www.salon.example/contact",
  websiteUrl: "https://salon.example",
  email: null,
  importedContactId: null,
  duplicateMetadata: {},
} as SalonEnrichmentRow;

test("only reviewed form-only salons may enroll", () => {
  assert.equal(canEnrollFormRow(verified), true);
  for (const change of [
    { contactFormStatus: "candidate" }, { identityMatchStatus: "unmatched" },
    { status: "imported" }, { email: "contact@salon.example" },
    { importedContactId: "some-contact" }, { duplicateMetadata: { contactIds: ["some-contact"] } },
    { contactRequestFormUrl: "https://booking.example/contact" },
  ]) assert.equal(canEnrollFormRow({ ...verified, ...change }), false, JSON.stringify(change));
});

test("form URL must be on the salon site or its subdomain", () => {
  assert.equal(validFormUrl("https://www.salon.example/contact", "https://salon.example"), true);
  assert.equal(validFormUrl("javascript:alert(1)", "https://salon.example"), false);
  assert.equal(validFormUrl("https://salon.example.evil.com/contact", "https://salon.example"), false);
  assert.equal(validFormUrl("https://user:pass@salon.example/contact", "https://salon.example"), false);
});

test("the next step uses the selected template's delay from recorded submission", () => {
  const submitted = new Date("2026-09-27T14:30:00Z");
  assert.equal(nextFormDueAt(submitted, 3).toISOString(), "2026-09-30T14:30:00.000Z");
  assert.equal(nextFormDueAt(submitted, 0).toISOString(), submitted.toISOString());
  assert.throws(() => nextFormDueAt(submitted, null), /configured/);
});

test("HTML email templates become readable, copyable form text without losing links", () => {
  assert.equal(htmlToFormText("<p>Hi &amp; welcome<br>Visit <a href=\"https://example.com/?a=1&amp;b=2\">our page</a>.</p>"),
    "Hi & welcome\nVisit our page (https://example.com/?a=1&b=2).");
});