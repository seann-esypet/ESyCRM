import { fullResearchLimitsSchema, type FullResearchProgress, type FullResearchLimits } from "@shared/fullResearch";

export const FULL_RESEARCH_HOUR = 60 * 60 * 1000;
export function isHourlyResearchError(message: string | null | undefined) {
  return /hourly (?:serp |shared provider |provider-call budget )?limit|hourly shared provider allowance/i.test(message || "");
}
export function isTemporaryProviderResearchError(message: string | null | undefined) {
  return /SerpAPI rate limit reached|SerpAPI returned HTTP 429/i.test(message || "");
}
export function readFullResearch(value: unknown): FullResearchProgress | null {
  if (value == null) return null;
  const run = value as FullResearchProgress;
  fullResearchLimitsSchema.parse(run.limits);
  if (run.providerRateLimitCount != null && (!Number.isInteger(run.providerRateLimitCount) || run.providerRateLimitCount < 0)) {
    throw new Error("Research retry accounting is invalid. Review before resuming.");
  }
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
export type FullResearchBlock = { status: "waiting_hourly" | "budget_exhausted" | "paused"; nextRunAt: string | null; message: string; waitReason?: "provider_rate_limit" };
export function providerRateLimitWait(run: FullResearchProgress, now: number, retryAfterMs = 0): FullResearchBlock {
  // A total cap or user pause always takes precedence over automatic retries.
  const allowance = researchAllowance(run, "paid", now);
  if (allowance && allowance.status !== "waiting_hourly") return allowance;
  const count = (run.providerRateLimitCount ?? 0) + 1;
  run.providerRateLimitCount = count;
  if (count > 5) return {
    status: "paused", nextRunAt: null,
    message: "The provider is still rate-limiting after five automatic retries. Review the provider account before resuming; all paid attempts remain counted.",
  };
  const backoff = Math.min(5 * 60_000 * 2 ** (count - 1), FULL_RESEARCH_HOUR);
  const businessAllowance = researchAllowance(run, "business", now);
  return {
    status: "waiting_hourly", waitReason: "provider_rate_limit",
    nextRunAt: new Date(Math.max(now + backoff, now + retryAfterMs,
      allowance?.nextRunAt ? Date.parse(allowance.nextRunAt) : 0,
      businessAllowance?.nextRunAt ? Date.parse(businessAllowance.nextRunAt) : 0)).toISOString(),
    message: `Temporary provider rate limit. Automatic retry ${count}/5 is scheduled; paid attempts remain counted.`,
  };
}
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