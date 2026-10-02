import test from "node:test";
import assert from "node:assert/strict";
import { cumulativeStagedSalonSerpCallsUsed, isRetryableStagedSalonRow, parseSalonListRow, stageSalonListRows } from "./salonListStaging";
import { canApproveSalonReportRow, promoteVerifiedStagedReportEmail } from "./salonSearchReport";
import type { LeadDiscoveryResult, SalonEnrichmentRow } from "@shared/schema";

test("CRM and exported spreadsheet headers map to review-only candidates", () => {
  const parsed = parseSalonListRow({
    id: "untrusted-record-id",
    userId: "attacker",
    company: "Paws & Polish",
    email: "owner@example.test",
    phone: "(617) 555-0100",
    firstName: "Jamie",
    lastName: "Smith",
    "Website URL": "https://paws.example.test",
    "Google Place ID": "place-123",
    source: "forged verified source",
  });
  assert.equal(parsed?.businessName, "Paws & Polish");
  assert.equal(parsed?.emailCandidate, "owner@example.test");
  assert.equal(parsed?.websiteUrl, "https://paws.example.test/");
  assert.equal(parsed?.placeId, "place-123");
  assert.equal(parsed?.uploadedFields.source, "forged verified source");
  assert.equal(parseSalonListRow({
    "Business Name": "North Star Grooming", State: "MA", Address: "1 Main St",
    Email: "list@example.test", Phone: "6175550101", "Owner First Name": "Ari",
    "Owner Last Name": "Lee", "ZIP Code": "02110",
  })?.state, "MA");
});

test("staging preserves unverified evidence, ignores uploaded ownership and never promotes email or names", () => {
  const result = stageSalonListRows([{
    id: "must-not-be-used",
    userId: "someone-else",
    includeOwnerNames: true,
    company: "Paws & Polish",
    email: "lead@example.test",
    firstName: "Jamie",
    lastName: "Smith",
  }], "authenticated-user", "pending", []);
  assert.equal(result.stagedCount, 1);
  const row = result.rows[0];
  assert.equal(row.userId, "authenticated-user");
  assert.equal(row.email, null);
  assert.equal(row.status, "enriched");
  assert.equal(row.reviewStatus, "needs_review");
  assert.equal(row.identityMatchStatus, "unmatched");
  assert.equal(row.placeId, null);
  const sourceData = row.sourceData as Record<string, unknown>;
  assert.equal(sourceData.category, "review_only");
  assert.equal(sourceData.uploadedEmailCandidate, "lead@example.test");
  assert.equal(sourceData.uploadedFirstNameSuggestion, "Jamie");
  assert.equal("ownerName" in row.evidence, false);
  assert.equal("userId" in row.evidence, false);
  assert.equal("id" in sourceData, false);
  assert.equal("includeOwnerNames" in sourceData, false);
});

test("deduplicates conservatively by supplied Place ID or exact normalized business plus phone", () => {
  const existing = [{
    businessName: "The Paw Spa",
    phone: "617-555-0111",
    placeId: null,
  }] as Pick<SalonEnrichmentRow, "businessName" | "phone" | "placeId">[];
  const result = stageSalonListRows([
    { "Business Name": "THE PAW SPA!", Phone: "+1 617 555 0111", Email: "one@example.test" },
    { company: "Fresh Fur", phone: "6175550112", "Google Place ID": "place-x" },
    { company: "Fresh Fur", phone: "(617) 555-0112", "Google Place ID": "place-x" },
    { company: "Fresh Fur", phone: "6175550113" },
    { company: "Fresh Fur", phone: "6175550113" },
  ], "user-1", "batch-1", existing);
  assert.equal(result.inputCount, 5);
  assert.equal(result.duplicateCount, 3);
  assert.equal(result.stagedCount, 2);
  assert.deepEqual(result.rows.map(row => row.rowNumber), [2, 4]);
  assert.equal(result.rows[1].placeId, null);
});

test("nationwide recovery requires one exact business-and-phone match; no email-domain website inference", () => {
  const matches = [{
    company: "Blue Dog Grooming",
    phone: "6175550123",
    address: "3 Oak Road, Boston, MA 02110",
    websiteUrl: "https://bluedog.example.test",
    zipCode: "02110",
  }] as LeadDiscoveryResult[];
  const recovered = stageSalonListRows([{
    company: "Blue Dog Grooming",
    phone: "(617) 555-0123",
    email: "info@bluedog.example.test",
  }], "user-1", "pending", [], matches).rows[0];
  assert.equal(recovered.address, "3 Oak Road, Boston, MA 02110");
  assert.equal(recovered.state, "MA");
  assert.equal(recovered.websiteUrl, "https://bluedog.example.test/");
  assert.equal(recovered.email, null);

  const ambiguous = stageSalonListRows([{
    company: "Blue Dog Grooming",
    phone: "6175550123",
  }], "user-1", "pending", [], [...matches, { ...matches[0] } as LeadDiscoveryResult]).rows[0];
  assert.equal(ambiguous.address, null);
  assert.equal(ambiguous.websiteUrl, null);

  const noSiteCandidate = stageSalonListRows([{
    company: "Blue Dog Grooming",
    email: "info@bluedog.example.test",
  }], "user-1", "pending", []).rows[0];
  assert.equal(noSiteCandidate.websiteUrl, null);
});

test("booking and social URLs are not staged as business websites", () => {
  const social = parseSalonListRow({ company: "Paws", "Website URL": "https://www.instagram.com/paws" });
  const booking = parseSalonListRow({ company: "Paws", "Web Site Address": "https://booksy.com/paws" });
  assert.equal(social?.websiteUrl, null);
  assert.equal(booking?.websiteUrl, null);
  assert.equal(booking?.uploadedFields["Web Site Address"], undefined);
});

test("raw upload cannot be approved; visibly sourced strong-identity enrichment becomes review-eligible", () => {
  const staged = stageSalonListRows([{
    company: "Paws & Polish",
    email: "uploaded@example.test",
  }], "user-1", "batch-1", []).rows[0];
  assert.equal(canApproveSalonReportRow(staged), false);

  const websiteUrl = "https://paws.example.test/";
  const enrichment = {
    status: "enriched",
    identityMatchStatus: "strong",
    email: "public@paws.example.test",
    websiteUrl,
    bookingUrl: null,
    evidence: {
      identity: { value: "Paws & Polish", source: "serp_google_maps", confidence: "high" },
      email: {
        value: "public@paws.example.test",
        source: "website",
        sourceType: "visible",
        confidence: "high",
        sourceUrl: websiteUrl,
      },
    },
  } as const;
  const promotion = promoteVerifiedStagedReportEmail(staged, enrichment);
  assert.ok(promotion);
  const verified = { ...staged, ...enrichment, ...promotion };
  assert.equal(verified.email, "public@paws.example.test");
  assert.equal((verified.sourceData as Record<string, unknown>).uploadedEmailCandidate, "uploaded@example.test");
  assert.equal((verified.sourceData as Record<string, unknown>).category, "verified_public_email");
  assert.equal((verified.sourceData as Record<string, unknown>).Outcome, "verified_first_party_email");
  assert.equal((verified.evidence as any).email.purpose, "general");
  assert.equal(canApproveSalonReportRow(verified), true);

  const metadataOnly = promoteVerifiedStagedReportEmail(staged, {
    ...enrichment,
    evidence: {
      ...enrichment.evidence,
      email: { ...enrichment.evidence.email, source: "website_metadata", sourceType: "metadata" },
    },
  });
  assert.equal(metadataOnly, null);
  const noSource = promoteVerifiedStagedReportEmail(staged, {
    ...enrichment,
    email: "uploaded@example.test",
    evidence: {},
  });
  assert.equal(noSource, null);

  const retryableStaged = {
    ...staged,
    sourceData: { ...(staged.sourceData as Record<string, unknown>), stagingState: "verification_attempted" },
  };
  const cloudflareVisible = promoteVerifiedStagedReportEmail(retryableStaged, {
    ...enrichment,
    evidence: {
      ...enrichment.evidence,
      email: { ...enrichment.evidence.email, sourceType: "cloudflare" },
    },
  });
  assert.ok(cloudflareVisible);
});

test("explicit retry eligibility includes failed and unverified rows but protects reviewed/imported/verified rows", () => {
  const raw = stageSalonListRows([{
    company: "Paws & Polish", email: "uploaded@example.test",
  }], "user-1", "batch-1", []).rows[0];
  assert.equal(isRetryableStagedSalonRow(raw), true);
  assert.equal(isRetryableStagedSalonRow({
    ...raw,
    status: "failed",
    sourceData: { ...(raw.sourceData as Record<string, unknown>), stagingState: "verification_attempted" },
  } as any), true);
  assert.equal(isRetryableStagedSalonRow({
    ...raw,
    status: "pending",
    sourceData: { ...(raw.sourceData as Record<string, unknown>), stagingState: "verification_attempted" },
  } as any), true);
  assert.equal(isRetryableStagedSalonRow({
    ...raw,
    email: "verified@paws.example.test",
    sourceData: { ...(raw.sourceData as Record<string, unknown>), stagingState: "verified_by_enrichment" },
  } as any), false);
  assert.equal(isRetryableStagedSalonRow({ ...raw, reviewStatus: "approved" } as any), false);
  assert.equal(isRetryableStagedSalonRow({ ...raw, importedContactId: "contact-owned" } as any), false);
});

test("staged verification retries add new paid search lookups without changing legacy accounting", () => {
  assert.equal(cumulativeStagedSalonSerpCallsUsed({ stagingState: "staged_unverified" }, 2, 1), 3);
  assert.equal(cumulativeStagedSalonSerpCallsUsed({ stagingState: "verification_attempted" }, 2, 2), 4);
  assert.equal(cumulativeStagedSalonSerpCallsUsed({ stagingState: "verified_by_enrichment" }, 2, 1), 1);
  assert.equal(cumulativeStagedSalonSerpCallsUsed({ source: "legacy-upload" }, 2, 1), 1);
});