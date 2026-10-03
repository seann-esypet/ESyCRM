import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ExternalLink } from "lucide-react";
import { directoryEligibility } from "@shared/directoryEligibility";

type EligibleRow = {
  id: string; businessName: string; contactRequestFormUrl?: string; contactFormStatus?: string;
  identityMatchStatus?: string; status?: string; email?: string; importedContactId?: string; audienceTrack?: string;
  duplicateMetadata?: { contactIds?: string[] };
  address?: string | null; placeId?: string | null; notes?: string | null; evidence?: unknown; sourceData?: Record<string, unknown>;
};
type Sequence = {
  id: string; strategy: string; sequenceTrack: string; sequenceNumber: number;
  isActive: string; subject: string;
};
type HistoryEvent = {
  step: number; sequenceId: string; action: string; formUrl: string;
  subject?: string; body?: string; actedAt: string; actedBy: string; note?: string;
};
type Draft = {
  id: string; salonRowId: string; batchId: string; businessName: string; rowNumber: number;
  status: string; strategy: string; sequenceTrack: string; sequenceNumber: number;
  formUrl: string; subject: string; body: string; dueAt: string;
  submittedCount: number; history: HistoryEvent[]; actedAt?: string; actedBy?: string; note?: string;
  reviewAllowed: boolean;
};
type FormAction = "submitted" | "blocked" | "resume" | "skipped" | "replied" | "opted_out";

export function SalonFormOutreachPanel({ batchId, rows = [] }: { batchId?: string; rows?: EligibleRow[] }) {
  const { toast } = useToast();
  const [rowId, setRowId] = useState("");
  const [sequenceId, setSequenceId] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [showHistory, setShowHistory] = useState(false);
  const draftsQuery = useQuery<Draft[]>({
    queryKey: ["/api/salon-form-outreach", batchId ?? "all"],
    queryFn: async () => (await apiRequest("GET", batchId ? `/api/salon-form-outreach?batchId=${encodeURIComponent(batchId)}` : "/api/salon-form-outreach")).json(),
  });
  const sequencesQuery = useQuery<Sequence[]>({ queryKey: ["/api/email-sequences"] });
  const drafts = draftsQuery.data ?? [];
  const enrolled = new Set(drafts.map(d => d.salonRowId));
  const eligible = rows.filter(row =>
    row.status === "enriched" && row.identityMatchStatus === "strong" &&
    row.contactFormStatus === "verified" && !!row.contactRequestFormUrl &&
    !row.email?.trim() && !row.importedContactId &&
    !row.duplicateMetadata?.contactIds?.length && !enrolled.has(row.id) &&
    !directoryEligibility(row).blocked);
  const selectedTrack = eligible.find(row => row.id === rowId)?.audienceTrack;
  const sequences = (sequencesQuery.data ?? []).filter(s =>
    s.sequenceNumber === 1 && s.isActive === "true" && !s.sequenceTrack.includes("custom") &&
    !!selectedTrack && s.sequenceTrack === selectedTrack);
  const enroll = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/salon-form-outreach", { salonRowId: rowId, sequenceId })).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/salon-form-outreach", batchId] });
      queryClient.invalidateQueries({ queryKey: ["/api/salon-form-outreach", "all"] });
      setRowId(""); setSequenceId("");
      toast({ title: "Form draft added", description: "No message was sent. Review and submit the form yourself." });
    },
    onError: (e: Error) => toast({ title: "Could not add draft", description: e.message, variant: "destructive" }),
  });
  const act = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: FormAction }) =>
      (await apiRequest("POST", `/api/salon-form-outreach/${id}/action`, { action, note: notes[id]?.trim() || undefined })).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/salon-form-outreach", batchId] });
      queryClient.invalidateQueries({ queryKey: ["/api/salon-form-outreach", "all"] });
      toast({ title: "Manual outcome recorded" });
    },
    onError: (e: Error) => toast({ title: "Could not record outcome", description: e.message, variant: "destructive" }),
  });
  const record = (draft: Draft, action: FormAction) => {
    if (action === "submitted" && !window.confirm("Only confirm after you personally submitted the message on the salon website (including any CAPTCHA). This schedules the next draft; the app does not submit it for you.")) return;
    if (["skipped", "replied", "opted_out"].includes(action) && !window.confirm(`Record ${action.replace("_", " ")} and stop future form drafts for this salon?`)) return;
    act.mutate({ id: draft.id, action });
  };
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: "Copied to clipboard" });
    } catch {
      toast({ title: "Copy unavailable", description: "Select and copy the text manually.", variant: "destructive" });
    }
  };
  const active = drafts.filter(d => ["due", "scheduled", "blocked"].includes(d.status));
  const ordered = [...drafts].sort((a, b) => {
    const openA = ["due", "scheduled", "blocked"].includes(a.status) ? 0 : 1;
    const openB = ["due", "scheduled", "blocked"].includes(b.status) ? 0 : 1;
    return openA - openB || new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
  });

  return <Card id="form-outreach">
    <CardHeader className="pb-2">
      <CardTitle className="text-lg">Manual contact-form outreach <Badge variant="secondary" className="ml-2">{active.length} open</Badge></CardTitle>
      <p className="text-sm text-muted-foreground">Select a reviewed form-only salon and an existing email sequence. Subjects and messages are personalized for copying. Open the salon site, complete the form and any CAPTCHA yourself, then record what happened. This queue never submits a form or sends an email.</p>
    </CardHeader>
    <CardContent className="space-y-4">
      {batchId ? <div className="flex flex-wrap items-end gap-2 border rounded-md p-3">
        <div className="min-w-[210px] flex-1"><span className="text-xs font-medium">Verified form-only salon (current table page)</span><Select value={rowId} onValueChange={value => { setRowId(value); setSequenceId(""); }}><SelectTrigger><SelectValue placeholder="Choose salon" /></SelectTrigger><SelectContent>{eligible.map(row => <SelectItem key={row.id} value={row.id}>{row.businessName}</SelectItem>)}</SelectContent></Select></div>
        <div className="min-w-[240px] flex-1"><span className="text-xs font-medium">First step of existing sequence</span><Select value={sequenceId} onValueChange={setSequenceId}><SelectTrigger><SelectValue placeholder="Choose sequence" /></SelectTrigger><SelectContent>{sequences.map(s => <SelectItem key={s.id} value={s.id}>{s.strategy} · {s.sequenceTrack} · {s.subject}</SelectItem>)}</SelectContent></Select></div>
        <Button disabled={!rowId || !sequenceId || enroll.isPending} onClick={() => enroll.mutate()}>Add review draft</Button>
      </div> : <p className="text-sm text-muted-foreground">To add a salon, open its enrichment batch, verify the form, and choose a matching sequence there. Only explicitly enrolled salons appear here.</p>}
      {draftsQuery.isError && <p className="text-sm text-red-700">Could not load form drafts. Refresh the page to retry.</p>}
      {!draftsQuery.isLoading && !drafts.length && <p className="text-sm text-muted-foreground">No form drafts yet. Verify a usable general-contact form in the table, then add its first draft here.</p>}
      {ordered.map(draft => {
        const due = new Date(draft.dueAt) <= new Date();
        const actionable = ["due", "scheduled"].includes(draft.status) && due;
        return <div key={draft.id} className="rounded-lg border p-4 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div><div className="font-semibold">{draft.businessName} <span className="text-xs font-normal text-muted-foreground">#{draft.rowNumber}</span></div><div className="text-xs text-muted-foreground">{draft.strategy} · {draft.sequenceTrack} · step {draft.sequenceNumber} · {draft.submittedCount} manually recorded submission{draft.submittedCount === 1 ? "" : "s"}</div>{!batchId && <a className="text-xs text-primary underline" href={`/salon-enrichment/${draft.batchId}`}>View source batch</a>}</div>
            <div className="text-right"><Badge variant={draft.status === "blocked" ? "destructive" : "outline"}>{draft.status === "scheduled" && due ? "due" : draft.status}</Badge><div className="text-xs text-muted-foreground mt-1">Due {new Date(draft.dueAt).toLocaleString()}</div></div>
          </div>
          {!draft.reviewAllowed && ["due", "scheduled", "blocked"].includes(draft.status) && <p className="text-sm text-red-700">Review paused: the salon now has an email, was imported, has a duplicate warning, or its verified form or identity changed. Do not submit this draft. Record a reply, opt-out, or skip as appropriate.</p>}
          {draft.reviewAllowed && ["due", "scheduled", "blocked"].includes(draft.status) && <>
            <a className="text-sm text-primary inline-flex items-center gap-1 underline" href={draft.formUrl} target="_blank" rel="noopener noreferrer">Open verified contact form <ExternalLink className="h-3 w-3" /></a>
            <div className="space-y-1"><div className="flex justify-between"><span className="text-xs font-medium">Subject (only if the site has a subject field)</span><Button size="sm" variant="ghost" onClick={() => copy(draft.subject)}>Copy subject</Button></div><Input value={draft.subject} readOnly aria-label="Personalized subject" /></div>
            <div className="space-y-1"><div className="flex justify-between"><span className="text-xs font-medium">Personalized message</span><Button size="sm" variant="ghost" onClick={() => copy(draft.body)}>Copy message</Button></div><textarea value={draft.body} readOnly aria-label="Personalized message" className="w-full min-h-36 rounded-md border bg-background p-3 text-sm" /></div>
            <Input value={notes[draft.id] ?? ""} onChange={e => setNotes(value => ({ ...value, [draft.id]: e.target.value }))} placeholder="Optional outcome note (e.g. CAPTCHA or rejection details)" aria-label={`Outcome note for ${draft.businessName}`} />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={!actionable || act.isPending} onClick={() => record(draft, "submitted")}>I submitted this form</Button>
              {draft.status === "blocked"
                ? <Button size="sm" variant="outline" disabled={act.isPending} onClick={() => record(draft, "resume")}>Resume review</Button>
                : <Button size="sm" variant="outline" disabled={act.isPending} onClick={() => record(draft, "blocked")}>Blocked / CAPTCHA issue</Button>}
              <Button size="sm" variant="outline" disabled={act.isPending} onClick={() => record(draft, "skipped")}>Skip and stop</Button>
              <Button size="sm" variant="outline" disabled={act.isPending} onClick={() => record(draft, "replied")}>Replied — stop</Button>
              <Button size="sm" variant="outline" disabled={act.isPending} onClick={() => record(draft, "opted_out")}>Opted out — stop</Button>
            </div>
            {!due && <p className="text-xs text-muted-foreground">The next step cannot be recorded as submitted until its configured delay has passed. A reply or opt-out stops it immediately.</p>}
          </>}
          {draft.history.length > 0 && <div><Button size="sm" variant="link" className="p-0" onClick={() => setShowHistory(value => !value)}>{showHistory ? "Hide" : "Show"} recorded history ({draft.history.length})</Button>{showHistory && <ol className="space-y-2 mt-2">{draft.history.map((event, index) => <li key={index} className="text-xs border-l-2 pl-3"><b>Step {event.step}: {event.action}</b> · {new Date(event.actedAt).toLocaleString()} · actor {event.actedBy}<br /><a href={event.formUrl} target="_blank" rel="noopener noreferrer" className="text-primary underline">{event.formUrl}</a>{event.note && <span> · {event.note}</span>}{event.action === "submitted" && <details className="mt-1"><summary>Submitted message snapshot</summary><p className="font-medium mt-1">{event.subject}</p><pre className="whitespace-pre-wrap font-sans">{event.body}</pre></details>}</li>)}</ol>}</div>}
        </div>;
      })}
    </CardContent>
  </Card>;
}