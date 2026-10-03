/** Display saved names, never guesses or unapproved research candidates. */
export function pipelineContactOwnerName(contact: {
  firstName?: string | null; lastName?: string | null; company?: string | null; notes?: string | null;
}): string | null {
  const name = [contact.firstName, contact.lastName].filter(value => value?.trim()).map(value => value!.trim()).join(" ");
  if (!name || name.toLowerCase() === contact.company?.trim().toLowerCase() ||
      /^(?:unknown|not found|n\/a|team)$/i.test(name)) return null;
  // Use the current contact fields, not stale evidence copied into import notes.
  // Research approval/application and revocation already govern those fields.
  return name;
}