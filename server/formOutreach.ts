import { and, eq, sql } from "drizzle-orm";
import { db } from "./db";
import { emailSequences, salonEnrichmentRows, salonFormOutreach, users, type SalonEnrichmentRow, type EmailSequence } from "@shared/schema";
import { replaceTemplateVariables } from "./sendgrid";
import { canEnrollFormRow, htmlToFormText, nextFormDueAt } from "./formOutreachPolicy";

export type FormAction = "submitted" | "blocked" | "resume" | "skipped" | "replied" | "opted_out";

function renderDraft(sequence: EmailSequence, row: SalonEnrichmentRow, actor: typeof users.$inferSelect) {
  const contact = {
    company: row.businessName,
    city: row.city,
    firstName: null,
    useBusinessNameForEmail: "Yes",
  } as Parameters<typeof replaceTemplateVariables>[1];
  return {
    subject: replaceTemplateVariables(sequence.subject, contact, actor),
    body: htmlToFormText(replaceTemplateVariables(sequence.body, contact, actor)),
  };
}

export async function listFormOutreach(userId: string, batchId?: string) {
  const records = await db.select({
    id: salonFormOutreach.id,
    salonRowId: salonFormOutreach.salonRowId,
    batchId: salonEnrichmentRows.batchId,
    businessName: salonEnrichmentRows.businessName,
    rowNumber: salonEnrichmentRows.rowNumber,
    status: salonFormOutreach.status,
    strategy: salonFormOutreach.strategy,
    sequenceTrack: salonFormOutreach.sequenceTrack,
    sequenceNumber: salonFormOutreach.sequenceNumber,
    formUrl: salonFormOutreach.formUrl,
    subject: salonFormOutreach.subject,
    body: salonFormOutreach.body,
    dueAt: salonFormOutreach.dueAt,
    actedAt: salonFormOutreach.actedAt,
    actedBy: salonFormOutreach.actedBy,
    note: salonFormOutreach.note,
    submittedCount: salonFormOutreach.submittedCount,
    history: salonFormOutreach.history,
    salonRow: salonEnrichmentRows,
  }).from(salonFormOutreach)
    .innerJoin(salonEnrichmentRows, eq(salonFormOutreach.salonRowId, salonEnrichmentRows.id))
    .where(and(eq(salonFormOutreach.userId, userId),
      batchId ? eq(salonEnrichmentRows.batchId, batchId) : undefined));
  return records.map(({ salonRow, ...draft }) => ({
    ...draft,
    reviewAllowed: canEnrollFormRow(salonRow) && salonRow.contactRequestFormUrl === draft.formUrl,
  }));
}

export async function enrollFormOutreach(userId: string, rowId: string, sequenceId: string) {
  return db.transaction(async tx => {
    const [row] = await tx.select().from(salonEnrichmentRows)
      .where(and(eq(salonEnrichmentRows.id, rowId), eq(salonEnrichmentRows.userId, userId)));
    if (!row || !canEnrollFormRow(row)) throw new Error("Select an unimported, email-free salon with a verified usable contact form and no duplicate warning");
    const [sequence] = await tx.select().from(emailSequences)
      .where(and(eq(emailSequences.id, sequenceId), eq(emailSequences.userId, userId)));
    if (!sequence || sequence.sequenceNumber !== 1 || sequence.isActive !== "true" ||
        sequence.sequenceTrack !== row.audienceTrack ||
        sequence.sequenceTrack.endsWith("_custom") || sequence.sequenceTrack === "custom") {
      throw new Error("Select an active first-step sequence matching this salon's audience track");
    }
    const [actor] = await tx.select().from(users).where(eq(users.id, userId));
    if (!actor) throw new Error("User not found");
    const draft = renderDraft(sequence, row, actor);
    const [created] = await tx.insert(salonFormOutreach).values({
      userId, salonRowId: row.id, sequenceId: sequence.id,
      strategy: sequence.strategy, sequenceTrack: sequence.sequenceTrack,
      sequenceNumber: 1, formUrl: row.contactRequestFormUrl!, ...draft,
      status: "due",
    }).onConflictDoNothing().returning();
    if (!created) throw new Error("This salon already has a form-outreach enrollment");
    return created;
  });
}

export async function recordFormAction(userId: string, outreachId: string, action: FormAction, note?: string) {
  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`form-outreach:${outreachId}`}))`);
    const [current] = await tx.select().from(salonFormOutreach)
      .where(and(eq(salonFormOutreach.id, outreachId), eq(salonFormOutreach.userId, userId)));
    if (!current) throw new Error("Form outreach not found");
    const [row] = await tx.select().from(salonEnrichmentRows)
      .where(and(eq(salonEnrichmentRows.id, current.salonRowId), eq(salonEnrichmentRows.userId, userId)));
    if (!row) throw new Error("Salon row no longer exists");
    const now = new Date();
    const history = Array.isArray(current.history) ? [...current.history] : [];
    if (action === "submitted") {
      if (!["due", "scheduled"].includes(current.status) || current.dueAt > now) {
        throw new Error("This form draft is not due for submission");
      }
      if (!canEnrollFormRow(row) || row.contactRequestFormUrl !== current.formUrl) {
        throw new Error("Salon email, identity, or verified form URL changed; review before submitting");
      }
      history.push({
        step: current.sequenceNumber, sequenceId: current.sequenceId, action,
        formUrl: current.formUrl, subject: current.subject, body: current.body,
        actedAt: now.toISOString(), actedBy: userId, note: note || null,
      });
      const [actor] = await tx.select().from(users).where(eq(users.id, userId));
      if (!actor) throw new Error("User not found");
      const [next] = await tx.select().from(emailSequences).where(and(
        eq(emailSequences.userId, userId),
        eq(emailSequences.strategy, current.strategy),
        eq(emailSequences.sequenceTrack, current.sequenceTrack),
        eq(emailSequences.sequenceNumber, current.sequenceNumber + 1),
      ));
      const nextDraft = next?.isActive === "true" ? renderDraft(next, row, actor) : null;
      const nextDueAt = nextDraft ? nextFormDueAt(now, next!.daysAfterNoReply) : current.dueAt;
      const [updated] = await tx.update(salonFormOutreach).set({
        status: nextDraft ? "scheduled" : "completed",
        sequenceNumber: nextDraft ? current.sequenceNumber + 1 : current.sequenceNumber,
        sequenceId: nextDraft ? next!.id : current.sequenceId,
        subject: nextDraft?.subject ?? current.subject,
        body: nextDraft?.body ?? current.body,
        dueAt: nextDueAt,
        actedAt: now, actedBy: userId, note: note || null,
        submittedCount: current.submittedCount + 1, history, updatedAt: now,
      }).where(eq(salonFormOutreach.id, current.id)).returning();
      return updated;
    }
    if (action === "resume") {
      if (current.status !== "blocked") throw new Error("Only blocked drafts can be resumed");
      if (!canEnrollFormRow(row) || row.contactRequestFormUrl !== current.formUrl) throw new Error("Reverify this salon and form before resuming");
    } else if (action === "blocked") {
      if (!["due", "scheduled"].includes(current.status)) throw new Error("Only active drafts can be blocked");
    } else if (["skipped", "replied", "opted_out"].includes(action)) {
      if (["skipped", "replied", "opted_out"].includes(current.status)) throw new Error("This outreach has already been stopped");
    }
    history.push({
      step: current.sequenceNumber, sequenceId: current.sequenceId, action,
      formUrl: current.formUrl, actedAt: now.toISOString(), actedBy: userId, note: note || null,
    });
    const [updated] = await tx.update(salonFormOutreach).set({
      status: action === "resume" ? (current.dueAt > now ? "scheduled" : "due") : action,
      dueAt: current.dueAt,
      actedAt: now, actedBy: userId, note: note || null, history, updatedAt: now,
    }).where(eq(salonFormOutreach.id, current.id)).returning();
    return updated;
  });
}