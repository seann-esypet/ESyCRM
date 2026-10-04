import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "./db";
import { storage } from "./storage";
import { salonEnrichmentBatches, salonEnrichmentRows } from "@shared/schema";
import { directoryObject } from "@shared/directoryEligibility";
import { enrichRow } from "./salonEnrichment";
import { crawlWebsite, searchWithSerpApi } from "./lead-discovery";
import { businessAndLocationMatch, extractSalonOwnerCandidates, stripHtml, searchSalonContactPages } from "./salonOwnerNames";
import { EMPTY_OWNER_NAME_RESULT } from "@shared/salonOwnerName";
import { isResearchDirectoryBatch, isResearchDirectoryRow, RESEARCH_READ_ONLY } from "./salonResearchPolicy";
import { salonEnrichmentIsActive } from "./salonEnrichment";
import type { SalonEnrichmentRow } from "@shared/schema";
import { leadView } from "./leadWorkspacePolicy";
import { recoveredLeadEvidence } from "./leadWorkspaceSavedEvidence";
import { safeWebsite } from "./salonListStaging";

const active = new Set<string>();
const unresolved = (row: SalonEnrichmentRow) => !row.email && !(leadView(recoveredLeadEvidence(row)).candidateEmail && leadView(recoveredLeadEvidence(row)).sourceUrl) && !row.importedContactId &&
  row.reviewStatus !== "approved" && row.reviewStatus !== "rejected" && row.status !== "processing";
export async function leadResearchEstimate(id: string, owner: string | null) {
  const batch = await storage.getSalonEnrichmentBatch(id, owner);
  if (!batch) throw new Error("Saved list not found.");
  const rows = await storage.getSalonEnrichmentRows(id, batch.userId);
  const closed = isResearchDirectoryBatch(batch) || rows.some(isResearchDirectoryRow);
  const eligibleRows = closed ? 0 : rows.filter(unresolved).length;
  return { eligibleRows, maxProviderCalls: Math.min(100, eligibleRows * 2),
    active: active.has(id) || salonEnrichmentIsActive(id), reason: closed ? RESEARCH_READ_ONLY : null };
}
export async function pauseLeadResearch(id: string, owner: string) {
  const batch = await storage.updateSalonEnrichmentBatch(id, { status: "paused", pausedAt: new Date() }, owner);
  if (!batch) throw new Error("Saved list not found or not owned by you.");
  return batch;
}
export async function recoverLeadResearch(id:string,owner:string){
  if(active.has(id)||salonEnrichmentIsActive(id))throw new Error("A worker is active. Pause it and wait for the current row; do not recover live work.");
  return db.transaction(async tx=>{
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`lead-research:${id}`}))`);
    const [batch]=await tx.select().from(salonEnrichmentBatches).where(and(eq(salonEnrichmentBatches.id,id),eq(salonEnrichmentBatches.userId,owner))).for("update");
    const run=directoryObject(directoryObject(batch?.researchProgress).leadResearch);
    if(!batch||!run.runId||isResearchDirectoryBatch(batch))throw new Error("There is no recoverable workflow run.");
    if(batch.updatedAt&&Date.now()-new Date(batch.updatedAt).getTime()<300_000)throw new Error("Wait five minutes without progress before recovering interrupted work; another worker may still be finishing.");
    await tx.update(salonEnrichmentRows).set({status:"failed",lastError:"Interrupted worker recovered explicitly. Previous provider attempts remain charged to the same confirmed allowance.",updatedAt:new Date()})
      .where(and(eq(salonEnrichmentRows.batchId,id),eq(salonEnrichmentRows.userId,owner),eq(salonEnrichmentRows.status,"processing")));
    const [updated]=await tx.update(salonEnrichmentBatches).set({status:"paused",updatedAt:new Date(),errorMessage:"Interrupted work recovered. Resume requires separate confirmation; retained provider allowance was not reset."})
      .where(eq(salonEnrichmentBatches.id,id)).returning();
    return updated;
  });
}
export async function startLeadResearch(id: string, owner: string, input: any, resume = false) {
  if (input.includeOwnerNames) throw new Error("Extra paid name search has its own estimate and confirmation. Website name evidence is collected together with email.");
  const existing = await storage.getSalonEnrichmentBatch(id, owner);
  if (!existing) throw new Error("Saved list not found or not owned by you.");
  const metadata = directoryObject(existing.researchProgress), previous = directoryObject(metadata.leadResearch);
  const rowLimit = resume ? Number(previous.rowLimit) : Number(input.rowLimit);
  const maxProviderCalls = resume ? Number(previous.maxProviderCalls) : Number(input.maxProviderCalls);
  if (!Number.isInteger(rowLimit) || rowLimit < 1 || rowLimit > 100 ||
    !Number.isInteger(maxProviderCalls) || maxProviderCalls < 0 || maxProviderCalls > 100) {
    throw new Error("Confirm a batch of 1–100 businesses and an additional provider-call cap of 0–100.");
  }
  if (active.has(id) || salonEnrichmentIsActive(id)) throw new Error("Research is already running. Pause it before starting another batch.");
  const prepared = await db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`lead-research:${id}`}))`);
    const [batch] = await tx.select().from(salonEnrichmentBatches).where(and(eq(salonEnrichmentBatches.id, id), eq(salonEnrichmentBatches.userId, owner))).for("update");
    if (!batch || batch.status === "running") throw new Error("Research is already running or inaccessible.");
    const rows = await tx.select().from(salonEnrichmentRows).where(and(eq(salonEnrichmentRows.batchId, id), eq(salonEnrichmentRows.userId, owner)));
    if (isResearchDirectoryBatch(batch) || rows.some(isResearchDirectoryRow)) throw new Error(RESEARCH_READ_ONLY);
    if (rows.some(row => row.status === "processing")) throw new Error("A prior row is still processing; reconcile its state before retrying.");
    const source = directoryObject(batch.researchProgress), prior = directoryObject(source.leadResearch);
    if (resume && (!prior.runId || !["paused", "failed"].includes(batch.status))) throw new Error("There is no paused research batch to resume.");
    const selectedIds = resume ? prior.rowIds as string[] : rows.filter(unresolved).slice(0, rowLimit).map(row => row.id);
    if (!selectedIds?.length) throw new Error("No unresolved rows are available.");
    const run = resume ? prior : { runId: randomUUID(), rowIds: selectedIds, rowLimit, maxProviderCalls,
      attemptedCalls: 0, providerCalls: 0, cacheHits: 0, processedIds: [], createdAt: new Date().toISOString() };
    const [updated] = await tx.update(salonEnrichmentBatches).set({ status: "running", researchProgress: { ...source, leadResearch: run },
      errorMessage: null, pausedAt: null }).where(eq(salonEnrichmentBatches.id, id)).returning();
    return { batch: updated, run };
  });
  active.add(id);
  void process(id, owner).finally(() => active.delete(id));
  return { batch: prepared.batch, eligibleRows: prepared.run.rowIds?.length, maxProviderCalls, started: true };
}
async function changeRun(id: string, owner: string, change: (run: any) => void, requireRunning=false) {
  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`lead-research:${id}`}))`);
    const [batch] = await tx.select().from(salonEnrichmentBatches).where(and(eq(salonEnrichmentBatches.id, id), eq(salonEnrichmentBatches.userId, owner))).for("update");
    if (!batch) throw new Error("Research list no longer exists.");
    if(requireRunning&&batch.status!=="running")throw new Error("Research paused; no additional provider call was initiated.");
    const source = directoryObject(batch.researchProgress), run = { ...directoryObject(source.leadResearch) };
    change(run);
    await tx.update(salonEnrichmentBatches).set({ researchProgress: { ...source, leadResearch: run },updatedAt:new Date() }).where(eq(salonEnrichmentBatches.id, id));
    return run;
  });
}
async function process(id: string, owner: string) {
  try {
    let batch = await storage.getSalonEnrichmentBatch(id, owner);
    const run = directoryObject(directoryObject(batch?.researchProgress).leadResearch);
    for (const rowId of run.rowIds as string[]) {
      batch = await storage.getSalonEnrichmentBatch(id, owner);
      if (batch?.status !== "running") return;
      const freshRun = directoryObject(directoryObject(batch.researchProgress).leadResearch);
      if ((freshRun.processedIds as string[] || []).includes(rowId)) continue;
      const row = await storage.getSalonEnrichmentRow(rowId, owner);
      if (!row || !unresolved(row)) continue;
      const pages: { url: string; html: string }[] = [];
      const cached = new Map<string, Awaited<ReturnType<typeof crawlWebsite>>>();
      const crawl: typeof crawlWebsite = async (url, options) => {
        if (cached.has(url)) return cached.get(url)!;
        const result = await crawlWebsite(url, { ...options, onPage: page => pages.push(page) });
        const matched = businessAndLocationMatch(row, stripHtml(result.html));
        const safe = matched ? result : { ...result, email: undefined, phone: undefined, ownerName: undefined,
          rejectedEmails: [...result.rejectedEmails, ...(result.email ? [{ value: result.email, sourceUrl: result.emailSourceUrl || url,
            reason: "Live page did not confirm this exact business/location; manual identity review required." }] : [])] };
        cached.set(url, safe); return safe;
      };
      let matchedWebsite = false;
      if (row.websiteUrl) {
        try {
          const result = await crawl(row.websiteUrl);
          matchedWebsite = businessAndLocationMatch(row,
            stripHtml(result.html));
        } catch { /* Targeted lookup can resolve a missing or mismatched website; it is bounded below. */ }
      }
      const search: typeof searchWithSerpApi = async (...args) => {
        // Cache hits do not consume the allowance. Persist every real attempt
        // immediately before the network call; failures never refund it.
        const [query,zip,state,template,options]=args;
        const result = await searchWithSerpApi(query,zip,state,template,{...options,beforeProviderRequest:async()=>{
          await changeRun(id,owner,current=>{
            if(Number(current.attemptedCalls)>=Number(current.maxProviderCalls))throw new Error("Confirmed additional provider-call budget exhausted.");
            current.attemptedCalls=Number(current.attemptedCalls)+1;
            current.providerCalls=Number(current.providerCalls||0)+1;
          },true);
          await options?.beforeProviderRequest?.();
        }});
        await changeRun(id, owner, current => {
          if (result.fromCache) current.cacheHits = Number(current.cacheHits || 0) + 1;
        });
        return result;
      };
      await storage.updateSalonEnrichmentRow(row.id, { status: "processing" }, owner);
      try {
        const currentRun=directoryObject(directoryObject((await storage.getSalonEnrichmentBatch(id,owner))?.researchProgress).leadResearch);
        const fallbackSearch:typeof searchWithSerpApi=async()=> {
          const result=await searchSalonContactPages(row,Number(currentRun.maxProviderCalls)-Number(currentRun.attemptedCalls),async()=> {
            await changeRun(id,owner,current=>{
              if(Number(current.attemptedCalls)>=Number(current.maxProviderCalls))throw new Error("Confirmed additional provider-call budget exhausted.");
              current.attemptedCalls=Number(current.attemptedCalls)+1;
              current.providerCalls=Number(current.providerCalls||0)+1;
            },true);
          });
          if(!result.calls&&!result.error)await changeRun(id,owner,current=>{current.cacheHits=Number(current.cacheHits||0)+1;});
          return {results:result.results,fromCache:result.calls===0};
        };
        const result = await enrichRow(row, { search, fallbackSearch, crawl, matchedWebsite });
        if(result.websiteUrl&&!safeWebsite(result.websiteUrl)){
          const evidence=directoryObject(result.evidence);
          result.evidence={...evidence,publicSource:{value:result.websiteUrl,sourceUrl:result.websiteUrl,
            source:"public_listing",rationale:"Public source, not a confirmed business-owned website."},
            website:{value:null,rationale:"Booking, social and directory links stay separate from business websites."},
            ...(result.email?{email:{...directoryObject(evidence.email),source:"public_directory",confidence:"medium",purpose:"general"}}:{})};
          result.websiteUrl=null;result.hasWebsite="Unknown";
        }
        const candidates = pages.flatMap(page => {
          const text = stripHtml(page.html);
          const matched = businessAndLocationMatch(row, text);
          return matched ? extractSalonOwnerCandidates(text, { url: page.url, excerpt: text.slice(0, 800), kind: safeWebsite(page.url)?"business_website":"public_source" }, true, true, row.businessName) : [];
        });
        await db.transaction(async tx => {
          const [fresh] = await tx.select().from(salonEnrichmentRows).where(and(eq(salonEnrichmentRows.id, row.id), eq(salonEnrichmentRows.userId, owner))).for("update");
          if (!fresh || fresh.reviewStatus === "approved" || fresh.importedContactId) return;
          const evidence = directoryObject(fresh.evidence), priorOwner = directoryObject(evidence.ownerName);
          await tx.update(salonEnrichmentRows).set({
            ...result, reviewStatus: "needs_review", serpCallsUsed: fresh.serpCallsUsed + Number(result.serpCallsUsed || 0),
            sourceData: { ...directoryObject(fresh.sourceData), stagingState: "verification_attempted" },
            evidence: { ...evidence, ...directoryObject(result.evidence),
              ...(candidates.length && priorOwner.status !== "approved" ? { ownerName: { ...EMPTY_OWNER_NAME_RESULT,
                status: "needs_review", candidates, pagesFetched: pages.length } } : {}) },
          }).where(eq(salonEnrichmentRows.id, row.id));
        });
        await changeRun(id, owner, current => { current.processedIds = [...(current.processedIds || []), row.id]; });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Research failed.";
        await storage.updateSalonEnrichmentRow(row.id, { status: "failed", lastError: message }, owner);
        await storage.updateSalonEnrichmentBatch(id, { status: "paused", errorMessage: message }, owner);
        return;
      }
      await storage.refreshSalonEnrichmentBatchCounts(id, owner);
    }
    await storage.updateSalonEnrichmentBatch(id, { status: "completed", completedAt: new Date() }, owner);
  } catch (error) {
    await storage.updateSalonEnrichmentBatch(id, { status: "paused", errorMessage: error instanceof Error ? error.message : "Research needs review." }, owner);
  }
}