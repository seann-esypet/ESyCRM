import React, { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { OwnerNameResult } from "@shared/salonOwnerName";
import { relevantOwnerCandidate } from "@shared/salonOwnerDiscoveryRelevance";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, Check, ExternalLink, RotateCcw, UserRound } from "lucide-react";

export type { OwnerNameResult } from "@shared/salonOwnerName";
export type OwnerPreview = { subject: string; body: string; salutation: string; mode: string; previewSource: string };
type ContactName = { firstName?: string | null; lastName?: string | null; useBusinessNameForEmail?: "Yes" | "No" | null };
type SearchesPerRow = 1 | 3;
type Estimate = { maxProviderCalls: number; maxPages: number; remainingCredits: number; allowed: boolean; reason?: string; searchesPerRow: SearchesPerRow };

async function jsonRequest<T>(method: string, url: string, body?: unknown): Promise<T> {
  const response = await apiRequest(method, url, body);
  return response.json();
}

type Props = {
  rowId: string;
  businessName: string;
  ownerName?: OwnerNameResult | null;
  contactName?: ContactName | null;
  canSearch?: boolean;
  selectedForBatch?: boolean;
  onSelectedForBatchChange?: (checked: boolean) => void;
  sequences?: { id: string; subject?: string }[];
};

export function OwnerNameReview({
  rowId, businessName, ownerName, contactName, canSearch = true,
  selectedForBatch = false, onSelectedForBatchChange, sequences = [],
}: Props) {
  const { toast } = useToast();
  const [candidateId, setCandidateId] = useState(ownerName?.selectedCandidateId ?? "");
  const [usePersonalName, setUsePersonalName] = useState(Boolean(ownerName?.usePersonalName));
  const [overwriteDialog, setOverwriteDialog] = useState(false);
  const [previewSequenceId, setPreviewSequenceId] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [confirmSearch, setConfirmSearch] = useState(false);
  const [searchesPerRow, setSearchesPerRow] = useState<SearchesPerRow>(1);

  useEffect(() => {
    setCandidateId(ownerName?.selectedCandidateId ?? "");
    setUsePersonalName(ownerName?.approvedAt
      ? Boolean(ownerName.usePersonalName)
      : contactName ? contactName.useBusinessNameForEmail === "No" : false);
  }, [ownerName?.selectedCandidateId, ownerName?.usePersonalName, ownerName?.approvedAt, contactName?.firstName, contactName?.lastName, contactName?.useBusinessNameForEmail]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
    queryClient.invalidateQueries({ queryKey: ["/api/salon-search-report"] });
    queryClient.invalidateQueries({ queryKey: ["/api/salon-enrichment/batches"] });
    queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
    queryClient.invalidateQueries({ queryKey: ["/api/salon-owner-names/rows"] });
  };
  const estimateMutation = useMutation({
    mutationFn: (count: SearchesPerRow) => jsonRequest<Estimate>("POST", "/api/salon-owner-names/estimate", { rowIds: [rowId], searchesPerRow: count }),
    onSuccess: data => { setEstimate(data); setConfirmSearch(true); },
    onError: error => toast({ title: "Could not estimate owner lookup", description: (error as Error).message, variant: "destructive" }),
  });
  const searchMutation = useMutation({
    mutationFn: () => {
      if (!estimate || estimate.searchesPerRow !== searchesPerRow || !confirmSearch) throw new Error("The owner-search estimate is out of date. Request a fresh estimate before confirming.");
      if (!Number.isInteger(estimate.maxProviderCalls) || estimate.maxProviderCalls < 0 || estimate.maxProviderCalls > searchesPerRow) throw new Error("The estimated provider-call cap is invalid. Request a fresh estimate.");
      return jsonRequest<{ results: { rowId: string; ownerName: OwnerNameResult }[]; callsUsed?: number }>("POST", "/api/salon-owner-names/search", {
        rowIds: [rowId], searchesPerRow, maxProviderCalls: estimate.maxProviderCalls, confirmed: true,
      });
    },
    onSuccess: data => {
      setConfirmSearch(false); setEstimate(null); refresh();
      const result = data.results.find(item => item.rowId === rowId)?.ownerName;
      toast(result?.status === "failed" || result?.error
        ? { title: "Owner search could not finish", description: `${data.callsUsed ?? "Actual call count unavailable"} provider calls used. ${result.error || "No source-backed owner result was obtained. You can retry later."}`, variant: "destructive" }
        : { title: "Owner search complete", description: `${data.callsUsed ?? "Actual call count unavailable"} provider calls used. ${result?.candidates.length ? "Review the source-backed candidates below." : "No confirmed owner was found. Business-name greetings remain available."}` });
    },
    onError: error => { refresh(); toast({ title: "Owner search failed", description: (error as Error).message, variant: "destructive" }); },
  });
  const reviewMutation = useMutation({
    mutationFn: ({ candidateId: id, decision }: { candidateId: string; decision: "approved" | "rejected" }) =>
      jsonRequest("PATCH", `/api/salon-owner-names/rows/${rowId}/review`, { candidateId: id, decision, usePersonalName }),
    onSuccess: () => { refresh(); toast({ title: "Owner review saved" }); },
    onError: error => toast({ title: "Could not save owner review", description: (error as Error).message, variant: "destructive" }),
  });
  const applyMutation = useMutation({
    mutationFn: (overwriteExisting: boolean) => jsonRequest("POST", `/api/salon-owner-names/rows/${rowId}/apply`, { overwriteExisting, usePersonalName }),
    onSuccess: () => { setOverwriteDialog(false); refresh(); toast({ title: "Approved name applied", description: "The linked contact was updated explicitly." }); },
    onError: error => {
      const message = (error as Error).message;
      if (message.includes("already has a manual name")) setOverwriteDialog(true);
      else toast({ title: "Could not apply approved name", description: message, variant: "destructive" });
    },
  });
  const previewQuery = useQuery<OwnerPreview>({
    queryKey: ["/api/salon-owner-names/rows", rowId, "preview", previewSequenceId],
    queryFn: () => jsonRequest("GET", `/api/salon-owner-names/rows/${rowId}/preview?sequenceId=${encodeURIComponent(previewSequenceId)}`),
    enabled: previewOpen && Boolean(previewSequenceId),
  });
  const storedCandidates = ownerName?.candidates ?? [];
  const candidates = storedCandidates.filter(candidate => relevantOwnerCandidate(candidate, businessName));
  const unrelatedCandidatesHidden = storedCandidates.length - candidates.length;
  const lookupError = ownerName?.error && /timeout|timed out|aborted.*time\s*out/i.test(ownerName.error)
    ? "The owner lookup timed out before completing. Your reviewed email is unchanged. Retry later; a retry may use another lookup credit."
    : ownerName?.error;
  const selectedCandidate = candidates.find(candidate => candidate.id === candidateId);
  const canApprove = Boolean(selectedCandidate?.roleConfirmed && selectedCandidate.businessMatched &&
    selectedCandidate.sources.some(source => /^(website|organic)_(homepage|about|team|page)$/.test(source.kind) && source.url && source.excerpt.trim()));
  const approved = Boolean(selectedCandidate && ownerName?.approvedAt && ownerName.selectedCandidateId && ownerName.selectedCandidateId === candidateId);

  return (
    <section className="mt-4 rounded-lg border-2 border-slate-400 bg-muted/20 p-3 dark:border-slate-600 sm:p-4" aria-label={`Owner name review for ${businessName}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <span className="mt-0.5 rounded-md bg-primary/10 p-1.5 text-primary"><UserRound className="h-4 w-4" /></span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-sm font-semibold">Owner / addressee</h4>
              <Badge variant={approved ? "default" : "outline"}>{approved ? "Owner approved" : unrelatedCandidatesHidden > 0 && !candidates.length ? "No matching candidates" : (ownerName?.status ?? "not_searched").replaceAll("_", " ")}</Badge>
              {onSelectedForBatchChange && canSearch && <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <Checkbox checked={selectedForBatch} onCheckedChange={value => onSelectedForBatchChange(value === true)} aria-label={`Select ${businessName} for owner search`} />
                Batch search
              </label>}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Owner evidence is separate from email review. A team listing alone does not establish ownership.</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {canSearch && <Button size="sm" variant="outline" onClick={() => { setConfirmSearch(false); setEstimate(null); estimateMutation.mutate(searchesPerRow); }} disabled={estimateMutation.isPending || searchMutation.isPending}>
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" />{estimateMutation.isPending ? "Estimating…" : ownerName?.status === "not_searched" ? "Search owner" : "Retry owner search"}
          </Button>}
        </div>
      </div>
      {canSearch && ownerName && ownerName.status !== "not_searched" && <p className="mt-2 text-[11px] leading-5 text-muted-foreground">Retrying resets owner approval. If a name previously applied by this search is still unchanged, it may revert; manually edited contact names are preserved. Email review status is unaffected.</p>}
      {searchMutation.isPending && <p role="status" className="mt-3 rounded-md border-2 border-slate-400 bg-background p-3 text-sm dark:border-slate-600">Checking business pages and, if needed, the search provider. Please wait for this lookup to finish before retrying.</p>}
      {!searchMutation.isPending && lookupError && <Alert variant="destructive" className="mt-3 border-2 border-red-400 dark:border-red-600"><AlertTriangle className="h-4 w-4" /><AlertDescription>{lookupError}</AlertDescription></Alert>}
      {ownerName && <p className="mt-2 text-[11px] text-muted-foreground">Lookup usage · {ownerName.providerCalls} provider call{ownerName.providerCalls === 1 ? "" : "s"} · {ownerName.pagesFetched} pages{ownerName.lookedUpAt ? ` · ${new Date(ownerName.lookedUpAt).toLocaleString()}` : ""}</p>}
      {unrelatedCandidatesHidden > 0 && <p className="mt-2 text-xs text-muted-foreground">Unrelated search-result suggestions have been hidden. They did not mention {businessName}. No saved contact name was changed.</p>}

      {candidates.length > 0 ? (
        <div className="mt-3 space-y-2">
          {candidates.map(candidate => {
            const eligible = candidate.roleConfirmed && candidate.businessMatched && candidate.sources.length > 0;
            const isChosen = candidateId === candidate.id;
            return <article key={candidate.id} className={`rounded-md border-2 bg-background p-3 ${isChosen ? "border-primary" : "border-slate-400 dark:border-slate-600"}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <label className="flex min-w-0 cursor-pointer items-start gap-2">
                  <input type="radio" name={`owner-${rowId}`} className="mt-1 accent-primary" checked={isChosen} onChange={() => setCandidateId(candidate.id)} />
                  <span><span className="block text-sm font-semibold">{candidate.firstName} {candidate.lastName || ""}</span><span className="text-xs text-muted-foreground">{candidate.role || "Role unspecified"}</span></span>
                </label>
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant="outline">{candidate.confidence} confidence</Badge>
                  <Badge variant={candidate.roleConfirmed ? "secondary" : "outline"}>{candidate.roleConfirmed ? "Role confirmed" : "Role unconfirmed"}</Badge>
                  <Badge variant={candidate.businessMatched ? "secondary" : "outline"}>{candidate.businessMatched ? "Business matched" : "Business unconfirmed"}</Badge>
                </div>
              </div>
              {candidate.sources.map((source, index) => <div key={`${source.url}-${index}`} className="mt-2 border-l-2 border-primary/60 pl-3 text-xs">
                <p className="leading-5 text-foreground/85">{source.excerpt || "No excerpt provided."}</p>
                <a className="mt-1 inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline" href={source.url} target="_blank" rel="noopener noreferrer">{source.kind || "Evidence source"} <ExternalLink className="h-3 w-3" /></a>
              </div>)}
              {!eligible && <p className="mt-2 text-xs text-amber-800">Cannot approve: requires a source-backed, business-matched owner role.</p>}
            </article>;
          })}
        </div>
      ) : <p className="mt-3 rounded-md border-2 border-dashed border-slate-400 p-3 text-xs text-muted-foreground dark:border-slate-600">{unrelatedCandidatesHidden > 0 ? "The saved search found no owner candidate tied to this salon. A new search is optional and requires budget confirmation." : ownerName?.status === "not_found" ? "No owner candidate was found. Emails should use the business-name fallback." : ownerName?.status === "excluded" ? "This row is excluded from owner lookup." : ownerName?.status === "failed" ? "Search did not finish. Your reviewed email is unchanged; retry is optional and may use another lookup credit." : "No candidates yet. Search is always an explicit, budget-confirmed action."}</p>}

      {candidates.length > 0 && <div className="mt-3 flex flex-col gap-3 border-t-2 border-slate-400 pt-3 dark:border-slate-600">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="text-xs font-medium">Preferred email salutation:</span>
          <label className="inline-flex cursor-pointer items-center gap-2 text-xs"><input type="radio" name={`salutation-${rowId}`} checked={!usePersonalName} onChange={() => setUsePersonalName(false)} className="accent-primary" />Business name</label>
          <label className="inline-flex cursor-pointer items-center gap-2 text-xs"><input type="radio" name={`salutation-${rowId}`} checked={usePersonalName} onChange={() => setUsePersonalName(true)} className="accent-primary" disabled={!selectedCandidate?.firstName} />Approved first name</label>
          {!contactName && <span className="text-xs text-muted-foreground">Preference is saved with approval; applying it to a contact is a separate step.</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => selectedCandidate && reviewMutation.mutate({ candidateId: selectedCandidate.id, decision: "approved" })} disabled={!canApprove || reviewMutation.isPending}>
            <Check className="mr-1.5 h-3.5 w-3.5" />Approve selected owner
          </Button>
          <Button size="sm" variant="outline" onClick={() => selectedCandidate && reviewMutation.mutate({ candidateId: selectedCandidate.id, decision: "rejected" })} disabled={!selectedCandidate || reviewMutation.isPending}>Reject selected</Button>
          {approved && <Button size="sm" variant="outline" onClick={() => applyMutation.mutate(false)} disabled={applyMutation.isPending || !contactName}>
            Apply to linked contact
          </Button>}
        </div>
        {approved && <p className="text-[11px] text-muted-foreground">Approval does not modify a contact. Apply is separate. Personal salutation uses the approved first name; a verified surname remains on the contact, and an unknown surname stays blank.</p>}
      </div>}
      {overwriteDialog && <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950" role="alert">
        <p className="font-semibold">This contact already has a name</p>
        <p className="mt-1 text-xs leading-5">Applying this approved owner will overwrite the linked contact’s existing first and last names. The salutation choice selected above will be applied.</p>
        <div className="mt-2 flex gap-2"><Button size="sm" variant="destructive" onClick={() => applyMutation.mutate(true)} disabled={applyMutation.isPending}>{applyMutation.isPending ? "Applying…" : "Overwrite existing names"}</Button><Button size="sm" variant="outline" onClick={() => setOverwriteDialog(false)}>Keep current names</Button></div>
      </div>}
      {sequences.length > 0 && <div className="mt-3 flex flex-wrap items-center gap-2 border-t-2 border-slate-400 pt-3 dark:border-slate-600">
        <span className="text-xs font-medium">Email preview</span>
        <Select value={previewSequenceId} onValueChange={value => { setPreviewSequenceId(value); setPreviewOpen(false); }}>
          <SelectTrigger className="h-8 w-full sm:w-[240px]" aria-label="Choose directory email template"><SelectValue placeholder="Preview a directory email" /></SelectTrigger>
          <SelectContent>{sequences.map(sequence => <SelectItem key={sequence.id} value={sequence.id}>{sequence.subject || "Directory step 1"}</SelectItem>)}</SelectContent>
        </Select>
        <Button size="sm" variant="outline" disabled={!previewSequenceId} onClick={() => setPreviewOpen(true)}>Render preview</Button>
        {previewOpen && <div className="basis-full rounded-md border-2 border-slate-400 bg-background p-3 text-sm dark:border-slate-600">
          {previewQuery.isLoading ? <p className="text-muted-foreground">Rendering with the current approved-name rules…</p> : previewQuery.isError ? <p className="text-destructive">{(previewQuery.error as Error).message}</p> : previewQuery.data && <>
            <div className="flex flex-wrap gap-2 text-xs"><Badge variant="outline">{previewQuery.data.mode}</Badge><span className="text-muted-foreground">Source: {previewQuery.data.previewSource}</span></div>
            <p className="mt-2 font-medium">Subject: {previewQuery.data.subject}</p><p className="mt-1 text-xs text-muted-foreground">{previewQuery.data.salutation}</p>
            <pre className="mt-2 whitespace-pre-wrap font-sans text-sm leading-6">{previewQuery.data.body}</pre>
          </>}
        </div>}
      </div>}
      {confirmSearch && estimate && <div className="mt-3 rounded-md border border-amber-300/70 bg-amber-50 p-3 text-sm text-amber-950">
        <p className="font-semibold">Confirm owner lookup</p>
        <label className="mt-2 flex max-w-sm flex-col gap-1 text-xs font-medium">Search phrases per salon
          <Select value={String(searchesPerRow)} onValueChange={value => {
            const count = Number(value) as SearchesPerRow;
            setSearchesPerRow(count);
            setConfirmSearch(false);
            setEstimate(null);
            estimateMutation.mutate(count);
          }} disabled={estimateMutation.isPending || searchMutation.isPending}>
            <SelectTrigger className="h-9 bg-background" aria-label="Owner search phrases per salon"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="1">1 phrase · default</SelectItem><SelectItem value="3">Up to 3 phrases · explicit expanded search</SelectItem></SelectContent>
          </Select>
        </label>
        <p className="mt-2 text-xs leading-5">Checks known business pages first and stops early when an owner is verified. Up to {estimate.maxProviderCalls} additional paid searches for this salon and {estimate.maxPages} page fetches (4-page cap per salon). {estimate.maxProviderCalls === 0 ? "Public-page and cached lookup only; no paid request will be made." : "No paid retries."} Cached results are free. {estimate.remainingCredits} credits remain{estimate.reason ? ` · ${estimate.reason}` : ""}.</p>
        <div className="mt-2 flex gap-2"><Button size="sm" onClick={() => searchMutation.mutate()} disabled={!estimate.allowed || !Number.isInteger(estimate.maxProviderCalls) || estimate.maxProviderCalls < 0 || estimate.maxProviderCalls > searchesPerRow || estimate.searchesPerRow !== searchesPerRow || searchMutation.isPending || estimateMutation.isPending}>{searchMutation.isPending ? "Searching…" : "Confirm & search"}</Button><Button size="sm" variant="outline" onClick={() => { setConfirmSearch(false); setEstimate(null); }}>Cancel</Button></div>
      </div>}
      {contactName && <p className="mt-2 text-[11px] text-muted-foreground">Current contact: {[contactName.firstName, contactName.lastName].filter(Boolean).join(" ") || "no personal name"} · {contactName.useBusinessNameForEmail === "Yes" ? "business-name salutation" : contactName.useBusinessNameForEmail === "No" ? "personal-name salutation" : "salutation preference unavailable"}</p>}
    </section>
  );
}

export type OwnerSearchEstimate = Estimate;