import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { storage } from "./storage";
import { pool } from "./db";
import { startSalonEnrichment, enrichRow, salonEnrichmentIsActive } from "./salonEnrichment";
import { isResearchDirectoryBatch, isResearchDirectoryRow, rejectResearchExecution } from "./salonResearchPolicy";
import { lookupSalonOwnerName } from "./salonOwnerNames";

test("all generic paid batch endpoints reject research directories before mutation", async () => {
  const paths = ["start", "resume", "rows/retry", "verify"];
  const source = readFileSync("server/routes.ts", "utf8");
  for (const path of paths) assert(source.includes(
    `app.post("/api/salon-enrichment/batches/:id/${path}", isAuthenticated, rejectResearchExecution,`));
  const original = {
    getSalonEnrichmentBatch: storage.getSalonEnrichmentBatch,
    getSalonEnrichmentRows: storage.getSalonEnrichmentRows,
  };
  let batch: any = { id: "fixed", userId: "owner", pilotLimit: 120, processedRows: 81,
    status: "paused", researchProgress: { datasetKey: "fixed" } };
  let rows: any[] = [];
  let mutations = 0;
  storage.getSalonEnrichmentBatch = async (_id, scope) => scope === "foreign" ? undefined : batch;
  storage.getSalonEnrichmentRows = async () => rows;
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.user = { claims: { sub: req.headers["x-owner"] || "owner", role: req.headers["x-role"] || "user" } };
    next();
  });
  for (const path of paths) app.post(`/api/salon-enrichment/batches/:id/${path}`,
    rejectResearchExecution, (_req, res) => { mutations++; res.json({ started: true }); });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = `http://127.0.0.1:${(server.address() as any).port}/api/salon-enrichment/batches/fixed`;
  try {
    for (const path of paths) for (const role of ["user", "admin"]) {
      const response = await fetch(`${url}/${path}`, { method: "POST",
        headers: { "Content-Type": "application/json", "x-role": role },
        body: JSON.stringify({ pilotLimit: 13847, rowIds: ["pending-directory-row"], maxProviderCalls: 200 }) });
      assert.equal(response.status, 409);
      assert.match((await response.json()).message, /browse-only/);
    }
    assert.equal(mutations, 0);
    assert.equal(batch.pilotLimit, 120);
    assert.equal(batch.status, "paused");
    assert.equal((await fetch(`${url}/start`, { method: "POST", headers: { "x-owner": "foreign" } })).status, 404);
    batch = { ...batch, researchProgress: null };
    rows = [{ sourceData: { stagingState: "research_directory" } }];
    assert.equal((await fetch(`${url}/resume`, { method: "POST" })).status, 409, "row guard survives missing batch metadata");
    rows = [{ sourceData: { stagingState: "staged_unverified" } }];
    assert.equal((await fetch(`${url}/start`, { method: "POST" })).status, 200, "ordinary batches retain their existing handlers");
    assert.equal(mutations, 1);
  } finally {
    Object.assign(storage, original);
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test("direct workers and owner lookups cannot execute research-directory rows", async () => {
  assert(isResearchDirectoryBatch({ researchProgress: { datasetKey: "fixed" } }));
  assert(isResearchDirectoryRow({ sourceData: { researchDataset: "fixed" } }));
  assert.throws(() => startSalonEnrichment({ id: "closed", researchProgress: { datasetKey: "fixed" } } as any), /browse-only/);
  assert(!salonEnrichmentIsActive("closed"));
  const row: any = { id: "closed-row", status: "enriched", sourceData: { stagingState: "research_directory" } };
  await assert.rejects(enrichRow(row), /browse-only/);
  const original = storage.getSalonEnrichmentRow;
  storage.getSalonEnrichmentRow = async () => row;
  try { await assert.rejects(lookupSalonOwnerName(row.id, "owner", 1), /browse-only/); }
  finally { storage.getSalonEnrichmentRow = original; }
});
test.after(() => pool.end());