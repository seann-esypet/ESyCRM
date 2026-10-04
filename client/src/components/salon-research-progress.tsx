import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import {
  AlertCircle, ArrowRight, Check, Clock3, Database, Leaf, Loader2,
  MailCheck, RefreshCw, ShieldCheck, Wifi, WifiOff,
} from "lucide-react";

type SalonResearchStatus = {
  available: boolean;
  initialized: boolean;
  canInitialize: boolean;
  batchId: string | null;
  directoryTotal: number;
  pilotTotal: number;
  pilotCompleted: number;
  verifiedEmails: number;
  verifiedForms: number;
  requestsInitiated: number;
  monthlyCap: number;
  hourlyLimit: number;
  status: string;
  sourceUpdatedAt: string | null;
  lastSyncedAt: string | null;
  nextAllowanceAt: string | null;
  stale: boolean;
  connection: string;
  message: string;
};

type SalonResearchProgressProps = {
  isAdmin: boolean;
  onViewDirectory: (batchId: string) => void;
  onViewVerifiedEmails: (batchId: string) => void;
};

const PILOT_DENOMINATOR = 120;
const numberLabel = (value: number) => Number(value || 0).toLocaleString();

function timestampLabel(value: string | null) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not recorded";
  return date.toLocaleString(undefined, {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

function getConnectionState(connection: string) {
  const normalized = connection.toLowerCase();
  if (["offline", "disconnected", "unavailable", "error", "failed"].some(value => normalized.includes(value))) return "offline";
  if (["online", "connected", "ready", "healthy"].some(value => normalized.includes(value))) return "online";
  return "unknown";
}

async function getResearchStatus(): Promise<SalonResearchStatus> {
  const response = await apiRequest("GET", "/api/salon-research/status");
  return response.json();
}

export function SalonResearchProgress({
  isAdmin,
  onViewDirectory,
  onViewVerifiedEmails,
}: SalonResearchProgressProps) {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const statusQuery = useQuery<SalonResearchStatus>({
    queryKey: ["/api/salon-research/status"],
    queryFn: getResearchStatus,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
  useEffect(() => {
    if (!statusQuery.data?.initialized) return;
    // Refresh the displayed leads as well as the progress panel. These are
    // read-only queries; refreshing never triggers provider searches.
    queryClient.invalidateQueries({ queryKey: ["/api/salon-search-report"] });
    queryClient.invalidateQueries({
      predicate: query => String(query.queryKey[0]).startsWith("/api/salon-enrichment"),
    });
  }, [statusQuery.data?.initialized, statusQuery.data?.lastSyncedAt]);

  const initialize = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/salon-research/initialize");
      return response.json() as Promise<SalonResearchStatus>;
    },
    onSuccess: status => {
      queryClient.setQueryData(["/api/salon-research/status"], status);
      toast({ title: "Directory is ready", description: "The original directory is stored. You can return here for progress without uploading it again." });
      queryClient.invalidateQueries({ queryKey: ["/api/salon-search-report"] });
    },
    onError: (error: Error) => {
      toast({ title: "Could not initialize the directory", description: error.message, variant: "destructive" });
      queryClient.invalidateQueries({ queryKey: ["/api/salon-research/status"] });
    },
  });

  if (statusQuery.isLoading) {
    return (
      <Card className="overflow-hidden border-border/80">
        <div className="h-1.5 animate-pulse bg-teal-700/20" />
        <CardContent className="space-y-5 p-5 sm:p-6" aria-label="Loading salon research status">
          <div className="h-5 w-48 animate-pulse rounded bg-muted" />
          <div className="h-4 w-72 max-w-full animate-pulse rounded bg-muted" />
          <div className="grid gap-3 sm:grid-cols-3">
            {[0, 1, 2].map(item => <div key={item} className="h-20 animate-pulse rounded-xl bg-muted/70" />)}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (statusQuery.isError || !statusQuery.data) {
    return (
      <Card className="border-rose-200 bg-rose-50/50 dark:border-rose-900 dark:bg-rose-950/20">
        <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex gap-3">
            <span className="mt-0.5 rounded-lg bg-rose-100 p-2 text-rose-800 dark:bg-rose-900/50 dark:text-rose-200"><AlertCircle className="h-4 w-4" /></span>
            <div>
              <h2 className="font-semibold">Research status is unavailable</h2>
              <p className="mt-1 text-sm text-muted-foreground">{(statusQuery.error as Error)?.message || "Check your connection and try again."} No new lookups are started by refreshing this status.</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => statusQuery.refetch()} disabled={statusQuery.isFetching}>
            <RefreshCw className={`mr-2 h-4 w-4 ${statusQuery.isFetching ? "animate-spin" : ""}`} />Retry status
          </Button>
        </CardContent>
      </Card>
    );
  }

  const status = statusQuery.data;
  const connectionState = getConnectionState(status.connection || "");
  const completed = Math.max(0, Math.min(PILOT_DENOMINATOR, Number(status.pilotCompleted) || 0));
  const progress = completed / PILOT_DENOMINATOR * 100;
  const isOffline = !status.available || connectionState === "offline";
  const statusLabel = status.status === "stopped_by_user"
    ? "Pilot closed — saved results"
    : status.status?.replace(/[_-]+/g, " ") || "Status pending";
  const nextAllowance = status.nextAllowanceAt ? timestampLabel(status.nextAllowanceAt) : null;
  const normalizedStatus = status.status.toLowerCase();
  const waitingReason = status.message || (
    normalizedStatus.includes("paused") ? "Research is paused; no additional pilot work will start until it resumes." :
      normalizedStatus.includes("wait") ? "Research is waiting for the next available allowance." :
        normalizedStatus.includes("fail") || normalizedStatus.includes("error") ? "The latest research run reported a failure. Review the source status before retrying." : ""
  );

  if (!status.initialized) {
    return (
      <Card className="overflow-hidden border-teal-900/15 bg-[linear-gradient(115deg,hsl(var(--card)),hsl(164_34%_96%))] dark:bg-card">
        <div className="h-1.5 bg-teal-800" />
        <CardContent className="grid gap-5 p-5 sm:p-6 lg:grid-cols-[1fr_auto] lg:items-center">
          <div className="flex gap-4">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-teal-900 text-teal-50"><Database className="h-5 w-5" /></span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold tracking-tight">CA · TX · NY salon directory</h2>
                <span className="rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">One-time setup</span>
              </div>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
                Save the original directory once, then return for hourly progress—no repeated uploads. Only a <strong className="font-semibold text-foreground">120-row pilot</strong> is authorized; the full directory is available to browse, not being processed.
              </p>
              {waitingReason && <p className="mt-2 text-sm text-muted-foreground">{waitingReason}</p>}
              {isOffline && <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-rose-700 dark:text-rose-300"><WifiOff className="h-3.5 w-3.5" />Research source is offline or unavailable.</p>}
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row lg:flex-col">
            <Button
              onClick={() => initialize.mutate()}
              disabled={!isAdmin || !status.canInitialize || initialize.isPending || !status.available}
              className="bg-teal-900 text-white hover:bg-teal-800"
            >
              {initialize.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving directory…</> : <><Leaf className="mr-2 h-4 w-4" />Load saved directory once</>}
            </Button>
            {!isAdmin && <p className="text-center text-xs text-muted-foreground">An administrator must initialize this shared directory.</p>}
            {isAdmin && !status.canInitialize && !isOffline && <p className="text-center text-xs text-muted-foreground">Initialization is currently unavailable.</p>}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden border-teal-900/15">
      <div className="h-1.5 bg-teal-800" />
      <CardContent className="space-y-5 p-5 sm:p-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="flex gap-4">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-teal-900 text-teal-50"><Database className="h-5 w-5" /></span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold tracking-tight">CA · TX · NY salon directory</h2>
                <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${
                  isOffline
                    ? "bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-200"
                    : status.stale
                      ? "bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200"
                      : "bg-teal-100 text-teal-900 dark:bg-teal-950/50 dark:text-teal-200"
                }`}>
                  {isOffline ? <WifiOff className="h-3 w-3" /> : status.stale ? <Clock3 className="h-3 w-3" /> : <Wifi className="h-3 w-3" />}
                  {isOffline ? "Offline" : status.stale ? "Stale data" : connectionState === "online" ? "Live source" : "Connected"}
                </span>
                <span className="rounded-full border border-border px-2.5 py-1 text-[11px] font-medium capitalize text-muted-foreground">{statusLabel}</span>
              </div>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
                One shared source, refreshed automatically every 30 seconds. The authorized research pilot is limited to 120 rows; the rest of the {numberLabel(status.directoryTotal)}-business directory is browse-only.
              </p>
              {waitingReason && <p className="mt-2 text-sm text-foreground/80">{waitingReason}</p>}
            </div>
          </div>
          <Button variant="ghost" size="sm" className="shrink-0 self-start" onClick={() => statusQuery.refetch()} disabled={statusQuery.isFetching}>
            <RefreshCw className={`mr-2 h-4 w-4 ${statusQuery.isFetching ? "animate-spin" : ""}`} />Refresh
          </Button>
        </div>

        {(isOffline || status.stale) && (
          <div className={`flex gap-2 rounded-lg border px-3.5 py-3 text-sm ${
            isOffline ? "border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-900 dark:bg-rose-950/20 dark:text-rose-200" : "border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-100"
          }`}>
            {isOffline ? <WifiOff className="mt-0.5 h-4 w-4 shrink-0" /> : <Clock3 className="mt-0.5 h-4 w-4 shrink-0" />}
            <p>{isOffline ? "The research connection is offline. Stored results remain available, but progress may not be current." : "Progress is stale. The source has not synchronized recently; treat these counts as a last-known snapshot."}</p>
          </div>
        )}

        <div className="grid gap-3 md:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <div className="rounded-xl border border-teal-900/15 bg-teal-50/70 p-4 dark:border-teal-800 dark:bg-teal-950/25">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-teal-900/75 dark:text-teal-100/75">Authorized pilot</p>
                <p className="mt-1 font-mono text-2xl font-semibold tracking-tight text-teal-950 dark:text-teal-50">{numberLabel(completed)} <span className="text-muted-foreground">/ {PILOT_DENOMINATOR}</span></p>
              </div>
              <span className="rounded-lg bg-white/70 p-2 text-teal-900 dark:bg-teal-900/50 dark:text-teal-100"><Leaf className="h-4 w-4" /></span>
            </div>
            <Progress value={progress} className="mt-3 h-2 bg-teal-900/10 [&>div]:bg-teal-800" aria-label={`${completed} of ${PILOT_DENOMINATOR} pilot rows completed`} />
            <p className="mt-2 text-xs text-muted-foreground">120-row cap · {numberLabel(status.requestsInitiated)} requests initiated</p>
          </div>
          <Metric icon={Database} label="Full directory" value={numberLabel(status.directoryTotal)} note="Businesses available to review" />
          <Metric icon={MailCheck} label="Verified public email" value={numberLabel(status.verifiedEmails)} note={`${numberLabel(status.verifiedForms)} public forms found`} />
        </div>

        <div className="grid gap-3 rounded-xl border bg-muted/20 p-4 sm:grid-cols-2 xl:grid-cols-4">
          <Timestamp label="Source last updated" value={timestampLabel(status.sourceUpdatedAt)} />
          <Timestamp label="Last synchronized" value={timestampLabel(status.lastSyncedAt)} />
          <Timestamp label="Next allowance" value={status.status === "stopped_by_user" ? "None — pilot closed" : nextAllowance || "No wait reported"} />
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Lookup limits</p>
            <p className="mt-1 text-sm font-medium">{numberLabel(status.hourlyLimit)} / hour <span className="text-muted-foreground">· {numberLabel(status.monthlyCap)} / month</span></p>
            <p className="mt-1 text-xs text-muted-foreground">Next-hour allowance estimate: up to {numberLabel(status.hourlyLimit)} lookups</p>
          </div>
        </div>

        <div className="flex flex-col gap-3 border-t pt-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-teal-800" />
            <p>Nothing is approved, imported, or sent automatically. Review an email and explicitly choose <strong className="font-medium text-foreground">Import approved</strong> in the existing approval workflow.</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <Button variant="outline" size="sm" onClick={() => status.batchId && onViewDirectory(status.batchId)} disabled={!status.batchId}>
              Browse full directory <ArrowRight className="ml-2 h-3.5 w-3.5" />
            </Button>
            <Button variant="outline" size="sm" onClick={() => status.batchId && onViewVerifiedEmails(status.batchId)} disabled={!status.batchId}>
              Verified emails <ArrowRight className="ml-2 h-3.5 w-3.5" />
            </Button>
            <Button
              size="sm"
              className="bg-teal-900 text-white hover:bg-teal-800"
              onClick={() => status.batchId && setLocation(`/salon-enrichment/${encodeURIComponent(status.batchId)}`)}
              disabled={!status.batchId}
            >
              Approval & import <Check className="ml-2 h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Metric({ icon: Icon, label, value, note }: { icon: typeof Database; label: string; value: string; note: string }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">{label}</p>
        <Icon className="h-4 w-4 text-teal-800 dark:text-teal-200" />
      </div>
      <p className="mt-2 font-mono text-2xl font-semibold tracking-tight">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{note}</p>
    </div>
  );
}

function Timestamp({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{label}</p>
      <p className="mt-1 inline-flex items-center gap-1.5 text-sm font-medium"><Clock3 className="h-3.5 w-3.5 text-muted-foreground" />{value}</p>
    </div>
  );
}