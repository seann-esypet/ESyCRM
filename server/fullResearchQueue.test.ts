import assert from "node:assert/strict";
import test from "node:test";
import { getTableColumns, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { db } from "./db";
import { storage } from "./storage";
import { salonEnrichmentBatches, salonEnrichmentRows } from "@shared/schema";
import { FULL_RESEARCH_DEFAULTS } from "@shared/fullResearch";
import { newFullResearch } from "./fullResearchPolicy";
import { unifiedUploadRow } from "./leadWorkspacePolicy";
import { controlFullResearch } from "./fullResearchQueue";
import { fullResearchRowTools } from "./fullResearchRow";
import { EMPTY_OWNER_NAME_RESULT } from "@shared/salonOwnerName";

// Every database operation and provider is replaced. These fixtures cannot
// create live records, spend provider requests, or send outreach.
const dialect = new PgDialect();
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
function fixture(count: number, fail: boolean | number = false, cachedBusinessSearch = false) {
  const batch: any = { id: "fixture-list", userId: "fixture-owner", name: "Fixture uploaded list",
    status: "completed", researchProgress: { workflow: "unified_leads" }, totalRows: count };
  const rows: any[] = Array.from({ length: count }, (_, i) => ({
    ...unifiedUploadRow({ Business: `Fixture Grooming ${i}`, Address: "1 Main Street Austin TX", State: "TX" }, i, batch.userId),
    id: `fixture-row-${i}`, batchId: batch.id, serpCallsUsed: 0,
  }));
  let transactions = 0, providerAttempts = 0;
  let tail = Promise.resolve();
  const matches = (table: any, record: any, condition?: SQL) => {
    if (!condition) return true;
    const query = dialect.sqlToQuery(condition);
    const columns = getTableColumns(table) as Record<string, { name: string }>;
    return [...query.sql.matchAll(/"([^"]+)"\s*=\s*\$(\d+)/g)].every(match => {
      const key = Object.keys(columns).find(key => columns[key].name === match[1]);
      return !key || record[key] === query.params[Number(match[2]) - 1];
    });
  };
  const records = (table: any) => table === salonEnrichmentBatches ? [batch] : table === salonEnrichmentRows ? rows : (() => { throw new Error("Unexpected fixture table"); })();
  const tx: any = {
    execute: async () => undefined,
    select: () => {
      let table: any, condition: SQL | undefined;
      const query: any = {
        from: (value: any) => { table = value; return query; },
        where: (value: SQL) => { condition = value; return query; },
        for: () => query,
        then: (resolve: any, reject: any) => Promise.resolve(records(table).filter((row: any) => matches(table, row, condition)).map((row: any) => structuredClone(row))).then(resolve, reject),
      };
      return query;
    },
    update: (table: any) => {
      let patch: any, condition: SQL;
      const apply = () => {
        const selected = records(table).filter((row: any) => matches(table, row, condition));
        selected.forEach((row: any) => Object.assign(row, structuredClone(patch)));
        return structuredClone(selected);
      };
      const query: any = {
        set: (value: any) => { patch = value; return query; },
        where: (value: SQL) => { condition = value; return query; },
        then: (resolve: any, reject: any) => Promise.resolve().then(apply).then(resolve, reject),
      };
      return query;
    },
  };
  const original = { transaction: db.transaction, get: storage.getSalonEnrichmentBatch,
    refresh: storage.refreshSalonEnrichmentBatchCounts, tools: { ...fullResearchRowTools } };
  (db as any).transaction = (action: any) => {
    const result = tail.then(async () => { transactions++; return action(tx); });
    tail = result.then(() => undefined, () => undefined);
    return result;
  };
  storage.getSalonEnrichmentBatch = async (id, owner) =>
    id === batch.id && (owner === null || owner === batch.userId) ? structuredClone(batch) : undefined;
  storage.refreshSalonEnrichmentBatchCounts = async () => structuredClone(batch);
  const provider = async (before: () => Promise<void>) => {
    const old = batch.researchProgress.fullResearch.attempts.length;
    await before();
    assert.equal(batch.researchProgress.fullResearch.attempts.length, old + 1, "request must be durably charged BEFORE invocation");
    providerAttempts++;
    if (fail === true || fail === providerAttempts) throw new Error("Fixture provider failed after starting");
  };
  Object.assign(fullResearchRowTools, {
    crawlWebsite: async () => { throw new Error("Unexpected website crawl in provider fixture"); },
    searchWithSerpApi: async (_q: any, _z: any, _s: any, _t: any, options: any) => {
      if (cachedBusinessSearch) return { results: [], fromCache: true };
      await provider(options.beforeProviderRequest);
      return { results: [], fromCache: false };
    },
    searchSalonContactPages: async (_row: any, _remaining: any, before: any) => {
      await provider(before); return { results: [], calls: 1, error: null };
    },
    enrichRow: async (row: any, options: any) => {
      await options.search("fixture", "78701", "TX", "fixture");
      await options.fallbackSearch();
      return { status: "enriched", identityMatchStatus: "strong", usesSoftware: "Yes", currentSoftware: "Fixture Booking",
        email: `row-${row.rowNumber}@fixture.example`, evidence: {
          email: { value: `row-${row.rowNumber}@fixture.example`, sourceUrl: "https://fixture.example/contact" },
          usesSoftware: { value: "Yes", sourceUrl: "https://fixture.example" },
        } };
    },
    researchSalonOwnerCandidates: async (_row: any, before: any) => {
      await provider(before); return { ...EMPTY_OWNER_NAME_RESULT, status: "needs_review", candidates: [] };
    },
  });
  return {
    batch, rows, get transactions() { return transactions; }, get providerAttempts() { return providerAttempts; },
    async settled() {
      for (let i = 0; i < 400; i++) {
        if (batch.researchProgress.fullResearch && !batch.researchProgress.fullResearch.lease &&
            ["waiting_hourly", "budget_exhausted", "completed", "paused", "interrupted"].includes(batch.researchProgress.fullResearch.status)) {
          await wait(10); return;
        }
        await wait(5);
      }
      throw new Error("Fixture queue did not settle");
    },
    restore() {
      (db as any).transaction = original.transaction;
      storage.getSalonEnrichmentBatch = original.get;
      storage.refreshSalonEnrichmentBatchCounts = original.refresh;
      Object.assign(fullResearchRowTools, original.tools);
    },
  };
}

test("Full Research controls and worker use only isolated records/providers", async t => {
  await t.test("activation requires confirmation and correct ownership before any provider invocation", async () => {
    const env = fixture(1);
    try {
      await assert.rejects(controlFullResearch(env.batch.id, env.batch.userId, "start", FULL_RESEARCH_DEFAULTS), /Confirm/);
      assert.equal(env.transactions, 0);
      await assert.rejects(controlFullResearch(env.batch.id, "other-owner", "start", { confirmed: true, ...FULL_RESEARCH_DEFAULTS }), /inaccessible/);
      assert.equal(env.providerAttempts, 0);
    } finally { env.restore(); }
  });
  await t.test("email, software and names are review-only and share a pre-invocation ledger", async () => {
    const env = fixture(1);
    try {
      await controlFullResearch(env.batch.id, env.batch.userId, "start", { confirmed: true, ...FULL_RESEARCH_DEFAULTS });
      await env.settled();
      const run = env.batch.researchProgress.fullResearch;
      assert.equal(run.status, "completed");
      assert.equal(env.providerAttempts, 3);
      assert.deepEqual(run.attempts.map((call: any) => call.tool), ["business_search", "email_contact_search", "contact_name_search"]);
      assert.equal(env.rows[0].reviewStatus, "needs_review");
      assert.equal(env.rows[0].currentSoftware, "Fixture Booking");
      assert.ok(env.rows[0].evidence.email.sourceUrl);
      assert.ok(!env.rows[0].importedContactId);
    } finally { env.restore(); }
  });
  await t.test("hourly paid cap stops mid-business without discarding prior evidence or allowing a duplicate start", async () => {
    const env = fixture(30);
    try {
      await controlFullResearch(env.batch.id, env.batch.userId, "start", { confirmed: true, ...FULL_RESEARCH_DEFAULTS });
      await assert.rejects(controlFullResearch(env.batch.id, env.batch.userId, "start", { confirmed: true, ...FULL_RESEARCH_DEFAULTS }), /already active|processing/);
      await env.settled();
      const run = env.batch.researchProgress.fullResearch;
      assert.equal(run.status, "waiting_hourly");
      assert.equal(run.enabled, true);
      assert.equal(env.providerAttempts, 40);
      assert.equal(run.attempts.length, 40);
      assert.equal(run.currentRowId, null);
      assert.equal(run.processedIds.length, 13);
      assert.ok(run.nextRunAt);
      await controlFullResearch(env.batch.id, env.batch.userId, "pause", { confirmed: true });
      assert.equal(env.batch.researchProgress.fullResearch.enabled, false);
      await controlFullResearch(env.batch.id, env.batch.userId, "resume", { confirmed: true });
      await env.settled();
      assert.equal(env.providerAttempts, 40);
    } finally { env.restore(); }
  });
  await t.test("list-wide cap cannot be reset by Start, Resume or recovery; more requires a higher confirmed total", async () => {
    const env = fixture(2);
    try {
      await controlFullResearch(env.batch.id, env.batch.userId, "start", { confirmed: true, ...FULL_RESEARCH_DEFAULTS, paidCallsPerList: 3 });
      await env.settled();
      assert.equal(env.batch.researchProgress.fullResearch.status, "budget_exhausted");
      await assert.rejects(controlFullResearch(env.batch.id, env.batch.userId, "resume", { confirmed: true }), /higher TOTAL/);
      await assert.rejects(controlFullResearch(env.batch.id, env.batch.userId, "start", { confirmed: true, ...FULL_RESEARCH_DEFAULTS, paidCallsPerList: 3 }), /higher TOTAL/);
      await controlFullResearch(env.batch.id, env.batch.userId, "start", { confirmed: true, ...FULL_RESEARCH_DEFAULTS, paidCallsPerList: 10 });
      await env.settled();
      assert.equal(env.providerAttempts, 6);
      assert.equal(env.batch.researchProgress.fullResearch.attempts.length, 6);
      assert.equal(env.batch.researchProgress.fullResearch.status, "completed");
    } finally { env.restore(); }
  });
  await t.test("provider failure retains its charged attempt and pauses rather than retrying automatically", async () => {
    const env = fixture(2, true);
    try {
      await controlFullResearch(env.batch.id, env.batch.userId, "start", { confirmed: true, ...FULL_RESEARCH_DEFAULTS });
      await env.settled();
      assert.equal(env.providerAttempts, 1);
      assert.equal(env.batch.researchProgress.fullResearch.attempts.length, 1);
      assert.equal(env.batch.researchProgress.fullResearch.status, "paused");
    } finally { env.restore(); }
  });
  await t.test("expired in-flight work requires separate recovery and preserves charged history", async () => {
    const env = fixture(1);
    try {
      const run = newFullResearch(FULL_RESEARCH_DEFAULTS, Date.now());
      run.enabled = false; run.status = "interrupted"; run.currentRowId = env.rows[0].id;
      run.attempts.push({ at: new Date().toISOString(), tool: "business_search", rowId: env.rows[0].id });
      run.lease = { token: "old-process", expiresAt: new Date(Date.now() - 1).toISOString() };
      env.batch.researchProgress.fullResearch = run;
      env.rows[0].status = "processing";
      await assert.rejects(controlFullResearch(env.batch.id, env.batch.userId, "resume", { confirmed: true }), /processing|Recover/);
      await controlFullResearch(env.batch.id, env.batch.userId, "recover", { confirmed: true });
      assert.equal(env.batch.researchProgress.fullResearch.status, "paused");
      assert.equal(env.batch.researchProgress.fullResearch.attempts.length, 1);
      assert.equal(env.rows[0].status, "failed");
      assert.equal(env.providerAttempts, 0);
    } finally { env.restore(); }
  });
  await t.test("a late provider failure preserves earlier email/software evidence and all prior charged requests", async () => {
    const env = fixture(2, 3);
    try {
      await controlFullResearch(env.batch.id, env.batch.userId, "start", { confirmed: true, ...FULL_RESEARCH_DEFAULTS });
      await env.settled();
      assert.equal(env.providerAttempts, 3);
      assert.equal(env.batch.researchProgress.fullResearch.attempts.length, 3);
      assert.equal(env.batch.researchProgress.fullResearch.status, "paused");
      assert.ok(env.rows[0].email);
      assert.ok(env.rows[0].evidence.email.sourceUrl);
      assert.equal(env.rows[0].currentSoftware, "Fixture Booking");
    } finally { env.restore(); }
  });
  await t.test("cached provider results do not consume the new-request allowance", async () => {
    const env = fixture(1, false, true);
    try {
      await controlFullResearch(env.batch.id, env.batch.userId, "start", { confirmed: true, ...FULL_RESEARCH_DEFAULTS });
      await env.settled();
      assert.equal(env.providerAttempts, 2);
      assert.deepEqual(env.batch.researchProgress.fullResearch.attempts.map((call: any) => call.tool),
        ["email_contact_search", "contact_name_search"]);
    } finally { env.restore(); }
  });
  await t.test("finishing the last business at exactly the list cap reports completed, not a budget stop", async () => {
    const env = fixture(1);
    try {
      await controlFullResearch(env.batch.id, env.batch.userId, "start", { confirmed: true, ...FULL_RESEARCH_DEFAULTS, paidCallsPerList: 3 });
      await env.settled();
      assert.equal(env.providerAttempts, 3);
      assert.equal(env.batch.researchProgress.fullResearch.status, "completed");
    } finally { env.restore(); }
  });
});