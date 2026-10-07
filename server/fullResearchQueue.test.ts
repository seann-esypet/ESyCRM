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
import { controlFullResearch, tickFullResearchScheduler, fullResearchIsDue } from "./fullResearchQueue";
import { fullResearchRowTools } from "./fullResearchRow";
import { readSerpProviderResponse } from "./serpProviderResponse";
import { EMPTY_OWNER_NAME_RESULT } from "@shared/salonOwnerName";

// Every database operation and provider is replaced. These fixtures cannot
// create live records, spend provider requests, or send outreach.
const dialect = new PgDialect();
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
function fixture(count: number, fail: boolean | number = false, cachedBusinessSearch = false, contactRequests = 1, groomingRequests = 0) {
  const batch: any = { id: "fixture-list", userId: "fixture-owner", name: "Fixture uploaded list",
    status: "completed", researchProgress: { workflow: "unified_leads" }, totalRows: count };
  const rows: any[] = Array.from({ length: count }, (_, i) => ({
    ...unifiedUploadRow({ Business: `Fixture Grooming ${i}`, Address: "1 Main Street Austin TX", State: "TX" }, i, batch.userId),
    id: `fixture-row-${i}`, batchId: batch.id, serpCallsUsed: 0,
  }));
  let transactions = 0, providerAttempts = 0, sharedThrottle = false, accountExhausted = false;
  let providerBlock: { stage: number; permanent: boolean; beforeResponse?: () => Promise<void> } | null = null;
  const hourlyPolicies: number[] = [];
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
  const original = { transaction: db.transaction, select: db.select, get: storage.getSalonEnrichmentBatch,
    usage: storage.getOrCreateSerpUsage, config: storage.getOrCreateLeadDiscoveryConfig, next: storage.getNextSerpCallAt,
    refresh: storage.refreshSalonEnrichmentBatchCounts, tools: { ...fullResearchRowTools } };
  (db as any).select = tx.select;
  storage.getOrCreateSerpUsage = async () => ({ usedCredits: accountExhausted ? 200 : 0, hardStopAt: 200, monthlyQuota: 250 } as any);
  storage.getOrCreateLeadDiscoveryConfig = async () => ({ maxSerpCallsPerHour: 20 } as any);
  storage.getNextSerpCallAt = async () => new Date(Date.now() + 60000).toISOString();
  (db as any).transaction = (action: any) => {
    const result = tail.then(async () => { transactions++; return action(tx); });
    tail = result.then(() => undefined, () => undefined);
    return result;
  };
  storage.getSalonEnrichmentBatch = async (id, owner) =>
    id === batch.id && (owner === null || owner === batch.userId) ? structuredClone(batch) : undefined;
  storage.refreshSalonEnrichmentBatchCounts = async () => structuredClone(batch);
  const provider = async (before: () => Promise<void>, policy: any, stage: number) => {
    const old = batch.researchProgress.fullResearch.attempts.length;
    await before();
    assert.equal(batch.researchProgress.fullResearch.attempts.length, old + 1, "request must be durably charged BEFORE invocation");
    providerAttempts++;
    if (providerBlock?.stage === stage) {
      await providerBlock.beforeResponse?.();
      await readSerpProviderResponse(new Response(JSON.stringify({
        error: providerBlock.permanent ? "Your account has run out of searches." : "Too many requests",
      }), { status: 429, headers: { "Retry-After": "120" } }), policy);
    }
    if (fail === true || fail === providerAttempts) throw new Error("Fixture provider failed after starting");
  };
  Object.assign(fullResearchRowTools, {
    researchGroomingChecks: async (_row: any, _pages: any, _urls: any, _before: any, _policy: any, progress: any) => {
      const { evaluateGroomingPages } = await import("./groomingChecks");
      const result = evaluateGroomingPages(_row, _pages); progress(result);
      for(let i=0;i<groomingRequests;i++){
        hourlyPolicies.push(_policy.hourlyLimit);
        await provider(()=>_before(i===0?"grooming_services_search":"grooming_shop_search"),_policy,4);
        result.providerCalls++; progress(result);
      }
      return result;
    },
    crawlWebsite: async () => { throw new Error("Unexpected website crawl in provider fixture"); },
    searchWithSerpApi: async (_q: any, _z: any, _s: any, _t: any, options: any) => {
      hourlyPolicies.push(options.requestPolicy.hourlyLimit);
      if (sharedThrottle) await options.requestPolicy.onReservationBlocked();
      if (cachedBusinessSearch) return { results: [], fromCache: true };
      await provider(options.beforeProviderRequest, options.requestPolicy, 1);
      return { results: [], fromCache: false };
    },
    searchSalonContactPages: async (_row: any, _remaining: any, before: any, policy: any) => {
      hourlyPolicies.push(policy.hourlyLimit);
      for (let i = 0; i < contactRequests; i++) await provider(before, policy, 2);
      return { results: [], calls: contactRequests, error: null };
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
    researchSalonOwnerCandidates: async (_row: any, before: any, policy: any) => {
      hourlyPolicies.push(policy.hourlyLimit);
      await provider(before, policy, 3); return { ...EMPTY_OWNER_NAME_RESULT, status: "needs_review", candidates: [] };
    },
  });
  return {
    batch, rows, hourlyPolicies,
    setSharedThrottle(value: boolean, quota = false) { sharedThrottle = value; accountExhausted = quota; },
    setProviderBlock(stage: number | null, permanent = false, beforeResponse?: () => Promise<void>) {
      providerBlock = stage == null ? null : { stage, permanent, beforeResponse };
    },
    get transactions() { return transactions; }, get providerAttempts() { return providerAttempts; },
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
      (db as any).select = original.select;
      storage.getOrCreateSerpUsage = original.usage;
      storage.getOrCreateLeadDiscoveryConfig = original.config;
      storage.getNextSerpCallAt = original.next;
      storage.getSalonEnrichmentBatch = original.get;
      storage.refreshSalonEnrichmentBatchCounts = original.refresh;
      Object.assign(fullResearchRowTools, original.tools);
    },
  };
}

test("Full Research controls and worker use only isolated records/providers", async t => {
  for (const stage of [1, 2, 3]) await t.test(`provider HTTP 429 at tool ${stage} waits, preserves charges/evidence, and retries only when due`, async () => {
    const env = fixture(1);
    try {
      env.setProviderBlock(stage);
      await controlFullResearch(env.batch.id, env.batch.userId, "start", { confirmed: true, ...FULL_RESEARCH_DEFAULTS });
      await env.settled();
      const run = env.batch.researchProgress.fullResearch;
      assert.equal(run.status, "waiting_hourly");
      assert.equal(run.waitReason, "provider_rate_limit");
      assert.equal(run.enabled, true);
      assert.equal(run.providerRateLimitCount, 1);
      assert.ok(Date.parse(run.nextRunAt) >= Date.now() + 299000);
      assert.equal(run.attempts.length, stage);
      assert.deepEqual(run.processedIds, []);
      assert.equal(env.rows[0].status, "pending");
      assert.equal(env.rows[0].sourceData.fullResearchWaitReason, "provider_rate_limit");
      if (stage === 3) assert.ok(env.rows[0].email, "retain earlier email when name lookup throttles");
      await tickFullResearchScheduler();
      assert.equal(env.providerAttempts, stage, "no early paid retry");
      env.setProviderBlock(null);
      run.nextRunAt = new Date(Date.now() - 1).toISOString();
      await tickFullResearchScheduler();
      await wait(20); await env.settled();
      assert.equal(env.batch.researchProgress.fullResearch.status, "completed");
      assert.equal(env.batch.researchProgress.fullResearch.attempts.length, stage + 3);
      assert.equal(env.batch.researchProgress.fullResearch.providerRateLimitCount, 0);
      assert.deepEqual(env.batch.researchProgress.fullResearch.processedIds, [env.rows[0].id]);
    } finally { env.restore(); }
  });
  await t.test("persistent 429 stops after five automatic retries, without refunding attempts", async () => {
    const env = fixture(1);
    try {
      env.setProviderBlock(1);
      await controlFullResearch(env.batch.id, env.batch.userId, "start", { confirmed: true, ...FULL_RESEARCH_DEFAULTS });
      await env.settled();
      for (let retry = 1; retry <= 5; retry++) {
        const run = env.batch.researchProgress.fullResearch;
        run.nextRunAt = new Date(Date.now() - 1).toISOString();
        await tickFullResearchScheduler();
        await wait(20); await env.settled();
      }
      assert.equal(env.batch.researchProgress.fullResearch.status, "paused");
      assert.equal(env.batch.researchProgress.fullResearch.enabled, false);
      assert.equal(env.batch.researchProgress.fullResearch.nextRunAt, null);
      assert.match(env.batch.researchProgress.fullResearch.error, /five automatic retries/);
      assert.equal(env.providerAttempts, 6);
      assert.equal(env.batch.researchProgress.fullResearch.attempts.length, 6);
      assert.deepEqual(env.batch.researchProgress.fullResearch.processedIds, []);
      await tickFullResearchScheduler();
      assert.equal(env.providerAttempts, 6);
    } finally { env.restore(); }
  });
  await t.test("429 at the list cap stops rather than scheduling another paid request", async () => {
    const env = fixture(1);
    try {
      env.setProviderBlock(1);
      await controlFullResearch(env.batch.id, env.batch.userId, "start", { confirmed: true, ...FULL_RESEARCH_DEFAULTS, paidCallsPerList: 1 });
      await env.settled();
      assert.equal(env.batch.researchProgress.fullResearch.status, "budget_exhausted");
      assert.equal(env.batch.researchProgress.fullResearch.enabled, false);
      assert.equal(env.batch.researchProgress.fullResearch.nextRunAt, null);
      assert.equal(env.providerAttempts, 1);
      assert.deepEqual(env.batch.researchProgress.fullResearch.processedIds, []);
    } finally { env.restore(); }
  });
  await t.test("a manual pause during a throttled response is never overridden by auto retry", async () => {
    const env = fixture(1);
    try {
      env.setProviderBlock(1, false, () => controlFullResearch(env.batch.id, env.batch.userId, "pause", { confirmed: true }).then(() => undefined));
      await controlFullResearch(env.batch.id, env.batch.userId, "start", { confirmed: true, ...FULL_RESEARCH_DEFAULTS });
      await env.settled();
      assert.equal(env.batch.researchProgress.fullResearch.status, "paused");
      assert.equal(env.batch.researchProgress.fullResearch.enabled, false);
      assert.equal(env.batch.researchProgress.fullResearch.nextRunAt, null);
      await tickFullResearchScheduler();
      assert.equal(env.providerAttempts, 1);
    } finally { env.restore(); }
  });
  await t.test("account exhaustion returned as 429 remains a permanent pause", async () => {
    const env = fixture(1);
    try {
      env.setProviderBlock(3, true);
      await controlFullResearch(env.batch.id, env.batch.userId, "start", { confirmed: true, ...FULL_RESEARCH_DEFAULTS });
      await env.settled();
      assert.equal(env.batch.researchProgress.fullResearch.status, "paused");
      assert.equal(env.batch.researchProgress.fullResearch.enabled, false);
      assert.equal(env.batch.researchProgress.fullResearch.nextRunAt, null);
      assert.match(env.batch.researchProgress.fullResearch.error, /quota/);
      assert.ok(env.rows[0].email);
      assert.equal(env.providerAttempts, 3);
    } finally { env.restore(); }
  });
  await t.test("explicit resume repairs the old rate-limited failed candidate, without activating it on scheduler startup", async () => {
    const env = fixture(1);
    try {
      const run = newFullResearch(FULL_RESEARCH_DEFAULTS, Date.now());
      run.enabled = false; run.status = "paused"; run.processedIds = [env.rows[0].id];
      run.attempts = [{ at: new Date().toISOString(), tool: "business_search", rowId: env.rows[0].id }];
      env.batch.researchProgress.fullResearch = run;
      env.rows[0].status = "failed"; env.rows[0].lastError = "SerpAPI rate limit reached";
      await tickFullResearchScheduler();
      assert.equal(env.providerAttempts, 0);
      await controlFullResearch(env.batch.id, env.batch.userId, "resume", { confirmed: true });
      await env.settled();
      assert.equal(env.batch.researchProgress.fullResearch.status, "completed");
      assert.equal(env.batch.researchProgress.fullResearch.attempts.length, 4);
    } finally { env.restore(); }
  });
  await t.test("new confirmed searches get fresh notifications without resetting cumulative spending", async () => {
    const env = fixture(3);
    try {
      await controlFullResearch(env.batch.id, env.batch.userId, "start", {
        confirmed: true, ...FULL_RESEARCH_DEFAULTS, paidCallsPerList: 3,
      });
      await env.settled();
      const first = structuredClone(env.batch.researchProgress.fullResearch);
      assert.equal(first.status, "budget_exhausted");
      assert.ok(first.notificationId);
      assert.equal(first.attempts.length, 3);
      await controlFullResearch(env.batch.id, env.batch.userId, "start", {
        confirmed: true, ...FULL_RESEARCH_DEFAULTS, paidCallsPerList: 6,
      });
      await env.settled();
      const next = env.batch.researchProgress.fullResearch;
      assert.notEqual(next.notificationId, first.notificationId);
      assert.equal(next.startedAt, first.startedAt);
      assert.equal(next.attempts.length, 6);
      assert.deepEqual(next.attempts.slice(0, 3), first.attempts);
      assert.ok(first.processedIds.every((id: string) => next.processedIds.includes(id)));
    } finally { env.restore(); }
  });
  await t.test("manual pause and ordinary resume retain the same notification identity", async () => {
    const env = fixture(3);
    try {
      await controlFullResearch(env.batch.id, env.batch.userId, "start", {
        confirmed: true, ...FULL_RESEARCH_DEFAULTS, paidCallsPerHour: 1,
      });
      await env.settled();
      const identity = env.batch.researchProgress.fullResearch.notificationId;
      assert.equal(env.batch.researchProgress.fullResearch.status, "waiting_hourly");
      await controlFullResearch(env.batch.id, env.batch.userId, "pause", { confirmed: true });
      await controlFullResearch(env.batch.id, env.batch.userId, "resume", { confirmed: true });
      await env.settled();
      assert.equal(env.batch.researchProgress.fullResearch.notificationId, identity);
      assert.equal(env.batch.researchProgress.fullResearch.attempts.length, 1);
    } finally { env.restore(); }
  });
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
  await t.test("new 80/hour run waits before request 81 and automatically continues without refunding history", async () => {
    const env = fixture(30, false, false, 3);
    try {
      await controlFullResearch(env.batch.id, env.batch.userId, "start", { confirmed: true, ...FULL_RESEARCH_DEFAULTS });
      await env.settled();
      const run = env.batch.researchProgress.fullResearch;
      assert.deepEqual(run.limits, { businessesPerHour: 20, paidCallsPerHour: 80, paidCallsPerList: 200 });
      assert.equal(run.status, "waiting_hourly");
      assert.equal(run.enabled, true);
      assert.equal(env.providerAttempts, 80);
      assert.equal(run.attempts.length, 80);
      assert.equal(run.processedIds.length, 16);
      assert.ok(run.startedRows.length < 20, "paid-request stop is distinct from the unchanged business stop");
      assert.ok(env.hourlyPolicies.every(limit => limit === 80));
      await tickFullResearchScheduler();
      assert.equal(env.providerAttempts, 80, "request 81 must wait until allowance returns");
      run.attempts.forEach((call: any) => { call.at = new Date(Date.now() - 3600001).toISOString(); });
      const history = structuredClone(run.attempts);
      run.nextRunAt = new Date(Date.now() - 1).toISOString();
      await tickFullResearchScheduler();
      await wait(20); await env.settled();
      const continued = env.batch.researchProgress.fullResearch;
      assert.equal(env.providerAttempts, 95);
      assert.equal(continued.attempts.length, 95);
      assert.deepEqual(continued.attempts.slice(0, 80), history);
      assert.equal(env.rows[0].serpCallsUsed, 5, "completed businesses are not researched again");
      assert.equal(continued.status, "waiting_hourly", "unchanged business allowance also remains enforced");
      await controlFullResearch(env.batch.id, env.batch.userId, "pause", { confirmed: true });
      await tickFullResearchScheduler();
      assert.equal(env.providerAttempts, 95, "manual pause cannot be overridden by hourly continuation");
    } finally { env.restore(); }
  });
  await t.test("grooming questions share the confirmed worker hourly policy and paid ledger", async () => {
    const env = fixture(1, false, false, 1, 2);
    try {
      await controlFullResearch(env.batch.id,env.batch.userId,"start",{confirmed:true,...FULL_RESEARCH_DEFAULTS});
      await env.settled();
      assert.equal(env.providerAttempts,5);
      assert.deepEqual(env.hourlyPolicies,[80,80,80,80,80]);
      assert.deepEqual(env.batch.researchProgress.fullResearch.attempts.slice(-2).map((attempt:any)=>attempt.tool),
        ["grooming_services_search","grooming_shop_search"]);
      assert.equal(env.rows[0].evidence.groomingChecks.providerCalls,2);
      assert.equal(env.rows[0].reviewStatus,"needs_review");
      assert.equal(env.rows[0].importedContactId,null);
    } finally {env.restore();}
  });
  await t.test("list stop blocks an extra grooming question without refunding attempts or losing earlier email evidence", async () => {
    const env = fixture(1, false, false, 1, 2);
    try {
      await controlFullResearch(env.batch.id,env.batch.userId,"start",{confirmed:true,...FULL_RESEARCH_DEFAULTS,paidCallsPerList:4});
      await env.settled();
      assert.equal(env.providerAttempts,4);
      assert.equal(env.batch.researchProgress.fullResearch.status,"budget_exhausted");
      assert.equal(env.batch.researchProgress.fullResearch.attempts.length,4);
      assert.equal(env.rows[0].evidence.groomingChecks.providerCalls,1);
      assert.equal(env.rows[0].email,"row-1@fixture.example");
      assert.equal(env.rows[0].reviewStatus,"needs_review");
    } finally {env.restore();}
  });
  await t.test("the new 80-request default still stops before business 21", async () => {
    const env = fixture(30);
    try {
      await controlFullResearch(env.batch.id, env.batch.userId, "start", { confirmed: true, ...FULL_RESEARCH_DEFAULTS });
      await env.settled();
      const run = env.batch.researchProgress.fullResearch;
      assert.equal(run.startedRows.length, 20);
      assert.equal(run.processedIds.length, 20);
      assert.equal(env.providerAttempts, 60);
      assert.match(run.error, /Hourly business limit/);
      assert.equal(run.limits.paidCallsPerList, 200);
    } finally { env.restore(); }
  });
  await t.test("saved 40/hour run stays unchanged on viewing/startup and explicit resume ignores new-default fields", async () => {
    const env = fixture(15);
    try {
      const prior = newFullResearch({ ...FULL_RESEARCH_DEFAULTS, paidCallsPerHour: 40 }, Date.now());
      prior.enabled = false; prior.status = "paused";
      prior.attempts = Array.from({ length: 40 }, () => ({
        rowId: "previous-business", tool: "business_search", at: new Date().toISOString(),
      }));
      env.batch.researchProgress.fullResearch = prior;
      env.batch.status = "paused";
      const saved = JSON.stringify(env.batch.researchProgress);
      await tickFullResearchScheduler();
      assert.equal(JSON.stringify(env.batch.researchProgress), saved);
      assert.equal(env.providerAttempts, 0);
      await controlFullResearch(env.batch.id, env.batch.userId, "resume", { confirmed: true, paidCallsPerHour: 80 });
      await env.settled();
      const run = env.batch.researchProgress.fullResearch;
      assert.equal(run.limits.paidCallsPerHour, 40);
      assert.equal(run.attempts.length, 40);
      assert.equal(env.providerAttempts, 0);
      assert.equal(run.status, "waiting_hourly");
      assert.deepEqual(run.attempts, prior.attempts);
      assert.ok(env.hourlyPolicies.every(limit => limit === 40));
    } finally { env.restore(); }
  });
  await t.test("hourly paid cap stops mid-business without discarding prior evidence or allowing a duplicate start", async () => {
    const env = fixture(30);
    try {
      await controlFullResearch(env.batch.id, env.batch.userId, "start", { confirmed: true, ...FULL_RESEARCH_DEFAULTS, paidCallsPerHour: 40 });
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
  await t.test("all research tools receive the new confirmed 80/hour allowance, not legacy 20/hour", async () => {
    const env = fixture(1);
    try {
      await controlFullResearch(env.batch.id, env.batch.userId, "start", { confirmed: true, ...FULL_RESEARCH_DEFAULTS });
      await env.settled();
      assert.deepEqual(env.hourlyPolicies, [80, 80, 80]);
    } finally { env.restore(); }
  });
  await t.test("shared hourly throttling waits without charging or marking the blocked business complete, then scheduler continues", async () => {
    const env = fixture(1);
    try {
      env.setSharedThrottle(true);
      await controlFullResearch(env.batch.id, env.batch.userId, "start", { confirmed: true, ...FULL_RESEARCH_DEFAULTS });
      await env.settled();
      const run = env.batch.researchProgress.fullResearch;
      assert.equal(run.status, "waiting_hourly");
      assert.equal(run.enabled, true);
      assert.ok(Date.parse(run.nextRunAt) > Date.now());
      assert.equal(run.attempts.length, 0);
      assert.equal(run.processedIds.length, 0);
      assert.equal(env.rows[0].status, "pending");
      assert.equal(env.rows[0].sourceData.fullResearchState, "waiting_hourly");
      await tickFullResearchScheduler();
      assert.equal(env.providerAttempts, 0, "must not resume before its next allowance");
      env.setSharedThrottle(false);
      run.nextRunAt = new Date(Date.now() - 1).toISOString();
      await tickFullResearchScheduler();
      await wait(20);
      await env.settled();
      assert.equal(env.providerAttempts, 3);
      assert.equal(env.batch.researchProgress.fullResearch.status, "completed");
      assert.deepEqual(env.batch.researchProgress.fullResearch.processedIds, [env.rows[0].id]);
    } finally { env.restore(); }
  });
  await t.test("scheduler resumes mid-list paid hourly waits and preserves earlier calls/results", async () => {
    const env = fixture(2);
    try {
      await controlFullResearch(env.batch.id, env.batch.userId, "start",
        { confirmed: true, ...FULL_RESEARCH_DEFAULTS, paidCallsPerHour: 4 });
      await env.settled();
      const run = env.batch.researchProgress.fullResearch;
      assert.equal(run.status, "waiting_hourly");
      assert.equal(run.attempts.length, 4);
      assert.deepEqual(run.processedIds, [env.rows[0].id]);
      assert.ok(env.rows[0].email);
      run.attempts.forEach((call: any) => { call.at = new Date(Date.now() - 3600001).toISOString(); });
      run.nextRunAt = new Date(Date.now() - 1).toISOString();
      await tickFullResearchScheduler();
      await wait(20);
      await env.settled();
      assert.equal(env.batch.researchProgress.fullResearch.status, "completed");
      assert.equal(env.batch.researchProgress.fullResearch.attempts.length, 7, "earlier calls must never reset");
      assert.equal(env.batch.researchProgress.fullResearch.processedIds.length, 2);
      assert.equal(env.rows[0].serpCallsUsed, 3, "completed row was not researched again");
    } finally { env.restore(); }
  });
  await t.test("the shared monthly hard stop pauses rather than automatically retrying or raising budget", async () => {
    const env = fixture(1);
    try {
      env.setSharedThrottle(true, true);
      await controlFullResearch(env.batch.id, env.batch.userId, "start", { confirmed: true, ...FULL_RESEARCH_DEFAULTS });
      await env.settled();
      assert.equal(env.batch.researchProgress.fullResearch.status, "paused");
      assert.equal(env.batch.researchProgress.fullResearch.enabled, false);
      assert.match(env.batch.researchProgress.fullResearch.error, /Shared app monthly safety stop/);
      assert.equal(env.providerAttempts, 0);
      await tickFullResearchScheduler();
      assert.equal(env.providerAttempts, 0);
    } finally { env.restore(); }
  });
  await t.test("confirmed resume recovers old hourly-blocked processed IDs without resetting paid attempts", async () => {
    const env = fixture(2);
    try {
      const run = newFullResearch(FULL_RESEARCH_DEFAULTS, Date.now());
      run.status = "paused"; run.enabled = false;
      run.startedRows = env.rows.map(row => ({ id: row.id, at: new Date().toISOString() }));
      run.processedIds = env.rows.map(row => row.id);
      run.attempts = [{ rowId: env.rows[0].id, tool: "business_search", at: new Date(Date.now() - 3600001).toISOString() }];
      env.batch.researchProgress.fullResearch = run;
      env.rows[0].status = "enriched";
      env.rows[1].status = "failed";
      env.rows[1].lastError = "SERP quota or hourly limit reached (20/hour). Please wait.";
      await controlFullResearch(env.batch.id, env.batch.userId, "resume", { confirmed: true });
      await env.settled();
      assert.equal(env.providerAttempts, 3);
      assert.equal(env.rows[0].serpCallsUsed, 0);
      assert.equal(env.batch.researchProgress.fullResearch.attempts.length, 4);
      assert.equal(env.batch.researchProgress.fullResearch.status, "completed");
    } finally { env.restore(); }
  });
  await t.test("automatic continuation never activates disabled or terminal runs", () => {
    const run = newFullResearch(FULL_RESEARCH_DEFAULTS, Date.now());
    assert.equal(fullResearchIsDue(run, Date.now()), true);
    for (const status of ["paused", "interrupted", "completed", "budget_exhausted"] as const) {
      assert.equal(fullResearchIsDue({ ...run, status }, Date.now()), false);
    }
    assert.equal(fullResearchIsDue({ ...run, enabled: false }, Date.now()), false);
  });
});