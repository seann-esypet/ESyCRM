import assert from "node:assert/strict";
import test from "node:test";
import type { Contact, User } from "@shared/schema";
import {
  EMPTY_OWNER_NAME_RESULT,
  salonOwnerNameForImport,
  type OwnerNameResult,
} from "@shared/salonOwnerName";
import { replaceTemplateVariables } from "./sendgrid";
import { stripLegacyOwnerHtml } from "./salonOwnerNames";
import { convertSalonSearchReportEntry, salonSearchReportBatchSchema } from "./salonSearchReport";
import salonPilot from "../reports/salon-next-100-summary.json" with { type: "json" };
import validation from "../reports/salon-owner-name-validation.json" with { type: "json" };

const salesperson = {
  id: "test-user", firstName: "Sales", lastName: "Person",
  email: "sales@example.test", workEmail: "work@example.test",
} as User;

const companyContact = {
  id: "test-contact", userId: salesperson.id, company: "Example Salon",
  city: "Example City", firstName: null, lastName: null, useBusinessNameForEmail: "Yes",
} as Contact;

function approvedOwner(usePersonalName: boolean): OwnerNameResult {
  return {
    ...EMPTY_OWNER_NAME_RESULT,
    status: "needs_review",
    candidates: [{
      id: "owner-jane", firstName: "Jane", lastName: null,
      role: "owner", roleConfirmed: true, businessMatched: true, confidence: "high",
      sources: [{
        kind: "website_about", url: "https://example.test/about",
        excerpt: "Example Salon at 12 Main Street. Owner: Jane.",
      }],
    }],
    selectedCandidateId: "owner-jane",
    approvedAt: "2026-09-30T00:00:00.000Z",
    usePersonalName,
  };
}

test("actual sequence renderer uses explicitly approved personal first name, with no invented surname", () => {
  const imported = salonOwnerNameForImport(approvedOwner(true));
  const contact = { ...companyContact, ...imported };
  assert.equal(imported.lastName, null);
  assert.equal(
    replaceTemplateVariables("Hi [Contact_First_Name], [Business_Name] in [City].", contact, salesperson),
    "Hi Jane, Example Salon in Example City.",
  );
});

test("approved contact names and business-name email preference stay independent", () => {
  const imported = salonOwnerNameForImport(approvedOwner(false));
  assert.equal(imported.firstName, "Jane");
  assert.equal(imported.lastName, null);
  assert.equal(imported.useBusinessNameForEmail, "Yes");
  assert.equal(
    replaceTemplateVariables("Hi [Contact_First_Name]", { ...companyContact, ...imported }, salesperson),
    "Hi Example Salon",
  );
});

test("unapproved team mentions never supply sequence first names", () => {
  const staged = approvedOwner(true);
  staged.candidates[0].roleConfirmed = false;
  staged.candidates[0].role = "team member";
  const imported = salonOwnerNameForImport(staged);
  assert.equal(imported.firstName, null);
  assert.equal(
    replaceTemplateVariables("Hi [Contact_First_Name]", { ...companyContact, ...imported }, salesperson),
    "Hi Example Salon",
  );
});

test("unknown names and explicit legacy business-name preferences retain the actual fallback", () => {
  assert.equal(replaceTemplateVariables("[Contact_First_Name]", {
    ...companyContact, useBusinessNameForEmail: "No",
  }, salesperson), "Example Salon");
  assert.equal(replaceTemplateVariables("[Contact_First_Name]", {
    ...companyContact, firstName: "Manual", lastName: "Name", useBusinessNameForEmail: "Yes",
  }, salesperson), "Example Salon");
  assert.equal(replaceTemplateVariables("[Contact_First_Name]", {
    ...companyContact, firstName: "Manual", lastName: "Name", useBusinessNameForEmail: "No",
  }, salesperson), "Manual");
});

test("the small public sample has no paid calls, no name approvals, and distinct unresolved team mentions", () => {
  assert.equal(validation.rows.length, 3);
  assert.equal(validation.budget.actualProviderCalls, 0);
  assert.equal(validation.budget.actualPublicPages, 6);
  for (const row of validation.rows) {
    assert.equal(row.ownerName.approvedAt, null);
    assert.equal(row.ownerName.selectedCandidateId, null);
    assert.equal(row.ownerName.usePersonalName, false);
  }
  const dogsTail = validation.rows.find(row => row.business === "A Dog's Tail")!;
  assert.deepEqual(dogsTail.ownerName.candidates.map(person => person.firstName), ["Jacqueline", "Elizabeth"]);
  assert.ok(dogsTail.ownerName.candidates.every(person => !person.roleConfirmed && person.lastName === null));
  const curlyTails = validation.rows.find(row => row.business === "Curly Tails Grooming")!;
  assert.equal(curlyTails.ownerName.candidates[0].lastName, "Jimenez");
  assert.equal(curlyTails.ownerName.candidates[0].roleConfirmed, true);
});

test("reviewed report extension preserves 100 distinct salons and independent email outcomes", () => {
  const parsed = salonSearchReportBatchSchema.parse({ name: "Owner evidence pilot", reviewed: salonPilot.reviewed });
  assert.equal(parsed.reviewed.length, 100);
  assert.equal(new Set(parsed.reviewed.map(row => row["Google Place ID"])).size, 100);
  for (const sample of validation.rows) {
    const report = parsed.reviewed.find(row => row["Google Place ID"] === sample.placeId)!;
    assert.ok(report.ownerName);
    const withOwner = convertSalonSearchReportEntry(report, 1);
    const withoutOwner = convertSalonSearchReportEntry({ ...report, ownerName: undefined }, 1);
    assert.equal(withOwner.email, withoutOwner.email);
    assert.equal(withOwner.status, withoutOwner.status);
    assert.equal(withOwner.reviewStatus, withoutOwner.reviewStatus);
    assert.equal(withOwner.identityMatchStatus, withoutOwner.identityMatchStatus);
  }
});

test("malformed uploaded name evidence cannot break review or supply executable source links", () => {
  const entry = salonSearchReportBatchSchema.parse({
    name: "Untrusted owner evidence",
    reviewed: [{
      ...salonPilot.reviewed[0],
      ownerName: {
        candidates: [null, {
          firstName: "Jane",
          lastName: { unsupported: true },
          roleConfirmed: true,
          businessMatched: true,
          sources: [
            null,
            { url: "javascript:alert(1)", excerpt: "Unsafe URL" },
            { url: "https://user:password@example.test/", excerpt: "Credentials are not evidence" },
            { url: "https://example.test/about", excerpt: "A public source", kind: "website_about" },
          ],
        }],
      },
    }],
  }).reviewed[0];
  const row = convertSalonSearchReportEntry(entry, 1);
  const staged = (row.evidence as { ownerName: OwnerNameResult }).ownerName;
  assert.equal(staged.candidates.length, 1);
  const candidate = staged.candidates[0];
  assert.equal(candidate.lastName, null);
  assert.equal(candidate.roleConfirmed, false);
  assert.equal(candidate.businessMatched, false);
  assert.equal(typeof candidate.id, "string");
  assert.equal(typeof candidate.role, "string");
  assert.deepEqual(candidate.sources, [{
    url: "https://example.test/about", excerpt: "A public source", kind: "uploaded_report_evidence",
  }]);
});

test("reusable legacy owner HTML helper preserves the existing Contacts text extraction", () => {
  const html = "<style>.hidden { display: none }</style><script>hidden()</script>" +
    "<h2>Owner: Jane</h2><p>Meet our team &amp; clients.</p>" +
    "<blockquote>Reviewer: Bob</blockquote>";
  const previous = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  assert.equal(stripLegacyOwnerHtml(html), previous);
  assert.equal(stripLegacyOwnerHtml(html), "Owner: Jane Meet our team &amp; clients. Reviewer: Bob");
});