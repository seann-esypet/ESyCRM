import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "./db";
import { storage } from "./storage";
import { salonEnrichmentBatches, salonEnrichmentRows, type SalonEnrichmentRow } from "@shared/schema";
import { directoryObject } from "@shared/directoryEligibility";
import { fullResearchLimitsSchema, type FullResearchProgress } from "@shared/fullResearch";
import { sharedSerpStopMessage } from "@shared/serpBudget";
import { isResearchDirectoryBatch, isResearchDirectoryRow, RESEARCH_READ_ONLY } from "./salonResearchPolicy";
import { salonEnrichmentIsActive } from "./salonEnrichment";
import { researchFullRow, fullResearchRowTools } from "./fullResearchRow";
import { getSerpUsageStatus } from "./lead-discovery";
import { readFullResearch, newFullResearch, researchAllowance, reserveResearchPaidCall, hasResearchLease, isHourlyResearchError, isTemporaryProviderResearchError, providerRateLimitWait, type FullResearchBlock } from "./fullResearchPolicy";

const LEASE_MS = 10 * 60 * 1000;
const active = new Set<string>();
const eligible = (row: SalonEnrichmentRow) => !row.importedContactId &&
  !["approved", "rejected"].includes(row.reviewStatus || "") && !isResearchDirectoryRow(row);
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function locked<T>(id: string, owner: string, action: (
  tx: Transaction, batch: typeof salonEnrichmentBatches.$inferSelect, run: FullResearchProgress | null,
) => Promise<T>) {
  return db.transaction(async tx => {
    // Same lock as the legacy manual worker, so both cannot start together.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`lead-research:${id}`}))`);
    const [batch] = await tx.select().from(salonEnrichmentBatches)
      .where(and(eq(salonEnrichmentBatches.id, id), eq(salonEnrichmentBatches.userId, owner))).for("update");
    if (!batch) throw new Error("Saved list not found or inaccessible.");
    if (isResearchDirectoryBatch(batch)) throw new Error(RESEARCH_READ_ONLY);
    return action(tx, batch, readFullResearch(directoryObject(batch.researchProgress).fullResearch));
  });
}
async function save(tx: Transaction, batch: typeof salonEnrichmentBatches.$inferSelect, run: FullResearchProgress) {
  await tx.update(salonEnrichmentBatches).set({
    researchProgress: { ...directoryObject(batch.researchProgress), fullResearch: run },
    status: run.status === "running" ? "running" : run.status === "completed" ? "completed" : "paused",
    updatedAt: new Date(), errorMessage: run.error,
  }).where(eq(salonEnrichmentBatches.id, batch.id));
}
function stopFor(run: FullResearchProgress, block: FullResearchBlock) {
  run.status = block.status; run.nextRunAt = block.nextRunAt; run.error = block.message;
  run.waitReason = block.waitReason;
  if (block.status !== "waiting_hourly") run.enabled = false;
}

export async function controlFullResearch(id: string, owner: string, action: string, input: any) {
  if (input?.confirmed !== true) throw new Error("Confirm this saved list and its paid-request limits first.");
  await locked(id, owner, async (tx, batch, prior) => {
    const now = Date.now();
    const rows = await tx.select().from(salonEnrichmentRows)
      .where(and(eq(salonEnrichmentRows.batchId, id), eq(salonEnrichmentRows.userId, owner)));
    if (rows.some(isResearchDirectoryRow)) throw new Error(RESEARCH_READ_ONLY);
    if (action === "pause") {
      if (!prior) throw new Error("Full Research has not been started.");
      prior.enabled = false; prior.status = "paused"; prior.nextRunAt = null;
      prior.error = "Paused by you. An in-flight request may finish; no new paid requests will start.";
      await save(tx, batch, prior);
      return;
    }
    if (action === "recover") {
      if (!prior || hasResearchLease(prior, now) || active.has(id)) throw new Error("A worker may still be active. Wait for its lease to expire before recovering.");
      if (!prior.currentRowId && prior.status !== "interrupted") throw new Error("There is no interrupted work to recover.");
      if (prior.currentRowId) await tx.update(salonEnrichmentRows).set({
        status: "failed", lastError: "Interrupted research recovered. Previous paid attempts remain counted.", updatedAt: new Date(),
      }).where(and(eq(salonEnrichmentRows.id, prior.currentRowId), eq(salonEnrichmentRows.userId, owner)));
      prior.currentRowId = null; prior.lease = null; prior.enabled = false; prior.status = "paused";
      prior.error = "Recovered safely. Confirm Resume to continue within the remaining allowance.";
      await save(tx, batch, prior);
      return;
    }
    if ((prior && hasResearchLease(prior, now)) ||
        active.has(id) || salonEnrichmentIsActive(id)) throw new Error("A worker is already active. Pause and wait for it to finish.");
    if ((!prior && batch.status === "running") || rows.some(row => row.status === "processing")) throw new Error("Earlier research is still processing. Recover it before starting.");
    if (prior?.currentRowId || prior?.status === "interrupted") throw new Error("Recover interrupted work before restarting. Its paid attempts cannot be reset.");
    if (action !== "start" && action !== "resume") throw new Error("Unknown Full Research action.");
    if (action === "resume" && !prior) throw new Error("There is no Full Research queue to resume.");
    const limits = action === "start" ? fullResearchLimitsSchema.parse(input) : prior!.limits;
    const run = prior || newFullResearch(limits, now);
    run.limits = limits;
    if (run.attempts.length >= limits.paidCallsPerList) throw new Error("Approve a higher TOTAL paid-request cap. Earlier requests are not refunded or reset.");
    // Older workers marked an hourly-blocked business complete. Repair only
    // on explicitly confirmed resume, without resetting any paid history.
    if (action === "resume") {
      const throttled = rows.filter(row => eligible(row) && row.status === "failed" &&
        (isHourlyResearchError(row.lastError) || isTemporaryProviderResearchError(row.lastError)));
      run.processedIds = run.processedIds.filter(rowId => !throttled.some(row => row.id === rowId));
    }
    if (!rows.some(row => eligible(row) && !run.processedIds.includes(row.id))) throw new Error("No remaining reviewable businesses in this list.");
    // A new, explicitly confirmed search gets a fresh notice without resetting
    // the cumulative provider spending, processed rows, or original start time.
    if (action === "start" || ["completed", "budget_exhausted"].includes(run.status)) {
      run.notificationId = randomUUID();
    }
    run.enabled = true; run.status = "running"; run.error = null; run.nextRunAt = null; run.waitReason = undefined;
    await save(tx, batch, run);
  });
  if (action === "start" || action === "resume") launch(id, owner);
  return storage.getSalonEnrichmentBatch(id, owner);
}

function launch(id: string, owner: string) {
  if (active.has(id)) return;
  active.add(id);
  void processQueue(id, owner).catch(error => console.error("[Full Research] Worker stopped:", error instanceof Error ? error.message : "unknown failure"))
    .finally(() => active.delete(id));
}
async function processQueue(id: string, owner: string) {
  const token = randomUUID();
  const acquired = await locked(id, owner, async (tx, batch, run) => {
    if (!run?.enabled || hasResearchLease(run, Date.now())) return false;
    if (run.currentRowId) {
      run.status = "interrupted"; run.enabled = false; run.error = "A previous worker stopped mid-business. Recover explicitly; paid requests remain counted.";
      await save(tx, batch, run); return false;
    }
    run.lease = { token, expiresAt: new Date(Date.now() + LEASE_MS).toISOString() };
    await save(tx, batch, run); return run.limits.paidCallsPerHour;
  });
  if (!acquired) return;
  const heartbeat = setInterval(() => {
    void locked(id, owner, async (tx, batch, run) => {
      if (run?.lease?.token === token) {
        run.lease.expiresAt = new Date(Date.now() + LEASE_MS).toISOString();
        await save(tx, batch, run);
      }
    }).catch(() => { /* Before-provider and save guards stop a worker whose lease cannot be renewed. */ });
  }, 30000);
  heartbeat.unref();
  try {
    while (true) {
      const row = await locked(id, owner, async (tx, batch, run) => {
        if (!run || run.lease?.token !== token || !hasResearchLease(run, Date.now()) || !run.enabled) return null;
        const rows = await tx.select().from(salonEnrichmentRows)
          .where(and(eq(salonEnrichmentRows.batchId, id), eq(salonEnrichmentRows.userId, owner)));
        const next = rows.find(item => eligible(item) && !run.processedIds.includes(item.id) && item.status !== "processing");
        if (!next && rows.some(item => eligible(item) && item.status === "processing")) {
          run.enabled = false; run.status = "interrupted";
          run.error = "An earlier row is still processing. Recover interrupted work explicitly.";
          await save(tx, batch, run); return null;
        }
        if (!next) { run.enabled = false; run.status = "completed"; run.error = null; run.nextRunAt = null; await save(tx, batch, run); return null; }
        const block = researchAllowance(run, "business", Date.now());
        if (block) { stopFor(run, block); await save(tx, batch, run); return null; }
        run.startedRows.push({ id: next.id, at: new Date().toISOString() });
        run.currentRowId = next.id; run.status = "running"; run.nextRunAt = null; run.error = null;
        await tx.update(salonEnrichmentRows).set({ status: "processing", updatedAt: new Date() }).where(eq(salonEnrichmentRows.id, next.id));
        await save(tx, batch, run);
        return next;
      });
      if (!row) break;
      let blocked: FullResearchBlock | null = null;
      const patch = await researchFullRow(row, async tool => {
        if (blocked) throw new Error(blocked.message);
        const block = await locked(id, owner, async (tx, batch, run) => {
          if (!run || run.lease?.token !== token || !hasResearchLease(run, Date.now())) throw new Error("Research lease lost; no additional paid request was initiated.");
          const [fresh] = await tx.select().from(salonEnrichmentRows)
            .where(and(eq(salonEnrichmentRows.id, row.id), eq(salonEnrichmentRows.userId, owner)));
          if (!fresh || !eligible(fresh)) return { status: "paused" as const, nextRunAt: null, message: "This business is no longer eligible. Research paused." };
          const result = reserveResearchPaidCall(run, row.id, tool, Date.now());
          if (result) stopFor(run, result);
          run.lease.expiresAt = new Date(Date.now() + LEASE_MS).toISOString();
          await save(tx, batch, run); // Persist the attempt BEFORE the network request, even if it fails.
          return result;
        });
        if (block) { blocked = block; throw new Error(block.message); }
      }, fullResearchRowTools, {
        hourlyLimit: acquired,
        onProviderBlocked: async providerBlock => {
          await locked(id, owner, async (tx, batch, run) => {
            if (!run || run.lease?.token !== token || !hasResearchLease(run, Date.now())) throw new Error("Research lease lost before scheduling a retry.");
            blocked = !run.enabled
              ? { status: "paused", nextRunAt: null, message: run.error || "Paused by you. No new paid requests will start." }
              : providerBlock.temporary
                ? providerRateLimitWait(run, Date.now(), providerBlock.retryAfterMs)
                : { status: "paused", nextRunAt: null, message: providerBlock.message };
            stopFor(run, blocked);
            await save(tx, batch, run);
          });
        },
        onReservationBlocked: async () => {
          const usage = await getSerpUsageStatus();
          blocked = usage.isQuotaReached
            ? { status: "paused", nextRunAt: null, message: sharedSerpStopMessage(usage.usage.usedCredits, usage.usage.hardStopAt) }
            : { status: "waiting_hourly", nextRunAt: await storage.getNextSerpCallAt(acquired),
              message: "Hourly shared provider allowance reached. Research will continue automatically when allowance becomes available." };
          throw new Error(blocked.message);
        },
      });
      await locked(id, owner, async (tx, batch, run) => {
        if (!run || run.lease?.token !== token || !hasResearchLease(run, Date.now())) throw new Error("Research lease lost before saving results. Recover interrupted work.");
        const [fresh] = await tx.select().from(salonEnrichmentRows)
          .where(and(eq(salonEnrichmentRows.id, row.id), eq(salonEnrichmentRows.userId, owner))).for("update");
        if (fresh && eligible(fresh)) {
          const evidence = directoryObject(fresh.evidence), newEvidence = directoryObject(patch.evidence);
          // Never overwrite a confirmed/manual name or erase previously saved candidates.
          if (directoryObject(evidence.ownerName).status === "approved") delete newEvidence.ownerName;
          else if (newEvidence.ownerName) {
            const previousName = directoryObject(evidence.ownerName), nextName = directoryObject(newEvidence.ownerName);
            const previousCandidates = Array.isArray(previousName.candidates) ? previousName.candidates : [];
            const nextCandidates = Array.isArray(nextName.candidates) ? nextName.candidates : [];
            const candidates = [...new Map([...previousCandidates, ...nextCandidates].map(candidate => [JSON.stringify(candidate), candidate])).values()];
            newEvidence.ownerName = { ...nextName, candidates,
              ...(candidates.length ? { status: "needs_review" } : {}) };
          }
          const merged = { ...evidence, ...newEvidence };
          for (const [key, value] of Object.entries(newEvidence)) if (directoryObject(value).value == null && directoryObject(evidence[key]).value != null) merged[key] = evidence[key];
          await tx.update(salonEnrichmentRows).set({
            ...patch, ...(fresh.email && !patch.email ? { email: fresh.email } : {}),
            evidence: merged, updatedAt: new Date(),
            serpCallsUsed: run.attempts.filter(attempt => attempt.rowId === row.id).length,
            ...(blocked ? { status: "pending", lastError: blocked.message,
              sourceData: { ...directoryObject(fresh.sourceData), stagingState: "verification_attempted",
                fullResearchState: blocked.status === "waiting_hourly" ? "waiting_hourly" : "paused",
                fullResearchWaitReason: blocked.waitReason ?? null } }
              : { sourceData: { ...directoryObject(fresh.sourceData), stagingState: "verification_attempted", fullResearchState: "researched", fullResearchWaitReason: null } }),
          }).where(eq(salonEnrichmentRows.id, row.id));
        }
        if (!blocked) {
          run.processedIds = [...new Set([...run.processedIds, row.id])];
          run.providerRateLimitCount = 0;
          run.waitReason = undefined;
        }
        run.currentRowId = null;
        if (blocked) stopFor(run, run.status === "paused" && run.error?.startsWith("Paused by you.") ? {
          status: "paused", nextRunAt: null, message: "Paused by you. No new paid requests will start.",
        } : blocked);
        // Genuine provider/infrastructure failures need explicit review, not hourly paid retry loops.
        if (!blocked && patch.status === "failed") {
          run.enabled = false; run.status = "paused"; run.error = patch.lastError || "A research tool failed. Review before resuming.";
        }
        await save(tx, batch, run);
      });
      await storage.refreshSalonEnrichmentBatchCounts(id, owner);
      if (blocked) break;
    }
  } catch (error) {
    await locked(id, owner, async (tx, batch, run) => {
      if (run?.lease?.token !== token) return;
      run.enabled = false; run.status = run.currentRowId ? "interrupted" : "paused";
      run.error = error instanceof Error ? error.message : "Research stopped safely.";
      await save(tx, batch, run);
    });
  } finally {
    clearInterval(heartbeat);
    await locked(id, owner, async (tx, batch, run) => {
      if (run?.lease?.token === token) { run.lease = null; await save(tx, batch, run); }
    });
  }
}

export function fullResearchIsDue(run: FullResearchProgress, now: number) {
  return run.enabled && ["running", "waiting_hourly"].includes(run.status) &&
    !hasResearchLease(run, now) && (!run.nextRunAt || Date.parse(run.nextRunAt) <= now);
}
let checking = false;
export async function tickFullResearchScheduler() {
  if (checking) return;
  checking = true;
  try {
    const batches = await db.select().from(salonEnrichmentBatches)
      .where(sql`${salonEnrichmentBatches.researchProgress}->'fullResearch'->>'enabled' = 'true'`);
    for (const batch of batches) {
      const run = readFullResearch(directoryObject(batch.researchProgress).fullResearch);
      if (run && fullResearchIsDue(run, Date.now())) launch(batch.id, batch.userId);
    }
  } catch (error) {
    console.error("[Full Research] Scheduler could not read its queue; no new lookup was started.", error instanceof Error ? error.message : "unknown failure");
  } finally { checking = false; }
}
export function startFullResearchScheduler() {
  const tick = tickFullResearchScheduler;
  const timer = setInterval(() => { void tick(); }, 60000);
  timer.unref();
  void tick();
}