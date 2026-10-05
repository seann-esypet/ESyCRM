import assert from "node:assert/strict";
import test from "node:test";
import { getTableName } from "drizzle-orm";
import { type Contact, type Deal, type InsertDeal } from "@shared/schema";
import { createDealForActor, createDealRecord, DealCreationError } from "./dealCreation";

const contact = { id: "fixture-contact", userId: "owner", archivedAt: null } as Contact;
const input = { title: "  Fixture opportunity  ", contactId: contact.id };
function repository(record: Contact | null = contact) {
  const calls: Array<{ scope?: string | null; owner?: string }> = [];
  return {
    calls,
    getContact: async (_id: string, scope: string | null) => {
      calls.push({ scope });
      return record && (scope === null || scope === record.userId) ? record : undefined;
    },
    createDeal: async (data: InsertDeal, owner: string) => {
      calls.push({ owner });
      return { ...data, id: "fixture-deal", userId: owner } as Deal;
    },
  };
}

test("salesperson creates a linked opportunity in their own scope", async () => {
  const repo = repository();
  const deal = await createDealForActor(repo, input, { id: "owner", isAdmin: false });
  assert.deepEqual(repo.calls, [{ scope: "owner" }, { owner: "owner" }]);
  assert.equal(deal.contactId, contact.id);
  assert.equal(deal.title, "Fixture opportunity");
});
test("admin preserves the contact salesperson rather than assigning the deal to themselves", async () => {
  const repo = repository();
  const deal = await createDealForActor(repo, input, { id: "admin", isAdmin: true });
  assert.deepEqual(repo.calls, [{ scope: null }, { owner: "owner" }]);
  assert.equal(deal.userId, "owner");
});
test("foreign and missing contacts cannot create deals", async () => {
  for (const repo of [repository(), repository(null)]) {
    const actor = { id: "foreign-salesperson", isAdmin: false };
    await assert.rejects(createDealForActor(repo, input, actor),
      (error: unknown) => error instanceof DealCreationError && error.status === 404);
    assert.ok(!repo.calls.some(call => call.owner));
  }
});
test("archived contacts and empty titles fail before writing", async () => {
  const repo = repository({ ...contact, archivedAt: new Date() });
  await assert.rejects(createDealForActor(repo, input, { id: "admin", isAdmin: true }),
    (error: unknown) => error instanceof DealCreationError && error.status === 409);
  await assert.rejects(createDealForActor(repo, { ...input, title: " " }, { id: "admin", isAdmin: true }),
    (error: unknown) => error instanceof DealCreationError && error.status === 400);
  assert.ok(!repo.calls.some(call => call.owner));
});
test("standalone New Deal remains supported", async () => {
  const repo = repository();
  const deal = await createDealForActor(repo, { title: "Standalone", contactId: "" }, { id: "owner", isAdmin: false });
  assert.equal(deal.contactId, null);
  assert.deepEqual(repo.calls, [{ owner: "owner" }]);
});

function fakeDatabase(failAt?: string, record = contact) {
  const saved: Record<string, any[]> = { contacts: [{ ...record, status: "active" }], deals: [], activities: [] };
  const operations: string[] = [];
  const database = {
    transaction: async (run: (tx: any) => Promise<Deal>) => {
      const working = structuredClone(saved);
      const tx = {
        select: () => ({ from: () => ({ where: () => ({ limit: () => ({
          for: async (mode: string) => { operations.push(`lock:${mode}`); return working.contacts; },
        }) }) }) }),
        insert: (table: Parameters<typeof getTableName>[0]) => ({
          values: (data: any) => {
            const name = getTableName(table);
            const write = () => {
              operations.push(`insert:${name}`);
              if (failAt === name) throw new Error("Simulated save failure");
              const row = { ...data, id: `fixture-${name}` };
              working[name].push(row);
              return [row];
            };
            return {
              returning: async () => write(),
              then: (resolve: (value: any) => unknown) => Promise.resolve(write()).then(resolve),
            };
          },
        }),
        update: () => ({ set: (data: any) => ({ where: async () => {
          operations.push("update:contacts");
          if (failAt === "contacts") throw new Error("Simulated save failure");
          Object.assign(working.contacts[0], data);
        } }) }),
      };
      const result = await run(tx);
      Object.assign(saved, working);
      return result;
    },
  } as unknown as Parameters<typeof createDealRecord>[0];
  return { database, saved, operations };
}

test("creation commits deal, Pipeline status and activity together without touching outreach", async () => {
  const fixture = fakeDatabase();
  const deal = await createDealRecord(fixture.database, input, "owner");
  assert.equal(fixture.saved.deals.length, 1);
  assert.equal(fixture.saved.contacts[0].status, "pipeline");
  assert.equal(fixture.saved.activities[0].dealId, deal.id);
  assert.deepEqual(fixture.operations, ["lock:update", "insert:deals", "update:contacts", "insert:activities"]);
});
test("a contact-status or activity failure rolls back the deal so retry cannot duplicate it", async () => {
  for (const failAt of ["contacts", "activities", "deals"]) {
    const fixture = fakeDatabase(failAt);
    await assert.rejects(createDealRecord(fixture.database, input, "owner"), /Simulated save failure/);
    assert.equal(fixture.saved.deals.length, 0);
    assert.equal(fixture.saved.activities.length, 0);
    assert.equal(fixture.saved.contacts[0].status, "active");
  }
});
test("contact archived during creation is rechecked under lock", async () => {
  const fixture = fakeDatabase(undefined, { ...contact, archivedAt: new Date() });
  await assert.rejects(createDealRecord(fixture.database, input, "owner"),
    (error: unknown) => error instanceof DealCreationError && error.status === 409);
  assert.deepEqual(fixture.operations, ["lock:update"]);
  assert.equal(fixture.saved.deals.length, 0);
});