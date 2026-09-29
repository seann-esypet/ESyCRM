import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import Header from "@/components/layout/header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertCircle, ArrowLeft, ArrowRight, BriefcaseBusiness, CalendarClock,
  Check, CircleHelp, ExternalLink, FileJson2, Mail, MapPin, RefreshCw,
  Search, ShieldCheck, Upload, Users,
} from "lucide-react";

type SearchBatch = { id: string; name: string; totalRows: number; createdAt: string; [key: string]: unknown };
type SearchRow = {
  id: string;
  batchId: string;
  businessName: string;
  address?: string | null;
  state?: string | null;
  placeId?: string | null;
  email?: string | null;
  candidateEmail?: string | null;
  sourceUrl?: string | null;
  evidenceNote?: string | null;
  category?: string | null;
  reviewStatus?: string | null;
  importedContactId?: string | null;
  dealId?: string | null;
  dealStage?: string | null;
  sequenceStatus?: string | null;
  audienceTrack?: string | null;
  [key: string]: unknown;
};
type ReportData = {
  batches: SearchBatch[];
  totals: {
    batches?: number;
    rows?: number;
    imported?: number;
    byCategory?: Record<string, number>;
    [key: string]: unknown;
  };
  rows: SearchRow[];
  pagination: { total: number; limit: number; offset: number };
};
type Sequence = { id: string; sequenceNumber: number; sequenceTrack: string; subject?: string; isActive?: string };

const PAGE_SIZE = 50;
const reportCategories = [
  "verified_public_email",
  "booking_only",
  "review_only",
  "no_verified_email",
  "non_grooming",
  "inaccessible",
];
const inaccessible = new Set(["booking_only", "review_only", "excluded", "inaccessible", "unavailable"]);
const labelize = (value?: string | null) => (value || "unclassified").replace(/[_-]+/g, " ").replace(/\b\w/g, s => s.toUpperCase());
const dateLabel = (value?: string) => value ? new Date(value).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "Date unavailable";
const categoryKey = (value?: string | null) => (value ?? "").trim().toLowerCase().replace(/\s+/g, "_");
const eastCoastParts = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

function easternLocalInputValue(date: Date) {
  const parts = Object.fromEntries(eastCoastParts.formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function toEasternScheduledSendAt(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error("Enter a valid scheduled date and time.");
  const [, yearText, monthText, dayText, hourText, minuteText] = match;
  const [year, month, day, hour, minute] = [yearText, monthText, dayText, hourText, minuteText].map(Number);
  const intendedAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  const dateCheck = new Date(intendedAsUtc);
  if (dateCheck.getUTCFullYear() !== year || dateCheck.getUTCMonth() !== month - 1 ||
    dateCheck.getUTCDate() !== day || hour > 23 || minute > 59) {
    throw new Error("Enter a valid scheduled date and time.");
  }

  // datetime-local values represent Eastern Time. Test both legal offsets explicitly:
  // -04:00 and -05:00. This also detects the repeated hour at fall-back.
  const candidates = [4, 5]
    .map(offsetHours => new Date(intendedAsUtc + offsetHours * 60 * 60 * 1000))
    .filter(candidate => {
      const parts = Object.fromEntries(eastCoastParts.formatToParts(candidate).map(part => [part.type, part.value]));
      return Number(parts.year) === year && Number(parts.month) === month &&
        Number(parts.day) === day && Number(parts.hour) === hour &&
        Number(parts.minute) === minute;
    })
    .sort((a, b) => a.getTime() - b.getTime());
  if (!candidates.length) {
    throw new Error("That time does not exist in Eastern Time because of a daylight-saving transition. Choose another time.");
  }
  // On the fall-back repeated hour, choose its earlier occurrence (the EDT instant).
  const scheduledInstant = candidates[0];
  if (scheduledInstant.getTime() <= Date.now()) throw new Error("Choose a future scheduled time.");
  return scheduledInstant.toISOString();
}

async function getJson<T>(url: string): Promise<T> {
  const response = await apiRequest("GET", url);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message || `Request failed (${response.status})`);
  }
  return response.json();
}

function isBookableSuccess(row: SearchRow) {
  return categoryKey(row.category) === "verified_public_email" && !inaccessible.has(categoryKey(row.category));
}

function formatCount(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString() : "—";
}

export default function SalonSearchReport() {
  const { toast } = useToast();
  const uploadRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  const [batchId, setBatchId] = useState("all");
  const [category, setCategory] = useState("all");
  const [page, setPage] = useState(0);
  const [scheduleRow, setScheduleRow] = useState<SearchRow | null>(null);
  const [sequenceId, setSequenceId] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [scheduleConfirmed, setScheduleConfirmed] = useState(false);
  const [minimumEasternTime] = useState(() => easternLocalInputValue(new Date(Date.now() + 60_000)));

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (batchId !== "all") params.set("batchId", batchId);
    if (category !== "all") params.set("category", category);
    if (search.trim()) params.set("search", search.trim());
    params.set("limit", String(PAGE_SIZE));
    params.set("offset", String(page * PAGE_SIZE));
    return params.toString();
  }, [batchId, category, search, page]);

  const reportQuery = useQuery<ReportData>({
    queryKey: ["/api/salon-search-report", batchId, category, search, page],
    queryFn: () => getJson(`/api/salon-search-report?${queryString}`),
  });
  const sequenceQuery = useQuery<Sequence[]>({
    queryKey: ["/api/email-sequences?track=directory_general"],
    queryFn: () => getJson("/api/email-sequences?track=directory_general"),
  });
  const rows = reportQuery.data?.rows ?? [];
  const batches = reportQuery.data?.batches ?? [];
  const totals = reportQuery.data?.totals ?? {};
  const categoryCounts = totals.byCategory ?? {};
  const totalRows = reportQuery.data?.pagination?.total ?? 0;
  const selectedSequence = sequenceQuery.data?.find(sequence => sequence.id === sequenceId);
  const seqStepOne = (sequenceQuery.data ?? []).filter(item =>
    Number(item.sequenceNumber) === 1 && item.sequenceTrack === "directory_general"
  );

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["/api/salon-search-report"] });
  const review = useMutation({
    mutationFn: async (row: SearchRow) => {
      const response = await apiRequest("POST", `/api/salon-enrichment/batches/${row.batchId}/rows/review`, { rowIds: [row.id], decision: "approved" });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).message || "Approval failed");
      return response.json();
    },
    onSuccess: () => { toast({ title: "Row approved", description: "You can now import this result as a contact." }); refresh(); },
    onError: (error: Error) => toast({ title: "Could not approve row", description: error.message, variant: "destructive" }),
  });
  const importContact = useMutation({
    mutationFn: async (row: SearchRow) => {
      const response = await apiRequest("POST", `/api/salon-enrichment/batches/${row.batchId}/import`, { rowIds: [row.id] });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).message || "Import failed");
      return { row, result: await response.json() as Record<string, unknown> };
    },
    onSuccess: ({ row, result }) => {
      const imported = Array.isArray(result.imported) ? result.imported : [];
      const rowWasImported = imported.some(item => {
        if (item === row.id) return true;
        if (!item || typeof item !== "object") return false;
        const record = item as Record<string, unknown>;
        return [record.rowId, record.row_id, record.sourceRowId, record.id].some(id => String(id ?? "") === row.id);
      });
      const skipped = Array.isArray(result.skipped) ? result.skipped : [];
      const skippedItem = skipped.find(item => {
        if (item === row.id) return true;
        if (!item || typeof item !== "object") return false;
        const record = item as Record<string, unknown>;
        return [record.rowId, record.row_id, record.sourceRowId, record.id].some(id => String(id ?? "") === row.id);
      });
      const skippedReason = skippedItem && typeof skippedItem === "object"
        ? String((skippedItem as Record<string, unknown>).reason ?? (skippedItem as Record<string, unknown>).message ?? "")
        : "";
      if (rowWasImported) {
        toast({ title: "Contact imported", description: "The contact is ready for a deliberate pipeline or sequence action." });
        queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      } else {
        toast({
          title: "Contact was not imported",
          description: skippedReason || "The server did not report this row in its imported results. Review the row status and try again if appropriate.",
          variant: "destructive",
        });
      }
      refresh();
    },
    onError: (error: Error) => toast({ title: "Could not import contact", description: error.message, variant: "destructive" }),
  });
  const createDeal = useMutation({
    mutationFn: async (row: SearchRow) => {
      if (!row.importedContactId) throw new Error("Import this result before creating a deal.");
      if (row.dealId) throw new Error("This result already has a pipeline deal.");
      const response = await apiRequest("POST", "/api/deals", {
        title: row.businessName || "Salon prospect",
        contactId: row.importedContactId,
        value: "",
        plan: "Unknown",
        stage: "new_lead_unqualified",
        probability: 0,
        expectedCloseDate: null,
        demoScheduledDate: null,
        demoCompletedDate: null,
        wonDate: null,
        description: `Salon search report · ${row.category || "Unclassified"}${row.sourceUrl ? ` · Source: ${row.sourceUrl}` : ""}`,
      });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).message || "Deal creation failed");
      return response.json();
    },
    onSuccess: () => { toast({ title: "Pipeline deal created", description: "Added at New Lead Unqualified." }); refresh(); queryClient.invalidateQueries({ queryKey: ["/api/deals"] }); },
    onError: (error: Error) => toast({ title: "Could not create deal", description: error.message, variant: "destructive" }),
  });
  const upload = useMutation({
    mutationFn: async (file: File) => {
      const parsed: unknown = JSON.parse(await file.text());
      if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { reviewed?: unknown }).reviewed)) {
        throw new Error("The JSON file must contain a reviewed array.");
      }
      const response = await apiRequest("POST", "/api/salon-search-report/batches", {
        name: file.name.replace(/\.json$/i, "") || "Salon search report",
        reviewed: (parsed as { reviewed: unknown[] }).reviewed,
      });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).message || "Upload failed");
      return response.json();
    },
    onSuccess: () => { toast({ title: "Search report added", description: "The report batch is ready to review." }); setPage(0); refresh(); },
    onError: (error: Error) => toast({ title: "Could not upload report", description: error.message, variant: "destructive" }),
  });
  const loadPilot = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/salon-search-report/load-pilot", {});
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).message || "Could not load the reviewed pilot");
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Reviewed pilot is ready", description: "The historical 100-row pilot was loaded. Any existing pilot batch was reused." });
      setPage(0);
      refresh();
    },
    onError: (error: Error) => toast({ title: "Could not load reviewed pilot", description: error.message, variant: "destructive" }),
  });
  const schedule = useMutation({
    mutationFn: async () => {
      if (!scheduleRow?.importedContactId || !scheduleRow.dealId || !selectedSequence ||
        selectedSequence.sequenceTrack !== "directory_general" || selectedSequence.isActive !== "true") {
        throw new Error("Import the contact, create its pipeline deal, and select an active directory-general first step.");
      }
      const scheduledSendAt = toEasternScheduledSendAt(scheduledAt);
      const response = await apiRequest("POST", `/api/salon-search-report/rows/${scheduleRow.id}/schedule`, {
        sequenceId: selectedSequence.id,
        scheduledSendAt,
      });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).message || "Could not schedule sequence");
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Sequence scheduled", description: "The contact was explicitly scheduled for the selected future time." });
      setScheduleRow(null); setScheduleConfirmed(false); setSequenceId(""); setScheduledAt("");
      refresh(); queryClient.invalidateQueries({ queryKey: ["/api/email-sequence-logs"] });
    },
    onError: (error: Error) => toast({ title: "Could not schedule sequence", description: error.message, variant: "destructive" }),
  });

  const startSchedule = (row: SearchRow) => {
    setScheduleRow(row);
    setSequenceId("");
    setScheduledAt("");
    setScheduleConfirmed(false);
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <Header title="Salon Search Report" />
      <main className="mx-auto max-w-[1500px] space-y-6 p-4 sm:p-6">
        <section className="relative overflow-hidden rounded-2xl border border-border bg-card px-5 py-6 sm:px-8 sm:py-8">
          <div className="absolute -right-8 -top-14 h-52 w-52 rounded-full border-[28px] border-primary/5" aria-hidden="true" />
          <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-primary">
                <Search className="h-3.5 w-3.5" /> Search intelligence
              </div>
              <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Salon search report</h1>
              <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
                Review source-backed discoveries across every batch. Approval, contact import, pipeline creation and email scheduling are separate, deliberate steps.
              </p>
            </div>
            <div>
              <input ref={uploadRef} className="sr-only" type="file" accept=".json,application/json" aria-label="Upload salon search JSON report" onChange={event => {
                const file = event.target.files?.[0];
                if (file) upload.mutate(file);
                event.currentTarget.value = "";
              }} />
              <Button onClick={() => uploadRef.current?.click()} disabled={upload.isPending} className="w-full sm:w-auto">
                <FileJson2 className="mr-2 h-4 w-4" />{upload.isPending ? "Uploading report…" : "Upload JSON report"}
              </Button>
              <p className="mt-2 text-right text-xs text-muted-foreground">Accepts a <code>reviewed</code> array</p>
              <Button variant="outline" onClick={() => loadPilot.mutate()} disabled={loadPilot.isPending} className="mt-3 w-full sm:w-auto">
                <Users className="mr-2 h-4 w-4" />{loadPilot.isPending ? "Loading pilot…" : "Load reviewed pilot"}
              </Button>
            </div>
          </div>
        </section>

        {reportQuery.isError && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Search report could not load</AlertTitle>
            <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
              <span>{(reportQuery.error as Error).message || "Check your connection and try again."}</span>
              <Button size="sm" variant="outline" onClick={() => reportQuery.refetch()}><RefreshCw className="mr-2 h-3.5 w-3.5" />Retry</Button>
            </AlertDescription>
          </Alert>
        )}

        <section aria-label="Cross-batch report summary" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            { label: "Report batches", value: reportQuery.isLoading ? "…" : reportQuery.isError ? "—" : formatCount(totals.batches ?? batches.length), icon: FileJson2, note: "Across all uploads" },
            { label: "Rows found", value: reportQuery.isLoading ? "…" : reportQuery.isError ? "—" : formatCount(totals.rows ?? totalRows), icon: Users, note: `${formatCount(totalRows)} in current view` },
            { label: "Successful matches", value: reportQuery.isLoading ? "…" : reportQuery.isError ? "—" : formatCount(categoryCounts.verified_public_email ?? 0), icon: Check, note: "Requires manual approval" },
            { label: "Imported contacts", value: reportQuery.isLoading ? "…" : reportQuery.isError ? "—" : formatCount(totals.imported ?? 0), icon: BriefcaseBusiness, note: "Not auto-enrolled" },
          ].map(item => {
            const Icon = item.icon;
            return <Card key={item.label} className="border-border/80"><CardContent className="flex items-start justify-between gap-2 p-4 sm:p-5">
              <div><p className="text-xs font-medium text-muted-foreground">{item.label}</p><p className="mt-2 font-mono text-2xl font-semibold tracking-tight">{item.value}</p><p className="mt-1 text-xs text-muted-foreground">{item.note}</p></div>
              <span className="rounded-xl bg-primary/8 p-2 text-primary"><Icon className="h-4 w-4" /></span>
            </CardContent></Card>;
          })}
        </section>

        <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
          <Card className="overflow-hidden">
            <div className="flex flex-col gap-4 border-b p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
              <div><h2 className="font-semibold">Discovery categories</h2><p className="mt-1 text-xs text-muted-foreground">Counts are returned across batches by the report service.</p></div>
              <div className="flex flex-wrap gap-2">
                {reportCategories.map(key => (
                  <Badge key={key} variant="secondary" className="gap-1.5 py-1"><span>{labelize(key)}</span><span className="font-mono">{reportQuery.isError ? "—" : formatCount(categoryCounts[key] ?? 0)}</span></Badge>
                ))}
                {reportQuery.isError && <span className="text-xs text-destructive">Category totals unavailable.</span>}
              </div>
            </div>
            <div className="grid grid-cols-1 divide-y sm:grid-cols-3 sm:divide-x sm:divide-y-0">
              {batches.slice(0, 3).map(batch => <div key={batch.id} className="min-w-0 p-4 sm:p-5">
                <p className="truncate text-sm font-medium">{batch.name}</p>
                <p className="mt-1 text-xs text-muted-foreground">{dateLabel(batch.createdAt)}</p>
                <p className="mt-3 font-mono text-lg font-semibold">{formatCount(batch.totalRows)} <span className="font-sans text-xs font-normal text-muted-foreground">rows</span></p>
              </div>)}
              {!batches.length && <p className="p-5 text-sm text-muted-foreground">{reportQuery.isLoading ? "Loading batches…" : "Upload a reviewed JSON report to start a batch."}</p>}
            </div>
          </Card>
          <div className="rounded-xl border border-primary/15 bg-primary/[0.035] p-4 sm:p-5">
            <div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" /><div>
              <h2 className="text-sm font-semibold">Keep the handoff human</h2>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">Only successful results can be approved here. Booking-only, review-only, excluded and inaccessible results stay out of contact import.</p>
              <p className="mt-3 text-xs leading-5 text-muted-foreground">Creating a deal or scheduling a sequence is always a separate action after import. Nothing enrolls automatically.</p>
            </div></div>
          </div>
        </section>

        <section className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div><h2 className="text-xl font-semibold tracking-tight">Search results</h2><p className="mt-1 text-sm text-muted-foreground">Filter by batch, category or business details.</p></div>
            <p className="text-xs text-muted-foreground">{reportQuery.isLoading ? "Loading…" : `${formatCount(totalRows)} matching rows`}</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-[minmax(200px,1fr)_200px_200px_auto]">
            <div className="relative"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input className="pl-9" aria-label="Search business results" placeholder="Business, email, state, evidence…" value={search} onChange={event => { setSearch(event.target.value); setPage(0); }} /></div>
            <Select value={batchId} onValueChange={value => { setBatchId(value); setPage(0); }}>
              <SelectTrigger aria-label="Filter by batch"><SelectValue placeholder="All batches" /></SelectTrigger>
              <SelectContent><SelectItem value="all">All batches</SelectItem>{batches.map(batch => <SelectItem key={batch.id} value={batch.id}>{batch.name}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={category} onValueChange={value => { setCategory(value); setPage(0); }}>
              <SelectTrigger aria-label="Filter by category"><SelectValue placeholder="All categories" /></SelectTrigger>
              <SelectContent><SelectItem value="all">All categories</SelectItem>{reportCategories.map(value => <SelectItem key={value} value={value}>{labelize(value)}</SelectItem>)}</SelectContent>
            </Select>
            <Button variant="outline" onClick={() => reportQuery.refetch()} disabled={reportQuery.isFetching}><RefreshCw className={`mr-2 h-4 w-4 ${reportQuery.isFetching ? "animate-spin" : ""}`} />Refresh</Button>
          </div>

          {reportQuery.isLoading ? (
            <div className="space-y-3" aria-label="Loading search results">
              {[0, 1, 2].map(item => <div key={item} className="h-44 animate-pulse rounded-xl border bg-muted/40" />)}
            </div>
          ) : reportQuery.isError ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-6 py-10 text-center" role="alert">
              <AlertCircle className="mx-auto mb-3 h-6 w-6 text-destructive" />
              <h3 className="font-medium">Results are unavailable</h3>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{(reportQuery.error as Error).message || "The report could not be loaded."}</p>
              <Button variant="outline" className="mt-4" onClick={() => reportQuery.refetch()} disabled={reportQuery.isFetching}><RefreshCw className="mr-2 h-4 w-4" />Retry search</Button>
            </div>
          ) : rows.length === 0 ? (
            <div className="rounded-xl border border-dashed bg-card px-6 py-14 text-center">
              <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-muted"><CircleHelp className="h-5 w-5 text-muted-foreground" /></div>
              <h3 className="font-medium">No results in this view</h3>
              <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">Adjust the filters or upload a report JSON containing a reviewed array.</p>
              <Button variant="outline" className="mt-4" onClick={() => { setSearch(""); setCategory("all"); setBatchId("all"); setPage(0); }}>Clear filters</Button>
            </div>
          ) : (
            <div className="space-y-3">
              {rows.map(row => {
                const isSuccess = isBookableSuccess(row);
                const isImported = Boolean(row.importedContactId);
                const isApproved = row.reviewStatus === "approved";
                const categoryIsRestricted = inaccessible.has(categoryKey(row.category));
                return <article key={row.id} className="overflow-hidden rounded-xl border bg-card transition-colors hover:border-primary/25">
                  <div className="flex flex-col gap-4 p-4 sm:p-5 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-base font-semibold">{row.businessName || "Unnamed business"}</h3>
                        <Badge variant={isSuccess ? "default" : "secondary"}>{labelize(row.category)}</Badge>
                        <Badge variant="outline">{labelize(row.reviewStatus || "pending review")}</Badge>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{[row.address, row.state].filter(Boolean).join(", ") || "Location not provided"}</span>
                        {row.email && <span className="inline-flex items-center gap-1"><Mail className="h-3.5 w-3.5" />{row.email}</span>}
                        {!row.email && row.candidateEmail && <span className="inline-flex items-center gap-1 rounded-md border border-amber-300/70 bg-amber-50 px-2 py-1 text-amber-900"><Mail className="h-3.5 w-3.5" /><span>{row.candidateEmail}</span><span className="font-semibold">Unverified / restricted · not actionable</span></span>}
                        {row.placeId && <span className="font-mono">Place ID · {row.placeId}</span>}
                      </div>
                      {row.evidenceNote && <p className="mt-3 max-w-3xl text-sm leading-5 text-foreground/80">{row.evidenceNote}</p>}
                      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
                        {row.sourceUrl ? <a className="inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline" href={row.sourceUrl} target="_blank" rel="noopener noreferrer">Open source <ExternalLink className="h-3 w-3" /></a> : <span className="text-muted-foreground">No source link provided</span>}
                        <span className="text-muted-foreground">Batch: {batches.find(batch => batch.id === row.batchId)?.name || row.batchId}</span>
                      </div>
                      <div className="mt-4 flex flex-wrap gap-2">
                        {isImported ? <Badge variant="secondary" className="gap-1"><Check className="h-3 w-3" />Contact imported</Badge> : isApproved ? <Badge variant="outline" className="gap-1"><ShieldCheck className="h-3 w-3" />Approved for import</Badge> : <Badge variant="outline">Not imported</Badge>}
                        {row.dealId && <Badge variant="secondary" className="gap-1"><BriefcaseBusiness className="h-3 w-3" />Pipeline · {labelize(row.dealStage || "deal exists")}</Badge>}
                        {row.sequenceStatus && <Badge variant="secondary" className="gap-1"><CalendarClock className="h-3 w-3" />Sequence · {labelize(row.sequenceStatus)}</Badge>}
                        {row.audienceTrack && <Badge variant="outline">Track · {labelize(row.audienceTrack)}</Badge>}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 lg:w-[265px] lg:justify-end">
                      {isSuccess && !categoryIsRestricted && !isApproved && !isImported && <Button size="sm" variant="outline" onClick={() => review.mutate(row)} disabled={review.isPending}><ShieldCheck className="mr-1.5 h-3.5 w-3.5" />Approve</Button>}
                      {isSuccess && !categoryIsRestricted && isApproved && !isImported && <Button size="sm" onClick={() => importContact.mutate(row)} disabled={importContact.isPending}><Upload className="mr-1.5 h-3.5 w-3.5" />Import contact</Button>}
                      {!isSuccess && <span className="w-full text-right text-xs text-muted-foreground">{categoryIsRestricted ? "Not eligible for approval or import" : "Manual approval is reserved for successful matches"}</span>}
                      {isImported && !row.dealId && <Button size="sm" variant="outline" onClick={() => createDeal.mutate(row)} disabled={createDeal.isPending}><BriefcaseBusiness className="mr-1.5 h-3.5 w-3.5" />Create pipeline deal</Button>}
                      {isImported && !row.dealId && !row.sequenceStatus && <span className="w-full text-right text-xs text-muted-foreground">Create a pipeline deal before scheduling a sequence.</span>}
                      {isImported && row.dealId && !row.sequenceStatus && <Button size="sm" variant="outline" onClick={() => startSchedule(row)}><Mail className="mr-1.5 h-3.5 w-3.5" />Schedule sequence</Button>}
                    </div>
                  </div>
                </article>;
              })}
            </div>
          )}
          {!reportQuery.isError && <div className="flex items-center justify-between border-t pt-4">
            <p className="text-xs text-muted-foreground">Showing {totalRows === 0 ? 0 : page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, totalRows)} of {formatCount(totalRows)}</p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page === 0 || reportQuery.isFetching} onClick={() => setPage(value => Math.max(0, value - 1))}><ArrowLeft className="mr-1.5 h-3.5 w-3.5" />Previous</Button>
              <Button variant="outline" size="sm" disabled={(page + 1) * PAGE_SIZE >= totalRows || reportQuery.isFetching} onClick={() => setPage(value => value + 1)}>Next<ArrowRight className="ml-1.5 h-3.5 w-3.5" /></Button>
            </div>
          </div>}
        </section>
      </main>

      <Dialog open={Boolean(scheduleRow)} onOpenChange={open => { if (!open) { setScheduleRow(null); setScheduleConfirmed(false); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Schedule directory introduction</DialogTitle>
            <DialogDescription>Choose an active first step and a future send time for {scheduleRow?.businessName}. This does not enroll automatically.</DialogDescription>
          </DialogHeader>
          {sequenceQuery.isError ? <Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertTitle>Could not load directory sequences</AlertTitle><AlertDescription>{(sequenceQuery.error as Error).message} <Button variant="outline" size="sm" className="mt-2" onClick={() => sequenceQuery.refetch()}>Retry</Button></AlertDescription></Alert> : (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="sequence-select">Directory general · step 1</Label>
                <Select value={sequenceId} onValueChange={setSequenceId}>
                  <SelectTrigger id="sequence-select"><SelectValue placeholder={sequenceQuery.isLoading ? "Loading sequence…" : "Select sequence step 1"} /></SelectTrigger>
                  <SelectContent>{seqStepOne.map(sequence => <SelectItem key={sequence.id} value={sequence.id} disabled={sequence.isActive !== "true"}>{sequence.subject || "Sequence 1"}{sequence.isActive === "true" ? " · Active" : " · Inactive"}</SelectItem>)}</SelectContent>
                </Select>
                {!sequenceQuery.isLoading && seqStepOne.length === 0 && <p className="text-xs text-destructive">No step 1 sequence is configured for directory_general.</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="scheduled-at">Scheduled send time (Eastern Time)</Label>
                <Input id="scheduled-at" type="datetime-local" value={scheduledAt} min={minimumEasternTime} onChange={event => setScheduledAt(event.target.value)} />
                <p className="text-xs text-muted-foreground">Uses Eastern Time, matching existing sequence enrollment. A repeated fall-back hour uses its earlier occurrence. A future time is required.</p>
              </div>
              <label className="flex cursor-pointer items-start gap-3 rounded-lg border bg-muted/30 p-3 text-sm">
                <input type="checkbox" checked={scheduleConfirmed} onChange={event => setScheduleConfirmed(event.target.checked)} className="mt-0.5 accent-primary" />
                <span>I understand that the scheduler may send Sequence 1 at the chosen time and automatically send subsequent directory follow-up emails.</span>
              </label>
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>Only this imported contact, already associated with a pipeline deal, will be scheduled. The sequence may continue with its configured directory follow-ups automatically.</AlertDescription>
              </Alert>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setScheduleRow(null)}>Cancel</Button>
            <Button disabled={!sequenceId || !scheduledAt || !scheduleConfirmed || sequenceQuery.isLoading || schedule.isPending} onClick={() => schedule.mutate()}>
              {schedule.isPending ? "Scheduling…" : "Confirm scheduled send"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}