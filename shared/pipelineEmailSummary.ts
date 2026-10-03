export type PipelineSequenceStatus =
  | "not_enrolled" | "scheduled" | "sending" | "failed"
  | "reply_stopped" | "historical" | "unavailable";

export interface PipelineEmailSummary {
  contactId: string;
  contactState: "available" | "unavailable";
  email: string | null;
  sequenceStatus: PipelineSequenceStatus;
  logCount: number;
  sentCount: number;
  latestSentAt: string | null;
  scheduledCount: number;
  processingCount: number;
  failedCount: number;
  nextScheduledAt: string | null;
  historyUncertain: boolean;
}

export type PipelineEmailSummaries = Record<string, PipelineEmailSummary>;

export const pipelineSequenceLabels: Record<PipelineSequenceStatus, string> = {
  not_enrolled: "Not in a sequence",
  scheduled: "Scheduled",
  sending: "Sending",
  failed: "Failed attempt",
  reply_stopped: "Stopped after reply",
  historical: "Previously enrolled",
  unavailable: "Status unavailable",
};

export function matchesPipelineEmailFilters(
  summary: PipelineEmailSummary | undefined,
  sequenceFilter: string,
  historyFilter: string,
): boolean {
  if (sequenceFilter !== "all") {
    if (sequenceFilter === "unavailable") {
      if (summary?.contactState === "available") return false;
    } else if (!summary || summary.contactState !== "available") return false;
    else if (sequenceFilter === "enrolled") {
      if (!summary.logCount) return false;
    } else if (summary.sequenceStatus !== sequenceFilter) return false;
  }
  if (historyFilter !== "all") {
    if (!summary || summary.contactState !== "available") return false;
    if (historyFilter === "sent" && summary.sentCount === 0) return false;
    // Ambiguous historical records must not be presented as confirmed absence.
    if (historyFilter === "none" && (summary.sentCount > 0 || summary.historyUncertain)) return false;
  }
  return true;
}