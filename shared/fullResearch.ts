import { z } from "zod";

export const FULL_RESEARCH_DEFAULTS = {
  businessesPerHour: 20, paidCallsPerHour: 80, paidCallsPerList: 200,
};
export const fullResearchLimitsSchema = z.object({
  businessesPerHour: z.number().int().min(1).max(100),
  paidCallsPerHour: z.number().int().min(1).max(100),
  paidCallsPerList: z.number().int().min(1).max(10000),
});
export type FullResearchLimits = z.infer<typeof fullResearchLimitsSchema>;
export type FullResearchProgress = {
  status: "running" | "waiting_hourly" | "paused" | "completed" | "budget_exhausted" | "interrupted";
  enabled: boolean;
  limits: FullResearchLimits;
  processedIds: string[];
  startedRows: { id: string; at: string }[];
  attempts: { at: string; tool: string; rowId: string }[];
  currentRowId: string | null;
  nextRunAt: string | null;
  error: string | null;
  startedAt: string;
  notificationId?: string;
  waitReason?: "provider_rate_limit";
  providerRateLimitCount?: number;
  lease?: { token: string; expiresAt: string } | null;
};