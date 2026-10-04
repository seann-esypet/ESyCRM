/**
 * Fixed-sample, read-only research runner. Uses the application's actual Maps
 * lookup/cache/call reservations and production website crawler. Does not import,
 * enroll, send, submit forms, request Google Places, or call DataForSEO.
 *
 * Explicit --run flag required. Resume never repeats an initiated lookup whose
 * result was lost. A per-attempt file ledger is independent of returned rows.
 */
import { existsSync, readFileSync } from "node:fs";
import { SalonPilotState, PilotClosedError } from "./salonPilotState";
import XLSX from "xlsx";
import { getSerpUsageStatus, searchWithSerpApi, crawlWebsite } from "../server/lead-discovery";
import { storage } from "../server/storage";
import { pool } from "../server/db";
import { audit } from "./audit-salon-sites.mjs";

const output = "reports/salon-provider-comparison-progress.json";
const lockPath = "reports/.salon-provider-comparison.lock";
const pilot = new SalonPilotState(output, lockPath);
const MAX_REQUESTS = 120;
const MAX_USD = 10;
// Conservative allocation at the smallest paid public plan's per-credit rate.
// This is NOT an invoice or a claimed incremental charge on the existing plan.
const ALLOCATION_PER_ATTEMPT_USD = 0.025;
const wait = (ms: number) => pilot.wait(ms);
const load = (path: string, sheet: string) =>
  XLSX.utils.sheet_to_json<Record<string, any>>(XLSX.readFile(path).Sheets[sheet]);
export function interleave(sample: Record<string, any>[]) {
  const queues = ["CA", "TX", "NY"].map(state => sample.filter(row => row.State === state));
  const result: Record<string, any>[] = [];
  // Preserve every original row/ID, but give early batches all three states.
  while (queues.some(queue => queue.length)) {
    for (const queue of queues) if (queue.length) result.push(queue.shift()!);
  }
  return result;
}
function save(state: any) {
  pilot.save(state);
}
function safeError(error: unknown): string {
  const text = error instanceof Error ? error.message : "";
  if (/quota|hourly|limit|credit/i.test(text)) return "Application/provider quota or hourly limit; no automatic retry.";
  return "Lookup/crawl failed; raw error omitted to protect credentials. Attempt is retained.";
}
function cleanUrl(raw: unknown): string {
  if (!raw) return "";
  try {
    const url = new URL(String(raw));
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return "";
    url.hash = "";
    url.search = "";
    return url.href;
  } catch { return ""; }
}
function siteKey(raw: string): string {
  // Shared-site reuse applies only to the exact page, not every branch on a host.
  return raw.replace(/^http:/, "https:").replace("://www.", "://").replace(/\/$/, "");
}
async function accountSnapshot() {
  const res = await fetch(`https://serpapi.com/account.json?${new URLSearchParams({
    api_key: process.env.SERPAPI_API_KEY!,
  })}`, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error("Account verification failed");
  const data = await res.json();
  if (data.error || !Number.isFinite(data.total_searches_left) ||
      !Number.isFinite(data.this_month_usage)) throw new Error("Account verification unavailable");
  return {
    checkedAt: new Date().toISOString(),
    monthlyLimit: data.searches_per_month,
    usedThisMonth: data.this_month_usage,
    remaining: data.total_searches_left,
    lastHour: data.last_hour_searches,
  };
}
async function auditSite(row: any, url: string, category: string, state: any) {
  pilot.assertOpen();
  if (!url) return null;
  const key = siteKey(url);
  if (state.sites[key]) return key;
  const started = Date.now();
  // Skip social/booking/directory URLs and non-grooming controls in both paths.
  const evidence = await audit({
    placeId: row["Google Place ID"], name: row["Salon name"],
    state: row.State, address: row["Full address"], url, category,
  });
  let production: any = null;
  if (!["social_booking_or_directory_url", "unrelated_business_control", "unsafe_url"].includes(evidence.outcome)) {
    try {
      const { html: _html, ...result } = await crawlWebsite(url);
      production = result;
    } catch { production = { error: "Crawl failed; source not assessed" }; }
  }
  state.sites[key] = {
    auditedAt: new Date().toISOString(), elapsedMs: Date.now() - started,
    production, evidence, reviewStatus: "pending_manual_source_review",
  };
  save(state);
  return key;
}

async function main() {
  const sample = interleave(load("reports/salon-provider-comparison-sample.xlsx", "Sample"));
  const existing = load("reports/salon-dataforseo-120-pilot.xlsx", "DataForSEO lookup");
  const lower = new Map(existing.map(row => [row["Google Place ID"], row]));
  if (sample.length !== 120 || new Set(sample.map(row => row["Google Place ID"])).size !== 120 ||
      lower.size !== 120 || sample.some(row => !lower.has(row["Google Place ID"]))) {
    throw new Error("Fixed sample and saved DataForSEO IDs do not match");
  }
  if (process.argv.includes("--close-now")) {
    if (!existsSync(output)) throw new Error("No saved comparison to close");
    const closure = pilot.requestClose(); // Durable first; wakes a waiting worker.
    await pilot.waitForWorker(); // Preserve its in-flight results and attempt ledger.
    const state = JSON.parse(readFileSync(output, "utf8"));
    Object.assign(state, closure);
    save(state); // Persist the stop even if final read-only accounting fails.
    try {
      state.accountSnapshots.push(await accountSnapshot());
      const usage = await getSerpUsageStatus();
      state.applicationFinalUsage = { used: usage.usage.usedCredits, cap: usage.usage.hardStopAt };
    } catch {
      state.finalAccountingNote = "Final read-only accounting unavailable; prior snapshots retained, no new lookup attempted.";
    }
    save(state);
    console.log(JSON.stringify({ status: state.status,
      paired: Object.values(state.rows).filter((row: any) => row.serpApi).length,
      attempts: state.attempts.length, finalAccount: state.accountSnapshots.at(-1) }));
    return;
  }
  if (!process.argv.includes("--run")) {
    console.log(JSON.stringify({ mode: "dry-run", rows: 120, newDataForSEOCalls: 0,
      googleCalls: 0, maxAdditionalUsd: MAX_USD, maxSerpAttempts: MAX_REQUESTS }));
    return;
  }
  if (pilot.closure()) {
    console.log("PILOT_CLOSED_BY_USER_NOT_RESUMED — no requests made; new explicit authorization required.");
    return;
  }
  if (!process.env.SERPAPI_API_KEY) throw new Error("Missing SerpApi configuration");
  pilot.acquire();
  let state: any;
  try {
    state = existsSync(output) ? JSON.parse(readFileSync(output, "utf8")) : {
      startedAt: new Date().toISOString(), status: "running",
      authorization: { additionalUsdLimit: MAX_USD, monthlyApplicationCapUnchanged: 200,
        scope: "SerpApi versus saved DataForSEO; Google excluded by user",
        imports: 0, messages: 0, formSubmissions: 0, facebookScraping: false },
      dataForSeo: { savedTasks: 120, savedReportedTaskCostUsd: 0.18, newCalls: 0 },
      attempts: [], rows: {}, sites: {}, accountSnapshots: [],
    };
    // Every account snapshot is non-search and contains counts only.
    state.accountSnapshots.push(await accountSnapshot());
    save(state);
    // Initialize both sides on precisely the same fixed sample.
    for (const row of sample) {
      const id = row["Google Place ID"];
      const saved = lower.get(id)!;
      state.rows[id] ??= { sample: row, dataForSeo: {
        returnedWebsite: cleanUrl(saved["Website URL (query removed)"]),
        exactPlaceId: saved["Exact Place ID match"] === "Yes",
        category: saved["Provider category"],
        returnedContactUrl: cleanUrl(saved["Provider contact URL (NOT a verified form)"]),
        providerStatus: saved["Provider status"], historicalTaskCostUsd: 0.0015,
      } };
    }
    save(state);
    const auditLower = async (row: any) => {
      const record = state.rows[row["Google Place ID"]].dataForSeo;
      if (record.siteKey === undefined) {
        record.siteKey = await auditSite(row, record.returnedWebsite, record.category || "", state);
        save(state);
      }
    };
    for (const row of sample) {
      pilot.assertOpen();
      const id = row["Google Place ID"];
      const record = state.rows[id];
      if (record.serpApi) {
        await auditLower(row);
        if (record.serpApi.returnedWebsite && record.serpApi.siteKey === undefined) {
          record.serpApi.siteKey = await auditSite(row, record.serpApi.returnedWebsite,
            record.serpApi.category || "", state);
          save(state);
        }
        continue;
      }
      if (state.attempts.some((attempt: any) => attempt.placeId === id)) {
        record.serpApi = { status: "unknown_after_interruption", reviewStatus: "not_assessed" };
        save(state);
        continue;
      }
      const zip = String(row.ZIP);
      const template = `salon-enrichment:place:${id}`;
      let cached = await storage.getSerpCache(zip, template, row.State, 30);
      let status = await getSerpUsageStatus();
      if (!cached) {
        if (state.attempts.length >= MAX_REQUESTS ||
            (state.attempts.length + 1) * ALLOCATION_PER_ATTEMPT_USD > MAX_USD ||
            status.usage.usedCredits >= Math.min(200, status.usage.hardStopAt)) {
          state.status = "stopped_budget_or_monthly_cap";
          save(state);
          console.log("STOPPED_BUDGET_OR_MONTHLY_CAP");
          return;
        }
        while (await storage.getSerpCallsInLastHour() >= (status.config.maxSerpCallsPerHour || 5)) {
          state.status = "waiting_hourly_allowance";
          save(state);
          console.log(`WAITING_HOURLY_ALLOWANCE completed=${Object.values(state.rows).filter((r: any) => r.serpApi).length}/120`);
          // Use the first enforced pause for the remaining saved-provider sites.
          // These are public-page GETs, not paid lookup requests.
          if (!state.lowerSitesAudited) {
            for (const remaining of sample) await auditLower(remaining);
            state.lowerSitesAudited = true;
            save(state);
            console.log("SAVED_DATAFORSEO_SITES_AUDITED");
          }
          await wait(60000);
          status = await getSerpUsageStatus();
          if (status.usage.usedCredits >= Math.min(200, status.usage.hardStopAt)) {
            state.status = "stopped_monthly_cap";
            save(state);
            return;
          }
        }
        const account = await accountSnapshot();
        state.accountSnapshots.push(account);
        // Never exhaust provider balance and risk automatic early renewal.
        if (account.remaining < 2) {
          state.status = "stopped_provider_balance";
          save(state);
          return;
        }
        // Cache could have been populated while the runner waited.
        cached = await storage.getSerpCache(zip, template, row.State, 30);
        if (!cached) {
          state.attempts.push({ placeId: id, initiatedAt: new Date().toISOString(),
            allocationUsd: ALLOCATION_PER_ATTEMPT_USD, status: "initiated" });
          save(state); // Durable before provider invocation; never refund this ledger.
        }
      }
      state.status = "running";
      pilot.assertOpen();
      const started = Date.now();
      const beforeAccount = state.accountSnapshots.at(-1);
      try {
        const result = await searchWithSerpApi(`"${row["Salon name"]}" "${row["Full address"]}"`,
          zip, row.State, template, { placeId: id, beforeProviderRequest: () => pilot.assertOpen() });
        const match = result.results.find(candidate => candidate.placeId === id);
        record.serpApi = {
          status: match ? "matched" : "no_exact_place_id_match",
          fromCache: result.fromCache,
          // All returned candidates remain review evidence, never contact imports.
          candidates: result.results.map(candidate => ({ ...candidate, link: cleanUrl(candidate.link) })),
          returnedWebsite: cleanUrl(match?.link), exactPlaceId: !!match,
          category: match?.categories?.join(" | ") || "",
          lookupElapsedMs: Date.now() - started,
        };
        const attempt = state.attempts.find((a: any) => a.placeId === id);
        if (attempt) attempt.status = result.fromCache ? "cache_race_no_provider_request" : "provider_response_received";
        save(state); // Preserve collected results even if subsequent accounting fails.
        if (!result.fromCache) {
          const afterAccount = await accountSnapshot();
          state.accountSnapshots.push(afterAccount);
          record.serpApi.observedAccountCreditDelta = afterAccount.usedThisMonth - beforeAccount.usedThisMonth;
          record.serpApi.creditDeltaCaveat = "Account-wide counter; concurrent application searches may affect attribution.";
        } else {
          record.serpApi.observedAccountCreditDelta = 0;
        }
        save(state);
        await auditLower(row);
        record.serpApi.siteKey = await auditSite(row, record.serpApi.returnedWebsite,
          record.serpApi.category, state);
      } catch (error) {
        if (error instanceof PilotClosedError) throw error;
        record.serpApi ??= { status: "failed", lookupElapsedMs: Date.now() - started };
        record.serpApi.error = safeError(error);
        const attempt = state.attempts.find((a: any) => a.placeId === id);
        if (attempt && attempt.status === "initiated") attempt.status = "failed_billing_unconfirmed";
        if (error instanceof Error && error.message === "SerpAPI lookup failed") {
          // A completed provider response without usable place data is a measured
          // row failure, not an unsafe accounting failure. Retain the attempt,
          // do not retry this ID, and continue with other distinct sample IDs.
          record.serpApi.error = "Provider returned an error/no usable place result; not retried.";
          save(state);
          await auditLower(row);
          console.log(`ROW_LOOKUP_FAILED_NOT_RETRIED completed=${Object.values(state.rows).filter((r: any) => r.serpApi).length}/120`);
          continue;
        }
        // Stop rather than giving later rows a renewed allowance or blindly retrying.
        state.status = "stopped_lookup_failure";
        save(state);
        console.log("STOPPED_LOOKUP_FAILURE");
        return;
      }
      save(state);
      console.log(`LOOKUP_PROGRESS completed=${Object.values(state.rows).filter((r: any) => r.serpApi).length}/120 attempts=${state.attempts.length}`);
    }
    for (const row of sample) await auditLower(row);
    state.lowerSitesAudited = true;
    // Let provider usage counters settle; immediate zero deltas are not free-use proof.
    await wait(60000);
    state.accountSnapshots.push(await accountSnapshot());
    const status = await getSerpUsageStatus();
    state.applicationFinalUsage = { used: status.usage.usedCredits, cap: status.usage.hardStopAt };
    state.status = "lookups_complete_review_pending";
    save(state);
    console.log("ALL_120_LOOKUPS_COMPLETE_REVIEW_PENDING");
  } finally {
    try { if (state && pilot.closure()) save(state); }
    finally { pilot.release(); }
  }
}
main().catch(error => {
  if (error instanceof PilotClosedError) {
    console.log("PILOT_CLOSED_BY_USER — saved in-flight evidence retained; no further requests.");
    return;
  }
  console.error("Comparison stopped unexpectedly. No automatic retry; inspect the saved attempt ledger before resuming.");
  process.exitCode = 1;
}).finally(() => pool.end());