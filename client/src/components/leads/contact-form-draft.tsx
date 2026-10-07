import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { AlertCircle, Check, ChevronDown, Clipboard, Copy, FileText, LoaderCircle } from "lucide-react";

type Template = { id: string; name: string };
type Draft = {
  name: string;
  replyEmail: string;
  subject: string;
  body: string;
  greeting: string;
  ownerSearch: { status: string; lookedUpAt?: string | null; error?: string | null };
  personalized: boolean;
  notice: string;
};

async function requestJson<T>(method: "GET" | "POST", url: string, body?: unknown): Promise<T> {
  const response = await apiRequest(method, url, body);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || data.error || `Request failed (${response.status})`);
  return data as T;
}

function lookupLabel(status: string) {
  if (status === "failed") return "Owner lookup failed";
  if (status === "not_searched") return "Owner lookup not attempted";
  if (status === "searched" || status === "success" || status === "completed") return "Owner lookup completed";
  return status ? `Owner lookup: ${status.replace(/[_-]/g, " ")}` : "Owner lookup status unavailable";
}

export function ContactFormDraft({ rowId, businessName, address, ownerSearch }: {
  rowId: string;
  businessName: string;
  address?: string;
  ownerSearch?: Draft["ownerSearch"];
}) {
  const [open, setOpen] = useState(false);
  const [sequenceId, setSequenceId] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [copyMessage, setCopyMessage] = useState("");
  const [copyError, setCopyError] = useState("");
  const templates = useQuery<Template[]>({
    queryKey: ["/api/leads/rows", rowId, "form-draft-templates"],
    queryFn: () => requestJson("GET", `/api/leads/rows/${encodeURIComponent(rowId)}/form-draft-templates`),
    enabled: open,
  });
  const generate = useMutation({
    mutationFn: () => {
      if (!sequenceId) throw new Error("Choose a saved message first.");
      return requestJson<Draft>("POST", `/api/leads/rows/${encodeURIComponent(rowId)}/form-draft`, { sequenceId });
    },
    onSuccess: value => {
      setDraft(value);
      setCopyMessage("");
      setCopyError("");
    },
  });
  const updateDraft = (field: keyof Pick<Draft, "name" | "replyEmail" | "subject" | "body" | "greeting">, value: string) => {
    setDraft(current => current ? { ...current, [field]: value,
      ...(field === "greeting" && current.body.startsWith(current.greeting)
        ? {body:value + current.body.slice(current.greeting.length)} : {}) } : current);
  };
  const copy = async (text: string, label: string) => {
    setCopyMessage("");
    setCopyError("");
    try {
      await navigator.clipboard.writeText(text);
      setCopyMessage(`${label} copied.`);
    } catch {
      setCopyError(`Could not copy ${label.toLowerCase()}. Select the text and copy it manually.`);
    }
  };
  const copyAll = () => copy([
    `Name: ${draft?.name ?? ""}`,
    `Reply email: ${draft?.replyEmail ?? ""}`,
    `Greeting: ${draft?.greeting ?? ""}`,
    `Subject: ${draft?.subject ?? ""}`,
    `Message:\n${draft?.body ?? ""}`,
  ].join("\n\n"), "All draft fields");
  const lookupStatus = draft?.ownerSearch || ownerSearch;
  const lookupAttempted = Boolean(ownerSearch?.lookedUpAt && ownerSearch.status !== "not_searched");
  const isLookupFailed = lookupStatus?.status === "failed";

  return <section className="rounded-xl border-2 border-indigo-300 bg-indigo-50/50 p-4 dark:border-indigo-900 dark:bg-indigo-950/20" aria-label={`Contact form message draft for ${businessName}`}>
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex items-start gap-3">
        <span className="rounded-lg border-2 border-indigo-300 bg-background p-2 text-indigo-800 dark:border-indigo-800 dark:text-indigo-200"><FileText className="h-5 w-5" /></span>
        <div>
          <h5 className="font-semibold">Contact form message draft</h5>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">A saved-message preview for {businessName}{address ? ` · ${address}` : ""}. Nothing is submitted, sent, enrolled, or recorded.</p>
        </div>
      </div>
      <Button type="button" variant="outline" className="min-h-10 shrink-0 border-2" aria-expanded={open} onClick={() => setOpen(value => !value)}>
        {open ? "Close draft tool" : "Build a draft"}
        <ChevronDown className={`ml-2 h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
      </Button>
    </div>

    {open && <div className="mt-4 space-y-4 border-t-2 border-indigo-200 pt-4 dark:border-indigo-900">
      <div className="rounded-lg border-2 bg-background p-3 text-sm" data-testid="form-draft-owner-search">
        <strong>{lookupLabel(lookupStatus?.status || "not_searched")}</strong>
        {lookupStatus?.lookedUpAt && <p>Last attempt: {new Date(lookupStatus.lookedUpAt).toLocaleString()}</p>}
        {lookupStatus?.error && <p className="mt-1 break-words text-amber-900 dark:text-amber-200">{lookupStatus.error}</p>}
        <p className="mt-1 text-xs">{lookupAttempted ? "An attempted search does not confirm a person. Only an approved owner with personal greetings enabled is addressed by first name; otherwise the draft addresses the business team." : "Run the owner search in Owner / addressee before generating a draft. A failed or no-name result can still produce a business-team greeting."}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <div className="space-y-1.5">
          <Label htmlFor={`draft-template-${rowId}`}>Saved message</Label>
          {templates.isLoading ? <div className="h-10 animate-pulse rounded-md border-2 bg-background" aria-label="Loading saved messages" /> :
            templates.isError ? <div role="alert" className="rounded-md border-2 border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">Saved messages could not load: {(templates.error as Error).message}</div> :
              <Select value={sequenceId} onValueChange={value => { setSequenceId(value); setDraft(null); setCopyMessage(""); setCopyError(""); }}>
                <SelectTrigger id={`draft-template-${rowId}`} className="min-h-11 border-2 bg-background"><SelectValue placeholder="Choose a saved message" /></SelectTrigger>
                <SelectContent>{(templates.data ?? []).map(template => <SelectItem key={template.id} value={template.id}>{template.name}</SelectItem>)}</SelectContent>
              </Select>}
          {!templates.isLoading && !templates.isError && !templates.data?.length && <p className="text-xs text-muted-foreground">No saved messages are available for drafting.</p>}
        </div>
        {templates.isError
          ? <Button type="button" variant="outline" className="min-h-11 border-2" onClick={() => void templates.refetch()}>Retry loading</Button>
          : <Button type="button" className="min-h-11" disabled={!lookupAttempted || !sequenceId || !templates.data?.length || generate.isPending} onClick={() => generate.mutate()}>
              {generate.isPending ? <><LoaderCircle className="mr-2 h-4 w-4 animate-spin" />Generating preview…</> : "Generate draft"}
            </Button>}
      </div>
      <p className="text-xs leading-5 text-muted-foreground">Choosing a saved message and generating a preview does not call a provider or incur usage charges.</p>
      <p className="rounded-md border-2 border-amber-300 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-950 dark:bg-amber-950/20 dark:text-amber-100">A recorded owner lookup attempt is required to generate a draft. If the lookup failed, generation can still use a team greeting.</p>
      {generate.isError && <div role="alert" className="rounded-md border-2 border-destructive/50 bg-destructive/5 p-3 text-sm text-destructive"><AlertCircle className="mr-1 inline h-4 w-4" />Draft could not be generated: {(generate.error as Error).message}</div>}

      {draft && <>
        <div className={`rounded-lg border-2 p-3 ${isLookupFailed ? "border-rose-500 bg-rose-50 text-rose-950 dark:bg-rose-950/30 dark:text-rose-100" : "border-amber-400 bg-amber-50 text-amber-950 dark:bg-amber-950/30 dark:text-amber-100"}`} role="status" aria-live="polite">
          <div className="flex flex-wrap items-center gap-2">
            <strong>{lookupLabel(lookupStatus?.status ?? "")}</strong>
            <Badge variant={isLookupFailed ? "destructive" : "outline"}>{lookupStatus?.status || "unknown"}</Badge>
            {lookupStatus?.lookedUpAt && <span className="text-xs">Attempted {new Date(lookupStatus.lookedUpAt).toLocaleString()}</span>}
          </div>
          {lookupStatus?.error && <p className="mt-2 break-words text-sm font-medium">Lookup detail: {lookupStatus.error}</p>}
          <p className="mt-2 text-sm font-semibold leading-5">{draft.notice || "Saved-message preview only. Review before using it."}</p>
          {draft.personalized && <p className="mt-1 text-xs">This draft includes a name from the owner lookup. Check it before use.</p>}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5"><Label htmlFor={`draft-name-${rowId}`}>Name <span className="font-normal text-muted-foreground">· optional</span></Label><Input id={`draft-name-${rowId}`} className="min-h-11 border-2 bg-background" value={draft.name} onChange={event => updateDraft("name", event.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor={`draft-reply-${rowId}`}>Reply email <span className="font-normal text-muted-foreground">· optional</span></Label><Input id={`draft-reply-${rowId}`} type="email" className="min-h-11 border-2 bg-background" value={draft.replyEmail} onChange={event => updateDraft("replyEmail", event.target.value)} /></div>
          <div className="space-y-1.5 sm:col-span-2"><Label htmlFor={`draft-greeting-${rowId}`}>Greeting <span className="font-normal text-muted-foreground">· optional</span></Label><Input id={`draft-greeting-${rowId}`} className="min-h-11 border-2 bg-background" value={draft.greeting} onChange={event => updateDraft("greeting", event.target.value)} /></div>
          <div className="space-y-1.5 sm:col-span-2"><Label htmlFor={`draft-subject-${rowId}`}>Subject <span className="font-normal text-muted-foreground">· optional</span></Label><Input id={`draft-subject-${rowId}`} className="min-h-11 border-2 bg-background" value={draft.subject} onChange={event => updateDraft("subject", event.target.value)} /></div>
          <div className="space-y-1.5 sm:col-span-2"><Label htmlFor={`draft-body-${rowId}`}>Message <span className="font-normal text-muted-foreground">· optional</span></Label><Textarea id={`draft-body-${rowId}`} className="min-h-48 border-2 bg-background text-sm leading-6" value={draft.body} onChange={event => updateDraft("body", event.target.value)} /></div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" className="min-h-10 border-2" onClick={() => void copy(draft.name, "Name")}><Copy className="mr-2 h-4 w-4" />Copy name</Button>
          <Button type="button" variant="outline" className="min-h-10 border-2" onClick={() => void copy(draft.replyEmail, "Reply email")}><Copy className="mr-2 h-4 w-4" />Copy reply email</Button>
          <Button type="button" variant="outline" className="min-h-10 border-2" onClick={() => void copy(draft.greeting, "Greeting")}><Copy className="mr-2 h-4 w-4" />Copy greeting</Button>
          <Button type="button" variant="outline" className="min-h-10 border-2" onClick={() => void copy(draft.subject, "Subject")}><Copy className="mr-2 h-4 w-4" />Copy subject</Button>
          <Button type="button" variant="outline" className="min-h-10 border-2" onClick={() => void copy(draft.body, "Message")}><Copy className="mr-2 h-4 w-4" />Copy message</Button>
          <Button type="button" className="min-h-10" onClick={() => void copyAll()}><Clipboard className="mr-2 h-4 w-4" />Copy all</Button>
        </div>
        {copyMessage && <p role="status" className="flex items-center gap-2 text-sm font-medium text-emerald-800"><Check className="h-4 w-4" />{copyMessage}</p>}
        {copyError && <p role="alert" className="rounded-md border-2 border-destructive/40 p-3 text-sm text-destructive">{copyError}</p>}
      </>}
    </div>}
  </section>;
}
