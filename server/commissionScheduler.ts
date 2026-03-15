import { storage } from "./storage";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

async function processMonthlyCommissions() {
  console.log("[CommissionScheduler] Processing monthly commissions...");
  let created = 0;

  try {
    const allCommissions = await storage.getCommissions(null);

    for (const commission of allCommissions) {
      if (!commission.confirmedAt) continue;

      const confirmedAt = new Date(commission.confirmedAt);
      const now = new Date();
      const msElapsed = now.getTime() - confirmedAt.getTime();
      const periodsElapsed = Math.floor(msElapsed / THIRTY_DAYS_MS);

      if (periodsElapsed < 1) continue;

      const existingPayments = await storage.getMonthlyPaymentsForCommission(commission.id);
      const existingPeriods = new Set(existingPayments.map((p) => p.periodNumber));

      for (let period = 1; period <= periodsElapsed; period++) {
        if (existingPeriods.has(period)) continue;

        const paidAt = new Date(confirmedAt.getTime() + period * THIRTY_DAYS_MS);

        // Safety guard: never create a recurring payment on or before the won date.
        // Period 1 must be at least 29 days after confirmedAt, period 2 at least 59 days, etc.
        const minDaysRequired = period * 30 - 1;
        const daysElapsed = (now.getTime() - confirmedAt.getTime()) / (24 * 60 * 60 * 1000);
        if (daysElapsed < minDaysRequired) {
          console.warn(`[CommissionScheduler] Skipping period ${period} for commission ${commission.id} — only ${Math.floor(daysElapsed)} days elapsed, need ${minDaysRequired}`);
          continue;
        }

        await storage.createMonthlyPayment({
          commissionId: commission.id,
          dealId: commission.dealId,
          userId: commission.userId,
          amount: commission.monthlyAmount,
          periodNumber: period,
          paidAt,
        });
        created++;
      }
    }

    console.log(`[CommissionScheduler] Done. Created ${created} new monthly payment(s).`);
  } catch (error) {
    console.error("[CommissionScheduler] Error:", error);
  }
}

export function startCommissionScheduler() {
  console.log("Starting commission monthly payment scheduler (runs every 24 hours)");

  processMonthlyCommissions();

  setInterval(processMonthlyCommissions, 24 * 60 * 60 * 1000);
}
