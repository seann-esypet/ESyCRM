import { Check, CircleAlert, Clock3, LoaderCircle, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type ResearchStatusBannerProps = {
  status?: string;
  enabled: boolean;
  unavailableReason?: string | null;
  nextRunAt?: string | null;
  waitReason?: "provider_rate_limit";
};

function researchLabel(status?: string, enabled = true, unavailable = false) {
  if (unavailable) return "Research unavailable";
  if (!status) return "Not started";
  switch (status) {
    case "running":
      return enabled && !unavailable ? "Researching" : "Research paused";
    case "waiting_hourly":
      return enabled ? "Waiting—resumes automatically" : "Research paused";
    case "completed":
      return "Search Complete";
    case "budget_exhausted":
      return "Search stopped—request limit reached";
    case "paused":
      return "Research paused";
    case "interrupted":
      return "Research interrupted";
    default:
      return "Not started";
  }
}

function formatNextRun(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? null
    : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function ResearchStatusBanner({
  status,
  enabled,
  unavailableReason,
  nextRunAt,
  waitReason,
}: ResearchStatusBannerProps) {
  const unavailable = Boolean(unavailableReason);
  const isActivelyResearching = status === "running" && enabled && !unavailable;
  const isWaiting = status === "waiting_hourly" && enabled && !unavailable;
  const providerWait = isWaiting && waitReason === "provider_rate_limit";
  const label = providerWait ? "Waiting for provider—resumes automatically" : researchLabel(status, enabled, unavailable);
  const scheduledText = formatNextRun(nextRunAt);

  const Icon = isActivelyResearching
    ? LoaderCircle
    : status === "completed"
      ? Check
      : status === "budget_exhausted" || status === "interrupted"
        ? CircleAlert
        : isWaiting
          ? Clock3
          : status === "paused" || (status === "running" && !enabled)
            ? X
            : Search;

  return (
    <section
      data-testid="full-research-status"
      className={`relative overflow-hidden rounded-xl border p-4 sm:p-5 ${
        isActivelyResearching
          ? "border-teal-300 bg-teal-50/90"
          : status === "completed"
            ? "border-emerald-200 bg-emerald-50/75"
            : status === "budget_exhausted" || status === "interrupted"
              ? "border-amber-300 bg-amber-50/80"
              : "border-border bg-card"
      }`}
      aria-live="polite"
      aria-atomic="true"
      role="status"
    >
      {isActivelyResearching && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-1 overflow-hidden bg-teal-100"
        >
          <span className="research-progress-sweep absolute inset-y-0 left-0 w-1/3 rounded-full bg-teal-600" />
        </div>
      )}
      <div className="flex items-start gap-4">
        <div
          className={`grid h-12 w-12 shrink-0 place-items-center rounded-xl ${
            isActivelyResearching
              ? "bg-teal-700 text-white"
              : status === "completed"
                ? "bg-emerald-700 text-white"
                : status === "budget_exhausted" || status === "interrupted"
                  ? "bg-amber-200 text-amber-950"
                  : "bg-muted text-foreground"
          }`}
        >
          <Icon
            aria-hidden="true"
            data-testid={isActivelyResearching ? "full-research-animation" : undefined}
            className={`h-6 w-6 ${isActivelyResearching ? "animate-spin motion-reduce:animate-none" : ""}`}
            strokeWidth={2.2}
          />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <p
              className={`text-lg font-semibold leading-tight tracking-tight ${
                isActivelyResearching ? "text-teal-950 sm:text-xl" : "text-foreground"
              }`}
            >
              {label}
            </p>
            {isActivelyResearching && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-teal-200/70 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-teal-950">
                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-teal-700" />
                Active
              </span>
            )}
          </div>
          {isActivelyResearching ? (
            <p className="mt-1.5 text-sm leading-5 text-teal-950/80">
              Full Research is working through eligible businesses. You can keep using this list while it runs.
            </p>
          ) : isWaiting ? (
            <p className="mt-1.5 text-sm leading-5 text-muted-foreground">
              {providerWait ? "The search provider temporarily limited requests. Research will retry after its cooldown, within your existing limits." : "Research will continue when the hourly allowance is available."}
              {scheduledText && <span className="block">Next eligible run · {scheduledText}</span>}
            </p>
          ) : unavailableReason ? (
            <p className="mt-1.5 text-sm leading-5 text-muted-foreground">{unavailableReason}</p>
          ) : status === "completed" ? (
            <p className="mt-1.5 text-sm leading-5 text-muted-foreground">
              Research is finished. Review the findings before deciding what to use.
            </p>
          ) : status === "budget_exhausted" ? (
            <p className="mt-1.5 text-sm leading-5 text-muted-foreground">
              Work stopped at the approved provider-request cap. Review what is ready; more research needs a separately approved cap increase.
            </p>
           ) : status === "paused" || (["running", "waiting_hourly"].includes(status ?? "") && !enabled) ? (
            <p className="mt-1.5 text-sm leading-5 text-muted-foreground">
              Research is not running. Resume it from the Full Research controls when you are ready.
            </p>
          ) : status === "interrupted" ? (
            <p className="mt-1.5 text-sm leading-5 text-muted-foreground">
              Research stopped before finishing. Review available findings or recover it from the Full Research controls.
            </p>
          ) : (
            <p className="mt-1.5 text-sm leading-5 text-muted-foreground">
              Start Full Research when you are ready to review this list.
            </p>
          )}
        </div>
      </div>
      <style>{`
        @keyframes research-progress-sweep {
          0% { transform: translateX(-110%); }
          100% { transform: translateX(330%); }
        }
        .research-progress-sweep {
          animation: research-progress-sweep 2.4s ease-in-out infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .research-progress-sweep { animation: none; transform: translateX(0); }
        }
      `}</style>
    </section>
  );
}

export type ResearchFinishedDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReview: () => void;
  onRestoreFocus: () => void;
  status: "completed" | "budget_exhausted";
  listName: string;
  processed: number;
  totalRows: number;
  paidCalls: number;
  cap: number;
  needsReview?: number;
  notResearched?: number;
};

function CountItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/80 bg-background/75 px-3.5 py-3">
      <dt className="text-xs font-medium leading-4 text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-mono text-lg font-semibold tabular-nums tracking-tight text-foreground">{value}</dd>
    </div>
  );
}

export function ResearchFinishedDialog({
  open,
  onOpenChange,
  onReview,
  onRestoreFocus,
  status,
  listName,
  processed,
  totalRows,
  paidCalls,
  cap,
  needsReview,
  notResearched,
}: ResearchFinishedDialogProps) {
  const completed = status === "completed";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="full-research-finished-dialog"
        onCloseAutoFocus={event => { event.preventDefault(); onRestoreFocus(); }}
        className="max-h-[min(90dvh,760px)] w-[calc(100%-1.5rem)] max-w-xl overflow-y-auto rounded-2xl border-border bg-card p-0 shadow-2xl motion-reduce:!animate-none"
      >
        <div className={`h-1.5 w-full ${completed ? "bg-emerald-600" : "bg-amber-500"}`} />
        <div className="p-5 sm:p-7">
          <DialogHeader className="pr-8 text-left">
            <div
              aria-hidden="true"
              className={`mb-3 grid h-12 w-12 place-items-center rounded-xl ${
                completed ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900"
              }`}
            >
              {completed ? <Check className="h-6 w-6" strokeWidth={2.4} /> : <CircleAlert className="h-6 w-6" strokeWidth={2.2} />}
            </div>
            <DialogTitle className="text-2xl font-semibold tracking-tight">
              {completed ? "Search Complete" : "Search stopped — request limit reached"}
            </DialogTitle>
            <DialogDescription className="break-words text-sm leading-6">
              <span className="font-medium text-foreground">{listName}</span>
              {completed
                ? " — all currently eligible businesses have been processed. This does not mean every uploaded row was researched or that email addresses were found."
                : " — research stopped at the approved provider-request cap, so this is partial work. The cap counts cumulative provider requests, not dollars. Continuing requires a separately approved cap increase."}
            </DialogDescription>
          </DialogHeader>

          <dl className="mt-6 grid grid-cols-2 gap-2.5 sm:grid-cols-2">
            <CountItem label="Processed candidates / uploaded rows" value={`${processed.toLocaleString()} / ${totalRows.toLocaleString()}`} />
            <CountItem label="Provider requests / approved cap" value={`${paidCalls.toLocaleString()} / ${cap.toLocaleString()}`} />
            {needsReview !== undefined && (
              <CountItem label="Businesses needing review" value={needsReview.toLocaleString()} />
            )}
            {notResearched !== undefined && (
              <CountItem label="Not researched" value={notResearched.toLocaleString()} />
            )}
          </dl>

          <p className="mt-4 rounded-lg bg-muted/65 px-3.5 py-3 text-xs leading-5 text-muted-foreground">
            Provider requests are cumulative attempts, not a dollar amount. Research findings remain suggestions for your review; no email is sent or scheduled.
          </p>

          <DialogFooter className="mt-6 flex-col-reverse gap-2 sm:flex-row sm:gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} className="w-full sm:w-auto">
              Dismiss
            </Button>
            <Button
              onClick={() => {
                onOpenChange(false);
                onReview();
              }}
              className="w-full sm:w-auto"
            >
              Review researched businesses
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
