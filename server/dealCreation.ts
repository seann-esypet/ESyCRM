import { and, eq } from "drizzle-orm";
import { activities, contacts, deals, type Contact, type Deal, type InsertDeal } from "@shared/schema";

export class DealCreationError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "DealCreationError";
  }
}

interface DealCreationRepository {
  getContact(id: string, userId: string | null): Promise<Contact | undefined>;
  createDeal(data: InsertDeal, userId: string): Promise<Deal>;
}

export async function createDealForActor(
  repository: DealCreationRepository,
  input: InsertDeal,
  actor: { id: string; isAdmin: boolean },
) {
  const data = { ...input, title: input.title.trim(), contactId: input.contactId?.trim() || null };
  if (!data.title) throw new DealCreationError(400, "Please enter a deal title.");
  let ownerId = actor.id;
  if (data.contactId) {
    const contact = await repository.getContact(data.contactId, actor.isAdmin ? null : actor.id);
    if (!contact) throw new DealCreationError(404, "Contact not found or unavailable.");
    if (contact.archivedAt) throw new DealCreationError(409, "Restore this contact before creating a deal.");
    ownerId = contact.userId;
  }
  return repository.createDeal(data, ownerId);
}

// Deal, contact status and activity succeed together; a failed save cannot leave
// an invisible deal behind that would be duplicated when the user retries.
export async function createDealRecord(
  database: Pick<typeof import("./db").db, "transaction">,
  input: InsertDeal,
  ownerId: string,
): Promise<Deal> {
  return database.transaction(async tx => {
    const contactId = input.contactId?.trim() || null;
    if (contactId) {
      const [contact] = await tx.select().from(contacts)
        .where(and(eq(contacts.id, contactId), eq(contacts.userId, ownerId)))
        .limit(1).for("update");
      if (!contact) throw new DealCreationError(404, "Contact not found or unavailable.");
      if (contact.archivedAt) throw new DealCreationError(409, "Restore this contact before creating a deal.");
    }
    const [deal] = await tx.insert(deals).values({
      ...input,
      userId: ownerId,
      contactId,
      value: input.value?.trim() || null,
      expectedCloseDate: input.expectedCloseDate ? new Date(input.expectedCloseDate) : null,
      demoScheduledDate: input.demoScheduledDate ? new Date(input.demoScheduledDate) : null,
      demoCompletedDate: input.demoCompletedDate ? new Date(input.demoCompletedDate) : null,
      wonDate: input.wonDate ? new Date(input.wonDate) : null,
      stageChangedAt: new Date(),
    }).returning();
    if (contactId) await tx.update(contacts).set({ status: "pipeline" })
      .where(and(eq(contacts.id, contactId), eq(contacts.userId, ownerId)));
    await tx.insert(activities).values({
      userId: ownerId,
      type: "deal_created",
      description: `New deal "${deal.title}" created`,
      dealId: deal.id,
      contactId,
    });
    return deal;
  });
}