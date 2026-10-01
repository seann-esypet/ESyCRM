import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";
import * as XLSX from "xlsx";
import Papa from "papaparse";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import Header from "@/components/layout/header";
import { SalonFormOutreachPanel } from "@/components/salon-form-outreach-panel";
import { OwnerNameReview, OwnerSearchEstimate } from "@/components/owner-name-review";
import type { OwnerNameResult } from "@shared/salonOwnerName";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Upload, ArrowLeft, Play, Pause, Square, Search, RefreshCw, Check, X, RotateCcw, ShieldCheck, FileSpreadsheet, AlertTriangle, ExternalLink } from "lucide-react";

type Batch = { id: string; name: string; fileName: string; status: string; totalRows: number; pilotLimit: number; processedRows: number; enrichedRows: number; needsReviewRows: number; reviewRows?: number; approvedRows: number; importedRows: number; estimatedSerpCalls: number; usedSerpCalls: number; concurrency: number; errorMessage?: string; createdAt: string };
type Row = { id: string; rowNumber: number; businessName: string; placeId?: string; address?: string; address1?: string; city?: string; state?: string; zipCode?: string; latitude?: number; longitude?: number; businessStatus?: string; status?: string; identityMatchStatus?: string; reviewStatus?: string; websiteUrl?: string; email?: string; phone?: string; contactRequestFormUrl?: string; contactFormStatus?: string; bookingUrl?: string; currentSoftware?: string; usesSoftware?: string; audienceTrack?: string; category?: string; ownerName?: OwnerNameResult | null; contactName?: { firstName?: string | null; lastName?: string | null; useBusinessNameForEmail?: "Yes" | "No" | null } | null; emailVerified?: boolean; evidence?: unknown; confidence?: unknown; duplicateMetadata?: { contactIds?: string[] }; lastError?: string; importedContactId?: string; sourceData?: Record<string, unknown> };

const columns = ["businessName", "placeId", "address", "address1", "city", "state", "zipCode", "latitude", "longitude", "businessStatus"];
const aliases: Record<string, string[]> = {
  businessName: ["businessName", "company", "varLocationName"], placeId: ["placeId", "googlePlaceId", "GooglePlaceID"],
  address: ["address", "FormattedAddress"], address1: ["address1", "varLocationAddress1"], city: ["city", "varLocationCity"],
  state: ["state", "varLocationState"], zipCode: ["zipCode", "zip", "varLocationZip"], latitude: ["latitude", "Latitude"],
  longitude: ["longitude", "Longitude"], businessStatus: ["businessStatus", "Business Status"],
};
const statusTone: Record<string, string> = { running: "bg-emerald-100 text-emerald-800", completed: "bg-blue-100 text-blue-800", paused: "bg-amber-100 text-amber-800", cancelled: "bg-slate-100 text-slate-700", failed: "bg-red-100 text-red-800", pending: "bg-slate-100 text-slate-700" };

function readFile(file: File): Promise<Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    if (file.name.toLowerCase().endsWith(".csv")) {
      Papa.parse<Record<string, unknown>>(file, { header: true, skipEmptyLines: true, complete: r => resolve(r.data), error: reject });
      return;
    }
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const book = XLSX.read(e.target?.result, { type: "array" });
        const sheet = book.Sheets[book.SheetNames[0]];
        resolve(XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" }));
      } catch (error) { reject(error); }
    };
    reader.onerror = () => reject(new Error("Could not read this file"));
    reader.readAsArrayBuffer(file);
  });
}

type NormalizedUploadRow = Record<string, unknown> & {
  rowNumber: number;
  sourceData: Record<string, unknown>;
};

function normalizeRows(rows: Record<string, unknown>[], mapping: Record<string, string>): NormalizedUploadRow[] {
  return rows.map((row, index) => ({
    rowNumber: index + 2,
    sourceData: row,
    ...Object.fromEntries(columns.map(key => [key, String(row[mapping[key]] ?? "").trim()])),
  }));
}

function prettyObject(value: unknown): string {
  if (!value) return "—";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(v => prettyObject(v)).join(" · ");
  if (typeof value === "object") return Object.entries(value as Record<string, unknown>).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`).join(" · ");
  return String(value);
}

function hasImportableEmailEvidence(row: Row): boolean {
  const emailEvidence = (row.evidence as { email?: { source?: string; confidence?: string; value?: string; sourceUrl?: string } } | null)?.email;
  const websiteEmail = emailEvidence?.source === "website" && emailEvidence.confidence === "high" &&
    Boolean(row.websiteUrl && emailEvidence.sourceUrl === row.websiteUrl);
  const bookingEmail = emailEvidence?.source === "booking_page" && emailEvidence.confidence === "medium" &&
    Boolean(row.bookingUrl && emailEvidence.sourceUrl === row.bookingUrl);
  const fallbackEmail = emailEvidence?.source === "serp_fallback_website" && emailEvidence.confidence === "medium" &&
    Boolean(emailEvidence.sourceUrl?.startsWith("https://") && emailEvidence.sourceUrl !== row.bookingUrl);
  return Boolean(
    row.email &&
    row.identityMatchStatus === "strong" &&
    row.reviewStatus === "approved" &&
    (websiteEmail || fallbackEmail || bookingEmail) &&
    emailEvidence.value?.trim().toLowerCase() === row.email.trim().toLowerCase(),
  );
}

export default function SalonEnrichment() {
  const { id } = useParams<{ id?: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [rawRows, setRawRows] = useState<Record<string, unknown>[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [name, setName] = useState("");
  const [pilotLimit, setPilotLimit] = useState("100");
  const [concurrency, setConcurrency] = useState("2");
  const [search, setSearch] = useState("");
  const [rowStatus, setRowStatus] = useState("all");
  const [reviewStatus, setReviewStatus] = useState("all");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [includeOwnerNames, setIncludeOwnerNames] = useState(false);
  const [ownerSelectedIds, setOwnerSelectedIds] = useState<string[]>([]);
  const [ownerEstimate, setOwnerEstimate] = useState<OwnerSearchEstimate | null>(null);
  const [confirmOwnerBatch, setConfirmOwnerBatch] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const isDetail = Boolean(id);

  const batchesQuery = useQuery<Batch[]>({ queryKey: ["/api/salon-enrichment/batches"], enabled: !isDetail, select: data => data.map(item => ({ ...item, reviewRows: item.needsReviewRows })) });
  const batchQuery = useQuery<Batch>({ queryKey: ["/api/salon-enrichment/batches", id], enabled: isDetail });
  const rowsQuery = useQuery<Row[]>({
    queryKey: ["/api/salon-enrichment/batches", id, "rows", rowStatus, reviewStatus, search, page],
    enabled: isDetail,
    queryFn: async () => {
      const qs = new URLSearchParams();
      if (rowStatus !== "all") qs.set("status", rowStatus);
      if (reviewStatus !== "all") qs.set("reviewStatus", reviewStatus);
      if (search) qs.set("search", search);
      qs.set("limit", "100");
      qs.set("offset", String(page * 100));
      const res = await apiRequest("GET", `/api/salon-enrichment/batches/${id}/rows?${qs}`);
      const records: Row[] = await res.json();
      return records.map(row => ({ ...row, emailVerified: hasImportableEmailEvidence(row) }));
    },
    refetchInterval: batchQuery.data?.status === "running" ? 4000 : false,
  });
  const batch = batchQuery.data ? ({ ...batchQuery.data, reviewRows: batchQuery.data.needsReviewRows } as Batch & { reviewRows: number }) : undefined;
  const rows = rowsQuery.data ?? [];
  const headers = useMemo(() => Object.keys(rawRows[0] ?? {}), [rawRows]);
  const rejectedCount = useMemo(() => rawRows.filter(row => !String(row[mapping.businessName] ?? "").trim()).length, [rawRows, mapping.businessName]);
  const duplicatePlaceIdCount = useMemo(() => {
    if (!mapping.placeId) return 0;
    const seen = new Set<string>();
    let duplicates = 0;
    for (const row of rawRows) {
      const placeId = String(row[mapping.placeId] ?? "").trim().toLowerCase();
      if (!placeId) continue;
      if (seen.has(placeId)) duplicates++;
      else seen.add(placeId);
    }
    return duplicates;
  }, [rawRows, mapping.placeId]);
  useEffect(() => setPage(0), [rowStatus, reviewStatus, search]);
  useEffect(() => {
    if (batch?.status !== "running") return;
    const timer = window.setInterval(() => { batchQuery.refetch(); rowsQuery.refetch(); }, 4000);
    return () => window.clearInterval(timer);
  }, [batch?.status, batchQuery.refetch, rowsQuery.refetch]);

  useEffect(() => {
    if (!file || rawRows.length) return;
    readFile(file).then(parsed => {
      setRawRows(parsed);
      const keys = Object.keys(parsed[0] ?? {});
      const next: Record<string, string> = {};
      columns.forEach(column => { next[column] = keys.find(k => aliases[column].some(alias => k.toLowerCase().replace(/[\s_-]/g, "") === alias.toLowerCase().replace(/[\s_-]/g, ""))) ?? ""; });
      setMapping(next);
    }).catch(error => toast({ title: "File could not be parsed", description: error.message, variant: "destructive" }));
  }, [file, rawRows.length, toast]);

  const create = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/salon-enrichment/batches", { name: name.trim() || file?.name || "Salon list", fileName: file?.name, pilotLimit: Number(pilotLimit), concurrency: Math.min(10, Math.max(1, Number(concurrency))), includeOwnerNames, rows: normalizeRows(rawRows, mapping).filter(row => String(row.businessName ?? "").trim()), columnMapping: mapping })).json(),
    onSuccess: data => { queryClient.invalidateQueries({ queryKey: ["/api/salon-enrichment/batches"] }); setLocation(`/salon-enrichment/${data.id}`); toast({ title: "Batch created", description: "Your pilot is ready to run." }); },
    onError: (e: Error) => toast({ title: "Batch creation failed", description: e.message, variant: "destructive" }),
  });
  const action = useMutation({
    mutationFn: async ({ action: actionName, body }: { action: string; body?: unknown }) => (await apiRequest("POST", `/api/salon-enrichment/batches/${id}/${actionName}`, body)).json(),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/salon-enrichment/batches", id] }); queryClient.invalidateQueries({ queryKey: ["/api/salon-enrichment/batches", id, "rows"] }); },
    onError: (e: Error) => toast({ title: "Action failed", description: e.message, variant: "destructive" }),
  });
  const patch = useMutation({
    mutationFn: async (row: Row) => (await apiRequest("PATCH", `/api/salon-enrichment/rows/${row.id}`, Object.fromEntries(["email", "phone", "websiteUrl", "contactRequestFormUrl", "bookingUrl", "currentSoftware", "usesSoftware", "audienceTrack"].map(key => [key, row[key as keyof Row]])))).json(),
    onSuccess: () => { setEditing(null); queryClient.invalidateQueries({ queryKey: ["/api/salon-enrichment/batches", id, "rows"] }); queryClient.invalidateQueries({ queryKey: ["/api/salon-form-outreach", id] }); toast({ title: "Row updated" }); },
    onError: (e: Error) => toast({ title: "Could not save row", description: e.message, variant: "destructive" }),
  });
  const reviewForm = useMutation({
    mutationFn: async ({ row, contactFormStatus }: { row: Row; contactFormStatus: "verified" | "unusable" }) =>
      (await apiRequest("PATCH", `/api/salon-enrichment/rows/${row.id}`, { contactFormStatus })).json(),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/salon-enrichment/batches", id, "rows"] }); toast({ title: "Contact-form review saved" }); },
    onError: (e: Error) => toast({ title: "Could not review form", description: e.message, variant: "destructive" }),
  });
  const estimateOwnerBatch = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/salon-owner-names/estimate", { rowIds: ownerSelectedIds })).json() as Promise<OwnerSearchEstimate>,
    onSuccess: data => { setOwnerEstimate(data); setConfirmOwnerBatch(true); },
    onError: (error: Error) => toast({ title: "Could not estimate owner lookup", description: error.message, variant: "destructive" }),
  });
  const searchOwnerBatch = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/salon-owner-names/search", { rowIds: ownerSelectedIds, maxProviderCalls: Math.min(ownerSelectedIds.length, ownerEstimate?.maxProviderCalls ?? ownerSelectedIds.length), confirmed: true })).json(),
    onSuccess: () => { setOwnerSelectedIds([]); setOwnerEstimate(null); setConfirmOwnerBatch(false); queryClient.invalidateQueries({ queryKey: ["/api/salon-enrichment/batches", id, "rows"] }); toast({ title: "Owner searches complete" }); },
    onError: (error: Error) => toast({ title: "Owner search failed", description: error.message, variant: "destructive" }),
  });

  if (!isDetail) return (
    <div className="flex-1 overflow-y-auto"><Header title="Salon Enrichment" /><main className="p-6 max-w-[1400px] mx-auto space-y-6">
       <div className="flex justify-between items-end"><div><p className="text-xs font-semibold tracking-[0.16em] uppercase text-muted-foreground">Salon contact enrichment</p><h1 className="text-2xl font-semibold mt-1">Upload and crawl your salon list</h1><p className="text-sm text-muted-foreground mt-1">Start with 100 salons. We look for contact details on business websites and keep source evidence for your review.</p></div><Button onClick={() => fileRef.current?.click()}><Upload className="h-4 w-4 mr-2" />Choose CSV or Excel</Button></div>
      <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={e => { const picked = e.target.files?.[0]; if (picked) { setFile(picked); setRawRows([]); } }} />
       {file && rawRows.length > 0 && <p className="text-sm text-muted-foreground">Creating a batch saves the source rows but does not start lookups. Starting the pilot uses external lookup credits, then crawls business websites. You approve imports separately.</p>}
       {file && rawRows.length > 0 && duplicatePlaceIdCount > 0 && <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950 flex items-start gap-2"><AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" /><span>{duplicatePlaceIdCount.toLocaleString()} repeated Place IDs in this file. Their source rows stay visible for review; importing a Place ID more than once is blocked.</span></div>}
       {file && rawRows.length > 0 && <Card className="border-primary/30"><CardHeader><CardTitle className="text-base flex items-center gap-2"><FileSpreadsheet className="h-4 w-4 text-primary" />{file.name} <Badge variant="secondary">{rawRows.length.toLocaleString()} rows</Badge>{rejectedCount > 0 && <Badge variant="destructive">{rejectedCount} rejected: missing business name</Badge>}</CardTitle></CardHeader><CardContent className="space-y-5"><div className="grid grid-cols-1 md:grid-cols-4 gap-4"><div className="md:col-span-2"><Label>Batch name</Label><Input value={name} onChange={e => setName(e.target.value)} placeholder="Austin salons — Q2 pilot" /></div><div><Label>Pilot limit</Label><Input type="number" min="1" value={pilotLimit} onChange={e => setPilotLimit(e.target.value)} /></div><div><Label>Concurrency (1–10)</Label><Input type="number" min="1" max="10" value={concurrency} onChange={e => setConcurrency(e.target.value)} /></div></div><label className="flex cursor-pointer items-start gap-3 rounded-md border border-primary/20 bg-primary/[0.025] p-3"><Checkbox checked={includeOwnerNames} onCheckedChange={value => setIncludeOwnerNames(value === true)} /><span className="text-sm"><span className="font-medium">Include optional owner-name lookup</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">Opt in to up to one additional paid owner search per eligible salon, plus bounded page fetches. No owner lookups run on the existing flow unless selected here.</span></span></label><div><div className="flex items-center justify-between mb-2"><div><Label>Column mapping</Label><p className="text-xs text-muted-foreground">Business name is required. Original source rows are preserved.</p></div><Badge variant="outline">{headers.length} source columns detected</Badge></div><div className="grid grid-cols-2 md:grid-cols-4 gap-3">{columns.map(column => <div key={column}><Label className="text-xs capitalize">{column === "zipCode" ? "ZIP code" : column}</Label><Select value={mapping[column] || "none"} onValueChange={v => setMapping(m => ({ ...m, [column]: v === "none" ? "" : v }))}><SelectTrigger className="h-9"><SelectValue placeholder="Not mapped" /></SelectTrigger><SelectContent><SelectItem value="none">Not mapped</SelectItem>{headers.map(header => <SelectItem key={header} value={header}>{header}</SelectItem>)}</SelectContent></Select></div>)}</div></div><div className="rounded-md border bg-muted/30 overflow-auto"><table className="w-full text-xs"><thead><tr>{columns.slice(0, 5).map(c => <th key={c} className="text-left p-2 font-medium">{c}</th>)}</tr></thead><tbody>{normalizeRows(rawRows.slice(0, 4), mapping).map((r, i) => <tr key={i} className="border-t">{columns.slice(0, 5).map(c => <td key={c} className="p-2 max-w-[180px] truncate">{prettyObject(r[c])}</td>)}</tr>)}</tbody></table></div><div className="flex justify-end gap-2"><Button variant="outline" onClick={() => { setFile(null); setRawRows([]); }}>Choose another</Button><Button disabled={!mapping.businessName || rejectedCount === rawRows.length || create.isPending} onClick={() => create.mutate()}>{create.isPending ? "Creating…" : "Create enrichment batch"}</Button></div></CardContent></Card>}
      {!file && <Card className="border-dashed"><CardContent className="py-14 text-center"><Upload className="h-8 w-8 mx-auto text-muted-foreground mb-3" /><p className="font-medium">Upload CSV or XLSX to begin</p><p className="text-sm text-muted-foreground mt-1">Browser-parsed locally before anything is sent. No auto-enrollment.</p><Button variant="outline" className="mt-4" onClick={() => fileRef.current?.click()}>Select file</Button></CardContent></Card>}
      <section><div className="flex items-center justify-between mb-3"><h2 className="font-semibold">Recent batches</h2><span className="text-xs text-muted-foreground">{batchesQuery.data?.length ?? 0} batches</span></div>{batchesQuery.isLoading ? <div className="h-20 rounded bg-muted animate-pulse" /> : <div className="space-y-2">{(batchesQuery.data ?? []).map(item => <button key={item.id} onClick={() => setLocation(`/salon-enrichment/${item.id}`)} className="w-full text-left border rounded-lg p-4 bg-card hover:border-primary/50 transition-colors"><div className="flex items-center justify-between"><div><p className="font-medium">{item.name}</p><p className="text-xs text-muted-foreground mt-1">{item.fileName} · {new Date(item.createdAt).toLocaleString()}</p></div><Badge className={statusTone[item.status] ?? ""}>{item.status}</Badge></div><div className="grid grid-cols-4 gap-4 mt-4 text-xs"><span><b>{item.totalRows}</b> rows</span><span><b>{item.enrichedRows}</b> enriched</span><span><b>{item.reviewRows}</b> to review</span><span><b>{item.importedRows}</b> imported</span></div></button>)}{!batchesQuery.data?.length && <p className="text-sm text-muted-foreground border rounded-lg p-8 text-center">No batches yet. Upload your first salon list.</p>}</div>}</section>
    </main></div>
  );

  const progress = batch?.totalRows ? ((batch.processedRows ?? 0) / batch.totalRows) * 100 : 0;
  const run = (actionName: string) => {
    const body = actionName === "resume" && batch && batch.processedRows >= batch.pilotLimit && batch.pilotLimit < batch.totalRows
      ? { pilotLimit: Math.min(batch.totalRows, batch.pilotLimit + 100) }
      : undefined;
    action.mutate({ action: actionName, body });
  };
  const review = (decision: string) => action.mutate({ action: "rows/review", body: { rowIds: selected, decision } });
  const canSelect = rows.filter(r => !r.importedContactId).map(r => r.id);
  const canApprove = selected.length > 0 && selected.every(rowId => {
    const row = rows.find(item => item.id === rowId);
    return row?.status === "enriched" && row.identityMatchStatus === "strong";
  });
  return <div className="flex-1 overflow-y-auto"><Header title="Salon Enrichment" /><main className="p-6 max-w-[1600px] mx-auto space-y-5">
    <button className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1" onClick={() => setLocation("/salon-enrichment")}><ArrowLeft className="h-4 w-4" />All batches</button>
      {batch && <><div className="flex flex-wrap justify-between gap-4"><div><div className="flex items-center gap-3"><h1 className="text-2xl font-semibold">{batch.name}</h1><Badge className={statusTone[batch.status] ?? ""}>{batch.status}</Badge></div><p className="text-sm text-muted-foreground mt-1">{batch.fileName} · pilot cap {batch.pilotLimit} · concurrency {batch.concurrency}</p></div><div className="flex gap-2">{["pending", "paused"].includes(batch.status) && <Button onClick={() => run(batch.status === "paused" ? "resume" : "start")}><Play className="h-4 w-4 mr-1.5" />{batch.status === "paused" && batch.processedRows >= batch.pilotLimit && batch.pilotLimit < batch.totalRows ? "Run next 100" : batch.status === "paused" ? "Resume" : "Start pilot"}</Button>}{batch.status === "running" && <Button variant="outline" onClick={() => run("pause")}><Pause className="h-4 w-4 mr-1.5" />Pause</Button>}{["running", "paused"].includes(batch.status) && <Button variant="outline" onClick={() => run("cancel")}><Square className="h-4 w-4 mr-1.5" />Cancel</Button>}</div></div>
      <Card><CardContent className="p-4"><div className="flex justify-between text-sm mb-2"><span className="font-medium">Processing progress</span><span>{batch.processedRows ?? 0} / {batch.totalRows} rows</span></div><Progress value={progress} className="h-2" /><div className="grid grid-cols-2 md:grid-cols-5 gap-4 mt-4 text-xs"><span><b className="text-foreground">{batch.enrichedRows ?? 0}</b> enriched</span><span><b className="text-foreground">{batch.reviewRows ?? 0}</b> need review</span><span><b className="text-foreground">{batch.approvedRows ?? 0}</b> approved</span><span><b className="text-foreground">{batch.estimatedSerpCalls ?? 0}</b> SERP est. / <b>{batch.usedSerpCalls ?? 0}</b> used</span><span><b className="text-foreground">{batch.importedRows ?? 0}</b> imported</span></div>{batch.errorMessage && <p className="text-sm text-red-700 mt-3 flex gap-2"><AlertTriangle className="h-4 w-4" />{batch.errorMessage}</p>}</CardContent></Card>
       <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950 flex gap-2"><ShieldCheck className="h-4 w-4 mt-0.5 shrink-0" /><span><b>Email-first lookup:</b> a phone number or booking link does not end the email search. A missing email may require one extra provider lookup, subject to the hourly and monthly limits. Emails found on a salon website, a matched alternate website, or a salon-matched booking page need your review and approval before import. Booking-service support addresses are excluded; importing never auto-enrolls contacts.</span></div>
       <SalonFormOutreachPanel batchId={id!} rows={rows} />
       <div className="flex flex-wrap gap-2 items-center"><div className="relative flex-1 min-w-[220px] max-w-sm"><Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" /><Input className="pl-8" placeholder="Search business, city, email…" value={search} onChange={e => setSearch(e.target.value)} /></div><Select value={rowStatus} onValueChange={setRowStatus}><SelectTrigger className="w-36"><SelectValue /></SelectTrigger><SelectContent>{["all", "pending", "processing", "enriched", "failed"].map(v => <SelectItem key={v} value={v}>{v === "all" ? "All statuses" : v}</SelectItem>)}</SelectContent></Select><Select value={reviewStatus} onValueChange={setReviewStatus}><SelectTrigger className="w-36"><SelectValue /></SelectTrigger><SelectContent>{["all", "pending", "needs_review", "approved", "rejected"].map(v => <SelectItem key={v} value={v}>{v === "all" ? "All review" : v}</SelectItem>)}</SelectContent></Select><Button variant="ghost" size="icon" onClick={() => { batchQuery.refetch(); rowsQuery.refetch(); }}><RefreshCw className="h-4 w-4" /></Button><div className="ml-auto flex items-center gap-2"><Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(value => value - 1)}>Previous</Button><span className="text-xs text-muted-foreground">Page {page + 1}</span><Button variant="outline" size="sm" disabled={rows.length < 100} onClick={() => setPage(value => value + 1)}>Next</Button></div></div>
       <div className="flex flex-wrap items-center gap-2 border-y py-3"><Checkbox checked={selected.length > 0 && selected.length === canSelect.length} onCheckedChange={checked => setSelected(checked ? canSelect : [])} /><span className="text-sm text-muted-foreground">{selected.length} selected</span><Button size="sm" variant="outline" disabled={!canApprove} onClick={() => review("approved")}><Check className="h-3.5 w-3.5 mr-1" />Approve matched</Button><Button size="sm" variant="outline" disabled={!selected.length} onClick={() => review("rejected")}><X className="h-3.5 w-3.5 mr-1" />Reject</Button><Button size="sm" variant="outline" disabled={!selected.length} onClick={() => action.mutate({ action: "rows/retry", body: { rowIds: selected } })}><RotateCcw className="h-3.5 w-3.5 mr-1" />Retry</Button><Button size="sm" className="ml-auto" disabled={!canApprove || selected.some(rowId => rows.find(r => r.id === rowId)?.reviewStatus !== "approved")} onClick={() => action.mutate({ action: "import", body: { rowIds: selected } })}>Import approved</Button></div>
        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-card p-3">
          <span className="text-sm font-medium">Owner-name batch</span><span className="text-xs text-muted-foreground">{ownerSelectedIds.length}/5 selected</span>
          <Button size="sm" variant="outline" className="ml-auto" disabled={!ownerSelectedIds.length || estimateOwnerBatch.isPending} onClick={() => estimateOwnerBatch.mutate()}>{estimateOwnerBatch.isPending ? "Estimating…" : "Estimate selected search"}</Button>
          {ownerSelectedIds.length > 0 && <Button size="sm" variant="ghost" onClick={() => setOwnerSelectedIds([])}>Clear</Button>}
        </div>
        {confirmOwnerBatch && ownerEstimate && <div className="rounded-md border border-amber-300/70 bg-amber-50 p-3 text-sm text-amber-950">
          <p className="font-semibold">Confirm paid owner lookup for {ownerSelectedIds.length} salons</p><p className="mt-1 text-xs">Up to {ownerEstimate.maxProviderCalls} provider calls and {ownerEstimate.maxPages} page fetches · {ownerEstimate.remainingCredits} credits remain{ownerEstimate.reason ? ` · ${ownerEstimate.reason}` : ""}.</p>
          <div className="mt-2 flex gap-2"><Button size="sm" disabled={!ownerEstimate.allowed || searchOwnerBatch.isPending} onClick={() => searchOwnerBatch.mutate()}>{searchOwnerBatch.isPending ? "Searching…" : "Confirm searches"}</Button><Button size="sm" variant="outline" onClick={() => { setConfirmOwnerBatch(false); setOwnerEstimate(null); }}>Cancel</Button></div>
        </div>}
        <div className="border rounded-lg overflow-auto"><table className="w-full text-xs min-w-[1350px]">
          <thead className="bg-muted/60"><tr>{["", "Row / business", "Location", "Contact", "Usable Contact Form", "Software", "Evidence", "Confidence", "Owner name", "Review", ""].map((h, i) => <th key={i} className="text-left font-medium p-3 whitespace-nowrap">{h}</th>)}</tr></thead>
          <tbody>{rowsQuery.isLoading ? <tr><td colSpan={11} className="p-10 text-center text-muted-foreground">Loading enrichment rows…</td></tr> : rows.map(row =>
           <tr key={row.id} className="border-t hover:bg-muted/20">
             <td className="p-3"><Checkbox disabled={!!row.importedContactId} checked={selected.includes(row.id)} onCheckedChange={checked => setSelected(s => checked ? [...s, row.id] : s.filter(x => x !== row.id))} /></td>
             <td className="p-3"><div className="font-medium">{row.businessName || "Unnamed business"}</div><div className="text-muted-foreground">#{row.rowNumber} {Boolean(row.duplicateMetadata && Object.keys(row.duplicateMetadata as object).length) && <span className="text-amber-700 ml-1">Duplicate warning</span>}</div></td>
             <td className="p-3">{[row.city, row.state, row.zipCode].filter(Boolean).join(", ") || "—"}<div className="text-muted-foreground max-w-[180px] truncate">{row.address || row.address1}</div></td>
             <td className="p-3"><div>{row.email || "—"} {String(row.emailVerified) === "true" && <ShieldCheck className="inline h-3 w-3 text-emerald-600" />}</div><div>{row.phone || "—"}</div>{row.websiteUrl && <a className="text-primary inline-flex gap-1" href={row.websiteUrl} target="_blank" rel="noreferrer">Website <ExternalLink className="h-3 w-3" /></a>}</td>
             <td className="p-3 min-w-[165px]">
               {row.contactRequestFormUrl ? <>
                 <a className="text-primary inline-flex items-center gap-1 underline" href={row.contactRequestFormUrl} target="_blank" rel="noopener noreferrer">Open form <ExternalLink className="h-3 w-3" /></a>
                 <div><Badge variant={row.contactFormStatus === "verified" ? "default" : "outline"}>{row.contactFormStatus === "verified" ? "Usable — reviewed" : row.contactFormStatus === "unusable" ? "Not usable" : "Candidate — unverified"}</Badge></div>
                 {row.identityMatchStatus === "strong" && row.contactFormStatus !== "verified" && <Button size="sm" variant="outline" className="mt-1 h-7" disabled={reviewForm.isPending} onClick={() => {
                   if (window.confirm(`After opening the link, did you verify that ${row.businessName} has a working general-inquiry form with a message field and submit control (not just a contact or booking page)?`)) reviewForm.mutate({ row, contactFormStatus: "verified" });
                 }}>Verify usable form</Button>}
                 {row.contactFormStatus === "verified" && <Button size="sm" variant="ghost" className="mt-1 h-7" disabled={reviewForm.isPending} onClick={() => reviewForm.mutate({ row, contactFormStatus: "unusable" })}>Mark unusable</Button>}
               </> : "—"}
             </td>
             <td className="p-3">{row.currentSoftware || "Unknown"}<div className="text-muted-foreground">{row.usesSoftware || "Unverified"}</div></td>
             <td className="p-3 max-w-[200px]">{prettyObject(row.evidence)}</td><td className="p-3">{prettyObject(row.confidence)}</td>
              <td className="p-3 min-w-[200px]"><details>
                <summary className="cursor-pointer text-primary underline-offset-2 hover:underline">{ownerSelectedIds.includes(row.id) ? "Selected · " : ""}{row.ownerName?.status?.replaceAll("_", " ") || "Review owner evidence"}</summary>
                <OwnerNameReview
                  rowId={row.id}
                  businessName={row.businessName}
                  ownerName={row.ownerName}
                  contactName={row.contactName}
                  canSearch={String(row.category ?? row.sourceData?.category ?? "").toLowerCase().replace(/[\s-]+/g, "_") !== "non_grooming"}
                  selectedForBatch={ownerSelectedIds.includes(row.id)}
                  onSelectedForBatchChange={checked => setOwnerSelectedIds(current => {
                    if (!checked) return current.filter(id => id !== row.id);
                    if (current.includes(row.id)) return current;
                    if (current.length >= 5) { toast({ title: "Batch limit reached", description: "Select up to five salons per owner-search batch.", variant: "destructive" }); return current; }
                    return [...current, row.id];
                  })}
                />
              </details></td>
             <td className="p-3"><Badge variant="outline">{row.reviewStatus || "pending"}</Badge>{row.importedContactId && <div className="text-emerald-700 mt-1">Imported</div>}</td>
             <td className="p-3"><Button size="sm" variant="ghost" onClick={() => setEditing(row)}>Edit</Button></td>
            </tr>)}{!rows.length && !rowsQuery.isLoading && <tr><td colSpan={11} className="p-10 text-center text-muted-foreground">No rows match these filters.</td></tr>}</tbody>
       </table></div>
    </>}
    {editing && <div className="fixed inset-0 bg-slate-950/30 z-50 flex items-center justify-center p-4" onClick={() => setEditing(null)}><Card className="w-full max-w-xl" onClick={e => e.stopPropagation()}><CardHeader><CardTitle>Edit enriched contact</CardTitle></CardHeader><CardContent className="space-y-3">{(["email", "phone", "websiteUrl", "contactRequestFormUrl", "bookingUrl", "currentSoftware", "usesSoftware", "audienceTrack"] as const).map(key => <div key={key}><Label className="capitalize">{key.replace(/([A-Z])/g, " $1")}</Label><Input value={String(editing[key] ?? "")} onChange={e => setEditing({ ...editing, [key]: e.target.value })} /></div>)}<div><Label>Evidence</Label><Textarea value={prettyObject(editing.evidence)} readOnly /></div><div className="flex justify-end gap-2 pt-2"><Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button><Button onClick={() => patch.mutate(editing)} disabled={patch.isPending}>Save changes</Button></div></CardContent></Card></div>}
  </main></div>;
}