export const normalizeRecipient = (value: string | null | undefined) => (value || "").trim().toLowerCase();
export type RecipientEvent = {
  logId: string; recipient: string; contactId: string; userId: string;
  sequenceTrack: string; sequenceNumber: number;
  state: "scheduled" | "attempted" | "sent" | "uncertain" | "failed";
  at: string; messageId?: string; scheduledSendAt?: string; reviewedBy?: string; reviewNote?: string; source?: string; acceptedAt?: string;
};
export function latestRecipientEvents(events: RecipientEvent[]) {
  const latest = new Map<string, RecipientEvent>();
  for (const event of events) latest.set(event.logId, event);
  return Array.from(latest.values());
}
export function recipientConflict(
  recipient: string, step: number, track: string, owner: string, contactId: string,
  events: RecipientEvent[], activeLogIds: Set<string>, excludeLogId?: string,
): string | null {
  const latest = new Map<string, RecipientEvent>();
  for (const event of events) {
    if (normalizeRecipient(event.recipient) === normalizeRecipient(recipient)) latest.set(event.logId, event);
  }
  const others = Array.from(latest.values()).filter(event => event.logId !== excludeLogId);
  if (others.some(event => ["attempted", "uncertain"].includes(event.state))) {
    return "Uncertain delivery history. Reconcile the previous send before scheduling or retrying.";
  }
  if (step === 1) {
    if (others.some(event => event.state === "sent")) return "Previously emailed. Use the existing sequence's follow-up instead of another introduction.";
    if (others.some(event => event.state === "scheduled" && activeLogIds.has(event.logId))) return "Already scheduled. Review the existing outreach before adding another introduction.";
  } else {
    const predecessor = others.find(event => event.state === "sent" && event.sequenceNumber === step - 1 &&
      event.sequenceTrack === track && event.userId === owner && event.contactId === contactId);
    if (!predecessor) return "A sent preceding step to this exact address in this owner's sequence is required.";
    if (others.some(event => event.sequenceNumber === step &&
      (event.state === "sent" || (event.state === "scheduled" && activeLogIds.has(event.logId))))) {
      return "Already scheduled or previously emailed for this follow-up step.";
    }
  }
  return null;
}