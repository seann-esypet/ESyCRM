import { and, eq, inArray } from "drizzle-orm";
import {
  activities, contacts, dealActivities, deals, dealTasks, emailSequenceLogs,
  inboxMessages, salonEnrichmentRows, tasks,
} from "@shared/schema";

export class ContactDeletionConflict extends Error {
  constructor() {
    super("This business has linked deals or deal history. Archive it instead to preserve pipeline and financial records.");
    this.name = "ContactDeletionConflict";
  }
}

/**
 * Remove a contact, not its pipeline or financial history. Lock and check
 * ownership before touching dependent records; a failure rolls back everything.
 */
export async function deleteContactSafely(
  database: Pick<typeof import("./db").db, "transaction">,
  id: string,
  userId: string | null,
): Promise<boolean> {
  return database.transaction(async tx => {
    const scope = userId === null ? eq(contacts.id, id)
      : and(eq(contacts.id, id), eq(contacts.userId, userId));
    const [contact] = await tx.select({ id: contacts.id }).from(contacts)
      .where(scope).for("update");
    if (!contact) return false;

    const [deal] = await tx.select({ id: deals.id }).from(deals)
      .where(eq(deals.contactId, id)).limit(1);
    const [history] = await tx.select({ id: dealActivities.id }).from(dealActivities)
      .where(eq(dealActivities.contactId, id)).limit(1);
    const [dealTask] = await tx.select({ id: dealTasks.id }).from(dealTasks)
      .where(eq(dealTasks.contactId, id)).limit(1);
    if (deal || history || dealTask) throw new ContactDeletionConflict();

    const logs = await tx.select({ id: emailSequenceLogs.id }).from(emailSequenceLogs)
      .where(eq(emailSequenceLogs.contactId, id));
    if (logs.length) {
      // Preserve received messages before removing their sequence-log references.
      await tx.update(inboxMessages).set({ emailSequenceLogId: null })
        .where(inArray(inboxMessages.emailSequenceLogId, logs.map(log => log.id)));
    }
    await tx.update(inboxMessages).set({ contactId: null }).where(eq(inboxMessages.contactId, id));
    await tx.update(activities).set({ contactId: null }).where(eq(activities.contactId, id));
    await tx.update(tasks).set({ contactId: null }).where(eq(tasks.contactId, id));
    // A surviving reviewed source must be explicitly reviewed again for reimport.
    await tx.update(salonEnrichmentRows).set({ importedContactId: null, reviewStatus: "needs_review" })
      .where(eq(salonEnrichmentRows.importedContactId, id));
    await tx.delete(emailSequenceLogs).where(eq(emailSequenceLogs.contactId, id));
    const removed = await tx.delete(contacts).where(scope).returning({ id: contacts.id });
    return removed.length > 0;
  });
}