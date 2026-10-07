import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { apiRequest, queryClient } from "@/lib/queryClient";
import Header from "@/components/layout/header";
import { OwnerNameReview } from "@/components/owner-name-review";
import { LeadContactHighlights } from "@/components/leads/lead-contact-highlights";
import { ContactFormDraft } from "@/components/leads/contact-form-draft";
import { GroomingChecksPanel } from "@/components/leads/grooming-checks";
import { LeadWorkflowGuide } from "@/components/leads/workflow-guide";
import { FullResearchPanel, type FullResearchStatus } from "@/components/leads/full-research-panel";
import { CompletedSearches } from "@/components/leads/completed-searches";
import { useToast } from "@/hooks/use-toast";
import { directoryEligibility, type DirectoryEligibility, type EligibilityRow } from "@shared/directoryEligibility";
import { leadResearchNeedsRefresh, leadSchedulePreviewReady, leadRecipient, type LeadResearchProgress } from "@shared/leadWorkflowState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, ArrowRight, Building2, Check, ChevronDown, CircleAlert, Clock3, ExternalLink, FileSpreadsheet, ListChecks, Search, Upload } from "lucide-react";

type LeadBatch = { id: string; name: string; fileName?: string; status: string; totalRows: number; createdAt: string; researchProgress?: LeadResearchProgress & { fullResearch?: FullResearchStatus } };
type LeadRow = {
  id: string; batchId: string; businessName: string; address?: string; state?: string; websiteUrl?: string;
  researchState?: "not_started" | "researching" | "researched" | "waiting_hourly" | "failed";
  email?: string; candidateEmail?: string; sourceUrl?: string; evidenceNote?: string; category?: string; placeId?: string;
  reviewStatus?: string; status?: string; identityMatchStatus?: string; importedContactId?: string; dealId?: string;
  nextAction?: string; historicalFinding?: unknown; sourceData?: Record<string, unknown>; evidence?: unknown;
  ownerName?: any; contactName?: any; eligibility?: unknown; processedAt?: string; recipientHistory?: unknown;
};
type LeadHistory = { label:"Already scheduled"|"Previously emailed"|"Uncertain history"|null; history:{status:string;date?:string;contactId?:string;sequenceTrack?:string}[]; crossOwner:boolean };
type LeadSequence = { id:string; subject?:string; sequenceTrack:string; sequenceNumber:number; isActive:string|boolean; renderedSubject?:string; renderedBody?:string; greetingPreview?:string; previewFingerprint?:string };
type LeadView = "all" | "researched" | "needs_review" | "ready_for_contacts";
type Detail = { batch: LeadBatch; rows: LeadRow[]; linkedRows?:{rowId:string;batchId:string;businessName:string}[]; nextOffset: number | null; total: number; researchSummary?: { uploaded:number; notResearched:number; needsReview:number; readyForContacts:number; addedToContacts:number; attempted:number; finished:number; waiting:number; failed:number; emails:number } };
type CorrectionPreview = { changes:{field:string;before:unknown;after:unknown}[]; protected:boolean; message:string; duplicates:{rowId:string;batchId:string;businessName:string}[] };
type Estimate = { eligibleRows: number; maxProviderCalls: number; active: boolean; reason?: string | null };
type Preview = { rows: { rowNumber: number; businessName: string; email?: string; sourceUrl?: string; existingRowId?: string; existingBatchId?: string; protected?: boolean; action: string }[]; inputCount: number; invalidCount: number; duplicateCount: number };
type Raw = Record<string, unknown>;
const fields = ["businessName", "email", "sourceUrl", "address", "state", "websiteUrl", "contactName", "firstName", "lastName"];
const aliases: Record<string, string[]> = {
  businessName: ["businessName", "business", "company", "varLocationName", "name"],
  email: ["email", "candidateEmail", "emailAddress"], sourceUrl: ["sourceUrl", "source", "emailSource", "evidenceUrl"],
  address: ["address", "FormattedAddress", "varLocationAddress1"], state: ["state", "varLocationState"],
  websiteUrl: ["websiteUrl", "website", "url"], contactName: ["contactName", "ownerName", "fullName"],
  firstName: ["firstName", "ownerFirstName"], lastName: ["lastName", "ownerLastName"],
};
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
async function parseUpload(file: File): Promise<Raw[]> {
  if (file.size > 20 * 1024 * 1024) throw new Error("Files must be 20 MB or smaller.");
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext === "json") {
    const value = JSON.parse(await file.text()) as unknown;
    const report = value as Record<string, unknown>;
    const rows = Array.isArray(value) ? value : report?.reviewed || report?.rows || report?.reviewedRows;
    if (!Array.isArray(rows)) throw new Error("JSON must be an array or contain reviewed, reviewedRows or rows.");
    if (rows.length > 20000) throw new Error("Lists are limited to 20,000 rows.");
    if (rows.some(r => !r || typeof r !== "object" || Array.isArray(r))) throw new Error("Every report row must be a business object; no invalid rows were dropped.");
    const metadata = Array.isArray(value) ? {} : Object.fromEntries(Object.entries(report).filter(([k,v]) => !["reviewed","reviewedRows","rows","additions"].includes(k) && !Array.isArray(v)));
    return (rows as Raw[]).map(row => ({ ...row, originalReportMetadata: metadata, researchDate: row.researchDate || report?.generatedAtUTC || report?.generatedAt || null }));
  }
  if (ext === "csv") {
    const parsed = Papa.parse<Raw>(await file.text(), { header: true, skipEmptyLines: true, transformHeader: h => h.trim() });
    if (parsed.errors.length) throw new Error(parsed.errors[0].message);
    if (parsed.data.length > 20000) throw new Error("Lists are limited to 20,000 rows.");
    return parsed.data;
  }
  if (ext !== "xlsx" && ext !== "xls") throw new Error("Choose CSV, XLSX, XLS, or JSON.");
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) throw new Error("No readable worksheet was found.");
  const rows = XLSX.utils.sheet_to_json<Raw>(sheet, { defval: "", raw: false });
  if (rows.length > 20000) throw new Error("Lists are limited to 20,000 rows.");
  return rows;
}
function requestJson<T>(url: string, body?: unknown): Promise<T> {
  return apiRequest(body ? "POST" : "GET", url, body).then(async r => {
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.message || data.error || `Request failed (${r.status})`);
    return data as T;
  });
}
function dateText(v?: string) { return v ? new Date(v).toLocaleString() : "Date unavailable"; }
function localDateTimeValue(date: Date) {
  const pad=(n:number)=>String(n).padStart(2,"0");
  return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function pretty(v: unknown): string { return typeof v === "string" ? v : v == null ? "" : JSON.stringify(v, null, 2); }
function readLeadView(): LeadView {
  const candidate=new URLSearchParams(window.location.search).get("view");
  return candidate==="researched"||candidate==="needs_review"||candidate==="ready_for_contacts"?candidate:"all";
}
function researchBadge(state: LeadRow["researchState"], waitReason?: unknown) {
  switch (state) {
    case "researching": return <Badge variant="secondary">Researching</Badge>;
    case "researched": return <Badge variant="default">Research complete</Badge>;
    case "waiting_hourly": return <Badge variant="outline" className="border-amber-400 text-amber-800">{waitReason==="provider_rate_limit"?"Waiting for provider cooldown":"Stopped at hourly limit"}</Badge>;
    case "failed": return <Badge variant="destructive">Research failed</Badge>;
    default: return <Badge variant="outline">Not researched</Badge>;
  }
}

function LeadGroomingReview({ row, eligibility, onRefresh }: {
  row: LeadRow;
  eligibility: DirectoryEligibility;
  onRefresh: () => void;
}) {
  const [note, setNote] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const provider = eligibility.listing;
  const save = useMutation({
    mutationFn: (decision: "approved" | "excluded") => requestJson(
      `/api/salon-enrichment/rows/${encodeURIComponent(row.id)}/eligibility`,
      { decision, note: note.trim() || undefined, confirmed: true },
    ),
    onSuccess: () => {
      setNote("");
      setConfirmed(false);
      onRefresh();
    },
  });
  const sourceName = row.businessName || "—";
  const sourceAddress = row.address || "—";
  const sourcePlaceId = row.placeId || "";
  const comparable = [[sourceName === "—" ? "" : sourceName, provider.name], [sourceAddress === "—" ? "" : sourceAddress, provider.address], [sourcePlaceId, provider.placeId]].filter(([source, listing]) => Boolean(source && listing));
  const exactMatch = comparable.length > 0 && comparable.every(([source, listing]) =>
    String(source).trim().toLocaleLowerCase().replace(/\s+/g, " ") === String(listing).trim().toLocaleLowerCase().replace(/\s+/g, " "),
  );
  return <section className={`rounded-md border-2 p-3 ${eligibility.blocked ? "border-amber-300 bg-amber-50/60 dark:bg-amber-950/10" : "border-slate-300 bg-muted/10 dark:border-slate-700"}`} aria-label="Grooming eligibility evidence">
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Grooming suitability</span>
      <Badge variant={eligibility.decision === "approved" ? "default" : eligibility.decision === "excluded" ? "destructive" : "outline"}>
        {eligibility.decision === "approved" ? "Human approved" : eligibility.decision === "excluded" ? "Human excluded" : "Review pending"}
      </Badge>
      {eligibility.flagged && <Badge variant="destructive">Flagged</Badge>}
    </div>
    <p className="mt-1 text-xs text-muted-foreground">{eligibility.reason}</p>
    <p className="mt-1 text-xs"><span className="text-muted-foreground">Provider categories: </span>{provider.categories.length ? provider.categories.join(" · ") : "Not supplied"}</p>
    <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
      <div className="rounded-md border-2 bg-background p-3"><b>Source row</b><p className="mt-1">Business: {sourceName}</p><p>Address: {sourceAddress}</p><p className="break-all">Place ID: {sourcePlaceId || "—"}</p></div>
      <div className="rounded-md border-2 bg-background p-3"><b>{provider.provider} listing</b><p className="mt-1">Business: {provider.name || "—"}</p><p>Address: {provider.address || "—"}</p><p className="break-all">Place ID: {provider.placeId || "—"}</p></div>
    </div>
    <p className={`mt-2 text-xs font-medium ${exactMatch ? "text-emerald-800 dark:text-emerald-300" : "text-amber-800 dark:text-amber-300"}`}>Identity evidence: {exactMatch ? "Exact match on comparable source values" : "Identity not confirmed"}</p>
    {provider.sourceUrl && <a className="mt-2 inline-flex text-xs font-medium text-primary underline" href={provider.sourceUrl} target="_blank" rel="noopener noreferrer">Open provider listing</a>}
    {eligibility.reviewNote && <p className="mt-2 border-l-2 border-primary/40 pl-2 text-xs"><b>Reviewer note:</b> {eligibility.reviewNote}</p>}
    <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
      <div className="space-y-2">
        <div><Label>Reviewer note <span className="font-normal text-muted-foreground">· optional</span></Label><Textarea rows={2} value={note} onChange={event => setNote(event.target.value)} placeholder="Optional context for this grooming decision." className="border-2 bg-background text-sm" /></div>
        <label className="flex items-start gap-2 text-xs text-muted-foreground"><Checkbox checked={confirmed} onCheckedChange={value => setConfirmed(value === true)} disabled={save.isPending} /><span>Optional confirmation: I reviewed the provider evidence and confirm this decision. This does not approve the email.</span></label>
      </div>
      <div className="flex flex-wrap gap-2 sm:justify-end">
        <Button size="sm" className="min-h-10" disabled={save.isPending} onClick={() => save.mutate("approved")}><Check className="mr-1 h-4 w-4" />Approve grooming</Button>
        <Button size="sm" variant="outline" className="min-h-10" disabled={save.isPending} onClick={() => save.mutate("excluded")}><span aria-hidden="true">×</span><span className="ml-1">Exclude</span></Button>
      </div>
    </div>
    {save.isError && <p role="alert" className="mt-2 rounded border-2 border-destructive/40 p-2 text-xs text-destructive">Could not save grooming decision: {(save.error as Error).message}</p>}
    <p className="mt-2 text-[11px] text-muted-foreground">{eligibility.blocked ? "Grooming review is a separate approval gate for email approval, Contacts, and outreach." : "Suitability approval and identity evidence do not replace email or owner review."}</p>
  </section>;
}
function FieldMap({ raw, mapping, setMapping }: { raw: Raw[]; mapping: Record<string,string>; setMapping: (v: Record<string,string>) => void }) {
  const headers = Object.keys(raw[0] ?? {});
  return <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{fields.map(field => <div key={field} className="space-y-1"><Label className="capitalize">{field.replace(/([A-Z])/g," $1")}{field === "businessName" ? " · required" : ""}</Label><Select value={mapping[field] || "none"} onValueChange={v => setMapping({...mapping,[field]:v==="none"?"":v})}><SelectTrigger><SelectValue placeholder="Not mapped"/></SelectTrigger><SelectContent><SelectItem value="none">Not mapped</SelectItem>{headers.map(h=><SelectItem key={h} value={h}>{h}</SelectItem>)}</SelectContent></Select></div>)}</div>;
}
function UploadPanel({ onDone }: { onDone: (id: string) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file,setFile]=useState<File|null>(null), [raw,setRaw]=useState<Raw[]>([]), [mapping,setMapping]=useState<Record<string,string>>({});
  const [name,setName]=useState(""), [preview,setPreview]=useState<Preview|null>(null), [duplicateAction,setDuplicateAction]=useState<"skip"|"link"|"update">("skip");
  const [error,setError]=useState(""), [confirmed,setConfirmed]=useState(false);
  const mapGuess = (data: Raw[]) => Object.fromEntries(fields.map(f=>[f,Object.keys(data[0]??{}).find(k=>aliases[f].some(a=>norm(a)===norm(k)))??""]));
  const choose = async (f?: File) => {
    if(!f) return;
    setError("");setPreview(null);setConfirmed(false);setFile(f);
    try { const data=await parseUpload(f); setRaw(data);setMapping(mapGuess(data));setName(f.name.replace(/\.[^.]+$/,"")); }
    catch(e){setError(e instanceof Error?e.message:"Could not read file.");}
  };
  const mappedRows = useMemo(()=>raw.map(row=>Object.fromEntries(fields.map(f=>[f,String(row[mapping[f]]??"").trim()]))),[raw,mapping]);
  const previewMutation=useMutation({
    mutationFn:()=>requestJson<Preview>("/api/leads/upload-preview",{name:name.trim(),fileName:file?.name,rows:raw,columnMapping:mapping}),
    onSuccess:setPreview,onError:e=>setError(e.message),
  });
  const uploadMutation=useMutation({
    mutationFn:()=>requestJson<{batch:{id:string};stagedCount:number;duplicateCount:number;linkedCount:number;updatedCount:number;invalidCount:number}>("/api/leads/upload",{name:name.trim(),fileName:file?.name,rows:raw,columnMapping:mapping,confirmed:true,duplicateAction}),
    onSuccess:d=>{queryClient.invalidateQueries({queryKey:["/api/leads"]});onDone(d.batch.id);},
    onError:e=>setError(e.message),
  });
  return <Card className="border-dashed border-2">
    <CardHeader><CardTitle className="flex items-center gap-2"><FileSpreadsheet className="h-5 w-5 text-primary"/>Upload a list</CardTitle><p className="text-sm text-muted-foreground">CSV, Excel, or JSON · up to 20 MB and 20,000 rows. Original row fields are preserved alongside your mapping.</p></CardHeader>
    <CardContent className="space-y-4">
      <input ref={fileRef} className="sr-only" type="file" accept=".csv,.xlsx,.xls,.json" onChange={e=>{void choose(e.target.files?.[0]);e.currentTarget.value="";}}/>
      <Button variant="outline" onClick={()=>fileRef.current?.click()}><Upload className="mr-2 h-4 w-4"/>Choose a file</Button>{file&&<span className="ml-3 text-sm text-muted-foreground">{file.name} · {raw.length.toLocaleString()} rows</span>}
      {raw.length>0&&<div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2"><div><Label>Saved list name</Label><Input value={name} onChange={e=>setName(e.target.value)} /></div><div className="flex items-end text-xs text-muted-foreground">Suggested columns are recognized automatically, including varLocationName, GooglePlaceID and FormattedAddress.</div></div>
        <FieldMap raw={raw} mapping={mapping} setMapping={value=>{setMapping(value);setPreview(null);setConfirmed(false);}}/>
        <div className="overflow-x-auto rounded-lg border"><table className="w-full text-left text-xs"><thead className="bg-muted"><tr>{fields.slice(0,5).map(f=><th key={f} className="p-2 capitalize">{f}</th>)}</tr></thead><tbody>{mappedRows.slice(0,4).map((r,i)=><tr key={i} className="border-t">{fields.slice(0,5).map(f=><td key={f} className="max-w-48 truncate p-2">{r[f]||"—"}</td>)}</tr>)}</tbody></table></div>
       <p className="text-xs text-muted-foreground">Upload only stages suggestions; research never starts automatically. After upload, open the saved list to start Full Research when you are ready. Uploading does not import contacts or send or schedule messages.</p>
        {!preview?<Button disabled={!mapping.businessName||previewMutation.isPending} onClick={()=>previewMutation.mutate()}>{previewMutation.isPending?"Preparing preview…":"Preview list"}</Button>:<div className="space-y-3 rounded-lg border bg-muted/30 p-4">
          <div className="flex flex-wrap gap-2"><Badge>{preview.inputCount} input</Badge><Badge variant="secondary">{preview.duplicateCount} possible duplicates</Badge><Badge variant="outline">{preview.invalidCount} missing business name</Badge></div>
          <div><Label>Duplicate handling</Label><Select value={duplicateAction} onValueChange={v=>setDuplicateAction(v as typeof duplicateAction)}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="skip">Skip duplicates</SelectItem><SelectItem value="link">Link to existing lead</SelectItem><SelectItem value="update">Add source suggestions</SelectItem></SelectContent></Select><p className="mt-1 text-xs text-muted-foreground">Update adds source suggestions only. It cannot override approved evidence, manual names, or CRM records.</p></div>
          <div className="max-h-64 overflow-auto rounded border bg-background"><table className="w-full text-xs"><thead className="sticky top-0 bg-muted"><tr><th className="p-2 text-left">Row</th><th className="p-2 text-left">Business</th><th className="p-2 text-left">Email suggestion</th><th className="p-2 text-left">Action</th></tr></thead><tbody>{preview.rows.map(r=><tr key={r.rowNumber} className="border-t"><td className="p-2">{r.rowNumber}</td><td className="p-2">{r.businessName||"—"}</td><td className="p-2">{r.email||"—"}</td><td className="p-2">{r.action}{r.protected?" · protected CRM data":""}</td></tr>)}</tbody></table></div>
          <label className="flex items-start gap-2 text-sm"><Checkbox checked={confirmed} onCheckedChange={v=>setConfirmed(v===true)}/><span>I understand uploaded emails and names are unverified suggestions and require explicit review.</span></label>
          <Button disabled={!confirmed||uploadMutation.isPending} onClick={()=>uploadMutation.mutate()}>{uploadMutation.isPending?"Adding list…":"Confirm and add to Leads"}</Button>
        </div>}
      </div>}
      {error&&<Alert variant="destructive"><CircleAlert className="h-4 w-4"/><AlertTitle>List could not be added</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
    </CardContent>
  </Card>;
}

function LeadRowCard({row,onRefresh}:{row:LeadRow;onRefresh:()=>void}) {
  const [sourceUrl,setSourceUrl]=useState(row.sourceUrl||""),[note,setNote]=useState(""),[historical,setHistorical]=useState(false),[identity,setIdentity]=useState(false),[open,setOpen]=useState(false);
  const [correctionFields,setCorrectionFields]=useState({
    businessName:row.businessName||"",
    address:row.address||"",
    websiteUrl:row.websiteUrl||"",
    candidateEmail:row.candidateEmail||row.email||"",
    sourceUrl:row.sourceUrl||"",
  });
  const [correctionNote,setCorrectionNote]=useState("");
  const [correctionOpen,setCorrectionOpen]=useState(false);
  const [correctionPreview,setCorrectionPreview]=useState<CorrectionPreview|null>(null);
  const [correctionError,setCorrectionError]=useState("");
  const cancelCorrection=()=>{
    setCorrectionOpen(false);
    setCorrectionPreview(null);
    setCorrectionNote("");
    setCorrectionError("");
    setCorrectionFields({businessName:row.businessName||"",address:row.address||"",websiteUrl:row.websiteUrl||"",candidateEmail:row.candidateEmail||row.email||"",sourceUrl:row.sourceUrl||""});
  };
  const [duplicateChoices,setDuplicateChoices]=useState<{id:string;company?:string;email?:string;phone?:string;address?:string;matchReasons?:string[]}[]>([]);
  const [selectedDuplicate,setSelectedDuplicate]=useState("");
  const [crmContactId,setCrmContactId]=useState("");
  const [scheduleSequence,setScheduleSequence]=useState("");
  const [scheduledAt,setScheduledAt]=useState(()=>localDateTimeValue(new Date(Date.now()+60*60*1000)));
  const [scheduleConfirmed,setScheduleConfirmed]=useState(false);
  const [scheduleMessage,setScheduleMessage]=useState("");
  const [crmMessage,setCrmMessage]=useState("");
  const eligibility=(row.eligibility as DirectoryEligibility|undefined)??directoryEligibility(row as unknown as EligibilityRow);
  const emailToApprove=[row.candidateEmail,row.email].map(value=>value?.trim()||"").find(value=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))||"";
  const history=useQuery<LeadHistory>({
    queryKey:["/api/leads/rows",row.id,"history",row.importedContactId||null],queryFn:()=>requestJson(`/api/leads/rows/${encodeURIComponent(row.id)}/history`),enabled:open,
  });
  const sequenceData=useQuery<{sequences:LeadSequence[];history:LeadHistory;contact?:{id?:string;email?:string}}>({
    queryKey:["/api/leads/rows",row.id,"sequences",row.importedContactId||null],queryFn:()=>requestJson(`/api/leads/rows/${encodeURIComponent(row.id)}/sequences`),enabled:open,
  });
  const availableSequences=(sequenceData.data?.sequences??[]).filter(s=>Number(s.sequenceNumber)===1&&(s.isActive===true||s.isActive==="true"));
  const recipientHistory=history.data??sequenceData.data?.history;
  const blockedHistory=["Already scheduled","Previously emailed","Uncertain history"].includes(recipientHistory?.label??"");
  const historyAvailable=history.isSuccess||Boolean(sequenceData.isSuccess&&sequenceData.data?.history);
  const selectedSequence=availableSequences.find(sequence=>sequence.id===scheduleSequence);
  const previewReady=sequenceData.isSuccess&&!sequenceData.isFetching&&!history.isFetching&&
    leadSchedulePreviewReady(row.importedContactId,sequenceData.data?.contact,selectedSequence);
  useEffect(()=>{setScheduleConfirmed(false);},[row.importedContactId,scheduleSequence,scheduledAt,sequenceData.dataUpdatedAt]);
  const scheduleMutation=useMutation({
    mutationFn:()=> {
      const parsed=new Date(scheduledAt);
      if(!scheduleSequence) throw new Error("Choose an active first-step sequence.");
      if(!row.importedContactId||!row.dealId) throw new Error("Link this contact and create its Pipeline deal before scheduling.");
      if(!scheduleConfirmed) throw new Error("Confirm the recipient and message preview before scheduling.");
      if(!previewReady)throw new Error("Wait for a current recipient, subject, greeting and message preview before confirming.");
      if(Number.isNaN(parsed.getTime())||parsed.getTime()<=Date.now()) throw new Error("Choose a future date and time.");
      if(blockedHistory) throw new Error("Recipient history blocks scheduling for this lead.");
      return requestJson<{successful?:boolean;failed?:unknown}>(`/api/leads/rows/${encodeURIComponent(row.id)}/schedule`,{
        confirmed:true,sequenceId:scheduleSequence,scheduledSendAt:parsed.toISOString(),
        previewRecipient:leadRecipient(sequenceData.data?.contact?.email),previewFingerprint:selectedSequence!.previewFingerprint,
      });
    },
    onSuccess:data=>{
      const successful=Boolean(data.successful);
      setScheduleMessage(successful?"Sequence scheduled for the selected future time.":`Scheduling did not succeed${data.failed?`: ${typeof data.failed==="string"?data.failed:JSON.stringify(data.failed)}`:"; the server did not confirm success."}`);
      if(successful){setScheduleConfirmed(false);queryClient.invalidateQueries({queryKey:["/api/leads/rows",row.id,"history"]});queryClient.invalidateQueries({queryKey:["/api/leads/rows",row.id,"sequences"]});}
    },
    onError:()=>{setScheduleConfirmed(false);queryClient.invalidateQueries({queryKey:["/api/leads/rows",row.id,"history"]});queryClient.invalidateQueries({queryKey:["/api/leads/rows",row.id,"sequences"]});},
  });
  const crmMutation=useMutation({
    mutationFn:(linkContactId?:string)=>requestJson<{contactId?:string;linked?:boolean;needsDuplicateReview?:boolean;duplicates?:{id:string;company?:string;email?:string;phone?:string;address?:string;matchReasons?:string[]}[]}>(`/api/leads/rows/${encodeURIComponent(row.id)}/crm`,{confirmed:true,...(linkContactId?{linkContactId}:{})}),
    onSuccess:data=>{
      if(data.needsDuplicateReview){
        setDuplicateChoices(data.duplicates??[]);
        setSelectedDuplicate("");
        if(!data.duplicates?.length) setCrmMessage("Possible duplicates were detected, but the server returned no selectable contact records. No CRM link was made.");
        return;
      }
      if(data.contactId){setCrmContactId(data.contactId);setDuplicateChoices([]);setScheduleConfirmed(false);queryClient.invalidateQueries({queryKey:["/api/leads/rows",row.id,"sequences"]});queryClient.invalidateQueries({queryKey:["/api/leads/rows",row.id,"history"]});onRefresh();return;}
      setCrmMessage("The server did not return a contact ID. No contact link was recorded.");
    },
  });
  const actionMutation=useMutation({
    mutationFn:({kind,body}:{kind:string;body?:unknown})=>requestJson(`/api/leads/rows/${encodeURIComponent(row.id)}/${kind}`,body),
    onSuccess:()=>{onRefresh();queryClient.invalidateQueries({queryKey:["/api/leads/rows",row.id,"history"]});},
  });
  const reviewMutation=useMutation({
    mutationFn:({decision}:{decision:"approved"|"rejected"})=>requestJson(`/api/leads/rows/${encodeURIComponent(row.id)}/review`,{
      confirmed:true,decision,sourceUrl:sourceUrl.trim(),reviewNote:note.trim()||undefined,
      ...(historical?{historicalEvidenceConfirmed:true}:{}),...(identity?{identityConfirmed:true}:{}),
    }),
    onSuccess:onRefresh,
  });
  const correctionPreviewMutation=useMutation({
    mutationFn:()=>requestJson<CorrectionPreview>(`/api/leads/rows/${encodeURIComponent(row.id)}/correction-preview`,{fields:correctionFields,note:correctionNote.trim()}),
    onSuccess:data=>{setCorrectionPreview(data);setCorrectionError("");},
    onError:e=>setCorrectionError(e.message),
  });
  const correctionMutation=useMutation({
    mutationFn:()=>requestJson(`/api/leads/rows/${encodeURIComponent(row.id)}/correction`,{fields:correctionFields,note:correctionNote.trim(),confirmed:true}),
    onSuccess:()=>{setCorrectionFields({...correctionFields});setCorrectionPreview(null);setCorrectionNote("");setCorrectionError("");setCorrectionOpen(false);onRefresh();},
    onError:e=>setCorrectionError(e.message),
  });
  const anyError=reviewMutation.error||actionMutation.error||crmMutation.error||scheduleMutation.error;
  const sourceData=row.sourceData;
  return <article id={`lead-row-${row.id}`} className="rounded-xl border-2 border-slate-400 bg-card p-4 shadow-sm dark:border-slate-600">
    <div className="flex flex-wrap items-start justify-between gap-3">
       <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{row.businessName}</h3>{researchBadge(row.researchState,row.sourceData?.fullResearchWaitReason)}<Badge variant={row.reviewStatus==="approved"?"default":row.reviewStatus==="rejected"?"destructive":"outline"}>{row.reviewStatus||"needs review"}</Badge>{row.identityMatchStatus&&<Badge variant="secondary">Identity · {row.identityMatchStatus}</Badge>}{!!row.historicalFinding&&<Badge variant="outline">Historical source finding · inspect evidence</Badge>}</div><p className="mt-1 text-sm text-muted-foreground">{[row.address,row.state].filter(Boolean).join(" · ")||"Address not provided"}</p><p className="mt-1 text-xs text-muted-foreground">Added {dateText(row.processedAt)}{row.sourceData?.originalResearchDate?` · Originally researched ${dateText(String(row.sourceData.originalResearchDate))}`:""}{row.category?` · ${row.category}`:""}</p></div>
      <Button size="sm" variant="ghost" onClick={()=>setOpen(!open)} aria-expanded={open}>{open?"Close details":"Review details"}<ChevronDown className={`ml-1 h-4 w-4 transition-transform ${open?"rotate-180":""}`}/></Button>
    </div>
    <p className="mt-3 rounded-md bg-muted/60 px-3 py-2 text-sm"><span className="font-medium">Next action · </span>{row.nextAction||"Review source evidence and confirm business identity before approving."}</p>
    <LeadContactHighlights businessName={row.businessName} contactName={row.contactName} ownerName={row.ownerName}
      email={row.email} candidateEmail={row.candidateEmail} reviewStatus={row.reviewStatus}
      importedContactId={row.importedContactId} sourceUrl={row.sourceUrl}/>
    {row.websiteUrl&&<a className="mt-2 inline-flex items-center gap-1 text-sm text-primary underline-offset-4 hover:underline" href={row.websiteUrl} target="_blank" rel="noreferrer">{row.websiteUrl}<ExternalLink className="h-3 w-3"/></a>}
    {open&&<div className="mt-4 space-y-4 border-t-2 border-slate-400 pt-4 dark:border-slate-600">
      {!row.importedContactId&&row.reviewStatus!=="approved"&&<section className="rounded-lg border-2 border-slate-400 bg-muted/20 p-3 dark:border-slate-600">
        <div className="flex flex-wrap items-start justify-between gap-2"><div><h4 className="text-sm font-semibold">Staged details</h4><p className="mt-1 text-xs text-muted-foreground">Correct source suggestions before approval. Original uploaded input remains preserved; correction resets identity and email approval.</p></div><Button size="sm" variant="outline" onClick={()=>{if(correctionOpen)cancelCorrection();else{setCorrectionOpen(true);setCorrectionPreview(null);setCorrectionError("");}}}>{correctionOpen?"Cancel correction":"Correct staged details"}</Button></div>
        {correctionOpen&&<div className="mt-3 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div><Label>Business name</Label><Input value={correctionFields.businessName} onChange={e=>{setCorrectionFields(v=>({...v,businessName:e.target.value}));setCorrectionPreview(null);}}/></div>
            <div><Label>Address</Label><Input value={correctionFields.address} onChange={e=>{setCorrectionFields(v=>({...v,address:e.target.value}));setCorrectionPreview(null);}}/></div>
            <div><Label>Website URL</Label><Input value={correctionFields.websiteUrl} onChange={e=>{setCorrectionFields(v=>({...v,websiteUrl:e.target.value}));setCorrectionPreview(null);}}/></div>
            <div><Label>Candidate email</Label><Input type="email" value={correctionFields.candidateEmail} onChange={e=>{setCorrectionFields(v=>({...v,candidateEmail:e.target.value}));setCorrectionPreview(null);}}/></div>
            <div className="sm:col-span-2"><Label>Source URL</Label><Input value={correctionFields.sourceUrl} onChange={e=>{setCorrectionFields(v=>({...v,sourceUrl:e.target.value}));setCorrectionPreview(null);}}/></div>
          </div>
          <p className="text-[11px] text-muted-foreground">Only staged lead fields are editable here. Manually entered or approved contact names are never changed by this correction.</p>
          <div><Label>Required correction note</Label><Textarea value={correctionNote} onChange={e=>setCorrectionNote(e.target.value)} placeholder="Explain the source-backed correction."/></div>
          {!correctionPreview?<div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={!correctionFields.businessName.trim()||!correctionNote.trim()||correctionPreviewMutation.isPending} onClick={()=>correctionPreviewMutation.mutate()}>{correctionPreviewMutation.isPending?"Checking correction…":"Preview correction"}</Button><Button size="sm" variant="ghost" onClick={cancelCorrection}>Cancel</Button></div>:<div className="space-y-3 rounded-md border bg-background p-3">
            <div><b className="text-sm">Review exact changes</b><p className="mt-1 text-xs text-muted-foreground">{correctionPreview.message||"This correction resets identity and email approval. Original input is retained."}</p></div>
            {correctionPreview.changes.length?<div className="overflow-x-auto rounded border"><table className="w-full text-left text-xs"><thead className="bg-muted"><tr><th className="p-2">Field</th><th className="p-2">Current</th><th className="p-2">Proposed</th></tr></thead><tbody>{correctionPreview.changes.map((change,index)=><tr key={`${change.field}-${index}`} className="border-t"><td className="p-2 font-medium">{change.field}</td><td className="max-w-64 whitespace-pre-wrap break-words p-2">{String(change.before??"—")}</td><td className="max-w-64 whitespace-pre-wrap break-words p-2">{String(change.after??"—")}</td></tr>)}</tbody></table></div>:<p className="text-xs text-muted-foreground">No field changes detected.</p>}
            {correctionPreview.duplicates?.length>0&&<div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3"><b className="text-xs">Possible duplicate saved rows</b>{correctionPreview.duplicates.map(duplicate=><Link key={`${duplicate.batchId}-${duplicate.rowId}`} href={`/leads/${encodeURIComponent(duplicate.batchId)}#lead-row-${encodeURIComponent(duplicate.rowId)}`} className="flex items-center justify-between gap-2 rounded border bg-background p-2 text-xs hover:border-primary/50"><span>{duplicate.businessName}</span><span className="text-primary">Open existing row <ArrowRight className="inline h-3 w-3"/></span></Link>)}</div>}
            {correctionPreview.protected&&<Alert variant="destructive"><AlertDescription>{correctionPreview.message||"This lead is protected and cannot be corrected here."}</AlertDescription></Alert>}
            <div className="flex flex-wrap gap-2"><Button size="sm" disabled={correctionPreview.protected||correctionMutation.isPending||!correctionNote.trim()} onClick={()=>correctionMutation.mutate()}>{correctionMutation.isPending?"Saving correction…":"Confirm correction"}</Button><Button size="sm" variant="outline" disabled={correctionMutation.isPending} onClick={cancelCorrection}>Cancel</Button></div>
          </div>}
          {correctionError&&<Alert variant="destructive"><AlertDescription>{correctionError}</AlertDescription></Alert>}
        </div>}
      </section>}
      {(row.reviewStatus==="approved"||row.importedContactId)&&<p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950">{row.importedContactId?"This lead is linked to a CRM contact and is immutable here. Open Contact to review the record.":"This lead has approved evidence and is immutable in staged corrections."}</p>}
      <section aria-labelledby={`crm-action-${row.id}`} className="rounded-xl border-2 border-primary/30 bg-primary/[0.06] p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="max-w-2xl">
            <h4 id={`crm-action-${row.id}`} className="text-base font-semibold">Add this approved lead to Contacts</h4>
            <p className="mt-1 text-sm leading-5 text-muted-foreground">{row.importedContactId?"This lead is already linked to a CRM contact.":"Approved leads can be added to Contacts after email review and grooming eligibility approval."}</p>
          </div>
          {row.importedContactId
            ? <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
                <Link className="inline-flex min-h-11 items-center justify-center rounded-md border bg-background px-4 text-sm font-semibold hover:bg-muted" href={`/contacts?edit=${encodeURIComponent(row.importedContactId)}`}>Open contact</Link>
                {row.dealId&&<Link className="inline-flex min-h-11 items-center justify-center rounded-md border bg-background px-4 text-sm font-semibold hover:bg-muted" href={`/deal/${encodeURIComponent(row.dealId)}`}>Open pipeline deal</Link>}
              </div>
            : <Button className="min-h-11 w-full px-5 text-sm font-semibold sm:w-auto" disabled={crmMutation.isPending||row.reviewStatus!=="approved"||eligibility.blocked} onClick={()=>{setCrmMessage("");crmMutation.mutate(undefined)}}>Add approved lead to Contacts</Button>}
        </div>
        {!row.importedContactId&&(row.reviewStatus!=="approved"||eligibility.blocked)&&<p className="mt-3 text-xs font-medium text-amber-900">{row.reviewStatus!=="approved"?"Approve the lead’s email evidence before adding it to Contacts.":"Approve grooming eligibility before adding this lead to Contacts."}</p>}
      </section>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="space-y-2 rounded-lg border-2 border-slate-400 bg-card p-3 dark:border-slate-600"><h4 className="text-sm font-semibold">Email & identity review</h4><p className="text-xs leading-5 text-muted-foreground">Email review is independent from a personal name. Inspect the source yourself and confirm the address is a general-contact email for this business. Grooming suitability is reviewed separately below.</p>
          <div><Label>Source URL <span className="font-normal text-muted-foreground">· optional</span></Label><Input value={sourceUrl} onChange={e=>setSourceUrl(e.target.value)} placeholder="https://business.example/contact"/></div>
          <div><Label>Review note <span className="font-normal text-muted-foreground">· optional</span></Label><Textarea value={note} onChange={e=>setNote(e.target.value)} placeholder="Describe what you inspected and how it matches the business/location."/></div>
          <label className="flex items-start gap-2 text-xs"><Checkbox checked={historical} onCheckedChange={v=>setHistorical(v===true)}/><span>Optional confirmation: I inspected the source, matched the business/location, and confirmed this is a general-contact email.</span></label>
          <label className="flex items-start gap-2 text-xs"><Checkbox checked={identity} onCheckedChange={v=>setIdentity(v===true)}/><span>Optional confirmation: I confirm this source and suggested email belong to this business identity.</span></label>
          <div className="rounded-lg border-2 border-slate-300 bg-muted/30 p-3 dark:border-slate-700">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Email being approved</p>
            <p className="mt-1 break-all text-lg font-bold" data-testid="lead-email-approval-target">{emailToApprove||"No email found"}</p>
          </div>
          <div className="flex flex-wrap gap-2"><Button size="sm" disabled={reviewMutation.isPending||!emailToApprove||eligibility.blocked} onClick={()=>reviewMutation.mutate({decision:"approved"})}><Check className="mr-1.5 h-4 w-4"/>Approve email</Button><Button size="sm" variant="outline" disabled={reviewMutation.isPending} onClick={()=>reviewMutation.mutate({decision:"rejected"})}>Reject suggestion</Button></div>
          {!emailToApprove&&<p role="status" className="text-xs font-medium text-amber-800">A usable email address is required before approval.</p>}
          {eligibility.blocked&&<p className="text-xs text-amber-800">Email approval is blocked until grooming suitability is separately approved.</p>}
          {!!row.historicalFinding&&<div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950"><b>Historical source finding — inspect evidence</b><pre className="mt-2 whitespace-pre-wrap font-sans">{pretty(row.historicalFinding)}</pre></div>}
          <ContactFormDraft key={`${row.id}:${row.businessName}:${row.address||""}:${row.ownerName?.lookedUpAt||""}:${row.ownerName?.selectedCandidateId||""}:${row.ownerName?.approvedAt||""}:${row.ownerName?.usePersonalName||false}`} rowId={row.id} businessName={row.businessName} address={row.address} ownerSearch={row.ownerName ? {status:row.ownerName.status,lookedUpAt:row.ownerName.lookedUpAt,error:row.ownerName.error}:undefined}/>
        </section>
        <section className="space-y-2 rounded-lg border-2 border-slate-400 bg-card p-3 dark:border-slate-600"><h4 className="text-sm font-semibold">Grooming eligibility & source history</h4>
          <LeadGroomingReview row={row} eligibility={eligibility} onRefresh={onRefresh}/>
          <details className="rounded-md border p-3"><summary className="cursor-pointer text-sm font-medium">Evidence notes and original row</summary><p className="mt-3 whitespace-pre-wrap break-words text-xs leading-5">{pretty(row.evidenceNote||"No evidence notes supplied.")}</p><pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-words border-t pt-3 text-[11px] leading-5">{pretty(row.evidence||"No structured evidence supplied.")}</pre><pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-words border-t pt-3 text-[11px] leading-5">{pretty(sourceData||"Original row unavailable")}</pre></details>
          {!historyAvailable&&(history.isLoading||sequenceData.isLoading)?<p className="text-xs text-muted-foreground">Checking permission-safe recipient history before any scheduling option is enabled…</p>:!historyAvailable?<Alert variant="destructive"><AlertDescription>Recipient history unavailable. Scheduling is disabled until history can be checked: {(history.error as Error)?.message||(sequenceData.error as Error)?.message}</AlertDescription></Alert>:<div className="rounded-md border p-3 text-xs"><b>{recipientHistory?.label||"No recorded schedule or email history"}</b>{recipientHistory?.crossOwner&&<p className="mt-1">History includes another owner.</p>}{recipientHistory?.history.map((h,i)=><p key={i} className="mt-2">{h.status} · {dateText(h.date)}{h.sequenceTrack?` · ${h.sequenceTrack}`:""}</p>)}</div>}
          {(crmContactId||row.importedContactId)&&<p className="text-xs text-emerald-800">Contact linked: <Link className="underline" href={`/contacts?edit=${encodeURIComponent(crmContactId||row.importedContactId!)}`}>open record</Link></p>}
          {duplicateChoices.length>0&&<div className="space-y-3 rounded-md border border-amber-300 bg-amber-50 p-3"><div><b className="text-sm">Possible duplicate contacts</b><p className="text-xs">Compare identity and location, then select the existing contact to link. Its current email and manual details will remain unchanged; scheduling previews that actual recipient.</p></div><div className="space-y-2">{duplicateChoices.map(candidate=><label key={candidate.id} className="flex cursor-pointer items-start gap-2 rounded border bg-background p-2 text-xs"><input type="radio" name={`dupe-${row.id}`} checked={selectedDuplicate===candidate.id} onChange={()=>setSelectedDuplicate(candidate.id)}/><span><b>{candidate.company||"Existing contact"}</b><span className="block text-muted-foreground">{candidate.email||"Email unavailable"} · {candidate.id}</span><span className="block">{candidate.address}{candidate.phone?` · ${candidate.phone}`:""}</span>{candidate.matchReasons&&<span className="block text-muted-foreground">Matches: {candidate.matchReasons.join(", ")}</span>}</span></label>)}</div><Button size="sm" disabled={!selectedDuplicate||crmMutation.isPending} onClick={()=>{setCrmMessage("");crmMutation.mutate(selectedDuplicate)}}>Confirm link to selected contact</Button></div>}
          {row.importedContactId&&!row.dealId&&<Button size="sm" variant="outline" disabled={actionMutation.isPending} onClick={()=>actionMutation.mutate({kind:"pipeline",body:{confirmed:true}})}>Create Pipeline deal</Button>}
          {row.importedContactId&&<section className="space-y-3 rounded-lg border bg-muted/20 p-3"><div><h5 className="text-sm font-semibold">Schedule an outreach step</h5><p className="text-xs text-muted-foreground">Scheduling is separate from approval, research, and CRM linking. This action does not send immediately.</p></div>
            {sequenceData.isLoading?<p className="text-xs text-muted-foreground">Loading active first-step sequences…</p>:sequenceData.isError?<p className="text-xs text-destructive">Available sequences could not load: {(sequenceData.error as Error).message}</p>:availableSequences.length===0?<p className="text-xs text-muted-foreground">No active first-step sequences are available for this lead.</p>:<>
              <div><Label>First-step sequence</Label><Select value={scheduleSequence} onValueChange={setScheduleSequence}><SelectTrigger><SelectValue placeholder="Choose a sequence"/></SelectTrigger><SelectContent>{availableSequences.map(seq=><SelectItem key={seq.id} value={seq.id}>{seq.subject||seq.sequenceTrack} · {seq.sequenceTrack}</SelectItem>)}</SelectContent></Select></div>
              {scheduleSequence&&<div className="rounded-md border bg-background p-3 text-xs"><b>Personalization preview</b><p className="mt-1">Recipient: {sequenceData.data?.contact?.email||"Unavailable"}</p><p className="mt-1">Subject: {availableSequences.find(s=>s.id===scheduleSequence)?.renderedSubject||"Rendered subject unavailable — review the contact and template."}</p><p className="mt-1">Greeting: {availableSequences.find(s=>s.id===scheduleSequence)?.greetingPreview||"Review the contact's business/personal greeting preference."}</p><p className="mt-2 whitespace-pre-wrap">{availableSequences.find(s=>s.id===scheduleSequence)?.renderedBody}</p><p className="mt-1 text-muted-foreground">Name approval does not authorize a personal-name greeting. Preview uses the linked contact's existing preference; attribution is checked again before sending.</p></div>}
              <div><Label>Scheduled time · your local time</Label><Input type="datetime-local" value={scheduledAt} min={localDateTimeValue(new Date(Date.now()+60_000))} onChange={e=>setScheduledAt(e.target.value)}/></div>
              <label className="flex items-start gap-2 text-xs"><Checkbox checked={scheduleConfirmed} onCheckedChange={v=>setScheduleConfirmed(v===true)}/><span>I reviewed the recipient, sequence preview, and history and confirm this future schedule.</span></label>
              {!previewReady&&scheduleSequence&&<p role="status" className="text-xs text-amber-800">Scheduling is disabled until the current linked recipient and complete message preview are available.</p>}
              <Button size="sm" disabled={!row.dealId||!row.importedContactId||!scheduleSequence||!scheduleConfirmed||!previewReady||!historyAvailable||blockedHistory||scheduleMutation.isPending} onClick={()=>{setScheduleMessage("");scheduleMutation.mutate()}}>{scheduleMutation.isPending?"Scheduling…":"Confirm schedule"}</Button>
            </>}
            {blockedHistory&&<p className="text-xs font-medium text-amber-800">Scheduling disabled: recipient history is {history.data?.label?.toLowerCase()}.</p>}
            {scheduleMessage&&<p role="status" className={`text-xs ${scheduleMessage.startsWith("Sequence scheduled")?"text-emerald-800":"text-destructive"}`}>{scheduleMessage}</p>}
          </section>}
          <GroomingChecksPanel row={row}/>
          {row.contactName||row.ownerName?<OwnerNameReview rowId={row.id} businessName={row.businessName} ownerName={row.ownerName} contactName={row.contactName} canSearch={row.sourceData?.stagingState!=="research_directory"&&!row.sourceData?.researchDataset}/>:null}
        </section>
      </div>
      {(anyError||crmMessage)&&<Alert variant="destructive"><CircleAlert className="h-4 w-4"/><AlertTitle>Action could not be completed</AlertTitle><AlertDescription>{crmMessage||(anyError as Error).message}</AlertDescription></Alert>}
    </div>}
  </article>;
}

export default function Leads() {
  const {id}=useParams<{id?:string}>();
  const [,setLocation]=useLocation();
  const {toast}=useToast();
  const [search,setSearch]=useState("");
  const [view,setView]=useState<LeadView>(()=>readLeadView());
  const [limit,setLimit]=useState("100");
  const [rowLimit,setRowLimit]=useState("100");
  const [calls,setCalls]=useState("");
  const [confirmResearch,setConfirmResearch]=useState(false);
  const [confirmResume,setConfirmResume]=useState(false);
  const [researchError,setResearchError]=useState("");
  useEffect(()=>{
    if(!id&&new URLSearchParams(window.location.search).get("upload")==="1"){
      window.requestAnimationFrame(()=>document.getElementById("upload-list")?.scrollIntoView({behavior:"smooth",block:"start"}));
    }
  },[id]);
  useEffect(()=>{
    setView(readLeadView());
  },[id]);
  const changeView=(next:LeadView, scrollTarget?:string)=>{
    setView(next);
    const params=new URLSearchParams(window.location.search);
    if(next==="all")params.delete("view");else params.set("view",next);
    setLocation(`${window.location.pathname}${params.size?`?${params.toString()}`:""}${window.location.hash}`);
    if(scrollTarget)window.requestAnimationFrame(()=>document.getElementById(scrollTarget)?.scrollIntoView({behavior:"smooth",block:"start"}));
  };
  const batches=useQuery<LeadBatch[]>({queryKey:["/api/leads"],queryFn:()=>requestJson("/api/leads"),enabled:!id});
  const detail=useInfiniteQuery<Detail>({
    queryKey:["/api/leads",id,limit,search,view],
    queryFn:({pageParam})=>requestJson(`/api/leads/${encodeURIComponent(id!)}?limit=${limit}&offset=${String(pageParam)}&view=${view}${search?`&search=${encodeURIComponent(search)}`:""}`),
    initialPageParam:0,
    getNextPageParam:page=>page.nextOffset??undefined,
    enabled:!!id,
    refetchInterval:query=>query.state.data?.pages[0]?.batch.researchProgress?.fullResearch?.status==="waiting_hourly"?15000:leadResearchNeedsRefresh(query.state.data?.pages[0]?.batch,query.state.data?.pages.flatMap(page=>page.rows))?2000:false,
  });
  const estimate=useQuery<Estimate>({queryKey:["/api/leads",id,"estimate"],queryFn:()=>requestJson(`/api/leads/${encodeURIComponent(id!)}/estimate`),enabled:!!id,refetchInterval:query=>query.state.data?.active?2000:false});
  const previousResearchActive=useRef(false);
  useEffect(()=>{
    if(previousResearchActive.current&&estimate.data?.active===false)queryClient.invalidateQueries({queryKey:["/api/leads",id]});
    previousResearchActive.current=Boolean(estimate.data?.active);
  },[estimate.data?.active,id]);
  const research=useMutation({mutationFn:()=>requestJson(`/api/leads/${encodeURIComponent(id!)}/research`,{confirmed:true,rowLimit:Number(rowLimit),maxProviderCalls:Number(calls),includeOwnerNames:false}),onSuccess:()=>{setConfirmResearch(false);queryClient.invalidateQueries({queryKey:["/api/leads",id]});queryClient.invalidateQueries({queryKey:["/api/leads",id,"estimate"]});},onError:e=>setResearchError(e.message)});
  const control=useMutation({mutationFn:(action:"pause"|"resume"|"recover")=>requestJson(`/api/leads/${encodeURIComponent(id!)}/${action}`,{confirmed:true}),onSuccess:()=>{setConfirmResume(false);queryClient.invalidateQueries({queryKey:["/api/leads",id]});queryClient.invalidateQueries({queryKey:["/api/leads",id,"estimate"]});}});
  const jobs=useQuery<any[]>({queryKey:["/api/lead-discovery/jobs"],queryFn:()=>requestJson("/api/lead-discovery/jobs"),enabled:!id});
  const national=useQuery<any[]>({queryKey:["/api/lead-discovery/national-jobs"],queryFn:()=>requestJson("/api/lead-discovery/national-jobs"),enabled:!id});
  const stageJob=useMutation({mutationFn:async(jobId:string)=>{
    const preview=await requestJson<any>(`/api/leads/discovery/${encodeURIComponent(jobId)}/preview`,{});
    let duplicateAction="link";
    if(preview.duplicateCount){
      const choice=window.prompt(`${preview.duplicateCount} matching saved leads: ${preview.duplicates.slice(0,10).map((row:any)=>row.businessName).join(", ")}.\nChoose skip, link, or update (source suggestions only; CRM and approved evidence never change).`,"link");
      if(!choice||!["skip","link","update"].includes(choice.trim().toLowerCase()))throw new Error("Preview cancelled; nothing was added.");
      duplicateAction=choice.trim().toLowerCase();
    }
    if(!preview.count)throw new Error("This search has no saved businesses to add.");
    if(!window.confirm(`Add ${preview.count} saved businesses to Leads? No research, contact creation, enrollment or sending will occur.`))throw new Error("Cancelled; nothing was added.");
    return requestJson(`/api/leads/discovery/${encodeURIComponent(jobId)}`,{confirmed:true,duplicateAction});
  },onSuccess:(result:any)=>{
    queryClient.invalidateQueries({queryKey:["/api/leads"]});
    toast({title:"Search saved in Leads",description:`${result.stagedCount??0} new businesses; ${result.linkedCount??0} existing leads linked. No contacts were created or emails sent.`});
    if(result.batch?.id)setLocation(`/leads/${encodeURIComponent(result.batch.id)}`);
  },onError:(error:Error)=>toast({title:"Could not save this search",description:error.message,variant:"destructive"})});
  const batchData=detail.data?.pages[0];
  const researchReviewFocusBatch=useRef<string|null>(null);
  useEffect(()=>{
    if(researchReviewFocusBatch.current!==id||view!=="researched")return;
    const target=document.getElementById("lead-candidates")?.querySelector<HTMLInputElement>("input");
    if(target){
      target.focus({preventScroll:true});
      researchReviewFocusBatch.current=null;
    }
  },[id,view,detail.data]);
  const researchProgress=batchData?.batch.researchProgress?.leadResearch;
  const summary=batchData?.researchSummary;
  const fullResearch=batchData?.batch.researchProgress?.fullResearch;
  const validResearchCaps=Boolean(estimate.data&&Number.isInteger(Number(rowLimit))&&Number(rowLimit)>=1&&Number(rowLimit)<=100&&Number(rowLimit)<=estimate.data.eligibleRows&&Number.isInteger(Number(calls))&&Number(calls)>=0&&Number(calls)<=estimate.data.maxProviderCalls);
  const visibleRows=detail.data?.pages.flatMap(page=>page.rows)??[];
  const reload=()=>queryClient.invalidateQueries({queryKey:["/api/leads",id]});
  return <div className="flex min-h-0 flex-1 flex-col overflow-y-auto"><Header title="Leads"/><main className="mx-auto w-full max-w-[1450px] space-y-6 p-4 sm:p-6 lg:p-8">
    {id?<>
      <Link href="/leads" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4"/>All saved lists</Link>
      {detail.isLoading?<div className="space-y-3"><div className="h-28 animate-pulse rounded-xl bg-muted"/><div className="h-40 animate-pulse rounded-xl bg-muted"/></div>:detail.isError?<Alert variant="destructive"><CircleAlert className="h-4 w-4"/><AlertTitle>Saved list unavailable</AlertTitle><AlertDescription>{(detail.error as Error).message}<Button className="ml-3" size="sm" variant="outline" onClick={()=>detail.refetch()}>Retry</Button></AlertDescription></Alert>:batchData&&<>
       <section className="relative overflow-hidden rounded-2xl border bg-card p-5 sm:p-7"><div className="absolute -right-12 -top-16 h-64 w-64 rounded-full border-[36px] border-primary/[0.06]"/><div className="relative flex flex-col justify-between gap-5 lg:flex-row lg:items-end"><div><p className="text-xs font-semibold uppercase tracking-[.15em] text-primary">Saved lead list · review before outreach</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">{batchData.batch.name}</h1><p className="mt-2 text-sm text-muted-foreground">{batchData.batch.fileName||"Lead list"} · {batchData.batch.totalRows.toLocaleString()} records · created {dateText(batchData.batch.createdAt)}</p></div><div className="flex flex-wrap gap-2"><Badge variant="secondary">{batchData.batch.status}</Badge></div></div></section>
          <section aria-labelledby="lead-process-title" className="rounded-2xl border-2 border-primary/20 bg-primary/[0.035] p-4 sm:p-6">
            <div className="flex flex-wrap items-end justify-between gap-2"><div><p className="text-xs font-semibold uppercase tracking-[.13em] text-primary">Your sales workflow</p><h2 id="lead-process-title" className="mt-1 text-xl font-semibold">What to do next</h2></div><p className="text-xs text-muted-foreground">Research does not approve email or add anyone to Contacts.</p></div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-lg border bg-card p-3"><p className="text-xs font-semibold uppercase tracking-wide text-primary">1 · Your upload</p><p className="mt-1 text-sm">You uploaded <b>{(summary?.uploaded??batchData.batch.totalRows).toLocaleString()}</b> businesses.</p><p className="mt-1 text-xs text-muted-foreground">{(summary?.notResearched??batchData.batch.totalRows).toLocaleString()} still have not been researched. Uploading alone is not a research result.</p></div>
              <div className="rounded-lg border bg-card p-3"><p className="text-xs font-semibold uppercase tracking-wide text-primary">2 · Research results</p><p className="mt-1 text-sm"><b>{(summary?.attempted??0).toLocaleString()}</b> businesses have been attempted: {(summary?.finished??0).toLocaleString()} finished, {(summary?.waiting??0).toLocaleString()} waiting, {(summary?.failed??0).toLocaleString()} failed.</p><p className="mt-1 text-xs text-muted-foreground">These are research outcomes, not emails. {summary?.emails??0} email suggestions found; a completed lookup may find none.</p></div>
              <div className="rounded-lg border bg-card p-3"><p className="text-xs font-semibold uppercase tracking-wide text-primary">3 · Your review</p><p className="mt-1 text-sm">These businesses still need review: <b>{(summary?.needsReview??0).toLocaleString()}</b> researched businesses.</p><p className="mt-1 text-xs text-muted-foreground">Check the source and salon suitability yourself. Only approve a real, source-backed business email.</p></div>
              <div className="rounded-lg border bg-card p-3"><p className="text-xs font-semibold uppercase tracking-wide text-primary">4 · Contacts</p><p className="mt-1 text-sm"><b>{(summary?.readyForContacts??0).toLocaleString()}</b> approved businesses are ready to add. <b>{(summary?.addedToContacts??0).toLocaleString()}</b> already added to Contacts.</p><p className="mt-1 text-xs text-muted-foreground">Approval and grooming eligibility are required first. Adding to Contacts never sends a message.</p></div>
            </div>
            <div className="mt-4 flex flex-col gap-3 rounded-lg border bg-card p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4">
              <div><p className="text-sm font-semibold">Next step</p>
                {summary&&summary.readyForContacts>0
                  ? <p className="mt-1 text-sm text-muted-foreground">Your reviewed businesses are ready. Open an approved lead and choose Add approved lead to Contacts.</p>
                  : summary&&summary.needsReview>0
                    ? <p className="mt-1 text-sm text-muted-foreground">Open the {summary.needsReview.toLocaleString()} researched businesses needing review. Confirm grooming suitability and inspect the source.{summary.emails===0?" No emails were found yet—find and save a source-backed business email before approval.":" Approve only an email that belongs to this exact business."}</p>
                  : fullResearch?.status==="paused"
                  ? <p className="mt-1 text-sm text-muted-foreground">Full Research is paused. To research more businesses, choose Resume in the Full Research controls and confirm there.</p>
                  : fullResearch?.status==="waiting_hourly"&&fullResearch.enabled
                    ? <p className="mt-1 text-sm text-muted-foreground">{fullResearch.waitReason==="provider_rate_limit"?"Full Research is waiting for a temporary provider rate limit and will retry automatically within your caps.":"Full Research is on an hourly schedule and continues automatically."} Review businesses already researched while it runs.</p>
                    : summary&&summary.attempted===0
                      ? <p className="mt-1 text-sm text-muted-foreground">No businesses have been researched yet. Review the limits below, then start only after your explicit in-app confirmation.</p>
                      : summary&&summary.needsReview===0&&summary.readyForContacts>0
                        ? <p className="mt-1 text-sm text-muted-foreground">Your reviewed businesses are ready. Add an approved lead to Contacts when you choose.</p>
                        : summary&&summary.finished>0&&summary.emails===0&&summary.waiting===0
                          ? <p className="mt-1 text-sm text-muted-foreground">No email suggestions were found. Inspect the researched businesses, confirm grooming suitability, and find a source-backed business email; do not approve an email that is not there.</p>
                          : summary&&summary.needsReview>0
                            ? <p className="mt-1 text-sm text-muted-foreground">Review the researched businesses next. Verify each source and email before approval.</p>
                            : <p className="mt-1 text-sm text-muted-foreground">Review the research limits below before starting. Research begins only after you confirm it in the app.</p>}
              </div>
              {summary&&summary.readyForContacts>0
                ? <Button variant="outline" className="shrink-0" onClick={()=>changeView("ready_for_contacts","lead-candidates")}>Show leads ready for Contacts</Button>
                : summary&&summary.needsReview>0
                  ? <Button className="shrink-0" onClick={()=>changeView("needs_review","lead-candidates")}>Show businesses needing review</Button>
                : fullResearch?.status==="paused"
                ? <Button variant="outline" className="shrink-0" onClick={()=>document.getElementById("full-research-controls")?.scrollIntoView({behavior:"smooth",block:"start"})}>Go to Resume controls</Button>
                : fullResearch?.status==="waiting_hourly"&&fullResearch.enabled
                  ? <Button variant="outline" className="shrink-0" onClick={()=>changeView("researched","lead-candidates")}>Review researched businesses</Button>
                  : summary&&summary.attempted===0
                    ? <Button variant="outline" className="shrink-0" onClick={()=>document.getElementById("full-research-controls")?.scrollIntoView({behavior:"smooth",block:"start"})}>Review research limits</Button>
                    : summary&&summary.needsReview===0&&summary.readyForContacts>0
                      ? <Button variant="outline" className="shrink-0" onClick={()=>changeView("ready_for_contacts","lead-candidates")}>Show leads ready for Contacts</Button>
                      : summary&&summary.finished>0&&summary.emails===0&&summary.waiting===0
                        ? <Button variant="outline" className="shrink-0" onClick={()=>changeView("researched","lead-candidates")}>Inspect researched businesses</Button>
                        : <Button variant="outline" className="shrink-0" onClick={()=>changeView("needs_review","lead-candidates")}>Show businesses needing review</Button>}
            </div>
            {fullResearch?.status==="paused"&&Boolean(summary?.needsReview||summary?.readyForContacts)&&<p className="mt-3 text-xs text-muted-foreground">Research is paused. You can review the saved results now. To research more businesses, use Resume below and confirm once; future hourly waits continue automatically.</p>}
          </section>
          <div id="full-research-controls"><FullResearchPanel key={batchData.batch.id} batch={batchData.batch} researchSummary={summary} onReview={()=>{if(view!=="researched")researchReviewFocusBatch.current=batchData.batch.id;changeView("researched","lead-candidates");}} readOnlyReason={estimate.data?.reason} busy={Boolean(estimate.data?.active||(batchData.batch.status==="running"&&!["running","waiting_hourly"].includes(batchData.batch.researchProgress?.fullResearch?.status??"")))} onChanged={async()=>{await Promise.all([queryClient.invalidateQueries({queryKey:["/api/leads",id]}),queryClient.invalidateQueries({queryKey:["/api/leads",id,"estimate"]}),queryClient.invalidateQueries({queryKey:["/api/leads"]})]);}}/></div>
         <section className="grid gap-4 lg:grid-cols-[1.15fr_.85fr]">
          {batchData.batch.researchProgress?.fullResearch?<Card><CardHeader><CardTitle className="text-base">Hourly Full Research is configured</CardTitle><p className="text-sm text-muted-foreground">Use the Full Research controls above to pause, resume or approve more requests. Its paid-request history is retained across every restart.</p></CardHeader></Card>:<Card><CardHeader><CardTitle className="text-base">Find contact details</CardTitle><p className="text-sm text-muted-foreground">Check the estimate and confirm the cap before research. Matched pages provide email and name evidence together; extra paid name searches require separate confirmation.</p></CardHeader><CardContent className="space-y-4">
            {estimate.isLoading?<div className="h-14 animate-pulse rounded bg-muted"/>:estimate.isError?<Alert variant="destructive"><AlertDescription>Current research estimate unavailable: {(estimate.error as Error).message}</AlertDescription></Alert>:estimate.data&&<div className="grid grid-cols-3 gap-2 rounded-lg bg-muted/50 p-3 text-sm"><div><b>{estimate.data.eligibleRows}</b><span className="block text-xs text-muted-foreground">eligible rows</span></div><div><b>{estimate.data.maxProviderCalls}</b><span className="block text-xs text-muted-foreground">provider-call cap</span></div><div><b>{estimate.data.active?"Active":"Idle"}</b><span className="block text-xs text-muted-foreground">shared research</span></div></div>}
            <div className="grid gap-3 sm:grid-cols-2"><div><Label>Row limit (maximum 100)</Label><Input type="number" min="1" max={Math.min(100,estimate.data?.eligibleRows||100)} value={rowLimit} onChange={e=>setRowLimit(e.target.value)}/></div><div><Label>Provider-call cap (up to {estimate.data?.maxProviderCalls??"—"})</Label><Input type="number" min="0" max={estimate.data?.maxProviderCalls??0} value={calls||String(estimate.data?.maxProviderCalls??0)} onChange={e=>setCalls(e.target.value)}/></div></div>
            {confirmResearch?<div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"><p className="font-semibold">Confirm bounded research</p><p className="mt-1 text-xs leading-5">Up to {rowLimit} rows and {calls||estimate.data?.maxProviderCalls||0} provider calls. Matched pages provide email and name evidence together. No extra paid name search, contact import, enrollment, or send will happen.</p><div className="mt-3 flex gap-2"><Button size="sm" disabled={research.isPending||!estimate.data||estimate.data.active||!validResearchCaps} onClick={()=>research.mutate()}>{research.isPending?"Starting…":"Confirm research"}</Button><Button size="sm" variant="outline" onClick={()=>setConfirmResearch(false)}>Cancel</Button></div></div>:!(batchData.batch.researchProgress?.fullResearch?.enabled&&batchData.batch.researchProgress.fullResearch.status==="waiting_hourly")&&<Button disabled={!estimate.data?.eligibleRows||estimate.data.active||estimate.isLoading} onClick={()=>{setResearchError("");setRowLimit(String(Math.min(100,estimate.data?.eligibleRows??100)));setCalls(String(estimate.data?.maxProviderCalls??0));setConfirmResearch(true)}}><Search className="mr-2 h-4 w-4"/>Review estimate & research</Button>}
            {researchError&&<Alert variant="destructive"><AlertDescription>{researchError}</AlertDescription></Alert>}
            {control.error&&<Alert variant="destructive"><AlertDescription>{(control.error as Error).message}</AlertDescription></Alert>}
            {researchProgress&&<div className="rounded-md border bg-muted/30 p-3"><p className="text-xs font-semibold">Shared research progress</p><div className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4"><span>Processed IDs · <b>{researchProgress.processedIds?.length??0}</b></span><span>Selected IDs · <b>{researchProgress.rowIds?.length??0}</b></span><span>Attempted calls · <b>{researchProgress.attemptedCalls??0}</b></span><span>Provider calls · <b>{researchProgress.providerCalls??0}</b></span><span>Cache hits · <b>{researchProgress.cacheHits??0}</b></span><span>Original cap · <b>{researchProgress.maxProviderCalls??0}</b></span></div><p className="mt-2 text-[11px] text-muted-foreground">Resume continues the paused operation within its existing cap; it does not request additional budget.</p></div>}
            {batchData.batch.status==="running"&&<Button variant="outline" size="sm" disabled={control.isPending} onClick={()=>control.mutate("pause")}>Pause research</Button>}
            {researchProgress&&!estimate.data?.active&&["running","paused","failed"].includes(batchData.batch.status)&&<Button variant="outline" size="sm" disabled={control.isPending} onClick={()=>{if(window.confirm("Recover interrupted work only after five minutes without progress? Retained provider attempts are not refunded. Recovery pauses the run; resume requires a separate confirmation."))control.mutate("recover");}}>Recover interrupted work</Button>}
            {batchData.batch.status==="paused"&&(confirmResume?<div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"><p className="font-semibold">Resume within the existing research cap?</p><p className="mt-1 text-xs">This continues the paused operation only; no additional provider-call budget is requested.</p><div className="mt-2 flex gap-2"><Button size="sm" disabled={control.isPending} onClick={()=>control.mutate("resume")}>Confirm resume</Button><Button size="sm" variant="outline" onClick={()=>setConfirmResume(false)}>Cancel</Button></div></div>:<Button variant="outline" size="sm" disabled={control.isPending} onClick={()=>setConfirmResume(true)}>Resume paused research</Button>)}
          </CardContent></Card>}
          <LeadWorkflowGuide/>
        </section>
        {batchData.linkedRows&&batchData.linkedRows.length>0&&<section className="rounded-xl border bg-muted/20 p-4"><h2 className="font-semibold">Rows linked to this list</h2><p className="mt-1 text-xs text-muted-foreground">These duplicate-only links remain attached to their original saved batch.</p><div className="mt-3 space-y-2">{batchData.linkedRows.map(link=><Link key={`${link.batchId}-${link.rowId}`} href={`/leads/${encodeURIComponent(link.batchId)}#lead-row-${encodeURIComponent(link.rowId)}`} className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-card p-3 text-sm hover:border-primary/50"><span>{link.businessName}</span><span className="inline-flex items-center gap-1 text-xs text-primary">Open original list <ArrowRight className="h-3 w-3"/></span></Link>)}</div></section>}
         <section id="lead-candidates" className="scroll-mt-5 space-y-3"><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><div><h2 className="text-xl font-semibold">Review businesses</h2><p className="text-sm text-muted-foreground">Check the source and identity. A research result is not automatically an email or approval.</p></div><div className="flex gap-2"><Input className="w-full sm:w-64" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search this list…"/><Select value={limit} onValueChange={setLimit}><SelectTrigger className="w-28"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="50">50 rows</SelectItem><SelectItem value="100">100 rows</SelectItem><SelectItem value="200">200 rows</SelectItem></SelectContent></Select></div></div>
           <div className="flex flex-col gap-3 rounded-xl border bg-muted/20 p-3 sm:flex-row sm:items-center sm:justify-between">
             <div className="flex flex-wrap gap-2" role="group" aria-label="Choose businesses to show">
               <Button size="sm" variant={view==="researched"?"default":"outline"} aria-pressed={view==="researched"} onClick={()=>changeView("researched","lead-candidates")}>Show researched businesses</Button>
               <Button size="sm" variant={view==="all"?"default":"outline"} aria-pressed={view==="all"} onClick={()=>changeView("all","lead-candidates")}>All uploaded businesses</Button>
               <Button size="sm" variant={view==="needs_review"?"default":"outline"} aria-pressed={view==="needs_review"} onClick={()=>changeView("needs_review","lead-candidates")}>Needs review{summary?` · ${summary.needsReview}`:""}</Button>
               <Button size="sm" variant={view==="ready_for_contacts"?"default":"outline"} aria-pressed={view==="ready_for_contacts"} onClick={()=>changeView("ready_for_contacts","lead-candidates")}>Ready for Contacts{summary?` · ${summary.readyForContacts}`:""}</Button>
             </div>
             <p className="text-xs text-muted-foreground">{batchData.total.toLocaleString()} {view==="all"?"businesses in this list":view==="researched"?"businesses attempted, including waiting and failed":view==="needs_review"?"researched businesses awaiting review":"approved businesses ready to add to Contacts"}</p>
           </div>
           {visibleRows.length?visibleRows.map(row=><LeadRowCard key={row.id} row={row} onRefresh={reload}/>):<div className="rounded-xl border border-dashed p-10 text-center"><ListChecks className="mx-auto h-8 w-8 text-muted-foreground"/><p className="mt-3 font-medium">No businesses in this view yet</p><p className="text-sm text-muted-foreground">{view==="researched"?"No research attempts are available to review yet.":view==="needs_review"?"No researched businesses are waiting for your review.":view==="ready_for_contacts"?"No approved businesses are ready for Contacts yet.":"Try another search or check the batch again."}</p></div>}
          {detail.hasNextPage&&<Button variant="outline" disabled={detail.isFetchingNextPage} onClick={()=>detail.fetchNextPage()}>{detail.isFetchingNextPage?"Loading more…":"Load more candidates"}</Button>}
        </section>
      </>}
    </>:<>
      <section className="relative overflow-hidden rounded-2xl border bg-card p-6 sm:p-9"><div className="absolute -right-10 -top-20 h-72 w-72 rounded-full border-[42px] border-primary/[0.06]"/><div className="relative max-w-3xl"><p className="inline-flex items-center gap-2 rounded-full border bg-primary/[0.05] px-3 py-1 text-xs font-semibold uppercase tracking-[.14em] text-primary"><Building2 className="h-3.5 w-3.5"/>Leads workspace</p><h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">Start with a business.<br className="hidden sm:block"/> Keep every decision in view.</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">Search for businesses or bring your own list. Find contact details, inspect evidence, then choose what enters Contacts and Pipeline. Scheduling stays separate.</p><div className="mt-5 flex flex-wrap gap-3"><Link href="/leads/search" className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"><Search className="mr-2 h-4 w-4"/>Search for Businesses</Link><a href="#upload-list" className="inline-flex h-10 items-center rounded-md border px-4 text-sm font-medium hover:bg-muted"><Upload className="mr-2 h-4 w-4"/>Upload a List</a></div><p className="mt-3 text-xs text-muted-foreground">Search opens the existing business discovery workspace. Completed searches can be staged here for unified review.</p></div></section>
      <section className="grid gap-3 rounded-xl border bg-muted/30 p-4 sm:grid-cols-4">{["Add Leads","Find Contact Details","Review","Add to CRM"].map((item,i)=><div key={item} className="flex gap-3 rounded-lg bg-card p-3"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{i+1}</span><span><b className="text-sm">{item}</b><span className="mt-1 block text-xs leading-5 text-muted-foreground">{["Search or upload a source list.","Research starts only after cap confirmation.","Approve source-backed evidence explicitly.","Contacts are records; Pipeline tracks sales."][i]}</span></span></div>)}</section>
      <section id="upload-list"><UploadPanel onDone={batchId=>{window.location.href=`/leads/${encodeURIComponent(batchId)}`;}}/></section>
      <section className="space-y-3"><div className="flex items-end justify-between"><div><h2 className="text-xl font-semibold">Saved lists</h2><p className="text-sm text-muted-foreground">A single review queue for uploaded and researched candidates.</p></div><Badge variant="outline">{batches.data?.length??0} lists</Badge></div>
        {batches.isLoading?<div className="grid gap-3 sm:grid-cols-2"><div className="h-24 animate-pulse rounded-xl bg-muted"/><div className="h-24 animate-pulse rounded-xl bg-muted"/></div>:batches.isError?<Alert variant="destructive"><CircleAlert className="h-4 w-4"/><AlertTitle>Saved lists could not load</AlertTitle><AlertDescription>{(batches.error as Error).message}<Button className="ml-3" size="sm" variant="outline" onClick={()=>batches.refetch()}>Retry</Button></AlertDescription></Alert>:batches.data?.length?<div className="grid gap-3 sm:grid-cols-2">{batches.data.map(batch=><Link key={batch.id} href={`/leads/${encodeURIComponent(batch.id)}`} className="group rounded-xl border bg-card p-4 transition-colors hover:border-primary/50"><div className="flex items-start justify-between gap-3"><div><h3 className="font-semibold group-hover:text-primary">{batch.name}</h3><p className="mt-1 text-xs text-muted-foreground">{batch.fileName||"Saved list"} · {dateText(batch.createdAt)}</p></div><Badge variant="secondary">{batch.status}</Badge></div><div className="mt-4 flex items-center justify-between border-t pt-3 text-sm"><span>{batch.totalRows.toLocaleString()} candidates</span><span className="inline-flex items-center text-primary">Review list <ArrowRight className="ml-1 h-4 w-4"/></span></div></Link>)}</div>:<div className="rounded-xl border border-dashed p-8 text-center"><ListChecks className="mx-auto h-8 w-8 text-muted-foreground"/><p className="mt-3 font-medium">Your saved lists will live here</p><p className="mt-1 text-sm text-muted-foreground">Search for businesses or upload your first list. Nothing is created until you choose.</p></div>}
      </section>
      <section className="space-y-3"><div><h2 className="text-xl font-semibold">Completed business searches</h2><p className="text-sm text-muted-foreground">Stage a completed discovery job into the unified Leads review. This does not start another search.</p></div>
        {jobs.isError||national.isError?<Alert variant="destructive"><AlertDescription>Discovery job status unavailable. {(jobs.error as Error)?.message||(national.error as Error)?.message}</AlertDescription></Alert>:null}
        <p className="text-xs text-muted-foreground">These are past search runs, not individual businesses. Saving reuses their stored results; it does not run or pay for another search. Nationwide runs include the state searches shown underneath.</p>
        {stageJob.isError&&<Alert variant="destructive" role="alert"><AlertTitle>Search could not be saved</AlertTitle><AlertDescription>{stageJob.error.message}</AlertDescription></Alert>}
        <CompletedSearches jobs={jobs.data??[]} nationalJobs={national.data??[]} disabled={stageJob.isPending} savingId={stageJob.isPending?stageJob.variables:undefined} onSave={jobId=>stageJob.mutate(jobId)} />
        {stageJob.error&&<Alert variant="destructive"><AlertDescription>{(stageJob.error as Error).message}</AlertDescription></Alert>}
        <Link href="/lead-discovery" className="inline-flex items-center gap-1 text-sm text-primary underline-offset-4 hover:underline">Open Business Search <ArrowRight className="h-4 w-4"/></Link>
      </section>
    </>}
  </main></div>;
}