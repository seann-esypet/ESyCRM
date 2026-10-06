import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { ProviderCreditSnapshot } from "@shared/providerCredits";
import { SharedProviderBudgetPanel } from "./shared-provider-budget";
import { AlertTriangle, Clock3, Pause, Play, RotateCcw, Search } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ResearchStatusBanner, ResearchFinishedDialog } from "./full-research-status";
import { useResearchNotice } from "./use-research-notice";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type FullResearchStatus = {
  status: "running" | "waiting_hourly" | "paused" | "completed" | "budget_exhausted" | "interrupted";
  enabled: boolean;
  limits: { businessesPerHour: number; paidCallsPerHour: number; paidCallsPerList: number };
  processedIds: string[];
  startedRows: { id: string; at: string }[];
  attempts: { at: string; tool: string; rowId: string }[];
  currentRowId: string | null;
  nextRunAt: string | null;
  error: string | null;
  startedAt?: string;
  notificationId?: string;
  waitReason?: "provider_rate_limit";
  providerRateLimitCount?: number;
};
export type FullResearchBatchData = {
  id: string;
  name: string;
  totalRows: number;
  status: string;
  researchProgress?: { fullResearch?: FullResearchStatus };
};
export type FullResearchBatch = {
  batch: FullResearchBatchData;
  readOnlyReason?: string | null;
  busy?: boolean;
  onChanged: () => void | Promise<void>;
  onReview: () => void;
  researchSummary?: { needsReview: number; notResearched: number };
};

async function post(url: string, body: unknown) {
  const response = await apiRequest("POST", url, body);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || data.error || `Request failed (${response.status})`);
  return data;
}

function dateText(value?: string | null) {
  if (!value) return "Not scheduled";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Time unavailable" : date.toLocaleString();
}

export function FullResearchPanel({ batch, readOnlyReason, busy = false, onChanged, onReview, researchSummary }: FullResearchBatch) {
  const research = batch.researchProgress?.fullResearch;
  const credits = useQuery<ProviderCreditSnapshot>({
    queryKey: ["/api/leads", batch.id, "provider-credits"],
    queryFn: async () => (await apiRequest("GET", `/api/leads/${encodeURIComponent(batch.id)}/provider-credits`)).json(),
    staleTime: 60000,
    refetchInterval: 60000,
    retry: false,
  });
  const providerEmpty = !credits.isError && credits.data?.status === "available" && credits.data.remaining === 0;
  const limits = research?.limits;
  const [businessesPerHour, setBusinessesPerHour] = useState(String(limits?.businessesPerHour ?? 20));
  const [paidCallsPerHour, setPaidCallsPerHour] = useState(String(limits?.paidCallsPerHour ?? 40));
  const [paidCallsPerList, setPaidCallsPerList] = useState(String(limits?.paidCallsPerList ?? 200));
  const [consent, setConsent] = useState(false);
  const [budgetConsent, setBudgetConsent] = useState(false);
  const [resumeConsent, setResumeConsent] = useState(false);
  const [recoverConsent, setRecoverConsent] = useState(false);
  const [localError, setLocalError] = useState("");
  const currentStatus = research?.status;
  const exhausted = currentStatus === "budget_exhausted";
  const processed = research?.processedIds?.length ?? 0;
  const previousPaidCalls = research?.attempts?.length ?? 0;

  const now = Date.now();
  const recentStarted = useMemo(
    () => (research?.startedRows ?? []).filter(entry => {
      const at = new Date(entry.at).getTime();
      return Number.isFinite(at) && at > now - 60 * 60 * 1000 && at <= now;
    }),
    [research?.startedRows, now],
  );
  const recentAttempts = useMemo(
    () => (research?.attempts ?? []).filter(entry => {
      const at = new Date(entry.at).getTime();
      return Number.isFinite(at) && at > now - 60 * 60 * 1000 && at <= now;
    }),
    [research?.attempts, now],
  );
  const numberValue = (value: string, max: number) => Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= max;
  const validBusinessCap = numberValue(businessesPerHour, 100);
  const validPaidHourlyCap = numberValue(paidCallsPerHour, 100);
  const validTotalCap = numberValue(paidCallsPerList, 10000);
  const raisesBudget = exhausted && Number(paidCallsPerList) > previousPaidCalls &&
    Number(paidCallsPerList) > (limits?.paidCallsPerList ?? previousPaidCalls);
  const running = currentStatus === "running" || currentStatus === "waiting_hourly";
  const readOnly = Boolean(readOnlyReason);
  const unavailable = readOnly || busy;
  const canStart = consent && validBusinessCap && validPaidHourlyCap && validTotalCap &&
    !unavailable && !running && currentStatus !== "paused" &&
    (!exhausted || (raisesBudget && budgetConsent));
  const onSuccess = async () => {
    setLocalError("");
    setConsent(false);
    setBudgetConsent(false);
    setResumeConsent(false);
    setRecoverConsent(false);
    await onChanged();
  };

  const start = useMutation({
    mutationFn: () => post(`/api/leads/${encodeURIComponent(batch.id)}/full-research`, {
      confirmed: true,
      businessesPerHour: Number(businessesPerHour),
      paidCallsPerHour: Number(paidCallsPerHour),
      paidCallsPerList: Number(paidCallsPerList),
    }),
    onSuccess,
    onError: error => setLocalError(error.message),
  });
  const control = useMutation({
    mutationFn: (action: "pause" | "resume" | "recover") =>
      post(`/api/leads/${encodeURIComponent(batch.id)}/full-research/${action}`, { confirmed: true }),
    onSuccess,
    onError: error => setLocalError(error.message),
  });
  const pending = start.isPending || control.isPending;
  const cap = limits?.paidCallsPerList ?? Number(paidCallsPerList);
  const canResume = currentStatus === "paused";
  const canRecover = currentStatus === "interrupted";
  const unavailableReason = readOnlyReason || (busy ? "Another research worker is active for this list. Full Research is unavailable until it finishes." : null);
  const notice = useResearchNotice(batch.id, research?.notificationId ?? research?.startedAt, currentStatus, Boolean(unavailableReason));
  const statusFocus = useRef<HTMLDivElement>(null);
  const reviewChosen = useRef(false);

  return <Card data-testid="full-research-panel" className="border-primary/20">
    <CardHeader className="pb-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-base"><Search className="h-4 w-4 text-primary"/>Full Research</CardTitle>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">Research email and source evidence, software usage and provider, and contact first and last names using available free and paid tools. Unverified or unavailable facts remain unknown; every candidate still requires your review.</p>
        </div>
      </div>
      <div ref={statusFocus} tabIndex={-1} aria-label="Full Research status" className="pt-4">
        <ResearchStatusBanner status={currentStatus} enabled={Boolean(research?.enabled)}
           nextRunAt={research?.nextRunAt} waitReason={research?.waitReason} unavailableReason={unavailableReason}/>
      </div>
    </CardHeader>
    <CardContent className="space-y-4">
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs leading-5 text-amber-950">
        <p className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4 shrink-0"/>Cost and request caution</p>
        <p className="mt-1">Caps count provider calls, not dollars. A single business may require several provider calls. Calls may fail or return no evidence and still count against the paid-call cap. Full Research only stages suggestions: it does not approve evidence, import contacts, or send or schedule email.</p>
      </div>
      {readOnlyReason && <Alert><AlertTitle>Research unavailable for this list</AlertTitle><AlertDescription>{readOnlyReason}</AlertDescription></Alert>}
      {busy && <p className="text-xs text-muted-foreground">Another research worker is active for this list. Full Research controls are temporarily unavailable.</p>}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1"><Label htmlFor="full-research-businesses-hour">Businesses per hour (1–100)</Label><Input id="full-research-businesses-hour" data-testid="full-research-businesses-hour" type="number" min="1" max="100" step="1" value={businessesPerHour} disabled={pending||running} onChange={event=>setBusinessesPerHour(event.target.value)}/></div>
        <div className="space-y-1"><Label htmlFor="full-research-paid-hour">Paid calls per hour (1–100)</Label><Input id="full-research-paid-hour" data-testid="full-research-paid-hour" type="number" min="1" max="100" step="1" value={paidCallsPerHour} disabled={pending||running} onChange={event=>setPaidCallsPerHour(event.target.value)}/></div>
        <div className="space-y-1"><Label htmlFor="full-research-paid-total">Paid calls total for this list (1–10,000)</Label><Input id="full-research-paid-total" data-testid="full-research-paid-total" type="number" min="1" max="10000" step="1" value={paidCallsPerList} disabled={pending||running} onChange={event=>setPaidCallsPerList(event.target.value)}/></div>
      </div>
      {providerEmpty && <Alert variant="destructive" data-testid="provider-credits-empty">
        <AlertTitle>No SerpAPI credits remaining</AlertTitle>
        <AlertDescription>The provider account has 0 searches left. Your list cap is a separate safety limit, not available provider credit. Replenish credits or wait for the allowance to renew, then check the balance before resuming. Waiting an hour or raising this list cap will not restore provider credits.</AlertDescription>
      </Alert>}
      <SharedProviderBudgetPanel batchId={batch.id} snapshot={credits.isError ? undefined : credits.data}
        onUpdated={async () => { await credits.refetch(); await onChanged(); }}/>
      {!running && currentStatus !== "paused" && <div className="space-y-3">
        <label className="flex items-start gap-2 text-sm leading-5">
          <Checkbox data-testid="full-research-consent" checked={consent} onCheckedChange={value=>setConsent(value===true)} disabled={pending||unavailable}/>
          <span>I authorize Full Research for this saved list using the caps above. I understand provider calls are not dollar amounts, businesses may take several calls, and paid attempts count even when they fail. Candidates are suggestions for review only; no contact import or email action occurs.</span>
        </label>
        {exhausted && <label className="flex items-start gap-2 text-sm leading-5">
          <Checkbox id="full-research-budget-increase-consent" data-testid="full-research-budget-increase-consent" checked={budgetConsent} onCheckedChange={value=>setBudgetConsent(value===true)} disabled={pending||unavailable}/>
          <span>I explicitly approve raising this list’s total paid-call cap above its previous limit and {previousPaidCalls} prior paid attempts. All prior counters and history remain preserved; no past calls are refunded.</span>
        </label>}
        <Button data-testid="full-research-start" disabled={!canStart||pending} onClick={()=>{setLocalError("");start.mutate();}}>
          {start.isPending?"Starting Full Research…":exhausted?"Start with increased cap":"Start Full Research"}
        </Button>
      </div>}
      {running && <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-muted-foreground">{currentStatus === "waiting_hourly" ? research?.waitReason === "provider_rate_limit" ? "Waiting for the provider cooldown. Research resumes automatically." : "Waiting for the next hourly allowance." : "Full Research is running."}{research?.currentRowId ? ` Current candidate: ${research.currentRowId}` : ""}</p>
        <Button data-testid="full-research-pause" variant="outline" size="sm" disabled={pending||readOnly} onClick={()=>{setLocalError("");control.mutate("pause");}}><Pause className="mr-1.5 h-4 w-4"/>{control.isPending&&control.variables==="pause"?"Pausing…":"Pause now"}</Button>
      </div>}
      {canResume && <div className="space-y-2 rounded-lg border p-3">
        <label className="flex items-start gap-2 text-sm"><Checkbox id="full-research-resume-confirmation" checked={resumeConsent} onCheckedChange={value=>setResumeConsent(value===true)} disabled={pending||unavailable}/><span>Confirm separately: resume this saved list within its existing configured caps.</span></label>
        <Button data-testid="full-research-resume" size="sm" disabled={!resumeConsent||pending||unavailable} onClick={()=>{setLocalError("");control.mutate("resume");}}><Play className="mr-1.5 h-4 w-4"/>{control.isPending&&control.variables==="resume"?"Resuming…":"Confirm and resume"}</Button>
      </div>}
      {canRecover && <div className="space-y-2 rounded-lg border p-3">
        <p className="text-xs text-muted-foreground">Recovery is a separate operation. Retained provider attempts and history are not refunded.</p>
        <label className="flex items-start gap-2 text-sm"><Checkbox id="full-research-recover-confirmation" checked={recoverConsent} onCheckedChange={value=>setRecoverConsent(value===true)} disabled={pending||unavailable}/><span>Confirm recovery of this interrupted research operation.</span></label>
        <Button data-testid="full-research-recover" variant="outline" size="sm" disabled={!recoverConsent||pending||unavailable} onClick={()=>{setLocalError("");control.mutate("recover");}}><RotateCcw className="mr-1.5 h-4 w-4"/>{control.isPending&&control.variables==="recover"?"Recovering…":"Confirm and recover"}</Button>
      </div>}
      {(localError||research?.error) && <Alert variant={!localError&&currentStatus==="waiting_hourly"?"default":"destructive"}><AlertTitle>{localError?"Request could not be completed":currentStatus==="waiting_hourly"?"Research waiting":"Research reported an error"}</AlertTitle><AlertDescription>{localError||research?.error}</AlertDescription></Alert>}
      <section className="rounded-lg border bg-muted/30 p-3" aria-label="Full Research progress">
        <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
          <div><b>{processed.toLocaleString()} / {batch.totalRows.toLocaleString()}</b><span className="block text-xs text-muted-foreground">processed candidates</span></div>
          <div><b>{previousPaidCalls.toLocaleString()} / {cap.toLocaleString()}</b><span className="block text-xs text-muted-foreground">paid attempts / list cap</span></div>
          <div data-testid="provider-credits" aria-live="polite">
            <b className={providerEmpty ? "text-destructive" : undefined}>{credits.isPending ? "Checking…" : credits.isError || credits.data?.status !== "available" ? "Unavailable" : credits.data.remaining!.toLocaleString()}</b>
            <span className="block text-xs text-muted-foreground">SerpAPI credits remaining</span>
            {credits.data?.status === "available" && credits.data.monthlyLimit !== null && <span className="block text-xs text-muted-foreground">{credits.data.monthlyLimit.toLocaleString()} searches / monthly allowance</span>}
          </div>
          <div><b>{recentStarted.length} / {limits?.businessesPerHour ?? Number(businessesPerHour)}</b><span className="block text-xs text-muted-foreground">started in rolling 60 min</span></div>
          <div><b>{recentAttempts.length} / {limits?.paidCallsPerHour ?? Number(paidCallsPerHour)}</b><span className="block text-xs text-muted-foreground">attempts in rolling 60 min</span></div>
        </div>
        <div className="mt-3 border-t pt-2 text-xs text-muted-foreground">
          <p>Provider credits are shared across all lists and searches, separate from this list’s cap. Account totals may lag recent requests.</p>
          {credits.isError || credits.data?.status === "unavailable" ? <p className="mt-1">Provider balance could not be checked. It is unknown—not zero. Check the provider account before resuming.</p> : credits.data && <p className="mt-1">Balance checked · {dateText(credits.data.checkedAt)} · refreshes every minute</p>}
          <Button variant="outline" size="sm" className="mt-2" data-testid="provider-credits-refresh" disabled={credits.isFetching} onClick={() => { void credits.refetch(); }}>{credits.isFetching ? "Checking balance…" : "Check provider balance"}</Button>
        </div>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
          <span>Next eligible run · {dateText(research?.nextRunAt)}</span>
          {research?.currentRowId && <span>Current candidate · {research.currentRowId}</span>}
          {exhausted && <span>Increase total cap above {previousPaidCalls} prior attempts to request more research.</span>}
        </div>
        {(recentStarted.length > 0 || recentAttempts.length > 0) && <details className="mt-3 border-t pt-2">
          <summary className="flex cursor-pointer list-none items-center gap-1 text-xs font-medium"><Clock3 className="h-3.5 w-3.5"/>Recent activity · rolling 60 minutes</summary>
          <div className="mt-2 grid gap-3 text-xs sm:grid-cols-2">
            <div><b>Businesses started ({recentStarted.length})</b><ul className="mt-1 space-y-1">{recentStarted.slice(-8).reverse().map((entry,index)=><li key={`${entry.id}-${entry.at}-${index}`}>{dateText(entry.at)} · {entry.id}</li>)}</ul></div>
            <div><b>Provider attempts ({recentAttempts.length})</b><ul className="mt-1 space-y-1">{recentAttempts.slice(-8).reverse().map((entry,index)=><li key={`${entry.rowId}-${entry.at}-${index}`}>{dateText(entry.at)} · {entry.tool} · {entry.rowId}</li>)}</ul></div>
          </div>
        </details>}
      </section>
      <p className="text-xs leading-5 text-muted-foreground">The list-wide request cap is a starting safety limit, not a guarantee that the entire list will be researched. It counts provider requests, not businesses, emails found, or dollars.</p>
      <p className="text-xs leading-5 text-muted-foreground">Protections: evidence remains unapproved until reviewed; unknown facts stay unknown; saved-list history and paid-attempt counters are retained. Full Research never imports a CRM contact or sends/schedules email.</p>
    </CardContent>
    <ResearchFinishedDialog open={notice.open} onOpenChange={open => { if (!open) notice.dismiss(); }}
      onReview={() => { reviewChosen.current = true; onReview(); }}
      onRestoreFocus={() => {
        const target = reviewChosen.current ? document.getElementById("lead-candidates")?.querySelector<HTMLInputElement>("input") : statusFocus.current;
        (target ?? statusFocus.current)?.focus({ preventScroll: true });
        reviewChosen.current = false;
      }} status={notice.status} listName={batch.name}
      processed={processed} totalRows={batch.totalRows} paidCalls={previousPaidCalls} cap={cap}
      needsReview={researchSummary?.needsReview} notResearched={researchSummary?.notResearched}/>
  </Card>;
}