import assert from "node:assert/strict";
import test from "node:test";
import { getTableName, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { ContactDeletionConflict, deleteContactSafely } from "./contactDeletion";
import { deleteSalonReviewRowSafely, SalonReviewDeletionConflict } from "./salonReviewDeletion";

type RecordRow = Record<string, unknown>;
type Data = Record<string, RecordRow[]>;
function fixture(extra: Partial<Data> = {}) {
  let data: Data = {
    contacts: [{ id: "target", userId: "seller" }, { id: "other", userId: "another" }],
    deals: [], deal_activities: [], deal_tasks: [],
    email_sequence_logs: [{ id: "log", contactId: "target" }, { id: "other-log", contactId: "other" }],
    inbox_messages: [{ id: "message", contactId: "target", emailSequenceLogId: "log" }, { id: "other-message", contactId: "other", emailSequenceLogId: "other-log" }],
    activities: [{ id: "activity", contactId: "target" }],
    tasks: [{ id: "task", contactId: "target" }],
    salon_enrichment_rows: [{ id: "source", importedContactId: "target", reviewStatus: "approved" }],
    ...extra,
  };
  const operations: string[] = [];
  const dialect = new PgDialect();
  let failAt = "";
  const database = {
    transaction: async (work: (tx: unknown) => Promise<boolean>) => {
      const working = structuredClone(data);
      function matches(name: string, condition: SQL, row: RecordRow) {
        const query = dialect.sqlToQuery(condition);
        const field = query.sql.includes('"id"') ? "id"
          : query.sql.includes('"batch_id"') ? "batchId"
          : query.sql.includes('"email_sequence_log_id"') ? "emailSequenceLogId"
          : query.sql.includes('"imported_contact_id"') ? "importedContactId" : "contactId";
        return query.params.includes(row[field]) &&
          (!query.sql.includes('"user_id"') || row.userId === query.params[1]);
      }
      const tx = {
        execute: async () => { operations.push("advisory"); return []; },
        select: () => ({
          from: (table: Parameters<typeof getTableName>[0]) => ({
            where: (condition: SQL) => {
              const name = getTableName(table);
              const rows = (working[name] || []).filter(row => matches(name, condition, row));
              return {
                for: async (lock: string) => { operations.push(`lock:${lock}`); return rows; },
                limit: async (limit: number) => rows.slice(0, limit),
                then: (resolve: (rows: RecordRow[]) => unknown, reject: (error: unknown) => unknown) =>
                  Promise.resolve(rows).then(resolve, reject),
              };
            },
          }),
        }),
        update: (table: Parameters<typeof getTableName>[0]) => ({
          set: (values: RecordRow) => ({
            where: async (condition: SQL) => {
              const name = getTableName(table);
              operations.push(`update:${name}`);
              if (failAt === name) throw new Error("simulated failure");
              working[name] = (working[name] || []).map(row =>
                matches(name, condition, row) ? { ...row, ...values } : row);
            },
          }),
        }),
        delete: (table: Parameters<typeof getTableName>[0]) => ({
          where: (condition: SQL) => {
            const name = getTableName(table);
            operations.push(`delete:${name}`);
            if (failAt === name) throw new Error("simulated failure");
            const removed = (working[name] || []).filter(row => matches(name, condition, row));
            working[name] = (working[name] || []).filter(row => !matches(name, condition, row));
            return {
              returning: async () => removed,
              then: (resolve: (rows: RecordRow[]) => unknown, reject: (error: unknown) => unknown) =>
                Promise.resolve(removed).then(resolve, reject),
            };
          },
        }),
      };
      const result = await work(tx);
      data = working; // Commit only when the callback succeeds.
      return result;
    },
  } as unknown as Parameters<typeof deleteContactSafely>[0];
  return { database, operations, data: () => data, failOn: (name: string) => { failAt = name; } };
}

test("deletes owned imported contact, removes queued logs, and preserves unlinked history", async () => {
  const f = fixture();
  assert.equal(await deleteContactSafely(f.database, "target", "seller"), true);
  const data = f.data();
  assert.deepEqual(data.contacts, [{ id: "other", userId: "another" }]);
  assert.deepEqual(data.email_sequence_logs, [{ id: "other-log", contactId: "other" }]);
  assert.deepEqual(data.inbox_messages[0], { id: "message", contactId: null, emailSequenceLogId: null });
  assert.deepEqual(data.inbox_messages[1], { id: "other-message", contactId: "other", emailSequenceLogId: "other-log" });
  assert.equal(data.tasks[0].contactId, null);
  assert.equal(data.activities[0].contactId, null);
  assert.deepEqual(data.salon_enrichment_rows[0], { id: "source", importedContactId: null, reviewStatus: "needs_review" });
  assert.equal(f.operations[0], "lock:update");
  assert(f.operations.indexOf("update:inbox_messages") < f.operations.indexOf("delete:email_sequence_logs"));
});

test("ordinary salespeople cannot delete another owner's contact or dependent records", async () => {
  const f = fixture();
  const original = structuredClone(f.data());
  assert.equal(await deleteContactSafely(f.database, "target", "another"), false);
  assert.deepEqual(f.data(), original);
  assert.deepEqual(f.operations, ["lock:update"]);
});

test("missing contacts do not mutate records", async () => {
  const f = fixture();
  assert.equal(await deleteContactSafely(f.database, "missing", "seller"), false);
  assert.deepEqual(f.operations, ["lock:update"]);
});

test("admin scope permits deletion across owners under existing authorization policy", async () => {
  const f = fixture();
  assert.equal(await deleteContactSafely(f.database, "target", null), true);
});

for (const table of ["deals", "deal_activities", "deal_tasks"]) {
  test(`linked ${table} protects the business and all history`, async () => {
    const f = fixture({ [table]: [{ id: "linked", contactId: "target" }] });
    const original = structuredClone(f.data());
    await assert.rejects(deleteContactSafely(f.database, "target", "seller"), ContactDeletionConflict);
    assert.deepEqual(f.data(), original);
    assert.deepEqual(f.operations, ["lock:update"]);
  });
}

test("a cleanup failure rolls back all preceding unlink operations", async () => {
  const f = fixture();
  const original = structuredClone(f.data());
  f.failOn("contacts");
  await assert.rejects(deleteContactSafely(f.database, "target", "seller"), /simulated failure/);
  assert.deepEqual(f.data(), original);
});

function reviewFixture(batchChanges: RecordRow = {}, rowChanges: RecordRow = {}) {
  const row = {
    id: "review", userId: "seller", batchId: "batch", status: "enriched",
    importedContactId: null, reviewStatus: "needs_review", sourceData: { stagingState: "staged_unverified" },
    ...rowChanges,
  };
  return fixture({
    salon_enrichment_batches: [{
      id: "batch", userId: "seller", fileName: "salon-public-web-review", status: "completed",
      totalRows: 2, usedSerpCalls: 4, ...batchChanges,
    }],
    salon_enrichment_rows: [row, { ...row, id: "other-review", importedContactId: null }],
  });
}

test("review deletion removes only the owned source row and refreshes counts without refunding calls", async () => {
  const f = reviewFixture();
  const originalContacts = structuredClone(f.data().contacts);
  assert.equal(await deleteSalonReviewRowSafely(f.database, "review", "seller"), true);
  assert.deepEqual(f.data().contacts, originalContacts);
  assert.deepEqual(f.data().salon_enrichment_rows.map(row => row.id), ["other-review"]);
  const batch = f.data().salon_enrichment_batches[0];
  assert.equal(batch.totalRows, 1);
  assert.equal(batch.processedRows, 0);
  assert.equal(batch.enrichedRows, 0);
  assert.equal(batch.needsReviewRows, 1);
  assert.equal(batch.usedSerpCalls, 4);
});

test("deleting every source row leaves an empty, consistent batch", async () => {
  const f = reviewFixture();
  await deleteSalonReviewRowSafely(f.database, "review", "seller");
  await deleteSalonReviewRowSafely(f.database, "other-review", "seller");
  assert.equal(f.data().salon_enrichment_rows.length, 0);
  assert.equal(f.data().salon_enrichment_batches[0].totalRows, 0);
  assert.equal(f.data().salon_enrichment_batches[0].needsReviewRows, 0);
});

test("review deletion respects user ownership and report-only boundaries", async () => {
  const f = reviewFixture();
  const original = structuredClone(f.data());
  assert.equal(await deleteSalonReviewRowSafely(f.database, "review", "another"), false);
  assert.deepEqual(f.data(), original);
  const ordinary = reviewFixture({ fileName: "ordinary-upload.xlsx" });
  assert.equal(await deleteSalonReviewRowSafely(ordinary.database, "review", "seller"), false);
  assert.equal(ordinary.data().salon_enrichment_rows.length, 2);
});

for (const [label, batchChanges, rowChanges] of [
  ["running verification", { status: "running" }, {}],
  ["processing rows", {}, { status: "processing" }],
  ["active owner lookups", {}, { evidence: { ownerName: { status: "searching" } } }],
  ["already imported CRM contacts", {}, { importedContactId: "target" }],
] as const) {
  test(`review deletion protects ${label}`, async () => {
    const f = reviewFixture(batchChanges, rowChanges);
    const original = structuredClone(f.data());
    await assert.rejects(deleteSalonReviewRowSafely(f.database, "review", "seller"), SalonReviewDeletionConflict);
    assert.deepEqual(f.data(), original);
  });
}

test("review counter-update failures roll back the source-row deletion", async () => {
  const f = reviewFixture();
  const original = structuredClone(f.data());
  f.failOn("salon_enrichment_batches");
  await assert.rejects(deleteSalonReviewRowSafely(f.database, "review", "seller"), /simulated failure/);
  assert.deepEqual(f.data(), original);
});