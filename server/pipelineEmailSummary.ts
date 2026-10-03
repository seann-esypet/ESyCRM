import type { PipelineEmailSummaries, PipelineEmailSummary } from "@shared/pipelineEmailSummary";

export interface PipelineContact {
  id: string;
  userId: string;
  email: string | null;
}

export interface PipelineEmailLog {
  id: string;
  contactId: string;
  userId: string;
  status: string;
  sentAt: Date | string | null;
  scheduledSendAt: Date | string | null;
  emailResponseReceived: string | null;
  brevoMessageId: string | null;
}

export function pipelineEmailQueryScope(role: string, userId: string, ownerFilter: unknown): string | null {
  if (role !== "admin") return userId;
  return typeof ownerFilter === "string" && ownerFilter ? ownerFilter : null;
}

function timestamp(value: Date | string | null): number | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

export function summarizePipelineContact(
  contactId: string, contact: PipelineContact | undefined, logs: PipelineEmailLog[],
): PipelineEmailSummary {
  const summary: PipelineEmailSummary = {
    contactId, contactState: contact ? "available" : "unavailable", email: contact?.email?.trim() || null,
    sequenceStatus: contact ? "not_enrolled" : "unavailable", logCount: 0, sentCount: 0,
    latestSentAt: null, scheduledCount: 0, processingCount: 0, failedCount: 0,
    nextScheduledAt: null, historyUncertain: false,
  };
  if (!contact) return summary;
  const uniqueLogs = Array.from(new Map(logs.filter(log => log.contactId === contactId)
    .map(log => [log.id, log])).values());
  summary.logCount = uniqueLogs.length;
  let latestSent: number | null = null;
  let nextScheduled: number | null = null;
  let replyStopped = false;
  for (const log of uniqueLogs) {
    const sentAt = timestamp(log.sentAt);
    // A subsequent reply/failure/queue change must not erase recorded sends.
    const recordedSend = log.status === "sent" || sentAt !== null || Boolean(log.brevoMessageId?.trim());
    if (recordedSend) {
      summary.sentCount++;
      if (sentAt !== null && (latestSent === null || sentAt > latestSent)) latestSent = sentAt;
    }
    if (log.status === "pending") {
      summary.scheduledCount++;
      const scheduledAt = timestamp(log.scheduledSendAt);
      if (scheduledAt !== null && (nextScheduled === null || scheduledAt < nextScheduled)) nextScheduled = scheduledAt;
    }
    if (log.status === "processing") summary.processingCount++;
    if (log.status === "failed") summary.failedCount++;
    const hasReply = log.status === "replied" || log.emailResponseReceived === "true";
    if (hasReply) replyStopped = true;
    if (!recordedSend && (hasReply || Boolean(log.sentAt) ||
        !["pending", "processing", "failed"].includes(log.status))) {
      summary.historyUncertain = true;
    }
  }
  summary.latestSentAt = latestSent === null ? null : new Date(latestSent).toISOString();
  summary.nextScheduledAt = nextScheduled === null ? null : new Date(nextScheduled).toISOString();
  summary.sequenceStatus = summary.processingCount ? "sending" :
    summary.scheduledCount ? "scheduled" : replyStopped ? "reply_stopped" :
    summary.failedCount ? "failed" : summary.logCount ? "historical" : "not_enrolled";
  // There is no explicit lifecycle record: sent steps alone do not prove an
  // active enrollment or that every strategy's full sequence is completed.
  return summary;
}

export function buildPipelineEmailSummaries(
  contactIds: string[], contacts: PipelineContact[], logs: PipelineEmailLog[], userId: string | null,
): PipelineEmailSummaries {
  const ids = Array.from(new Set(contactIds));
  const requested = new Set(ids);
  const permittedContacts = new Map(contacts.filter(contact => requested.has(contact.id) &&
    (userId === null || contact.userId === userId)).map(contact => [contact.id, contact]));
  const logsByContact = new Map<string, PipelineEmailLog[]>();
  for (const log of logs) {
    if (!permittedContacts.has(log.contactId) || (userId !== null && log.userId !== userId)) continue;
    const grouped = logsByContact.get(log.contactId) ?? [];
    grouped.push(log);
    logsByContact.set(log.contactId, grouped);
  }
  return Object.fromEntries(ids.map(id => [
    id, summarizePipelineContact(id, permittedContacts.get(id), logsByContact.get(id) ?? []),
  ]));
}

export interface PipelineSummaryRepository {
  getDeals(userId: string | null, stage?: string): Promise<Array<{ contactId: string | null }>>;
  getContacts(ids: string[], userId: string | null): Promise<PipelineContact[]>;
  getLogs(ids: string[], userId: string | null): Promise<PipelineEmailLog[]>;
}

export const PIPELINE_SUMMARY_BATCH_SIZE = 250;

export async function loadPipelineEmailSummaries(
  userId: string | null, stage: string | undefined, repository: PipelineSummaryRepository,
): Promise<PipelineEmailSummaries> {
  const deals = await repository.getDeals(userId, stage);
  const ids = Array.from(new Set(deals.map(deal => deal.contactId).filter((id): id is string => Boolean(id))));
  const result: PipelineEmailSummaries = {};
  for (let offset = 0; offset < ids.length; offset += PIPELINE_SUMMARY_BATCH_SIZE) {
    const batch = ids.slice(offset, offset + PIPELINE_SUMMARY_BATCH_SIZE);
    const [contacts, logs] = await Promise.all([
      repository.getContacts(batch, userId), repository.getLogs(batch, userId),
    ]);
    Object.assign(result, buildPipelineEmailSummaries(batch, contacts, logs, userId));
  }
  return result;
}