export function contactDeletionLabel(contact: {
  company?: string | null; firstName?: string | null; lastName?: string | null;
  phone?: string | null; email?: string | null;
}): string {
  return contact.company?.trim()
    || [contact.firstName, contact.lastName].filter(Boolean).join(" ").trim()
    || contact.phone || contact.email || "Unnamed business";
}

/** One awaited request per unique ID; failed records are never reported deleted. */
export async function deleteContactBatch(
  ids: string[],
  remove: (id: string) => Promise<unknown>,
): Promise<{ removedIds: string[]; failures: Array<{ id: string; status: string }> }> {
  const removedIds: string[] = [];
  const failures: Array<{ id: string; status: string }> = [];
  for (const id of Array.from(new Set(ids))) {
    try {
      await remove(id);
      removedIds.push(id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Request failed";
      failures.push({ id, status: message.match(/^(\d{3})/)?.[1] || "" });
    }
  }
  return { removedIds, failures };
}