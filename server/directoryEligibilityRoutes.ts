import type { Express, RequestHandler } from "express";
import { z } from "zod";
import { storage } from "./storage";
import { directoryEligibility, directoryEligibilitySummary, directoryNotesEvidence, directoryObject,
  groomingReviewFor, withDirectoryNotes } from "@shared/directoryEligibility";

const reviewInput = z.object({
  decision: z.enum(["approved", "excluded"]),
  note: z.string().trim().min(1, "Record the grooming evidence or reason for exclusion").max(1500),
  confirmed: z.literal(true),
});

export function registerDirectoryEligibilityRoutes(app: Express, authenticate: RequestHandler) {
  app.get("/api/salon-enrichment/batches/:id/eligibility-summary", authenticate, async (req: any, res) => {
    try {
      const scope = req.user.claims.role === "admin" ? null : req.user.claims.sub;
      const batch = await storage.getSalonEnrichmentBatch(req.params.id, scope);
      if (!batch) return res.status(404).json({ message: "Batch not found" });
      const rows = await storage.getSalonEnrichmentRows(batch.id, batch.userId);
      return res.json(directoryEligibilitySummary(rows));
    } catch { return res.status(500).json({ message: "Unable to load grooming review counts" }); }
  });

  app.post("/api/salon-enrichment/rows/:rowId/eligibility", authenticate, async (req: any, res) => {
    try {
      const input = reviewInput.parse(req.body);
      const scope = req.user.claims.role === "admin" ? null : req.user.claims.sub;
      const row = await storage.getSalonEnrichmentRow(req.params.rowId, scope);
      if (!row) return res.status(404).json({ message: "Row not found" });
      if (row.status === "processing") return res.status(409).json({ message: "Wait until enrichment finishes before reviewing grooming suitability" });
      const updated = await storage.updateSalonEnrichmentRow(row.id, {
        evidence: { ...directoryObject(row.evidence), groomingReview: groomingReviewFor(row, input.decision, input.note) },
      }, row.userId);
      if (!updated) return res.status(404).json({ message: "Row not found" });
      await storage.refreshSalonEnrichmentBatchCounts(row.batchId, row.userId);
      return res.json({ row: updated, eligibility: directoryEligibility(updated) });
    } catch (error) {
      return res.status(error instanceof z.ZodError ? 400 : 500).json({
        message: error instanceof Error ? error.message : "Unable to record grooming decision",
      });
    }
  });

  app.post("/api/lead-discovery/results/:resultId/eligibility", authenticate, async (req: any, res) => {
    try {
      const input = reviewInput.parse(req.body);
      const row = await storage.getLeadDiscoveryResultById(req.params.resultId);
      if (!row || (row.userId !== req.user.claims.sub && req.user.claims.role !== "admin")) {
        return res.status(404).json({ message: "Result not found" });
      }
      const notes = withDirectoryNotes(row.notes, {
        ...directoryNotesEvidence(row.notes), groomingReview: groomingReviewFor(row, input.decision, input.note),
      });
      const updated = await storage.updateLeadDiscoveryResult(row.id, { notes }, row.userId);
      if (!updated) return res.status(404).json({ message: "Result not found" });
      return res.json({ row: updated, eligibility: directoryEligibility({ ...row, notes }) });
    } catch (error) {
      return res.status(error instanceof z.ZodError ? 400 : 500).json({
        message: error instanceof Error ? error.message : "Unable to record grooming decision",
      });
    }
  });
}