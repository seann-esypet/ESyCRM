import assert from "node:assert/strict";
import test from "node:test";
import { isStrongApprovedOwnerCandidate, type OwnerNameResult } from "@shared/salonOwnerName";
import type { SalonEnrichmentRow } from "@shared/schema";
import {
  businessAndLocationMatch,
  configureSalonOwnerNameDependencies,
  estimateSalonOwnerNameSearch,
  extractSalonOwnerCandidates,
  extractSalonOwnerSummaryCandidates,
  isSalonOwnerNameEligible,
  lookupSalonOwnerName,
  salonOwnerNameLimits,
  stripHtml,
  validatePublicHttpUrl,
} from "./salonOwnerNames";
import type { SalonOwnerNameDependencies } from "./salonOwnerNames";

const identity = {
  businessName: "Curly Tails",
  address: "5651 Tourist Dr",
  address1: "5651 Tourist Dr",
  city: "North Richland Hills",
  state: "TX",
  zipCode: "76117",
  websiteUrl: "https://www.curlytailsgrooming.com/",
};
const source = {
  url: "https://www.curlytailsgrooming.com/about",
  excerpt: "Business/location verification: Curly Tails at 5651 Tourist Dr, North Richland Hills TX 76117.",
  kind: "website_about",
};

test("owner extraction recognizes full names and independently confirms explicit owner roles", () => {
  const text = "Eliud Jimenez Founder & Groomer. Curly Tails is at 5651 Tourist Dr, North Richland Hills, TX 76117.";
  assert.equal(businessAndLocationMatch(identity, text), true);
  const candidates = extractSalonOwnerCandidates(text, source, true, false, identity.businessName);
  const eliud = candidates.find(candidate => candidate.firstName === "Eliud");
  assert.ok(eliud);
  assert.equal(eliud.lastName, "Jimenez");
  assert.equal(eliud.roleConfirmed, true);
  assert.equal(eliud.businessMatched, true);
  assert.equal(eliud.confidence, "high");
  assert.equal(isStrongApprovedOwnerCandidate({
    status: "needs_review",
    candidates,
    selectedCandidateId: eliud.id,
    approvedAt: new Date().toISOString(),
    usePersonalName: true,
    providerCalls: 0,
    pagesFetched: 1,
  }), eliud);

  const ownerPagePhrase = "Curly Tails, 5651 Tourist Dr, North Richland Hills TX 76117. As a business owner, founder Eliud Jimenez is committed to building the salon.";
  const founder = extractSalonOwnerCandidates(ownerPagePhrase, source, true, false, identity.businessName)
    .find(candidate => candidate.firstName === "Eliud");
  assert.ok(founder);
  assert.equal(founder.lastName, "Jimenez");
  assert.equal(founder.roleConfirmed, true);

  const capitalizedRole = extractSalonOwnerCandidates(
    "Curly Tails, 5651 Tourist Dr, North Richland Hills TX 76117. Founder & Groomer Eliud Jimenez.",
    source,
    true,
    false,
    identity.businessName,
  ).find(candidate => candidate.firstName === "Eliud");
  assert.ok(capitalizedRole);
  assert.equal(capitalizedRole.lastName, "Jimenez");
  assert.equal(capitalizedRole.roleConfirmed, true);

  const internalInitial = extractSalonOwnerCandidates(
    "Owner: Jane Q. Smith. Curly Tails, 5651 Tourist Dr, North Richland Hills TX 76117.",
    source,
    true,
    false,
    identity.businessName,
  ).find(candidate => candidate.firstName === "Jane");
  assert.ok(internalInitial);
  assert.equal(internalInitial.lastName, "Q Smith");

  const sentenceBoundary = extractSalonOwnerCandidates(
    "Owner: Jane. Sarah Smith provides grooming at the salon.",
    source,
    true,
    true,
    identity.businessName,
  );
  assert.deepEqual(sentenceBoundary.map(candidate => [candidate.firstName, candidate.lastName]), [["Jane", null]]);
});

test("exact business and location checks reject unrelated locations and business names", () => {
  assert.equal(businessAndLocationMatch(identity, "Curly Tails, 100 Main St, Dallas TX 75201"), false);
  assert.equal(businessAndLocationMatch(identity, "Curly Tails, 100 Main St, North Richland Hills TX 76117"), false);
  assert.equal(businessAndLocationMatch(identity, "Curly Tail, 5651 Tourist Dr North Richland Hills TX 76117"), false);
  assert.equal(businessAndLocationMatch(identity, "Other Salon, 5651 Tourist Dr North Richland Hills TX 76117"), false);
  assert.equal(businessAndLocationMatch(identity, "Curly Tails Grooming, 5651 Tourist Dr North Richland Hills TX 76117"), false);
  assert.equal(businessAndLocationMatch(identity, "Curly Tails, 5651 Tourist Dr North Richland Hills TX 76118"), false);
  assert.equal(businessAndLocationMatch(identity, "Curly Tails, 5651 Tourist Dr Arlington TX 76117"), false);
  assert.equal(businessAndLocationMatch({ businessName: "Curly Tails" } as any, "Curly Tails owner Jane Smith"), false);
  assert.equal(
    businessAndLocationMatch(identity, "Curly Tails 5651 Tourist Dr NorthRichlandHillsTX76117"),
    true,
  );
});

test("historical, operator-only, staff, and review mentions do not confirm current ownership", () => {
  const examples = [
    "Curly Tails, 5651 Tourist Dr North Richland Hills TX 76117. Operated by Eliud Jimenez.",
    "Curly Tails, 5651 Tourist Dr North Richland Hills TX 76117. Eliud Jimenez was the owner.",
    "Curly Tails, 5651 Tourist Dr North Richland Hills TX 76117. Former owner: Eliud Jimenez.",
    "Curly Tails, 5651 Tourist Dr North Richland Hills TX 76117. Staff member Jane Smith says Eliud Jimenez is the owner.",
    "Curly Tails, 5651 Tourist Dr North Richland Hills TX 76117. Reviewer Jane Smith says Eliud Jimenez is the owner.",
    "Curly Tails, 5651 Tourist Dr North Richland Hills TX 76117.\nTestimonials\nEliud Jimenez is the owner of another salon.",
    "Curly Tails, 5651 Tourist Dr North Richland Hills TX 76117. Owner: Jane. Sarah Smith provides grooming.",
  ];
  for (const text of examples) {
    const candidates = extractSalonOwnerCandidates(text, source, true, false, identity.businessName);
    assert.ok(candidates.every(candidate => !candidate.roleConfirmed), text);
  }
});

test("distinct co-owners remain separate candidates and staff are never confirmed owners", () => {
  const pair = "Curly Tails, 5651 Tourist Dr North Richland Hills TX 76117. Jane Smith and Elizabeth Jones are co-owners.";
  const candidates = extractSalonOwnerCandidates(pair, source, true);
  assert.deepEqual(candidates.map(candidate => [candidate.firstName, candidate.lastName]), [
    ["Jane", "Smith"],
    ["Elizabeth", "Jones"],
  ]);
  assert.ok(candidates.every(candidate => candidate.roleConfirmed && candidate.role === "co-owner"));

  const staffText = "Curly Tails, 5651 Tourist Dr North Richland Hills TX 76117. Jane Smith is our groomer.";
  const staff = extractSalonOwnerCandidates(staffText, source, true);
  assert.equal(staff.length, 1);
  assert.equal(staff[0].roleConfirmed, false);
  assert.equal(staff[0].businessMatched, true);

  const firstOnly = extractSalonOwnerCandidates(
    "Curly Tails, 5651 Tourist Dr North Richland Hills TX 76117. Owner: Jacqueline Contact Us",
    source,
    true,
    true,
    identity.businessName,
  );
  assert.deepEqual(firstOnly.map(candidate => [candidate.firstName, candidate.lastName]), [["Jacqueline", null]]);
  assert.equal(firstOnly[0].roleConfirmed, true);
});

test("search summary names remain unresolved and company/title words are not emitted as people", () => {
  const nextdoor = extractSalonOwnerSummaryCandidates(
    "A Dog's Tail team mentions Jacqueline and Elizabeth as neighborhood favorites.",
    { url: "https://www.nextdoor.com/public/", excerpt: "", kind: "organic_summary" },
  );
  assert.deepEqual(nextdoor.map(candidate => candidate.firstName), ["Jacqueline", "Elizabeth"]);
  assert.ok(nextdoor.every(candidate => candidate.lastName === null && !candidate.roleConfirmed));

  const roleSummary = extractSalonOwnerSummaryCandidates(
    "A Dog's Tail says Jacqueline and Elizabeth are co-owners according to a neighbor.",
    { url: "https://www.nextdoor.com/public/", excerpt: "", kind: "organic_summary" },
  );
  assert.deepEqual(roleSummary.map(candidate => candidate.firstName), ["Jacqueline", "Elizabeth"]);
  assert.ok(roleSummary.every(candidate =>
    candidate.lastName === null && !candidate.roleConfirmed && !candidate.businessMatched,
  ));

  assert.deepEqual(
    extractSalonOwnerCandidates("Owner: The Curly Tails Grooming Salon", source, true),
    [],
  );
});

test("explicit fetched-page owner evidence is approvable", () => {
  const candidate = extractSalonOwnerCandidates(
    "Curly Tails, 5651 Tourist Dr North Richland Hills TX 76117. Owner: Eliud Jimenez.",
    source,
    true,
  )[0];
  const approved: OwnerNameResult = {
    status: "needs_review",
    candidates: [candidate],
    selectedCandidateId: candidate.id,
    approvedAt: "2026-01-01T00:00:00.000Z",
    usePersonalName: true,
    providerCalls: 1,
    pagesFetched: 2,
  };
  assert.equal(isStrongApprovedOwnerCandidate(approved), candidate);
});

test("owner lookup request and page ceilings stay bounded", () => {
  assert.equal(salonOwnerNameLimits.maxRowsPerRequest, 5);
  assert.equal(salonOwnerNameLimits.maxPagesPerRow, 4);
});

test("public page fetching rejects private, local, unsupported, and credential-bearing URLs", async () => {
  await assert.rejects(validatePublicHttpUrl("http://127.0.0.1/admin"), /public HTTP\(S\)|private/i);
  await assert.rejects(validatePublicHttpUrl("http://192.168.1.15/"), /public HTTP\(S\)|private/i);
  await assert.rejects(validatePublicHttpUrl("http://[::ffff:7f00:1]/"), /private|reserved/i);
  await assert.rejects(validatePublicHttpUrl("http://[::ffff:a9fe:a9fe]/"), /private|reserved/i);
  await assert.rejects(validatePublicHttpUrl("http://[::ffff:a00:1]/"), /private|reserved/i);
  await assert.rejects(validatePublicHttpUrl("http://[2001:db8::1]/"), /private|reserved/i);
  await assert.rejects(validatePublicHttpUrl("http://[fe80::1]/"), /private|reserved/i);
  await assert.rejects(validatePublicHttpUrl("http://localhost/"), /public HTTP\(S\)/i);
  await assert.rejects(validatePublicHttpUrl("http://0x7f000001/"), /private|reserved/i);
  await assert.rejects(validatePublicHttpUrl("ftp://example.com/file"), /public HTTP\(S\)/i);
  await assert.rejects(validatePublicHttpUrl("https://user:pass@example.com/"), /public HTTP\(S\)/i);
});

test("HTML text extraction retains paragraph boundaries and removes testimonial blocks", () => {
  assert.equal(
    stripHtml("<main><p>Owner: Jane</p><p>Contact Us</p><section class='testimonials'><p>Reviewer John says Jane owns a salon</p></section></main>"),
    "Owner: Jane\nContact Us",
  );
});

function orchestrationRow(overrides: Record<string, unknown> = {}): SalonEnrichmentRow {
  return {
    id: "salon-owner-test-row",
    userId: "salon-owner-test-user",
    ...identity,
    sourceData: { category: "Pet Grooming" },
    evidence: { ownerName: { status: "needs_review", selectedCandidateId: "old", approvedAt: "old", usePersonalName: true } },
    serpCallsUsed: 0,
    ...overrides,
  } as unknown as SalonEnrichmentRow;
}

function mockDependencies(
  row: SalonEnrichmentRow,
  options: {
    cached?: Array<{ title?: string; link?: string; snippet?: string }>;
    fetchPage?: SalonOwnerNameDependencies["fetchPage"];
    fetchProvider?: SalonOwnerNameDependencies["fetchProvider"];
    reserve?: string | null;
    usage?: unknown;
    complete?: boolean;
    completeFailures?: number;
  } = {},
) {
  const observed = {
    begin: 0,
    complete: 0,
    cacheReads: 0,
    reservations: 0,
    releases: 0,
    providerAttempts: 0,
    pageAttempts: 0,
    token: "",
    persisted: null as OwnerNameResult | null,
  };
  const current = { ...row };
  const usageStatus = (options.usage || {
    config: { maxSerpCallsPerHour: 5 },
    usage: { monthlyQuota: 100, usedCredits: 0, hardStopAt: 100 },
  }) as Awaited<ReturnType<SalonOwnerNameDependencies["getUsageStatus"]>>;
  const fakeStorage = {
    beginSalonOwnerNameLookup: async (_rowId: string, _userId: string, token: string) => {
      observed.begin++;
      observed.token = token;
      return current;
    },
    completeSalonOwnerNameLookup: async (_rowId: string, _userId: string, token: string, result: OwnerNameResult) => {
      observed.complete++;
      assert.equal(token, observed.token);
      observed.persisted = result;
      if (observed.complete <= (options.completeFailures || 0)) throw new Error("mock persistence failure");
      return options.complete ?? true;
    },
    getSalonEnrichmentRow: async () => current,
    getSerpCache: async () => {
      observed.cacheReads++;
      return options.cached ? { resultsJson: options.cached } : undefined;
    },
    reserveSerpCall: async () => {
      observed.reservations++;
      return options.reserve === undefined ? "mock-reservation" : options.reserve;
    },
    releaseSerpCall: async () => { observed.releases++; },
    createSerpCache: async () => ({}) as any,
    getSerpCallsInLastHour: async () => 0,
    revokeSalonOwnerName: async () => undefined,
  };
  const restore = configureSalonOwnerNameDependencies({
    storage: fakeStorage as unknown as SalonOwnerNameDependencies["storage"],
    getUsageStatus: async () => usageStatus,
    fetchPage: async url => {
      observed.pageAttempts++;
      if (options.fetchPage) return options.fetchPage(url);
      throw new Error("mock page fetch failed");
    },
    fetchProvider: async (...args) => {
      observed.providerAttempts++;
      if (options.fetchProvider) return options.fetchProvider(...args);
      throw new Error("mock provider timeout");
    },
  });
  return { observed, restore };
}

test("real lookup orchestration finds first-name-only owner on long official page and stops before paid search", async () => {
  const row = orchestrationRow();
  const deps = mockDependencies(row, {
    fetchPage: async url => ({
      url,
      html: `<main><p>Curly Tails, 5651 Tourist Dr, North Richland Hills, TX 76117.</p>${"Salon story. ".repeat(1800)}<p>Owner: Jacqueline</p></main>`,
    }),
  });
  try {
    const result = await lookupSalonOwnerName(row.id, row.userId, true);
    assert.ok(result);
    const jacqueline = result.candidates.find(candidate => candidate.firstName === "Jacqueline");
    assert.ok(jacqueline);
    assert.equal(jacqueline.lastName, null);
    assert.equal(jacqueline.roleConfirmed, true);
    assert.equal(result.selectedCandidateId, null);
    assert.equal(result.approvedAt, null);
    assert.equal(result.usePersonalName, false);
    assert.equal(result.providerCalls, 0);
    assert.equal(result.pagesFetched, 1);
    assert.equal(deps.observed.providerAttempts, 0);
    assert.equal(deps.observed.cacheReads, 0);
    assert.equal(deps.observed.begin, 1);
    assert.equal(deps.observed.complete, 1);
  } finally {
    deps.restore();
  }
});

test("matched homepage identity can pass to a same-domain about page without conflicting location", async () => {
  const row = orchestrationRow();
  const deps = mockDependencies(row, {
    fetchPage: async url => url.endsWith("/about")
      ? { url, html: "<main><p>Founder Eliud Jimenez created the shop.</p></main>" }
      : {
        url,
        html: `<main><p>Curly Tails, 5651 Tourist Dr, North Richland Hills, TX 76117.</p><a href="/about">About</a></main>`,
      },
  });
  try {
    const result = await lookupSalonOwnerName(row.id, row.userId, true);
    assert.ok(result);
    const eliud = result.candidates.find(candidate => candidate.firstName === "Eliud");
    assert.ok(eliud);
    assert.equal(eliud.lastName, "Jimenez");
    assert.equal(eliud.roleConfirmed, true);
    assert.equal(result.pagesFetched, 2);
    assert.equal(result.providerCalls, 0);
  } finally {
    deps.restore();
  }
});

test("cached search results are free, remain unconfirmed, and do not reserve or attempt provider calls", async () => {
  const row = orchestrationRow({ websiteUrl: null });
  const deps = mockDependencies(row, {
    cached: [{
      title: "A Dog's Tail team",
      link: "https://www.nextdoor.com/public/",
      snippet: "A Dog's Tail team mentions Jacqueline as a neighborhood favorite.",
    }],
  });
  try {
    const result = await lookupSalonOwnerName(row.id, row.userId, true);
    assert.equal(result?.providerCalls, 0);
    assert.equal(result?.candidates[0]?.firstName, "Jacqueline");
    assert.equal(result?.candidates[0]?.roleConfirmed, false);
    assert.equal(deps.observed.cacheReads, 1);
    assert.equal(deps.observed.reservations, 0);
    assert.equal(deps.observed.providerAttempts, 0);
  } finally {
    deps.restore();
  }
});

test("a social-provider homepage is never treated as a first-party owner page", async () => {
  const row = orchestrationRow({ websiteUrl: "https://www.facebook.com/curlytails" });
  const deps = mockDependencies(row);
  try {
    await lookupSalonOwnerName(row.id, row.userId, false);
    assert.equal(deps.observed.pageAttempts, 0);
    assert.equal(deps.observed.cacheReads, 1);
  } finally {
    deps.restore();
  }
});

test("pending and processing rows are not started for owner-name lookup", async () => {
  for (const status of ["pending", "processing"]) {
    const row = orchestrationRow({ status });
    const deps = mockDependencies(row);
    try {
      const result = await lookupSalonOwnerName(row.id, row.userId, true);
      assert.equal(result?.status, "excluded");
      assert.equal(deps.observed.begin, 0);
      assert.equal(deps.observed.pageAttempts, 0);
      assert.equal(deps.observed.cacheReads, 0);
      assert.equal(deps.observed.providerAttempts, 0);
    } finally {
      deps.restore();
    }
  }
});

test("explicit non-grooming categories are excluded before cache, usage, or network access", async () => {
  const row = orchestrationRow({ sourceData: { category: "Hair Salon" }, websiteUrl: "https://example.invalid" });
  const deps = mockDependencies(row);
  try {
    const estimate = await estimateSalonOwnerNameSearch([row]);
    assert.equal(estimate.allowed, false);
    assert.equal(estimate.maxProviderCalls, 0);
    assert.equal(deps.observed.cacheReads, 0);
    const result = await lookupSalonOwnerName(row.id, row.userId, true);
    assert.equal(result?.status, "excluded");
    assert.equal(result?.providerCalls, 0);
    assert.equal(deps.observed.pageAttempts, 0);
    assert.equal(deps.observed.reservations, 0);
    assert.equal(deps.observed.providerAttempts, 0);
  } finally {
    deps.restore();
  }
});

test("quota-zero lookup attempts no paid request and provider timeout is counted conservatively", async () => {
  const row = orchestrationRow({ websiteUrl: null });
  const oldKey = process.env.SERPAPI_API_KEY;
  process.env.SERPAPI_API_KEY = "test-only-key";
  try {
    const zeroQuota = mockDependencies(row, {
      usage: { config: { maxSerpCallsPerHour: 0 }, usage: { monthlyQuota: 0, usedCredits: 0, hardStopAt: 0 } },
    });
    try {
      const estimate = await estimateSalonOwnerNameSearch([row]);
      assert.equal(estimate.maxProviderCalls, 0);
      assert.equal(estimate.allowed, false);
      const noCalls = await lookupSalonOwnerName(row.id, row.userId, false);
      assert.equal(noCalls?.providerCalls, 0);
      assert.equal(zeroQuota.observed.reservations, 0);
      assert.equal(zeroQuota.observed.providerAttempts, 0);
    } finally {
      zeroQuota.restore();
    }

    const timeoutDeps = mockDependencies(row, {
      fetchProvider: async () => { throw new Error("mock network timeout"); },
    });
    try {
      const failed = await lookupSalonOwnerName(row.id, row.userId, true);
      assert.equal(failed?.status, "failed");
      assert.equal(failed?.providerCalls, 1);
      assert.equal(failed?.approvedAt, null);
      assert.equal(failed?.selectedCandidateId, null);
      assert.equal(timeoutDeps.observed.reservations, 1);
      assert.equal(timeoutDeps.observed.providerAttempts, 1);
      assert.equal(timeoutDeps.observed.releases, 0);
      assert.equal(timeoutDeps.observed.persisted?.providerCalls, 1);
    } finally {
      timeoutDeps.restore();
    }
  } finally {
    if (oldKey === undefined) delete process.env.SERPAPI_API_KEY;
    else process.env.SERPAPI_API_KEY = oldKey;
  }
});

test("provider calls remain counted when first persistence fails and retry succeeds", async () => {
  const row = orchestrationRow({ websiteUrl: null });
  const oldKey = process.env.SERPAPI_API_KEY;
  process.env.SERPAPI_API_KEY = "test-only-key";
  const deps = mockDependencies(row, {
    completeFailures: 1,
    fetchProvider: async () => new Response(JSON.stringify({ organic_results: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  });
  try {
    const result = await lookupSalonOwnerName(row.id, row.userId, true);
    assert.equal(result?.status, "failed");
    assert.equal(result?.providerCalls, 1);
    assert.match(result?.error || "", /Could not persist owner-name results/);
    assert.equal(deps.observed.providerAttempts, 1);
    assert.equal(deps.observed.reservations, 1);
    assert.equal(deps.observed.complete, 2);
    assert.equal(deps.observed.persisted?.providerCalls, 1);
  } finally {
    deps.restore();
    if (oldKey === undefined) delete process.env.SERPAPI_API_KEY;
    else process.env.SERPAPI_API_KEY = oldKey;
  }
});

test("owner lookup eligibility covers report workflow categories and rejects non-grooming", () => {
  assert.equal(isSalonOwnerNameEligible(orchestrationRow()), true);
  for (const category of [
    "verified_public_email",
    "review_only",
    "no_verified_email",
    "booking_only",
    "inaccessible",
    "Pet Grooming",
  ]) {
    assert.equal(
      isSalonOwnerNameEligible(orchestrationRow({ sourceData: { category } })),
      true,
      category,
    );
  }
  assert.equal(isSalonOwnerNameEligible(orchestrationRow({ sourceData: { category: "non_grooming" } })), false);
  assert.equal(isSalonOwnerNameEligible(orchestrationRow({ sourceData: { category: "excluded_non_grooming" } })), false);
  assert.equal(isSalonOwnerNameEligible(orchestrationRow({ sourceData: { category: "Pet Store" } })), false);
  assert.equal(isSalonOwnerNameEligible(orchestrationRow({ sourceData: { category: "Grooming Supply Store" } })), false);
});

test("category-less fixed-list uploads can run the opted-in owner stage after strong enrichment", async () => {
  const uploadedSourceData = {
    "Business Name": identity.businessName,
    "Street Address": identity.address,
    "Google Place ID": "upload-place-id",
    includeOwnerNames: true,
  };
  const row = orchestrationRow({
    sourceData: uploadedSourceData,
    status: "enriched",
    identityMatchStatus: "strong",
  });
  const { observed, restore } = mockDependencies(row, {
    fetchPage: async url => ({
      url,
      html: `<main>Curly Tails at 5651 Tourist Dr, North Richland Hills, TX 76117.
        <p>Owner: Jane.</p></main>`,
    }),
  });
  try {
    assert.equal(isSalonOwnerNameEligible(row), true);
    const result = await lookupSalonOwnerName(row.id, row.userId);
    assert.equal(result?.candidates[0]?.firstName, "Jane");
    assert.equal(result?.providerCalls, 0);
    assert.equal(observed.begin, 1);
    assert.equal(observed.complete, 1);
    assert.equal(isSalonOwnerNameEligible({ ...row, identityMatchStatus: "weak" }), false);
    assert.equal(isSalonOwnerNameEligible({
      ...row, sourceData: { ...uploadedSourceData, category: "non_grooming" },
    }), false);
  } finally {
    restore();
  }
});