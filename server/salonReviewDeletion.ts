import { and, eq, sql } from "drizzle-orm";
import { salonEnrichmentBatches, salonEnrichmentRows } from "@shared/schema";

export class SalonReviewDeletionConflict extends Error {
  constructor(message: string) { super(message); this.name = "SalonReviewDeletionConflict"; }
}

export async function deleteSalonReviewRowSafely(
  database: Pick<typeof import("./db").db, "transaction">, id: string, userId: string,
): Promise<boolean> {
  return database.transaction(async tx => {
    const ownedRow = and(eq(salonEnrichmentRows.id, id), eq(salonEnrichmentRows.userId, userId));
    const [initial] = await tx.select().from(salonEnrichmentRows).where(ownedRow);
    if (!initial) return false;
    // Use the same lock order as imports and verification, then reread the row.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`salon-import:${initial.batchId}`}))`);
    const [batch] = await tx.select().from(salonEnrichmentBatches).where(and(
      eq(salonEnrichmentBatches.id, initial.batchId), eq(salonEnrichmentBatches.userId, userId),
    )).for("update");
    if (!batch || batch.fileName !== "salon-public-web-review") return false;
    const [row] = await tx.select().from(salonEnrichmentRows).where(ownedRow).for("update");
    if (!row || row.batchId !== batch.id) return false;
    if (row.importedContactId) {
      throw new SalonReviewDeletionConflict("This business is already a CRM contact. Delete or archive it from Contacts first.");
    }
    const batchScope = and(eq(salonEnrichmentRows.batchId, batch.id), eq(salonEnrichmentRows.userId, userId));
    const batchRows = await tx.select().from(salonEnrichmentRows).where(batchScope);
    if (batch.status === "running" || batchRows.some(item =>
      item.status === "processing" ||
      (item.evidence as { ownerName?: { status?: string } } | null)?.ownerName?.status === "searching")) {
      throw new SalonReviewDeletionConflict("Wait for verification or an active row operation to finish before deleting leads.");
    }
    await tx.delete(salonEnrichmentRows).where(ownedRow);
    const remaining = batchRows.filter(item => item.id !== row.id);
    const processed = remaining.filter(item =>
      (item.sourceData as { stagingState?: string } | null)?.stagingState !== "staged_unverified" &&
      !["pending", "processing"].includes(item.status));
    await tx.update(salonEnrichmentBatches).set({
      totalRows: remaining.length,
      processedRows: processed.length,
      enrichedRows: processed.filter(item => item.status === "enriched").length,
      needsReviewRows: remaining.filter(item => ["pending", "needs_review"].includes(item.reviewStatus)).length,
      approvedRows: remaining.filter(item => item.reviewStatus === "approved").length,
      importedRows: remaining.filter(item => Boolean(item.importedContactId)).length,
      // Retain provider-call accounting: deleting evidence never refunds credits.
    }).where(and(eq(salonEnrichmentBatches.id, batch.id), eq(salonEnrichmentBatches.userId, userId)));
    return true;
  });
}