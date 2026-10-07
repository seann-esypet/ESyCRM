import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Contact, SalonEnrichmentRow, EmailSequence, User } from "@shared/schema";
import { EMPTY_OWNER_NAME_RESULT, hasStrongOwnerNameEvidence, isStrongApprovedOwnerCandidate, type OwnerNameResult } from "@shared/salonOwnerName";
import { contactOwnerLookupIdentity } from "@shared/contactOwnerLookup";
import { contactHasManualName } from "./salonOwnerNameMutationPolicy";
import { registerContactOwnerNameRoutes } from "./contactOwnerNameRoutes";

async function fixture(run: (f: any) => Promise<void>) {
  let contact = {
    id: "legacy", userId: "owner-a", company: "Example Pet Spa", firstName: null, lastName: null,
    email: "spa@example.test", address: "123 Example Road", city: "Example City", state: "TX",
    zipCode: "77058", websiteUrl: "https://spa.example.test", phone: null,
    useBusinessNameForEmail: "Yes", archivedAt: null,
  } as Contact;
  let row: SalonEnrichmentRow | undefined;
  let searches = 0, preparations = 0, applications = 0;
  let allowed = true, allowance = 3;
  let hold: Promise<void> | undefined;
  const candidate = {
    id: "owner-riley", firstName: "Riley", lastName: "Example", role: "owner",
    roleConfirmed: true, businessMatched: true, confidence: "high" as const,
    sources: [{ url: "https://spa.example.test/about", kind: "website_about",
      excerpt: "Riley Example owns Example Pet Spa at 123 Example Road, Example City TX 77058." }],
  };
  const found: OwnerNameResult = {
    ...EMPTY_OWNER_NAME_RESULT, status: "needs_review", candidates: [candidate],
    providerCalls: 1, pagesFetched: 1, lookedUpAt: "2026-10-07T12:00:00Z",
  };
  const sequence = {
    id: "sequence", userId: "owner-a", sequenceTrack: "salon_no_software",
    subject: "[Contact_First_Name], an invitation", body: "<p>[Contact_Greeting]</p><p>For [Business_Name].</p>",
  } as EmailSequence;
  const app = express();
  app.use(express.json());
  registerContactOwnerNameRoutes(app, (req: any, _res, next) => {
    req.user = { role: req.headers["x-role"] || "salesperson",
      claims: { sub: req.headers["x-user"] || "owner-a", role: req.headers["x-claim-role"] } };
    next();
  }, {
    repository: {
      getContact: async (id, scope) => id === contact.id && (!scope || scope === contact.userId) ? contact : undefined,
      getContactOwnerNameRow: async (id, owner) => id === contact.id && owner === contact.userId ? row : undefined,
      ensureContactOwnerNameRow: async (id, owner) => {
        preparations++;
        assert.equal(id, contact.id); assert.equal(owner, contact.userId);
        row ??= { id: "evidence", userId: owner, importedContactId: id, status: "imported",
          ...contactOwnerLookupIdentity(contact), evidence: { ownerName: { ...EMPTY_OWNER_NAME_RESULT } } } as SalonEnrichmentRow;
        return row;
      },
      reviewSalonOwnerName: async (id, owner, input) => {
        assert.equal(id, row!.id); assert.equal(owner, contact.userId);
        const result = (row!.evidence as any).ownerName as OwnerNameResult;
        const selected = result.candidates.find(c => c.id === input.candidateId);
        if (!selected || (input.decision === "approved" && !hasStrongOwnerNameEvidence(selected))) {
          return { error: { status: 409, message: "Only a fetched, matched owner can be approved" } };
        }
        row!.evidence = { ownerName: { ...result, selectedCandidateId: input.candidateId,
          approvedAt: input.decision === "approved" ? "2026-10-07T12:30:00Z" : null, usePersonalName: input.usePersonalName } };
        return { row };
      },
      applySalonOwnerName: async (id, owner, input) => {
        assert.equal(id, row!.id); assert.equal(owner, contact.userId);
        const approved = isStrongApprovedOwnerCandidate((row!.evidence as any).ownerName);
        if (!approved) return { error: { status: 409, message: "Approve a source-backed owner first" } };
        if (contactHasManualName(contact, undefined, row!.id, approved.id) && !input.overwriteExisting) {
          return { error: { status: 409, message: "The linked contact already has a manual name." } };
        }
        applications++;
        contact = { ...contact, firstName: approved.firstName, lastName: approved.lastName,
          useBusinessNameForEmail: input.usePersonalName ? "No" : "Yes" };
        return { row, contact };
      },
      getEmailSequence: async (id, scope) => id === sequence.id && (!scope || scope === sequence.userId) ? sequence : undefined,
      getUser: async id => ({ id, firstName: "Sales", lastName: "Person", email: "sales@example.test" } as User),
    },
    estimate: async (rows, count = 1) => {
      assert.equal(rows[0].importedContactId, contact.id);
      return { searchesPerRow: count, allowed, maxProviderCalls: Math.min(allowance, count), maxPages: 4,
        remainingCredits: 80, ...(allowed ? {} : { reason: "Shared provider budget exhausted" }) };
    },
    search: async (rows, owner, cap, phrases = 1) => {
      searches++;
      assert.equal(owner, contact.userId); assert.ok(cap <= phrases && cap <= 3);
      await hold;
      row!.evidence = { ownerName: found };
      return { results: [{ rowId: rows[0].id, ownerName: found }], callsUsed: 1 };
    },
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/contacts/legacy/owner-name`;
  const request = async (path = "", method = "GET", body?: unknown, headers = {}) => {
    const response = await fetch(origin + path, { method, headers: { "Content-Type": "application/json", ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() as any };
  };
  try {
    await run({ request, candidate, sequence, found,
      get contact() { return contact; }, get row() { return row; },
      get searches() { return searches; }, get preparations() { return preparations; }, get applications() { return applications; },
      updateContact: (values: Partial<Contact>) => { contact = { ...contact, ...values }; },
      setBudget: (value: boolean, cap = 3) => { allowed = value; allowance = cap; },
      setHold: (value: Promise<void>) => { hold = value; },
    });
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

test("legacy Contacts have read-only research status; opening it does not create rows or search", () => fixture(async f => {
  const result = await f.request();
  assert.equal(result.status, 200); assert.equal(result.body.ownerName.status, "not_searched");
  assert.equal(result.body.rowId, null); assert.equal(f.preparations, 0); assert.equal(f.searches, 0);
}));

test("refreshed administrator role, not identity claims, controls cross-owner access", () => fixture(async f => {
  const admin = { "x-role": "admin", "x-user": "administrator" };
  assert.equal((await f.request("", "GET", undefined, admin)).status, 200);
  assert.equal((await f.request("/estimate", "POST", { searchesPerRow: 3 }, admin)).status, 200);
  assert.equal((await f.request("/search", "POST", { searchesPerRow: 3, maxProviderCalls: 3, confirmed: true }, admin)).status, 200);
  const foreign = { "x-role": "salesperson", "x-user": "other", "x-claim-role": "admin" };
  for (const [path, method, body] of [
    ["", "GET", undefined], ["/estimate", "POST", { searchesPerRow: 3 }],
    ["/search", "POST", { maxProviderCalls: 3, searchesPerRow: 3, confirmed: true }],
    ["/review", "PATCH", { candidateId: f.candidate.id, decision: "approved", usePersonalName: true }],
    ["/apply", "POST", { overwriteExisting: false, usePersonalName: true }],
    ["/preview", "POST", { sequenceId: "sequence" }],
  ] as const) assert.equal((await f.request(path, method, body, foreign)).status, 404);
  assert.equal(f.searches, 1); assert.equal(f.applications, 0);
}));

test("explicit bounded search saves evidence only; approval/application personalizes the real email renderer", () => fixture(async f => {
  assert.equal((await f.request("/estimate", "POST", { searchesPerRow: 3 })).body.maxProviderCalls, 3);
  const search = await f.request("/search", "POST", { searchesPerRow: 3, maxProviderCalls: 3, confirmed: true });
  assert.equal(search.status, 200); assert.equal(search.body.callsUsed, 1);
  assert.equal(f.contact.firstName, null); assert.equal(f.applications, 0);
  assert.equal((await f.request("/apply", "POST", { overwriteExisting: false, usePersonalName: true })).status, 409);
  assert.equal((await f.request("/review", "PATCH", { candidateId: f.candidate.id, decision: "approved", usePersonalName: true })).status, 200);
  assert.equal((await f.request("/apply", "POST", { overwriteExisting: false, usePersonalName: true })).status, 200);
  assert.equal(f.contact.firstName, "Riley"); assert.equal(f.contact.lastName, "Example");
  assert.equal(f.contact.email, "spa@example.test"); assert.equal(f.contact.useBusinessNameForEmail, "No");
  const preview = await f.request("/preview", "POST", { sequenceId: "sequence" });
  assert.equal(preview.status, 200); assert.equal(preview.body.greetingPreview, "Hi Riley,");
  assert.equal(preview.body.renderedSubject, "Riley, an invitation");
  assert.match(preview.body.renderedBody, /Hi Riley,/);
}));

test("budgets, confirmation, manual names, archived Contacts and changed identity remain protected", () => fixture(async f => {
  assert.equal((await f.request("/search", "POST", { confirmed: false, maxProviderCalls: 3 })).status, 400);
  assert.equal((await f.request("/search", "POST", { confirmed: true, maxProviderCalls: 4 })).status, 400);
  f.setBudget(false);
  assert.equal((await f.request("/search", "POST", { confirmed: true, maxProviderCalls: 3 })).status, 409);
  f.setBudget(true, 1);
  assert.equal((await f.request("/search", "POST", { confirmed: true, maxProviderCalls: 3 })).status, 409);
  assert.equal(f.searches, 0);
  f.setBudget(true);
  await f.request("/search", "POST", { confirmed: true, maxProviderCalls: 3 });
  f.updateContact({ firstName: "Manually", lastName: "Entered" });
  await f.request("/review", "PATCH", { candidateId: f.candidate.id, decision: "approved", usePersonalName: false });
  assert.equal((await f.request("/apply", "POST", { overwriteExisting: false, usePersonalName: false })).status, 409);
  assert.equal(f.contact.firstName, "Manually");
  assert.equal((await f.request("/apply", "POST", { overwriteExisting: true, usePersonalName: false })).status, 200);
  const preview = await f.request("/preview", "POST", { sequenceId: "sequence" });
  assert.equal(preview.body.greetingPreview, "Hi Example Pet Spa team,");
  f.updateContact({ address: "A different business location" });
  assert.equal((await f.request("/apply", "POST", { overwriteExisting: true, usePersonalName: true })).status, 409);
  assert.equal((await f.request()).body.ownerName.status, "not_searched");
  f.updateContact({ archivedAt: new Date() });
  assert.equal((await f.request("/estimate", "POST", {})).status, 404);
}));

test("simultaneous duplicate lookup is rejected instead of spending a second allowance", () => fixture(async f => {
  let release!: () => void;
  f.setHold(new Promise<void>(resolve => { release = resolve; }));
  const first = f.request("/search", "POST", { confirmed: true, maxProviderCalls: 3 });
  for (let i = 0; i < 100 && !f.searches; i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(f.searches, 1);
  const second = await f.request("/search", "POST", { confirmed: true, maxProviderCalls: 3 });
  release();
  assert.equal(second.status, 409); assert.equal((await first).status, 200); assert.equal(f.searches, 1);
}));

test("AI-only suggestions cannot be applied as confirmed owners", () => fixture(async f => {
  await f.request("/search", "POST", { confirmed: true, maxProviderCalls: 3 });
  (f.row.evidence as any).ownerName.candidates = [{ ...f.candidate, roleConfirmed: false, businessMatched: false,
    sources: [{ kind: "google_ai_overview", url: "https://google.example.test", excerpt: "Suggested owner Riley Example" }] }];
  assert.equal((await f.request("/review", "PATCH", { candidateId: f.candidate.id, decision: "approved", usePersonalName: true })).status, 409);
  assert.equal((await f.request("/apply", "POST", { overwriteExisting: false, usePersonalName: true })).status, 409);
  assert.equal(f.contact.firstName, null);
}));
