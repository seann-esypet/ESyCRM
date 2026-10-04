import * as React from "react";
import { CalendarClock, CircleMinus, Mail, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { PipelineEmailSummary } from "@shared/pipelineEmailSummary";
import { pipelineSequenceLabels } from "@shared/pipelineEmailSummary";

interface PipelineEmailStatusProps {
  contactId: string | null;
  summary?: PipelineEmailSummary;
  email?: string | null;
  contactKnown: boolean;
  contactsLoading: boolean;
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
  onOpenHistory: () => void;
  compact?: boolean;
}

export default function PipelineEmailStatus({
  contactId,
  summary,
  email,
  contactKnown,
  contactsLoading,
  loading,
  failed,
  onRetry,
  onOpenHistory,
  compact = false,
}: PipelineEmailStatusProps) {
  const linkedContactAvailable = !!contactId && summary?.contactState === "available";
  const status = !contactId
    ? "Status unavailable"
    : loading
      ? "Loading status"
      : failed || !summary || summary.contactState !== "available"
        ? pipelineSequenceLabels.unavailable
        : summary.logCount === 0 && summary.sentCount === 0 && !summary.historyUncertain
          ? pipelineSequenceLabels.not_enrolled
          : pipelineSequenceLabels[summary.sequenceStatus];

  const statusIsNotEnrolled = status === pipelineSequenceLabels.not_enrolled;
  const statusIsScheduled = status === pipelineSequenceLabels.scheduled;
  const StatusIcon = statusIsNotEnrolled
    ? CircleMinus
    : statusIsScheduled
      ? CalendarClock
      : null;
  const statusBadgeClass = statusIsNotEnrolled
    ? "border-amber-700/25 bg-amber-100 text-amber-950 dark:border-amber-300/30 dark:bg-amber-950/60 dark:text-amber-100"
    : statusIsScheduled
      ? "border-sky-700/25 bg-sky-100 text-sky-950 dark:border-sky-300/30 dark:bg-sky-950/60 dark:text-sky-100"
      : "font-semibold";

  let recordedSummary = "Recorded sends unavailable";
  if (contactId && loading) recordedSummary = "Loading recorded sends";
  else if (contactId && !failed && summary?.contactState === "available") {
    if (summary.historyUncertain) {
      const dateNote = summary.sentCount > 0
        ? ` · latest recorded ${summary.latestSentAt ? new Date(summary.latestSentAt).toLocaleDateString() : "date not recorded"}`
        : "";
      recordedSummary = `History incomplete/unknown · ${summary.sentCount} recorded sent${dateNote}`;
    } else if (summary.sentCount === 0) {
      recordedSummary = "No recorded emails sent";
    } else if (summary.sentCount > 0) {
      const date = summary.latestSentAt
        ? new Date(summary.latestSentAt).toLocaleDateString()
        : "date not recorded";
      recordedSummary = `${summary.sentCount} recorded sent · latest recorded ${date}`;
    }
  }

  const contactLine = !contactId
    ? "No linked contact"
    : contactsLoading && !summary
      ? "Loading contact"
    : summary?.contactState === "unavailable"
      ? "Contact unavailable"
      : email
        ? email
        : linkedContactAvailable || contactKnown
          ? "No email address"
          : "Contact unavailable";

  return (
    <div className={`rounded-md border border-border/80 bg-muted/20 ${compact ? "p-2.5" : "p-3"}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1.5">
          <p className="truncate text-xs text-muted-foreground" title={contactLine}>
            <span className="font-medium text-foreground/80">Email:</span> {contactLine}
          </p>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            <span className="font-semibold text-foreground/80" data-pipeline-sequence-status-label>
              Sequence status
            </span>
            {loading ? (
              <span className="h-5 w-28 animate-pulse rounded bg-muted" aria-label="Loading sequence status" />
            ) : (
              <Badge
                data-pipeline-sequence-status={status}
                variant={status === "Status unavailable" || status === "Failed attempt" ? "destructive" : "secondary"}
                className={`min-h-7 gap-1.5 px-2.5 py-1 text-sm font-bold leading-4 ${statusBadgeClass}`}
                title={statusIsScheduled ? "Next email is scheduled, not yet sent" : undefined}
              >
                {StatusIcon && <StatusIcon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />}
                {status}
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground" aria-label="Recorded send summary">
            <span className="font-medium text-foreground/80">Recorded sends:</span> {recordedSummary}
          </p>
          {summary?.historyUncertain && !failed && (
            <p className="text-[11px] text-amber-700 dark:text-amber-300">History incomplete/unknown; counts reflect available CRM records.</p>
          )}
          {!!summary?.failedCount && !failed && !loading && (
            <p className="text-[11px] text-destructive">{summary.failedCount} failed attempt{summary.failedCount === 1 ? "" : "s"} recorded</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {failed && (
            <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={onRetry} aria-label="Retry email status">
              <RefreshCw className="mr-1 h-3.5 w-3.5" />
              Retry
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="h-8 px-2.5 text-xs"
            onClick={onOpenHistory}
            disabled={!contactId}
            title={!contactId ? "This deal has no linked contact" : "Open CRM-recorded email history"}
            aria-label="Email history"
          >
            <Mail className="mr-1.5 h-3.5 w-3.5" />
            Email history
          </Button>
        </div>
      </div>
    </div>
  );
}