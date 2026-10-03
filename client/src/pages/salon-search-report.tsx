import { useEffect, useMemo, useRef, useState } from "react";
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
import { OwnerNameReview, OwnerSearchEstimate, OwnerPreview } from "@/components/owner-name-review";
import SalesLeadListUpload from "@/components/sales-lead-list-upload";
import { DirectoryEligibilityReview, EligibilitySummaryStrip, type EligibilitySummary } from "@/components/directory-eligibility";
import type { DirectoryEligibility } from "@shared/directoryEligibility";
import type { OwnerNameResult } from "@shared/salonOwnerName";
import { deleteContactBatch } from "@/lib/contact-deletion";
import {
  AlertCircle, ArrowLeft, ArrowRight, BriefcaseBusiness, CalendarClock,
  Check, CircleHelp, ExternalLink, FileJson2, Mail, MapPin, RefreshCw,
  Search, ShieldCheck, Trash2, Upload, Users,
} from "lucide-react";

type SearchBatch = { id: string; name: string; totalRows: number; createdAt: string; [key: string]: unknown };
type SearchRow = {
  id: string;
  batchId: string;
  businessName: string;
  address?: string | null;
  state?: string | null;
  phone?: string | null;
  placeId?: string | null;
  email?: string | null;
  candidateEmail?: string | null;
  suggestedFirstName?: string | null;
  suggestedLastName?: string | null;
  sourceUrl?: string | null;
  evidenceNote?: string | null;
  category?: string | null;
  reviewStatus?: string | null;
  importedContactId?: string | null;
  dealId?: string | null;
  dealStage?: string | null;
  sequenceStatus?: string | null;
  audienceTrack?: string | null;
  eligibility?: DirectoryEligibility;
  ownerName?: OwnerNameResult | null;
  contactName?: { firstName?: string | null; lastName?: string | null; useBusinessNameForEmail?: "Yes" | "No" | null } | null;
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
  eligibilitySummary?: EligibilitySummary;
};
type Sequence = { id: string; sequenceNumber: number; sequenceTrack: string; subject?: string; isActive?: string };

const PAGE_SIZE = 50;
type SearchesPerRow = 1 | 3;
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

function rowEligibility(row: SearchRow): DirectoryEligibility {
  return row.eligibility ?? {
    listing: { categories: [], name: null, address: null, placeId: null, provider: "Provider listing", sourceUrl: null },
    classification: "unknown", decision: "pending", flagged: false, blocked: true,
    reason: "Provider eligibility evidence is unavailable. Review is required before outreach.",
    reviewNote: null, identityKey: "",
  };
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
  const [ownerSelectedIds, setOwnerSelectedIds] = useState<string[]>([]);
  const [ownerEstimate, setOwnerEstimate] = useState<OwnerSearchEstimate | null>(null);
  const [ownerEstimateIds, setOwnerEstimateIds] = useState<string[]>([]);
  const [ownerSearchesPerRow, setOwnerSearchesPerRow] = useState<SearchesPerRow>(1);
  const [ownerEstimateSearchesPerRow, setOwnerEstimateSearchesPerRow] = useState<SearchesPerRow | null>(null);
  const ownerSelectionVersion = useRef(0);
  const [confirmOwnerBatch, setConfirmOwnerBatch] = useState(false);
  const [selectedDeleteIds, setSelectedDeleteIds] = useState<Set<string>>(new Set());
  const [deleteTargets, setDeleteTargets] = useState<SearchRow[]>([]);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [isDeletingRows, setIsDeletingRows] = useState(false);
  const deleteSelectionVersion = useRef(0);

  useEffect(() => {
    deleteSelectionVersion.current += 1;
    setSelectedDeleteIds(new Set());
    setDeleteTargets([]);
    setDeleteDialogOpen(false);
  }, [batchId, category, search, page]);

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
  const schedulePreview = useQuery<OwnerPreview>({
    queryKey: ["/api/salon-owner-names/rows", scheduleRow?.id, "preview", sequenceId],
    queryFn: () => getJson(`/api/salon-owner-names/rows/${scheduleRow!.id}/preview?sequenceId=${encodeURIComponent(sequenceId)}`),
    enabled: Boolean(scheduleRow && sequenceId),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["/api/salon-search-report"] });
  const openDeleteDialog = (targets: SearchRow[]) => {
    if (isDeletingRows || !targets.length) return;
    setDeleteTargets(targets);
    setDeleteDialogOpen(true);
  };
  const deleteReviewRows = async () => {
    if (isDeletingRows || !deleteTargets.length) return;
    const targets = [...deleteTargets];
    const versionAtStart = deleteSelectionVersion.current;
    setIsDeletingRows(true);
    try {
      const { removedIds, failures } = await deleteContactBatch(
        targets.map(row => row.id),
        id => apiRequest("DELETE", `/api/salon-search-report/rows/${encodeURIComponent(id)}`),
      );
      if (removedIds.length) {
        ownerSelectionVersion.current += 1;
        setOwnerSelectedIds(current => current.filter(id => !removedIds.includes(id)));
        setOwnerEstimate(null); setOwnerEstimateIds([]); setOwnerEstimateSearchesPerRow(null);
        setConfirmOwnerBatch(false);
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["/api/salon-search-report"] }),
          queryClient.invalidateQueries({ queryKey: ["/api/salon-enrichment/batches"] }),
        ]);
        const refreshed = queryClient.getQueryData<ReportData>([
          "/api/salon-search-report", batchId, category, search, page,
        ]);
        const remaining = refreshed?.pagination?.total ?? 0;
        if (page > 0 && remaining <= page * PAGE_SIZE) {
          setPage(Math.max(0, Math.ceil(remaining / PAGE_SIZE) - 1));
        }
      }
      if (deleteSelectionVersion.current === versionAtStart) {
        setSelectedDeleteIds(new Set(failures.map(failure => failure.id)));
      }
      setDeleteDialogOpen(false);
      setDeleteTargets([]);
      if (failures.length) {
        const blockedCount = failures.filter(failure => failure.status === "409").length;
        const description = [
          removedIds.length ? `${removedIds.length} ${removedIds.length === 1 ? "uploaded row was" : "uploaded rows were"} removed.` : "",
          `${failures.length} ${failures.length === 1 ? "row could not" : "rows could not"} be removed${deleteSelectionVersion.current === versionAtStart ? " and remain selected" : ""}.`,
          blockedCount ? `${blockedCount} ${blockedCount === 1 ? "row is" : "rows are"} imported, linked to a deal, or being processed and cannot be deleted.` : "",
        ].filter(Boolean).join(" ");
        toast({ title: "Some uploaded rows were not removed", description, variant: "destructive" });
      } else {
        toast({
          title: targets.length === 1 ? "Uploaded row removed" : "Uploaded rows removed",
          description: `${targets.length} ${targets.length === 1 ? "Sales Lead Review row was" : "Sales Lead Review rows were"} removed.`,
        });
      }
    } finally {
      setIsDeletingRows(false);
    }
  };
  const review = useMutation({
    mutationFn: async (row: SearchRow) => {
      if (rowEligibility(row).blocked) throw new Error("Approve grooming suitability before reviewing this email for import.");
      const response = await apiRequest("POST", `/api/salon-enrichment/batches/${row.batchId}/rows/review`, { rowIds: [row.id], decision: "approved" });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).message || "Approval failed");
      return response.json();
    },
    onSuccess: () => { toast({ title: "Row approved", description: "You can now import this result as a contact." }); refresh(); },
    onError: (error: Error) => toast({ title: "Could not approve row", description: error.message, variant: "destructive" }),
  });
  const importContact = useMutation({
    mutationFn: async (row: SearchRow) => {
      if (rowEligibility(row).blocked) throw new Error("Approve grooming suitability before importing this contact.");
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
        description: `Sales lead review · ${row.category || "Unclassified"}${row.sourceUrl ? ` · Source: ${row.sourceUrl}` : ""}`,
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
        throw new Error("This option needs a pre-checked lead report. For your ordinary CSV or Excel file, use Upload a Lead List.");
      }
      const response = await apiRequest("POST", "/api/salon-search-report/batches", {
        name: file.name.replace(/\.json$/i, "") || "Sales lead review",
        reviewed: (parsed as { reviewed: unknown[] }).reviewed,
      });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).message || "Upload failed");
      return response.json();
    },
    onSuccess: () => { toast({ title: "Lead report added", description: "The list is ready for email-source and contact-name review." }); setPage(0); refresh(); },
    onError: (error: Error) => toast({ title: "Could not upload report", description: error.message, variant: "destructive" }),
  });
  const loadPilot = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/salon-search-report/load-pilot", {});
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).message || "Could not load the sample leads");
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Sample leads are ready", description: "The built-in 100-lead example is available for review. It uses the existing sample list if already added." });
      setPage(0);
      refresh();
    },
    onError: (error: Error) => toast({ title: "Could not load sample leads", description: error.message, variant: "destructive" }),
  });
  const schedule = useMutation({
    mutationFn: async () => {
      if (!scheduleRow || rowEligibility(scheduleRow).blocked) throw new Error("Approve grooming suitability before scheduling outreach.");
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
  const estimateOwnerBatch = useMutation({
    mutationFn: async ({ rowIds, searchesPerRow }: { rowIds: string[]; searchesPerRow: SearchesPerRow; selectionVersion: number }) => {
      const response = await apiRequest("POST", "/api/salon-owner-names/estimate", { rowIds, searchesPerRow });
      return response.json() as Promise<OwnerSearchEstimate>;
    },
    onSuccess: (data, variables) => {
      if (variables.selectionVersion !== ownerSelectionVersion.current) return;
      setOwnerEstimate(data);
      setOwnerEstimateIds([...variables.rowIds].sort());
      setOwnerEstimateSearchesPerRow(variables.searchesPerRow);
      setConfirmOwnerBatch(true);
    },
    onError: (error: Error) => toast({ title: "Could not estimate owner search", description: error.message, variant: "destructive" }),
  });
  const searchOwnerBatch = useMutation({
    mutationFn: async ({ rowIds, searchesPerRow }: { rowIds: string[]; searchesPerRow: SearchesPerRow }) => {
      const sameIds = [...ownerSelectedIds].sort().join("|") === [...rowIds].sort().join("|");
      const estimateMatches = ownerEstimate && ownerEstimateIds.join("|") === [...rowIds].sort().join("|") &&
        ownerEstimateSearchesPerRow === searchesPerRow && ownerSearchesPerRow === searchesPerRow &&
        ownerEstimate.searchesPerRow === searchesPerRow;
      if (!sameIds || !estimateMatches || !confirmOwnerBatch) throw new Error("The owner-search estimate is out of date. Estimate the current selection again before confirming.");
      if (!Number.isInteger(ownerEstimate.maxProviderCalls) || ownerEstimate.maxProviderCalls < 0 || ownerEstimate.maxProviderCalls > rowIds.length * searchesPerRow) {
        throw new Error("The estimated provider-call cap is invalid. Request a fresh estimate.");
      }
      const response = await apiRequest("POST", "/api/salon-owner-names/search", {
        rowIds, searchesPerRow, maxProviderCalls: ownerEstimate.maxProviderCalls, confirmed: true,
      });
      return response.json();
    },
    onSuccess: data => {
      const failed = (data.results as { ownerName: { status: string; error?: string } }[]).filter(result => result.ownerName.status === "failed" || result.ownerName.error).length;
      toast({ title: failed ? "Some owner searches could not finish" : "Owner searches complete", description: `${data.callsUsed ?? "Actual call count unavailable"} provider calls used. ${failed ? `${failed} lookup${failed === 1 ? "" : "s"} did not finish. Review each row’s error before choosing to retry.` : "Review source-backed candidates in each row."}`, ...(failed ? { variant: "destructive" as const } : {}) });
      setOwnerSelectedIds([]); setOwnerEstimate(null); setOwnerEstimateIds([]); setOwnerEstimateSearchesPerRow(null); setConfirmOwnerBatch(false); refresh();
    },
    onError: (error: Error) => toast({ title: "Owner search failed", description: error.message, variant: "destructive" }),
  });

  const startSchedule = (row: SearchRow) => {
    if (rowEligibility(row).blocked) {
      toast({ title: "Grooming review required", description: "Approve grooming suitability before scheduling outreach.", variant: "destructive" });
      return;
    }
    setScheduleRow(row);
    setSequenceId("");
    setScheduledAt("");
    setScheduleConfirmed(false);
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
    <Header title="Sales Lead Review" />
      <main className="mx-auto max-w-[1500px] space-y-6 p-4 sm:p-6">
        <section className="relative overflow-hidden rounded-2xl border border-border bg-card px-5 py-6 sm:px-8 sm:py-8">
          <div className="absolute -right-8 -top-14 h-52 w-52 rounded-full border-[28px] border-primary/5" aria-hidden="true" />
          <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-primary">
                <Search className="h-3.5 w-3.5" /> Public Database · Review before outreach
              </div>
              <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Sales Lead Review</h1>
              <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
                Review public leads, verify emails and contact names, then add approved contacts to Directory First outreach sequences. Uploading a list does not import contacts or send emails.
              </p>
            </div>
            <div>
              <Button className="w-full sm:w-auto" onClick={() => {
                document.getElementById("sales-lead-list-file")?.click();
                document.getElementById("sales-lead-list-upload")?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}>
                <Upload className="mr-2 h-4 w-4" />Upload a Lead List
              </Button>
              <p className="mt-2 text-right text-xs text-muted-foreground">CSV or Excel · preview before adding</p>
              <details className="mt-3 rounded-lg border-2 border-slate-400 p-3 dark:border-slate-600">
                <summary className="cursor-pointer text-sm font-medium">Other List Options</summary>
                <p className="mt-2 text-xs text-muted-foreground">These options are not for your ordinary CSV or Excel list.</p>
              <input ref={uploadRef} className="sr-only" type="file" accept=".json,application/json" aria-label="Upload source-reviewed JSON report" onChange={event => {
                const file = event.target.files?.[0];
                if (file) upload.mutate(file);
                event.currentTarget.value = "";
              }} />
              <Button variant="outline" onClick={() => uploadRef.current?.click()} disabled={upload.isPending} className="mt-3 w-full">
                <FileJson2 className="mr-2 h-4 w-4" />{upload.isPending ? "Adding report…" : "Import a Pre-Checked Report"}
              </Button>
              <p className="mt-2 text-xs text-muted-foreground">For a checked lead report with email-source links, saved as JSON. Leads still need your approval before outreach.</p>
              <Button variant="outline" onClick={() => loadPilot.mutate()} disabled={loadPilot.isPending} className="mt-3 w-full">
                <Users className="mr-2 h-4 w-4" />{loadPilot.isPending ? "Loading sample leads…" : "Load Sample Leads"}
              </Button>
              <p className="mt-2 text-xs text-muted-foreground">Adds the built-in example list for review. It does not upload your file or run a search.</p>
              </details>
            </div>
          </div>
        </section>

        <SalesLeadListUpload onSuccess={result => {
          setBatchId(result.batch.id);
          setPage(0);
          refresh();
          queryClient.invalidateQueries({ queryKey: ["/api/salon-enrichment/batches"] });
        }} />

        {reportQuery.isError && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Sales leads could not load</AlertTitle>
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
        <EligibilitySummaryStrip summary={reportQuery.data?.eligibilitySummary} label={batchId === "all" ? "Full report eligibility" : "Selected batch eligibility"} />

        <section className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div><h2 className="text-xl font-semibold tracking-tight">Search results</h2><p className="mt-1 text-sm text-muted-foreground">Filter by batch, category or business details.</p></div>
            <p className="text-xs text-muted-foreground">{reportQuery.isLoading ? "Loading…" : `${formatCount(totalRows)} matching rows`}</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-[minmax(200px,1fr)_200px_200px_auto]">
            <div className="relative"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input disabled={isDeletingRows} className="pl-9" aria-label="Search business results" placeholder="Business, email, state, evidence…" value={search} onChange={event => { setSearch(event.target.value); setPage(0); }} /></div>
            <Select value={batchId} onValueChange={value => { setBatchId(value); setPage(0); }}>
              <SelectTrigger disabled={isDeletingRows} aria-label="Filter by batch"><SelectValue placeholder="All batches" /></SelectTrigger>
              <SelectContent><SelectItem value="all">All batches</SelectItem>{batches.map(batch => <SelectItem key={batch.id} value={batch.id}>{batch.name}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={category} onValueChange={value => { setCategory(value); setPage(0); }}>
              <SelectTrigger disabled={isDeletingRows} aria-label="Filter by category"><SelectValue placeholder="All categories" /></SelectTrigger>
              <SelectContent><SelectItem value="all">All categories</SelectItem>{reportCategories.map(value => <SelectItem key={value} value={value}>{labelize(value)}</SelectItem>)}</SelectContent>
            </Select>
            <Button variant="outline" onClick={() => reportQuery.refetch()} disabled={isDeletingRows || reportQuery.isFetching}><RefreshCw className={`mr-2 h-4 w-4 ${reportQuery.isFetching ? "animate-spin" : ""}`} />Refresh</Button>
          </div>
          {rows.length > 0 && !reportQuery.isLoading && !reportQuery.isError && <div className="flex flex-col gap-3 rounded-lg border border-destructive/20 bg-destructive/[0.025] p-3 sm:flex-row sm:items-center sm:justify-between">
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={rows.length > 0 && rows.every(row => selectedDeleteIds.has(row.id))}
                disabled={isDeletingRows}
                onChange={() => setSelectedDeleteIds(current => {
                  const allSelected = rows.length > 0 && rows.every(row => current.has(row.id));
                  const next = new Set(current);
                  rows.forEach(row => allSelected ? next.delete(row.id) : next.add(row.id));
                  return next;
                })}
                aria-label={`Select all ${rows.length} visible review rows`}
                data-testid="select-visible-review-rows"
                className="h-4 w-4 rounded border-input accent-primary"
              />
              Select all {rows.length} visible rows
              {selectedDeleteIds.size > 0 && <span> · {selectedDeleteIds.size} selected</span>}
            </label>
            <Button
              size="sm"
              variant="destructive"
              disabled={isDeletingRows || selectedDeleteIds.size === 0}
              onClick={() => openDeleteDialog(rows.filter(row => selectedDeleteIds.has(row.id)))}
              data-testid="delete-selected-review-rows"
            >
              <Trash2 className="mr-2 h-4 w-4" />Delete Selected
            </Button>
          </div>}
          {!isDeletingRows && <div className="flex flex-col gap-3 rounded-lg border border-primary/15 bg-primary/[0.025] p-3 sm:flex-row sm:items-center sm:justify-between">
            <div><p className="text-sm font-medium">Owner-name lookup</p><p className="text-xs text-muted-foreground">Select up to five eligible salons below. Each search is budget-estimated and requires confirmation.</p></div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">{ownerSelectedIds.length}/5 selected</span>
              <Button size="sm" variant="outline" onClick={() => {
                setOwnerEstimate(null); setOwnerEstimateIds([]); setOwnerEstimateSearchesPerRow(null); setConfirmOwnerBatch(false);
                estimateOwnerBatch.mutate({ rowIds: [...ownerSelectedIds], searchesPerRow: ownerSearchesPerRow, selectionVersion: ownerSelectionVersion.current });
              }} disabled={!ownerSelectedIds.length || estimateOwnerBatch.isPending || searchOwnerBatch.isPending}>
                {estimateOwnerBatch.isPending ? "Estimating…" : "Estimate & search selected"}
              </Button>
              <Select value={String(ownerSearchesPerRow)} onValueChange={value => {
                const count = Number(value) as SearchesPerRow;
                setOwnerSearchesPerRow(count);
                setOwnerEstimate(null); setOwnerEstimateIds([]); setOwnerEstimateSearchesPerRow(null); setConfirmOwnerBatch(false);
                if (ownerSelectedIds.length) estimateOwnerBatch.mutate({ rowIds: [...ownerSelectedIds], searchesPerRow: count, selectionVersion: ownerSelectionVersion.current });
              }} disabled={estimateOwnerBatch.isPending || searchOwnerBatch.isPending}>
                <SelectTrigger className="h-9 w-[215px]" aria-label="Owner search phrases per salon"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="1">1 phrase per salon · default</SelectItem><SelectItem value="3">Up to 3 phrases per salon</SelectItem></SelectContent>
              </Select>
              {ownerSelectedIds.length > 0 && <Button size="sm" variant="ghost" onClick={() => { ownerSelectionVersion.current += 1; setOwnerSelectedIds([]); setOwnerEstimate(null); setOwnerEstimateIds([]); setOwnerEstimateSearchesPerRow(null); setConfirmOwnerBatch(false); }}>Clear selection</Button>}
            </div>
          </div>}
          {confirmOwnerBatch && ownerEstimate && !isDeletingRows && <div className="rounded-lg border border-amber-300/70 bg-amber-50 p-4 text-sm text-amber-950">
            <p className="font-semibold">Confirm paid owner search for {ownerSelectedIds.length} salon{ownerSelectedIds.length === 1 ? "" : "s"}</p>
            <p className="mt-1 text-xs leading-5">Searches per salon: {ownerEstimateSearchesPerRow ?? "—"}. Batch-wide cap: <strong>{ownerEstimate.maxProviderCalls} provider calls</strong> (maximum 15) and up to {ownerEstimate.maxPages} pages total; four-page cap per salon. Searches stop early when an owner is verified. Cached results are free; no paid retries. {ownerEstimate.remainingCredits} credits remain{ownerEstimate.reason ? ` · ${ownerEstimate.reason}` : ""}.</p>
            <div className="mt-3 flex flex-wrap gap-2"><Button size="sm" disabled={!ownerEstimate.allowed || ownerEstimate.maxProviderCalls < 0 || ownerEstimate.maxProviderCalls > 15 || ownerEstimateIds.join("|") !== [...ownerSelectedIds].sort().join("|") || ownerEstimateSearchesPerRow !== ownerSearchesPerRow || estimateOwnerBatch.isPending || searchOwnerBatch.isPending} onClick={() => searchOwnerBatch.mutate({ rowIds: [...ownerSelectedIds], searchesPerRow: ownerSearchesPerRow })}>{searchOwnerBatch.isPending ? "Searching…" : "Confirm searches"}</Button><Button size="sm" variant="outline" onClick={() => { setConfirmOwnerBatch(false); setOwnerEstimate(null); setOwnerEstimateIds([]); setOwnerEstimateSearchesPerRow(null); }}>Cancel</Button></div>
          </div>}

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
                const eligibility = rowEligibility(row);
                return <article key={row.id} className="overflow-hidden rounded-xl border-2 border-slate-400 bg-card transition-colors hover:border-primary/60 dark:border-slate-600">
                  <div className="flex flex-col gap-4 p-4 sm:p-5 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          type="checkbox"
                          checked={selectedDeleteIds.has(row.id)}
                          disabled={isDeletingRows}
                          onChange={() => setSelectedDeleteIds(current => {
                            const next = new Set(current);
                            if (next.has(row.id)) next.delete(row.id);
                            else next.add(row.id);
                            return next;
                          })}
                          aria-label={`Select ${row.businessName} for deletion`}
                          data-testid={`select-review-row-${row.id}`}
                          className="h-4 w-4 rounded border-input accent-primary"
                        />
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
                      {(row.suggestedFirstName || row.suggestedLastName) && <p className="mt-3 text-sm text-muted-foreground">Uploaded contact-name suggestion: <span className="font-medium text-foreground">{[row.suggestedFirstName, row.suggestedLastName].filter(Boolean).join(" ")}</span> · not confirmed. Review owner evidence below before using a personal greeting.</p>}
                      {row.evidenceNote && <p className="mt-3 max-w-3xl text-sm leading-5 text-foreground/80">{row.evidenceNote}</p>}
                      <div className="mt-3">
                        <DirectoryEligibilityReview row={row} eligibility={eligibility} endpoint={`/api/salon-enrichment/rows/${encodeURIComponent(row.id)}/eligibility`} invalidateKeys={[["/api/salon-search-report"], ["/api/salon-enrichment/batches"]]} />
                      </div>
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
                      <OwnerNameReview
                        rowId={row.id}
                        businessName={row.businessName}
                        ownerName={row.ownerName}
                        contactName={row.contactName}
                        sequences={seqStepOne.map(sequence => ({ id: sequence.id, subject: sequence.subject }))}
                        canSearch={categoryKey(row.category) !== "non_grooming" && !isDeletingRows}
                        selectedForBatch={ownerSelectedIds.includes(row.id)}
                        onSelectedForBatchChange={checked => {
                          ownerSelectionVersion.current += 1;
                          setOwnerEstimate(null); setOwnerEstimateIds([]); setOwnerEstimateSearchesPerRow(null); setConfirmOwnerBatch(false);
                          setOwnerSelectedIds(current => {
                            if (!checked) return current.filter(id => id !== row.id);
                            if (current.includes(row.id)) return current;
                            if (current.length >= 5) { toast({ title: "Batch limit reached", description: "Select up to five salons per owner-search batch.", variant: "destructive" }); return current; }
                            return [...current, row.id];
                          });
                        }}
                      />
                    </div>
                    <div className="flex flex-wrap gap-2 lg:w-[265px] lg:justify-end">
                      <Button size="sm" variant="ghost" onClick={() => openDeleteDialog([row])} disabled={isDeletingRows} className="text-destructive hover:text-destructive" aria-label={`Delete uploaded review row for ${row.businessName}`} data-testid={`delete-review-row-${row.id}`}>
                        <Trash2 className="mr-1.5 h-3.5 w-3.5" />Delete
                      </Button>
                        {isSuccess && !categoryIsRestricted && !eligibility.blocked && !isApproved && !isImported && <Button size="sm" variant="outline" onClick={() => review.mutate(row)} disabled={isDeletingRows || review.isPending}><ShieldCheck className="mr-1.5 h-3.5 w-3.5" />Approve email</Button>}
                        {isSuccess && !categoryIsRestricted && !eligibility.blocked && isApproved && !isImported && <Button size="sm" onClick={() => importContact.mutate(row)} disabled={isDeletingRows || importContact.isPending}><Upload className="mr-1.5 h-3.5 w-3.5" />Import contact</Button>}
                        {eligibility.blocked && <span className="w-full text-right text-xs font-medium text-amber-800">Grooming review required before approval or import</span>}
                        {!isSuccess && !eligibility.blocked && <span className="w-full text-right text-xs text-muted-foreground">{categoryIsRestricted ? "Not eligible for approval or import" : "Manual approval is reserved for successful matches"}</span>}
                      {isImported && !row.dealId && <Button size="sm" variant="outline" onClick={() => createDeal.mutate(row)} disabled={createDeal.isPending}><BriefcaseBusiness className="mr-1.5 h-3.5 w-3.5" />Create pipeline deal</Button>}
                      {isImported && !row.dealId && !row.sequenceStatus && <span className="w-full text-right text-xs text-muted-foreground">Create a pipeline deal before scheduling a sequence.</span>}
                        {isImported && row.dealId && !row.sequenceStatus && !eligibility.blocked && <Button size="sm" variant="outline" onClick={() => startSchedule(row)}><Mail className="mr-1.5 h-3.5 w-3.5" />Schedule sequence</Button>}
                    </div>
                  </div>
                </article>;
              })}
            </div>
          )}
          {!reportQuery.isError && <div className="flex items-center justify-between border-t pt-4">
            <p className="text-xs text-muted-foreground">Showing {totalRows === 0 ? 0 : page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, totalRows)} of {formatCount(totalRows)}</p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={isDeletingRows || page === 0 || reportQuery.isFetching} onClick={() => setPage(value => Math.max(0, value - 1))}><ArrowLeft className="mr-1.5 h-3.5 w-3.5" />Previous</Button>
              <Button variant="outline" size="sm" disabled={isDeletingRows || (page + 1) * PAGE_SIZE >= totalRows || reportQuery.isFetching} onClick={() => setPage(value => value + 1)}>Next<ArrowRight className="ml-1.5 h-3.5 w-3.5" /></Button>
            </div>
          </div>}
        </section>
      </main>

      <Dialog open={deleteDialogOpen} onOpenChange={open => { if (!isDeletingRows) setDeleteDialogOpen(open); }}>
        <DialogContent className="max-w-lg" data-testid="delete-review-row-confirmation">
          <DialogHeader>
            <DialogTitle>Delete {deleteTargets.length} uploaded {deleteTargets.length === 1 ? "review row" : "review rows"}?</DialogTitle>
            <DialogDescription>Confirm removal of these Sales Lead Review records.</DialogDescription>
          </DialogHeader>
          <ul className="max-h-48 space-y-2 overflow-y-auto rounded-md border p-3 text-sm" aria-label="Review rows selected for deletion">
            {deleteTargets.map(row => (
              <li key={row.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className="font-medium">{row.businessName}</span>
                <span className="text-muted-foreground">{[row.address, row.state].filter(Boolean).join(", ") || "Location not provided"}{row.phone ? ` · ${row.phone}` : ""}</span>
              </li>
            ))}
          </ul>
          <div className="space-y-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
            <p className="font-medium">This only removes the selected uploaded review rows.</p>
            <p>It does not delete CRM contacts or saved national search results, run owner or email lookups, or send mail.</p>
            <p>Rows that are imported, linked to a deal, or actively being verified cannot be removed.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={isDeletingRows} onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
            <Button variant="destructive" disabled={isDeletingRows || !deleteTargets.length} onClick={deleteReviewRows} data-testid="confirm-delete-review-rows">
              <Trash2 className="mr-2 h-4 w-4" />
              {isDeletingRows ? "Deleting…" : `Delete ${deleteTargets.length} ${deleteTargets.length === 1 ? "row" : "rows"}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
              {sequenceId && <div className="rounded-lg border bg-muted/20 p-3">
                <p className="text-xs font-semibold">Rendered email preview</p>
                {schedulePreview.isLoading ? <p className="mt-2 text-xs text-muted-foreground">Rendering the selected template…</p> :
                  schedulePreview.isError ? <div className="mt-2 text-xs text-destructive">{(schedulePreview.error as Error).message}<Button size="sm" variant="ghost" className="ml-1 h-7" onClick={() => schedulePreview.refetch()}>Retry</Button></div> :
                    schedulePreview.data && <><p className="mt-2 text-sm font-medium">{schedulePreview.data.subject}</p><p className="mt-1 text-xs text-muted-foreground">{schedulePreview.data.salutation} · {schedulePreview.data.mode}</p><pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap font-sans text-xs leading-5">{schedulePreview.data.body}</pre></>}
              </div>}
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