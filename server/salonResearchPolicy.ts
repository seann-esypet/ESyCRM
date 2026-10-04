import type { RequestHandler } from "express";
import { storage } from "./storage";

export const RESEARCH_READ_ONLY = "This saved research directory is browse-only. The pilot is closed; new paid work requires a separately approved research batch.";

export function isResearchDirectoryBatch(batch: { researchProgress?: unknown }): boolean {
  const metadata = batch.researchProgress as { datasetKey?: unknown } | null;
  return typeof metadata?.datasetKey === "string" && !!metadata.datasetKey;
}

export function isResearchDirectoryRow(row: { sourceData?: unknown }): boolean {
  const source = row.sourceData as { stagingState?: unknown; researchDataset?: unknown } | null;
  return source?.stagingState === "research_directory" || !!source?.researchDataset;
}

/** Applied before any generic batch mutation or provider execution. */
export const rejectResearchExecution: RequestHandler = async (req: any, res, next) => {
  try {
    const scope = req.user.claims.role === "admin" ? null : req.user.claims.sub;
    const batch = await storage.getSalonEnrichmentBatch(req.params.id, scope);
    if (!batch) return res.status(404).json({ message: "Batch not found" });
    if (isResearchDirectoryBatch(batch) ||
        (await storage.getSalonEnrichmentRows(batch.id, batch.userId)).some(isResearchDirectoryRow)) {
      return res.status(409).json({ message: RESEARCH_READ_ONLY });
    }
    next();
  } catch (error) { next(error); }
};