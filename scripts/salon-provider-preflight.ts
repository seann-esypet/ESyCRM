// Read-only account/application checks. Never log account identity or credentials.
import XLSX from "xlsx";
import { getSerpUsageStatus } from "../server/lead-discovery";
import { storage } from "../server/storage";
import { pool } from "../server/db";

try {
  const status = await getSerpUsageStatus();
  const sample = XLSX.utils.sheet_to_json<Record<string, any>>(
    XLSX.readFile("reports/salon-provider-comparison-sample.xlsx").Sheets.Sample,
  );
  let cached = 0;
  for (const row of sample) {
    const value = await storage.getSerpCache(String(row.ZIP), `salon-enrichment:place:${row["Google Place ID"]}`, row.State, 30);
    if (value) cached++;
  }
  const response = await fetch("https://serpapi.com/account.json", {
    headers: { Authorization: `Bearer ${process.env.SERPAPI_API_KEY}` },
    signal: AbortSignal.timeout(15000),
  });
  // The account endpoint requires api_key; don't log URLs or raw responses.
  let account: any = response.ok ? await response.json() : null;
  if (!account || account.error) {
    const fallback = await fetch(`https://serpapi.com/account.json?${new URLSearchParams({ api_key: process.env.SERPAPI_API_KEY! })}`, {
      signal: AbortSignal.timeout(15000),
    });
    account = fallback.ok ? await fallback.json() : null;
  }
  console.log(JSON.stringify({
    checkedAt: new Date().toISOString(),
    sample: sample.length,
    sampleCacheHits: cached,
    monthlyUsed: status.usage.usedCredits,
    monthlyHardStop: status.usage.hardStopAt,
    hourlyCap: status.config.maxSerpCallsPerHour,
    callsLastHour: await storage.getSerpCallsInLastHour(),
    account: account && !account.error ? {
      plan: account.account_rate_limit_per_hour,
      monthlyLimit: account.searches_per_month,
      remaining: account.total_searches_left,
      usedThisMonth: account.this_month_usage,
      lastHour: account.last_hour_searches,
    } : { status: "unavailable" },
  }, null, 2));
} catch {
  console.error("Preflight failed; no paid lookup was initiated. Check database/account configuration.");
  process.exitCode = 1;
} finally {
  await pool.end();
}