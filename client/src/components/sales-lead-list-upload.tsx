import React, { useRef, useState } from "react";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { AlertCircle, CheckCircle2, FileSpreadsheet, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";

const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
const MAX_ROWS = 5000;

type RawRow = Record<string, unknown>;

interface StageResponse {
  batch: { id: string };
  stagedCount: number;
  duplicateCount: number;
  invalidCount: number;
  duplicateSummary: string;
  externalSearches: number;
}

interface Props {
  onSuccess: (result: StageResponse) => void;
}

function field(row: RawRow, aliases: string[]): string {
  const key = Object.keys(row).find(candidate =>
    aliases.some(alias => candidate.toLowerCase().replace(/[^a-z0-9]/g, "") === alias.toLowerCase().replace(/[^a-z0-9]/g, "")),
  );
  return key && row[key] != null ? String(row[key]).trim() : "";
}

async function parseFile(file: File): Promise<RawRow[]> {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (file.size > MAX_UPLOAD_BYTES) throw new Error("File exceeds the 2 MB upload limit.");
  if (extension === "csv") {
    const result = Papa.parse<RawRow>(await file.text(), {
      header: true,
      skipEmptyLines: true,
      transformHeader: header => header.trim(),
    });
    if (result.errors.length) throw new Error(`CSV parsing failed: ${result.errors[0].message}`);
    if (result.data.length > MAX_ROWS) throw new Error(`A list can contain no more than ${MAX_ROWS.toLocaleString()} rows.`);
    return result.data;
  }
  if (extension !== "xlsx" && extension !== "xls") {
    throw new Error("Choose a CSV, XLSX, or XLS file.");
  }
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellFormula: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error("The workbook does not contain a readable sheet.");
  // Do not use cached formula results as uploaded contact data.
  for (const [address, cell] of Object.entries(sheet)) {
    if (address.startsWith("!") || !cell || typeof cell !== "object") continue;
    if ("f" in cell) {
      delete (cell as XLSX.CellObject).v;
      delete (cell as XLSX.CellObject).w;
    }
  }
  const rows = XLSX.utils.sheet_to_json<RawRow>(sheet, { defval: "", raw: false });
  if (rows.length > MAX_ROWS) throw new Error(`A list can contain no more than ${MAX_ROWS.toLocaleString()} rows.`);
  return rows;
}

export default function SalesLeadListUpload({ onSuccess }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<RawRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<StageResponse | null>(null);

  const chooseFile = async (selected: File | undefined) => {
    if (!selected) return;
    setError("");
    setResult(null);
    setConfirmed(false);
    setFile(selected);
    setRows([]);
    try {
      const parsed = await parseFile(selected);
      setRows(parsed);
      if (!parsed.length) setError("No data rows were found in the first sheet.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not read this file.");
    }
  };

  const stage = async () => {
    if (!file || !rows.length || !confirmed || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await apiRequest("POST", "/api/salon-search-report/stage-list", {
        name: file.name,
        rows,
      });
      const data = await response.json() as StageResponse;
      setResult(data);
      onSuccess(data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not stage this list.");
    } finally {
      setBusy(false);
    }
  };

  const preview = rows.slice(0, 5);

  return (
    <section id="sales-lead-list-upload" className="rounded-lg border-2 border-slate-400 bg-card p-4 space-y-3 dark:border-slate-600" aria-label="Upload a sales lead list">
      <div className="flex items-start gap-3">
        <FileSpreadsheet className="mt-1 h-5 w-5 shrink-0 text-muted-foreground" />
        <div>
          <h3 className="font-medium">Upload a Lead List · CSV or Excel</h3>
          <p className="text-sm text-muted-foreground">
            Add your list here for review. Uploaded emails and names are unverified. No contacts are imported, no paid lookups run, and no emails are sent.
          </p>
        </div>
      </div>
      <input
        ref={inputRef}
        id="sales-lead-list-file"
        disabled={busy}
        className="sr-only"
        type="file"
        accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
        onChange={event => { void chooseFile(event.target.files?.[0]); event.currentTarget.value = ""; }}
        aria-label="Choose CSV or Excel list"
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" onClick={() => inputRef.current?.click()} disabled={busy}>
          <Upload className="h-4 w-4" /> Choose CSV or Excel File
        </Button>
        {file && <span className="text-sm text-muted-foreground">{file.name}</span>}
      </div>

      {rows.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm">
            <strong>{rows.length.toLocaleString()}</strong> rows ready to preview · first {preview.length} shown
            {rows.length > preview.length ? " · duplicate rows are summarized after staging" : ""}
          </p>
          <div className="overflow-x-auto rounded border-2 border-slate-400 dark:border-slate-600">
            <table className="w-full text-left text-xs">
              <thead className="bg-muted text-muted-foreground">
                <tr><th className="p-2">Business</th><th className="p-2">Candidate email (unverified)</th><th className="p-2">Uploaded email source</th><th className="p-2">Uploaded name suggestion</th><th className="p-2">State / address</th></tr>
              </thead>
              <tbody>
                {preview.map((row, index) => {
                  const first = field(row, ["Business Name", "Business", "company"]);
                  const email = field(row, ["Email"]);
                  const source = field(row, ["source", "Source"]);
                  const names = [field(row, ["Owner First Name", "firstName"]), field(row, ["Owner Last Name", "lastName"])].filter(Boolean).join(" ");
                  const location = [field(row, ["State"]), field(row, ["Address"])].filter(Boolean).join(" · ");
                  return <tr key={index} className="border-t">
                    <td className="max-w-48 truncate p-2">{first || "—"}</td>
                    <td className="max-w-48 truncate p-2">{email || "—"}</td>
                    <td className="max-w-40 truncate p-2">{source || (email ? "Uploaded list; unverified" : "—")}</td>
                    <td className="max-w-40 truncate p-2">{names || "—"}</td>
                    <td className="max-w-48 truncate p-2">{location || "—"}</td>
                  </tr>;
                })}
              </tbody>
            </table>
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} disabled={busy} className="mt-1" />
            <span>I understand these uploaded details are suggestions only: emails are not verified or approved, and names are not confirmed owners.</span>
          </label>
          <Button type="button" onClick={() => void stage()} disabled={!confirmed || busy || !!result}>
            {busy ? "Adding list…" : result ? "List Added" : "Add List for Review"}
          </Button>
        </div>
      )}

      {error && <p role="alert" className="flex items-center gap-2 text-sm text-destructive"><AlertCircle className="h-4 w-4" />{error}</p>}
      {result && <div role="status" className="space-y-2 text-sm text-green-700">
        <p className="flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4" />
          Added {result.stagedCount} leads for review. {result.duplicateSummary}
          {result.invalidCount ? `; ${result.invalidCount} rows without a business name skipped.` : ""}
        </p>
        <a className="inline-flex font-medium text-primary underline underline-offset-4" href={`/salon-enrichment/${encodeURIComponent(result.batch.id)}`}>
          Verify/enrich this batch in Salon Enrichment
        </a>
      </div>}
    </section>
  );
}