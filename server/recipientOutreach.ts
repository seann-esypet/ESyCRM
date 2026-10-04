import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "./db";
import { activities, contacts, emailSequenceLogs } from "@shared/schema";
import type { InsertEmailSequenceLog } from "@shared/schema";
import { normalizeRecipient, recipientConflict, latestRecipientEvents, type RecipientEvent } from "./recipientPolicy";

const EVENT_TYPE = "recipient_outreach_evidence";
async function state(tx: any) {
  const evidence = await tx.select().from(activities).where(eq(activities.type, EVENT_TYPE));
  const events: RecipientEvent[] = evidence.flatMap((item: any) => {
    const event = JSON.parse(item.description) as RecipientEvent;
    if (!event.logId || !event.recipient || !event.at || !event.userId || !event.state) throw new Error("Recipient history is incomplete and must be reviewed before outreach.");
    return [event];
  }).sort((a: RecipientEvent, b: RecipientEvent) => a.at.localeCompare(b.at) ||
    ["scheduled","attempted","uncertain","failed","sent"].indexOf(a.state) - ["scheduled","attempted","uncertain","failed","sent"].indexOf(b.state));
  const logs = await tx.select().from(emailSequenceLogs);
  return { events, logs, active: new Set<string>(logs.filter((l: any) => ["pending", "processing", "needs_review"].includes(l.status)).map((l: any) => l.id)) };
}
async function append(tx: any, event: RecipientEvent) {
  // Evidence deliberately has no contact FK: edits, merges and deletion must not erase the recipient snapshot.
  await tx.insert(activities).values({ userId: event.userId, type: EVENT_TYPE, description: JSON.stringify(event) });
}
function legacyConflict(logs: any[], events: RecipientEvent[], matchingContacts: any[], exclude?: string) {
  const known = new Set(events.map(event => event.logId));
  const ids = new Set(matchingContacts.map(contact => contact.id));
  return logs.some(log => log.id !== exclude && !known.has(log.id) && ids.has(log.contactId) &&
    ["pending", "processing", "sent", "replied", "needs_review"].includes(log.status));
}
export async function reserveRecipientLog(input: InsertEmailSequenceLog, userId: string, expectedRecipient?: string | null) {
  return db.transaction(async tx => {
    const [contact] = await tx.select().from(contacts).where(eq(contacts.id, input.contactId)).for("update");
    if (contact?.userId !== userId) throw new Error("Contact and sequence must belong to the same CRM owner.");
    const recipient = normalizeRecipient(contact?.email);
    if (expectedRecipient && normalizeRecipient(expectedRecipient) !== recipient) throw new Error("Contact email changed during enrollment. Review the new address first.");
    if (!recipient) throw new Error("An email address is required.");
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`outreach:${recipient}`}))`);
    const current = await state(tx);
    const matching = await tx.select().from(contacts).where(sql`lower(trim(${contacts.email})) = ${recipient}`);
    if (legacyConflict(current.logs, current.events, matching)) {
      throw new Error("Uncertain history: existing outreach has no retained recipient address. Review it before enrollment.");
    }
    const conflict = recipientConflict(recipient, input.sequenceNumber, input.sequenceTrack || "salon_no_software",
      userId, input.contactId, current.events, current.active);
    if (conflict) throw new Error(conflict);
    const id = randomUUID();
    const [log] = await tx.insert(emailSequenceLogs).values({ ...input, id, userId }).returning();
    await append(tx, { logId: id, recipient, contactId: input.contactId, userId,
      sequenceTrack: log.sequenceTrack, sequenceNumber: log.sequenceNumber, state: "scheduled", at: new Date().toISOString(),
      ...(log.scheduledSendAt ? { scheduledSendAt: new Date(log.scheduledSendAt).toISOString() } : {}) });
    return log;
  });
}
function historyFor(email: string | null | undefined, viewer: string | null, current: Awaited<ReturnType<typeof state>>, matching: any[]) {
  const recipient = normalizeRecipient(email);
  if (!recipient) return { label: null, history: [], crossOwner: false };
  const events = latestRecipientEvents(current.events).filter((event: RecipientEvent) => normalizeRecipient(event.recipient) === recipient &&
    (event.state !== "scheduled" || current.active.has(event.logId)));
  const uncertain = legacyConflict(current.logs, current.events, matching);
  const label = events.some((event: RecipientEvent) => ["attempted", "uncertain"].includes(event.state)) || uncertain ? "Uncertain history" :
    events.some((event: RecipientEvent) => event.state === "sent") ? "Previously emailed" :
    events.some((event: RecipientEvent) => event.state === "scheduled") ? "Already scheduled" : null;
  return {
    label, crossOwner: events.some((event: RecipientEvent) => viewer !== null && event.userId !== viewer),
    history: events.filter((event: RecipientEvent) => viewer === null || event.userId === viewer)
      .map((event: RecipientEvent) => ({ status: event.state, date: event.state === "scheduled" ? event.scheduledSendAt || event.at : event.acceptedAt || event.at,
        contactId: event.contactId, sequenceTrack: event.sequenceTrack })),
    uncertainLegacy: uncertain,
  };
}
export async function recipientHistoryReader(viewer: string | null) {
  const current = await state(db);
  const allContacts = await db.select().from(contacts);
  return (email: string | null | undefined) => historyFor(email, viewer, current,
    allContacts.filter(contact => normalizeRecipient(contact.email) === normalizeRecipient(email)));
}
export async function recipientHistory(email: string | null | undefined, viewer: string | null) {
  return (await recipientHistoryReader(viewer))(email);
}
export async function retainedRecipientEvidence(logs: { id: string }[]) {
  const current = await state(db), events = latestRecipientEvents(current.events);
  return logs.map(log => {
    const event = events.find(event => event.logId === log.id);
    return { ...log, recipientAddress: event?.recipient || null,
      recipientEvidence: event ? event.state : "unknown_historical_recipient" };
  });
}
export async function claimRecipientSend(logId: string, expectedRecipient?: string | null): Promise<{ recipient: string } | { rejection: string }> {
  return db.transaction(async tx => {
    const [log] = await tx.select().from(emailSequenceLogs).where(eq(emailSequenceLogs.id, logId)).for("update");
    if (!log || log.status !== "pending") return { rejection: "This queued item is not pending." };
    const [contact] = await tx.select().from(contacts).where(eq(contacts.id, log.contactId));
    const recipient = normalizeRecipient(contact?.email);
    if (!recipient) return { rejection: "Contact email is missing." };
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`outreach:${recipient}`}))`);
    const current = await state(tx);
    const own = current.events.filter((event: RecipientEvent) => event.logId === logId);
    const snapshot = own[0]?.recipient;
    let rejection = (snapshot && normalizeRecipient(snapshot) !== recipient) ||
      (expectedRecipient && normalizeRecipient(expectedRecipient) !== recipient) ? "Contact email changed after scheduling or evidence validation. Review and explicitly schedule the new address." : null;
    if (contact?.userId !== log.userId) rejection = "Contact ownership changed after scheduling. Review this outreach.";
    if (own.some((event: RecipientEvent) => ["attempted", "uncertain", "sent"].includes(event.state))) {
      rejection = "This delivery may already have been accepted. Reconciliation is required; it will not be retried automatically.";
    }
    const matching = await tx.select().from(contacts).where(sql`lower(trim(${contacts.email})) = ${recipient}`);
    if (!rejection && legacyConflict(current.logs, current.events, matching, logId)) rejection = "Uncertain legacy recipient history requires review.";
    if (!rejection) rejection = recipientConflict(recipient, log.sequenceNumber, log.sequenceTrack,
      log.userId, log.contactId, current.events, current.active, logId);
    if (rejection) {
      await tx.update(emailSequenceLogs).set({ status: "needs_review", errorMessage: rejection }).where(eq(emailSequenceLogs.id, logId));
      return { rejection };
    }
    await append(tx, { logId, recipient, contactId: log.contactId, userId: log.userId, sequenceTrack: log.sequenceTrack,
      sequenceNumber: log.sequenceNumber, state: "attempted", at: new Date().toISOString() });
    await tx.update(emailSequenceLogs).set({ status: "processing", processingStartedAt: new Date() }).where(eq(emailSequenceLogs.id, logId));
    return { recipient };
  });
}
export async function recordRecipientOutcome(logId: string, success: boolean, messageId?: string, error?: string) {
  return db.transaction(async tx => {
    const current = await state(tx);
    const attempted = current.events.filter((event: RecipientEvent) => event.logId === logId && event.state === "attempted").at(-1);
    if (!attempted) throw new Error("Recipient attempt evidence is missing; delivery requires reconciliation.");
    await append(tx, { ...attempted, state: success ? "sent" : "uncertain", at: new Date().toISOString(), ...(messageId ? { messageId } : {}) });
    await tx.update(emailSequenceLogs).set({
      status: success ? "sent" : "needs_review", ...(success ? { sentAt: new Date() } : {}),
      ...(messageId ? { brevoMessageId: messageId } : {}), errorMessage: success ? null : error || "Uncertain provider outcome; reconcile before retry.",
    }).where(eq(emailSequenceLogs.id, logId));
  }).catch(async failure => {
    // Retry only persistence, never the provider send. Preserve the accepted
    // receipt as uncertain evidence and make the queue's review action visible.
    try {
      await db.transaction(async tx=>{
        const current=await state(tx);
        const attempted=current.events.filter((event:RecipientEvent)=>event.logId===logId&&event.state==="attempted").at(-1);
        const log=current.logs.find((item:any)=>item.id===logId);
        if(log?.status==="sent")return;
        if(attempted)await append(tx,{...attempted,state:"uncertain",at:new Date().toISOString(),...(messageId?{messageId}:{}),
          source:"outcome_save_failed",reviewNote:"Provider outcome could not be saved atomically. Reconcile before any resend."});
        if(log)await tx.update(emailSequenceLogs).set({status:"needs_review",errorMessage:"Provider outcome was not saved. Inspect the retained receipt and provider history; do not resend blindly."}).where(eq(emailSequenceLogs.id,logId));
      });
    } catch { /* Original attempt remains a durable no-resend reservation if the database is unavailable. */ }
    throw failure;
  });
}
export async function reconcileRecipientOutcome(logId: string, owner: string | null, actor: string, input: any) {
  if (input.confirmed !== true || !String(input.note || "").trim()) throw new Error("Explicitly confirm that you inspected provider history and record the evidence.");
  if(String(input.note).length>4000||String(input.providerMessageId||"").length>200)throw new Error("Review notes are limited to 4,000 characters and provider message IDs to 200; nothing was truncated.");
  if (!["accepted","not_accepted"].includes(input.outcome)) throw new Error("Choose provider acceptance or confirmed non-acceptance, not an uncertain outcome.");
  const recipient = normalizeRecipient(input.recipient);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) throw new Error("Enter the actual recipient from provider history, not a guessed current contact address.");
  if (input.outcome === "accepted" && !String(input.providerMessageId || "").trim()) throw new Error("Record the accepted provider message ID.");
  if(input.outcome==="accepted"&&(typeof input.acceptedAt!=="string"||!input.acceptedAt.trim()))throw new Error("Record the actual provider acceptance date and time.");
  const acceptedAt = input.outcome === "accepted" ? new Date(input.acceptedAt) : null;
  if (acceptedAt && (Number.isNaN(acceptedAt.getTime()) || acceptedAt.getTime() > Date.now())) throw new Error("Record the actual acceptance time shown by the provider, not the review time.");
  return db.transaction(async tx => {
    const [log] = await tx.select().from(emailSequenceLogs).where(owner === null ? eq(emailSequenceLogs.id, logId) :
      and(eq(emailSequenceLogs.id, logId), eq(emailSequenceLogs.userId, owner))).for("update");
    if (!log || log.status !== "needs_review") throw new Error("This delivery is not awaiting review or is not accessible.");
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`outreach:${recipient}`}))`);
    const current = await state(tx), prior = latestRecipientEvents(current.events).find(event => event.logId === logId);
    if (prior && normalizeRecipient(prior.recipient) !== recipient) throw new Error("The provider receipt address differs from retained scheduling evidence. Resolve that discrepancy before recording an outcome.");
    const event: RecipientEvent = { logId, recipient, contactId: log.contactId, userId: log.userId,
      sequenceTrack: log.sequenceTrack, sequenceNumber: log.sequenceNumber, state: input.outcome === "accepted" ? "sent" : "failed",
      at: new Date().toISOString(), reviewedBy: actor, reviewNote: String(input.note).trim(),
      source: "manual_provider_review", ...(input.outcome === "accepted" ? { messageId: String(input.providerMessageId).trim(), acceptedAt:acceptedAt!.toISOString() } : {}) };
    await append(tx,event);
    const [updated] = await tx.update(emailSequenceLogs).set({ status: input.outcome === "accepted" ? "sent" : "failed",
      ...(input.outcome === "accepted" ? { brevoMessageId: event.messageId, sentAt: acceptedAt } : {}),
      errorMessage: `Explicit provider review: ${event.reviewNote}` }).where(eq(emailSequenceLogs.id, logId)).returning();
    return { log: updated, message: "Provider outcome recorded after explicit review. No queue was deleted and no message was resent." };
  });
}