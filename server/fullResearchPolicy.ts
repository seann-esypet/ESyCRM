import { fullResearchLimitsSchema, type FullResearchProgress, type FullResearchLimits } from "@shared/fullResearch";

export const FULL_RESEARCH_HOUR = 60 * 60 * 1000;
export function isHourlyResearchError(message: string | null | undefined) {
  return /hourly (?:serp |shared provider |provider-call budget )?limit|hourly shared provider allowance/i.test(message || "");
}
export function readFullResearch(value: unknown): FullResearchProgress | null {
  if (value == null) return null;
  const run = value as FullResearchProgress;
  fullResearchLimitsSchema.parse(run.limits);
  if (!Array.isArray(run.processedIds) || !Array.isArray(run.startedRows) || !Array.isArray(run.attempts) ||
      !run.startedRows.every(row => typeof row.id === "string" && Number.isFinite(Date.parse(row.at))) ||
      !run.attempts.every(call => typeof call.rowId === "string" && typeof call.tool === "string" && Number.isFinite(Date.parse(call.at)))) {
    throw new Error("Research accounting is invalid. Research stopped; do not reset its paid-request history.");
  }
  return run;
}
export function newFullResearch(limits: FullResearchLimits, now: number): FullResearchProgress {
  return { status: "running", enabled: true, limits, processedIds: [], startedRows: [], attempts: [],
    currentRowId: null, nextRunAt: null, error: null, startedAt: new Date(now).toISOString(), lease: null };
}
export type FullResearchBlock = { status: "waiting_hourly" | "budget_exhausted" | "paused"; nextRunAt: string | null; message: string };
export function researchAllowance(run: FullResearchProgress, kind: "business" | "paid", now: number): FullResearchBlock | null {
  if (!run.enabled) return { status: "paused", nextRunAt: null, message: "Research is paused. No further paid request was initiated." };
  if (run.attempts.length >= run.limits.paidCallsPerList) return {
    status: "budget_exhausted", nextRunAt: null,
    message: "The confirmed list-wide provider-call budget is exhausted. Approve a higher total limit to continue.",
  };
  const events = kind === "business" ? run.startedRows : run.attempts;
  const limit = kind === "business" ? run.limits.businessesPerHour : run.limits.paidCallsPerHour;
  const recent = events.map(item => Date.parse(item.at)).filter(at => at > now - FULL_RESEARCH_HOUR).sort((a, b) => a - b);
  if (recent.length < limit) return null;
  return { status: "waiting_hourly", nextRunAt: new Date(recent[recent.length - limit] + FULL_RESEARCH_HOUR).toISOString(),
    message: `Hourly ${kind === "business" ? "business" : "provider-call budget"} limit reached. Research will continue when allowance becomes available.` };
}
export function reserveResearchPaidCall(run: FullResearchProgress, rowId: string, tool: string, now: number) {
  const block = researchAllowance(run, "paid", now);
  if (block) return block;
  run.attempts.push({ rowId, tool, at: new Date(now).toISOString() });
  return null;
}
export function hasResearchLease(run: FullResearchProgress, now: number) {
  return !!run.lease && Date.parse(run.lease.expiresAt) > now;
}