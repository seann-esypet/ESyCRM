import { db, pool } from "../server/db";
import { salonEnrichmentBatches, salonEnrichmentRows } from "../shared/schema";

// Read-only application queries validate every mapped column without reading records.
// Do not apply migrations here; managed production schema changes happen on Publish.
try {
  await db.select().from(salonEnrichmentBatches).limit(0);
  await db.select().from(salonEnrichmentRows).limit(0);
  console.log("[schema-check] Lead-list and candidate columns are available");
} catch (error) {
  console.error("[schema-check] Lead schema is incomplete. Apply a reviewed development schema change before republishing.");
  console.error(error instanceof Error ? error.message : "Database schema check failed");
  process.exitCode = 1;
} finally {
  await pool.end();
}