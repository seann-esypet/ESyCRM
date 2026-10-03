import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { directoryEligibility, type DirectoryEligibility, type EligibilityRow } from "@shared/directoryEligibility";
import { Check, CircleAlert, MapPin, ShieldCheck, X } from "lucide-react";

export type EligibilitySummary = {
  total: number;
  flagged: number;
  needsGroomingReview: number;
  approved: number;
  excluded: number;
};

export function EligibilitySummaryStrip({ summary, label = "Grooming eligibility" }: {
  summary?: EligibilitySummary | null;
  label?: string;
}) {
  if (!summary) return null;
  const counts = [
    ["Flagged", summary.flagged],
    ["Approved", summary.approved],
    ["Excluded", summary.excluded],
    ["Needs grooming review", summary.needsGroomingReview],
  ] as const;
  return <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border bg-muted/20 px-3 py-2 text-xs" aria-label={`${label} summary`}>
    <span className="font-medium text-foreground">{label} <span className="text-muted-foreground">· {summary.total.toLocaleString()} total</span></span>
    {counts.map(([name, value]) => <span key={name} className="text-muted-foreground">{name}: <b className="font-mono text-foreground">{value.toLocaleString()}</b></span>)}
  </div>;
}

function identityValue(value: unknown) {
  return typeof value === "string" ? value.trim().toLocaleLowerCase().replace(/\s+/g, " ") : "";
}

export function DirectoryEligibilityReview({ row, endpoint, eligibility: providedEligibility, invalidateKeys = [], compact = false }: {
  row: EligibilityRow;
  endpoint: string;
  eligibility?: DirectoryEligibility;
  invalidateKeys?: unknown[][];
  compact?: boolean;
}) {
  const { toast } = useToast();
  const [note, setNote] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const eligibility = providedEligibility ?? directoryEligibility(row);
  const sourceName = row.businessName || row.company || "";
  const sourceAddress = row.address || "";
  const sourcePlaceId = row.placeId || "";
  const provider = eligibility.listing;
  const comparable = [
    [sourceName, provider.name],
    [sourceAddress, provider.address],
    [sourcePlaceId, provider.placeId],
  ].filter(([source, listing]) => !!source && !!listing);
  const exactMatch = comparable.length > 0 && comparable.every(([source, listing]) => identityValue(source) === identityValue(listing));
  const save = useMutation({
    mutationFn: async (decision: "approved" | "excluded") => {
      const response = await apiRequest("POST", endpoint, { decision, note: note.trim(), confirmed: true });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).message || "Could not save grooming review");
      return response.json();
    },
    onSuccess: (_, decision) => {
      setNote("");
      setConfirmed(false);
      invalidateKeys.forEach(queryKey => queryClient.invalidateQueries({ queryKey }));
      toast({ title: decision === "approved" ? "Grooming suitability approved" : "Business excluded from grooming outreach", description: "The source listing remains unchanged. Email approval is a separate review." });
    },
    onError: (error: Error) => toast({ title: "Could not save grooming review", description: error.message, variant: "destructive" }),
  });
  return <section className={`rounded-md border ${eligibility.blocked ? "border-amber-300/70 bg-amber-50/50 dark:bg-amber-950/10" : "bg-muted/10"} ${compact ? "p-2.5" : "p-3"}`} aria-label="Directory eligibility evidence">
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Grooming suitability</span>
      <Badge variant={eligibility.decision === "approved" ? "default" : eligibility.decision === "excluded" ? "destructive" : "outline"} className="h-5 text-[10px]">
        {eligibility.decision === "approved" ? "Human approved" : eligibility.decision === "excluded" ? "Human excluded" : eligibility.classification === "grooming" ? "Provider says grooming · review pending" : "Review pending"}
      </Badge>
      {eligibility.flagged && <Badge variant="destructive" className="h-5 text-[10px]">Flagged</Badge>}
      <span className="text-[11px] text-muted-foreground">{eligibility.reason}</span>
    </div>
    <div className={`mt-2 grid gap-x-4 gap-y-1 text-[11px] ${compact ? "sm:grid-cols-2" : "sm:grid-cols-3"}`}>
      <div><span className="text-muted-foreground">Provider categories: </span><span className="font-medium">{provider.categories.length ? provider.categories.join(" · ") : "Not supplied"}</span></div>
      <div className="sm:col-span-2">
        <span className="text-muted-foreground">Identity evidence: </span>
        <span className={exactMatch ? "font-medium text-emerald-800 dark:text-emerald-300" : "font-medium text-amber-800 dark:text-amber-300"}>
          {exactMatch ? "Exact match on comparable source values" : "Identity not confirmed"}
        </span>
      </div>
    </div>
    <div className="mt-2 grid gap-2 text-[11px] sm:grid-cols-2">
      <div className="rounded border bg-background/70 p-2">
        <div className="mb-1 font-semibold text-muted-foreground">Source row</div>
        <div>Business: {sourceName || "—"}</div>
        <div className="flex items-start gap-1"><MapPin className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />{sourceAddress || "—"}</div>
        <div className="break-all">Place ID: {sourcePlaceId || "—"}</div>
      </div>
      <div className="rounded border bg-background/70 p-2">
        <div className="mb-1 font-semibold text-muted-foreground">{provider.provider} listing</div>
        <div>Business: {provider.name || "—"}</div>
        <div className="flex items-start gap-1"><MapPin className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />{provider.address || "—"}</div>
        <div className="break-all">Place ID: {provider.placeId || "—"}</div>
      </div>
    </div>
    {eligibility.reviewNote && <p className="mt-2 border-l-2 border-primary/40 pl-2 text-[11px]"><span className="font-medium">Reviewer note:</span> {eligibility.reviewNote}</p>}
    {provider.sourceUrl && <a className="mt-2 inline-block text-[11px] text-primary underline" href={provider.sourceUrl} target="_blank" rel="noopener noreferrer">Open provider listing</a>}
    <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(180px,1fr)_auto] sm:items-end">
      <div>
        <Textarea rows={2} value={note} onChange={event => setNote(event.target.value)} placeholder="Reviewer note: evidence grooming is offered, or why this listing is excluded" aria-label="Grooming eligibility reviewer note" className="min-h-0 text-xs" />
        <label className="mt-1 flex items-start gap-2 text-[11px] text-muted-foreground">
          <Checkbox checked={confirmed} onCheckedChange={value => setConfirmed(value === true)} disabled={save.isPending} />
          <span>I reviewed the provider evidence and confirm this grooming decision. This does not approve the email.</span>
        </label>
      </div>
      <div className="flex flex-wrap gap-1.5 sm:justify-end">
        <Button size="sm" variant="outline" className="h-8" disabled={!confirmed || !note.trim() || save.isPending} onClick={() => save.mutate("approved")}><Check className="mr-1 h-3.5 w-3.5" />Approve grooming</Button>
        <Button size="sm" variant="outline" className="h-8" disabled={!confirmed || !note.trim() || save.isPending} onClick={() => save.mutate("excluded")}><X className="mr-1 h-3.5 w-3.5" />Exclude</Button>
      </div>
    </div>
    <p className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground"><CircleAlert className="h-3 w-3" />{eligibility.blocked ? "Blocked from approval, import and outreach until grooming is approved." : "Suitability approval and identity evidence do not replace email or owner review."} <ShieldCheck className="h-3 w-3" /></p>
  </section>;
}