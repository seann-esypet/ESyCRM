import { z } from "zod";
import { storage } from "./storage";
import { getProviderCredits } from "./providerCredits";
import type { ProviderCredits } from "@shared/providerCredits";
import { APPROVED_SERP_BUDGET, serpMonthYear, type SharedProviderBudget } from "@shared/serpBudget";

const updateSchema = z.object({
  confirmed: z.literal(true),
  monthlyQuota: z.literal(APPROVED_SERP_BUDGET.monthlyQuota),
  hardStopAt: z.literal(APPROVED_SERP_BUDGET.hardStopAt),
}).strict();

type BudgetUsage = {
  monthYear: string; monthlyQuota: number; hardStopAt: number; usedCredits: number;
};
export function sharedBudgetSnapshot(usage: BudgetUsage): SharedProviderBudget {
  return {
    monthYear: usage.monthYear, monthlyQuota: usage.monthlyQuota,
    hardStopAt: usage.hardStopAt, used: usage.usedCredits,
    remaining: Math.max(0, usage.hardStopAt - usage.usedCredits),
  };
}
export async function readSharedProviderBudget() {
  return sharedBudgetSnapshot(await storage.getOrCreateSerpUsage(serpMonthYear()));
}

export type BudgetUpdateDependencies = {
  credits: () => Promise<ProviderCredits>;
  update: (month: string, quota: number, stop: number) => Promise<BudgetUsage | undefined>;
  month: () => string;
};
const defaults: BudgetUpdateDependencies = {
  credits: getProviderCredits,
  update: (month, quota, stop) => storage.updateSerpQuota(month, quota, stop),
  month: serpMonthYear,
};

export async function confirmSharedProviderBudget(
  role: string, input: unknown, dependencies = defaults,
) {
  if (role !== "admin") throw new Error("Only an administrator can change the shared monthly safety budget.");
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) throw new Error("Confirm exactly a 1,000-search allowance and an 800-attempt shared safety stop.");
  const credits = await dependencies.credits();
  if (credits.status !== "available" || credits.monthlyLimit === null ||
      credits.monthlyLimit < APPROVED_SERP_BUDGET.monthlyQuota) {
    throw new Error("Verify a SerpAPI allowance of at least 1,000 searches before updating the shared budget. Check the provider balance and try again.");
  }
  const usage = await dependencies.update(
    dependencies.month(), parsed.data.monthlyQuota, parsed.data.hardStopAt,
  );
  if (!usage) throw new Error("Shared budget update was not saved. No research was resumed.");
  // No list, attempt, reservation or enabled-state mutation is authorized here.
  return sharedBudgetSnapshot(usage);
}
