import { storage } from "./storage";
import { sendEmail } from "./sendgrid";

const REPORT_RECIPIENTS = [
  "ravin@esypet.com",
  "seann@esypet.com",
  "srinath@esyntaxis.com",
];

const TIMEZONE = "America/New_York";

// Report sends at this hour (Eastern Time), 24-hour format
const REPORT_HOUR_ET = 18; // 6:00 PM ET

/**
 * Get the start and end of "today" in Eastern Time, returned as UTC Date objects.
 */
function getTodayRangeET(): { start: Date; end: Date } {
  const nowET = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());

  // nowET is like "03/10/2026"
  const [month, day, year] = nowET.split("/");
  const dateStr = `${year}-${month}-${day}`;

  // Convert ET midnight → UTC
  const startET = new Date(`${dateStr}T00:00:00`);
  const endET   = new Date(`${dateStr}T23:59:59`);

  // Get ET offset by comparing UTC vs ET representation
  const refDate = new Date();
  const utcHour = refDate.getUTCHours();
  const etHour = parseInt(
    new Intl.DateTimeFormat("en-US", { timeZone: TIMEZONE, hour: "2-digit", hour12: false }).format(refDate),
    10
  );
  const offsetHours = utcHour - (etHour === 24 ? 0 : etHour);

  const start = new Date(startET.getTime() + offsetHours * 60 * 60 * 1000);
  const end   = new Date(endET.getTime()   + offsetHours * 60 * 60 * 1000);

  return { start, end };
}

function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true,
  }).format(new Date(d)) + " ET";
}

function todayLabel(): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  }).format(new Date());
}

const STAGE_LABELS: Record<string, string> = {
  new_lead_unqualified:                  "New Lead Unqualified",
  qualified_lead:                        "Qualified Lead",
  contacted_emailed:                     "Contacted — Emailed",
  contacted_phone_spoke_decision_maker:  "Spoke w/ Decision Maker",
  contacted_phone_spoke_non_decision_maker: "Spoke w/ Non-Decision Maker",
  contacted_phone_left_message:          "Left Message",
  trial_period_started:                  "Trial Period Started",
  pending_commitment:                    "Pending Commitment",
  in_negotiation:                        "In Negotiation",
  won:                                   "Won",
  lost:                                  "Lost",
};

function stageLabel(stage: string | null | undefined): string {
  if (!stage) return "—";
  return STAGE_LABELS[stage] ?? stage;
}

function contactDisplay(c: { firstName?: string | null; lastName?: string | null; company?: string | null; city?: string | null }): string {
  const name = [c.firstName, c.lastName].filter(Boolean).join(" ") || c.company || "Unknown";
  return name;
}

// ────────────────────────────────────────────────────────────────────────────
// HTML builders
// ────────────────────────────────────────────────────────────────────────────

function buildEmailHtml(
  sentRows: SentRow[],
  replyRows: ReplyRow[],
  dateLabel?: string
): string {
  const date = dateLabel ?? todayLabel();

  const totalSent    = sentRows.length;
  const totalReplies = replyRows.length;

  // Group sent by salesperson
  const bySalesperson = new Map<string, SentRow[]>();
  for (const row of sentRows) {
    const key = row.salespersonName;
    if (!bySalesperson.has(key)) bySalesperson.set(key, []);
    bySalesperson.get(key)!.push(row);
  }

  // Sent table rows HTML
  const sentTableRows = sentRows.length === 0
    ? `<tr><td colspan="6" style="padding:12px 16px; color:#6b7280; font-style:italic; text-align:center;">No emails sent today</td></tr>`
    : sentRows.map(r => `
      <tr style="border-bottom:1px solid #f3f4f6;">
        <td style="padding:10px 16px; font-size:13px;">${escHtml(r.recipientName)}</td>
        <td style="padding:10px 16px; font-size:13px; color:#6b7280;">${escHtml(r.businessName)}</td>
        <td style="padding:10px 16px; font-size:13px; color:#6b7280;">${escHtml(r.location)}</td>
        <td style="padding:10px 16px; font-size:13px;">${escHtml(r.salespersonName)}</td>
        <td style="padding:10px 16px; font-size:13px;">
          <span style="background:#dbeafe; color:#1d4ed8; padding:2px 8px; border-radius:9999px; font-size:11px; white-space:nowrap;">
            Seq #${r.sequenceNumber} · ${escHtml(r.track)}
          </span>
        </td>
        <td style="padding:10px 16px; font-size:13px;">
          <span style="background:#f3f4f6; color:#374151; padding:2px 8px; border-radius:9999px; font-size:11px; white-space:nowrap;">${escHtml(r.dealStage)}</span>
        </td>
      </tr>`).join("");

  const replyTableRows = replyRows.length === 0
    ? `<tr><td colspan="5" style="padding:12px 16px; color:#6b7280; font-style:italic; text-align:center;">No replies received today</td></tr>`
    : replyRows.map(r => `
      <tr style="border-bottom:1px solid #f3f4f6;">
        <td style="padding:10px 16px; font-size:13px;">${escHtml(r.recipientName)}</td>
        <td style="padding:10px 16px; font-size:13px; color:#6b7280;">${escHtml(r.businessName)}</td>
        <td style="padding:10px 16px; font-size:13px; color:#6b7280;">${escHtml(r.location)}</td>
        <td style="padding:10px 16px; font-size:13px;">${escHtml(r.salespersonName)}</td>
        <td style="padding:10px 16px; font-size:13px;">
          <span style="background:#f3f4f6; color:#374151; padding:2px 8px; border-radius:9999px; font-size:11px; white-space:nowrap;">${escHtml(r.dealStage)}</span>
        </td>
      </tr>`).join("");

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:820px;margin:0 auto;padding:32px 16px;">

    <!-- Header -->
    <div style="background:#1e3a5f;border-radius:12px 12px 0 0;padding:28px 32px;">
      <div style="display:flex;align-items:center;gap:12px;">
        <div style="background:#3b82f6;border-radius:8px;padding:8px 14px;">
          <span style="color:white;font-size:18px;font-weight:700;letter-spacing:1px;">ESY</span>
        </div>
        <div>
          <p style="margin:0;color:#93c5fd;font-size:12px;letter-spacing:1px;text-transform:uppercase;">EsyPet CRM</p>
          <p style="margin:0;color:white;font-size:20px;font-weight:600;">Daily Activity Report</p>
        </div>
      </div>
      <p style="margin:12px 0 0;color:#bfdbfe;font-size:14px;">${escHtml(date)}</p>
    </div>

    <!-- Summary cards -->
    <div style="display:flex;gap:0;background:white;border-left:1px solid #e5e7eb;border-right:1px solid #e5e7eb;">
      <div style="flex:1;padding:24px 32px;border-right:1px solid #e5e7eb;">
        <p style="margin:0;color:#6b7280;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;">Emails Sent Today</p>
        <p style="margin:6px 0 0;color:#1d4ed8;font-size:36px;font-weight:700;">${totalSent}</p>
      </div>
      <div style="flex:1;padding:24px 32px;">
        <p style="margin:0;color:#6b7280;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;">Replies Received Today</p>
        <p style="margin:6px 0 0;color:#16a34a;font-size:36px;font-weight:700;">${totalReplies}</p>
      </div>
    </div>

    <!-- Emails Sent section -->
    <div style="background:white;border:1px solid #e5e7eb;margin-top:24px;border-radius:8px;overflow:hidden;">
      <div style="padding:16px 20px;border-bottom:1px solid #e5e7eb;background:#eff6ff;">
        <p style="margin:0;font-size:15px;font-weight:600;color:#1e40af;">📤 Emails Sent (${totalSent})</p>
      </div>
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;">
          <thead>
            <tr style="background:#f9fafb;border-bottom:2px solid #e5e7eb;">
              <th style="padding:10px 16px;text-align:left;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Recipient</th>
              <th style="padding:10px 16px;text-align:left;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Business</th>
              <th style="padding:10px 16px;text-align:left;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">City / State</th>
              <th style="padding:10px 16px;text-align:left;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Salesperson</th>
              <th style="padding:10px 16px;text-align:left;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Sequence</th>
              <th style="padding:10px 16px;text-align:left;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Deal Stage</th>
            </tr>
          </thead>
          <tbody>${sentTableRows}</tbody>
        </table>
      </div>
    </div>

    <!-- Replies section -->
    <div style="background:white;border:1px solid #e5e7eb;margin-top:20px;border-radius:8px;overflow:hidden;">
      <div style="padding:16px 20px;border-bottom:1px solid #e5e7eb;background:#f0fdf4;">
        <p style="margin:0;font-size:15px;font-weight:600;color:#15803d;">💬 Replies Received (${totalReplies})</p>
      </div>
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;">
          <thead>
            <tr style="background:#f9fafb;border-bottom:2px solid #e5e7eb;">
              <th style="padding:10px 16px;text-align:left;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Contact</th>
              <th style="padding:10px 16px;text-align:left;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Business</th>
              <th style="padding:10px 16px;text-align:left;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">City / State</th>
              <th style="padding:10px 16px;text-align:left;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Salesperson</th>
              <th style="padding:10px 16px;text-align:left;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Deal Stage</th>
            </tr>
          </thead>
          <tbody>${replyTableRows}</tbody>
        </table>
      </div>
    </div>

    <!-- Footer -->
    <div style="margin-top:24px;padding:16px;text-align:center;">
      <p style="margin:0;color:#9ca3af;font-size:12px;">This report was automatically generated by EsyPet CRM · Sent daily at 6:00 PM ET</p>
    </div>

  </div>
</body>
</html>`;
}

function escHtml(str: string | null | undefined): string {
  return (str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ────────────────────────────────────────────────────────────────────────────
// Row types
// ────────────────────────────────────────────────────────────────────────────

interface SentRow {
  recipientName: string;
  businessName: string;
  location: string;
  salespersonName: string;
  sequenceNumber: number;
  track: string;
  dealStage: string;
}

interface ReplyRow {
  recipientName: string;
  businessName: string;
  location: string;
  salespersonName: string;
  dealStage: string;
}

const TRACK_LABELS: Record<string, string> = {
  no_software: "No Software",
  uses_competitor: "Uses Competitor",
  custom: "Custom",
};

// ────────────────────────────────────────────────────────────────────────────
// Main report function
// ────────────────────────────────────────────────────────────────────────────

export async function sendDailyReport(options?: { overrideStart?: Date; overrideEnd?: Date; label?: string }): Promise<void> {
  console.log("[DailyReport] Building daily activity report...");

  const { start, end } = options?.overrideStart
    ? { start: options.overrideStart, end: options.overrideEnd ?? new Date() }
    : getTodayRangeET();

  try {
    // Fetch all data in parallel
    const [allLogs, allMessages, allContacts, allDeals, allUsers] = await Promise.all([
      storage.getEmailSequenceLogs(null),
      storage.getInboxMessages(null),
      storage.getContacts(null),
      storage.getDeals(null),
      storage.getAllUsers(),
    ]);

    // Index for fast lookup
    const contactMap = new Map(allContacts.map(c => [c.id, c]));
    const dealsByContact = new Map<string, (typeof allDeals)[0]>();
    for (const deal of allDeals) {
      if (!deal.contactId) continue;
      // Keep the most recent active deal for the contact
      const existing = dealsByContact.get(deal.contactId);
      if (!existing || new Date(deal.createdAt ?? 0) > new Date(existing.createdAt ?? 0)) {
        dealsByContact.set(deal.contactId, deal);
      }
    }

    // User map — keyed by userId
    const userMap = new Map<string, { firstName?: string | null; lastName?: string | null; email?: string | null }>();
    for (const u of allUsers) userMap.set(u.id, u);

    // Helper: get salesperson display name
    const getSalesperson = (userId: string) => {
      const u = userMap.get(userId);
      if (!u) return "Unknown";
      return [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email || "Unknown";
    };

    // Helper: location string
    const locationStr = (c: { city?: string | null; address?: string | null }) => {
      // Extract state from address if city is separate
      const city = c.city ?? "";
      return city || "—";
    };

    // ── Emails Sent today ──────────────────────────────────────────────────
    const sentLogs = allLogs.filter(l => {
      if (l.status !== "sent" || !l.sentAt) return false;
      const t = new Date(l.sentAt);
      return t >= start && t <= end;
    });

    const sentRows: SentRow[] = sentLogs.map(l => {
      const contact = contactMap.get(l.contactId);
      const deal = contact ? dealsByContact.get(contact.id) : undefined;
      return {
        recipientName: contact ? contactDisplay(contact) : "Unknown",
        businessName: contact?.company || "—",
        location: contact ? locationStr(contact) : "—",
        salespersonName: getSalesperson(l.userId),
        sequenceNumber: l.sequenceNumber,
        track: TRACK_LABELS[l.sequenceTrack] ?? l.sequenceTrack,
        dealStage: stageLabel(deal?.stage),
      };
    });

    // ── Replies today ──────────────────────────────────────────────────────
    const todayMessages = allMessages.filter(m => {
      const t = new Date(m.receivedAt ?? m.createdAt ?? 0);
      return t >= start && t <= end;
    });

    const replyRows: ReplyRow[] = todayMessages.map(m => {
      const contact = m.contactId ? contactMap.get(m.contactId) : undefined;
      const deal = contact ? dealsByContact.get(contact.id) : undefined;
      return {
        recipientName: contact ? contactDisplay(contact) : (m.from ?? "Unknown"),
        businessName: contact?.company || "—",
        location: contact ? locationStr(contact) : "—",
        salespersonName: getSalesperson(m.userId),
        dealStage: stageLabel(deal?.stage),
      };
    });

    if (sentRows.length === 0 && replyRows.length === 0) {
      console.log("[DailyReport] No activity today — sending report anyway.");
    }

    const reportLabel = options?.label ?? todayLabel();
    const subject = `EsyPet CRM Daily Report — ${reportLabel} · ${sentRows.length} sent, ${replyRows.length} repl${replyRows.length === 1 ? "y" : "ies"}`;
    const html = buildEmailHtml(sentRows, replyRows, reportLabel);

    // Send to all recipients
    const results = await Promise.allSettled(
      REPORT_RECIPIENTS.map(to => sendEmail({ to, subject, body: html }))
    );

    results.forEach((r, i) => {
      if (r.status === "fulfilled" && r.value.success) {
        console.log(`[DailyReport] Sent to ${REPORT_RECIPIENTS[i]}`);
      } else {
        const err = r.status === "rejected" ? r.reason : (r.value as any).error;
        console.error(`[DailyReport] Failed to send to ${REPORT_RECIPIENTS[i]}:`, err);
      }
    });

    console.log("[DailyReport] Done.");
  } catch (err) {
    console.error("[DailyReport] Error generating report:", err);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Scheduler — fires once per day at REPORT_HOUR_ET (Eastern Time)
// ────────────────────────────────────────────────────────────────────────────

export function startDailyReportScheduler(): void {
  console.log(`[DailyReport] Scheduler started — report sends daily at ${REPORT_HOUR_ET}:00 ET`);

  function scheduleNext() {
    const now = new Date();

    // Compute next fire time: today at REPORT_HOUR_ET ET (or tomorrow if already past)
    const etNowStr = new Intl.DateTimeFormat("en-US", {
      timeZone: TIMEZONE,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hour12: false,
    }).format(now);

    // etNowStr like "03/10/2026, 18:05:32"
    const [datePart, timePart] = etNowStr.split(", ");
    const [month, day, year] = datePart.split("/");
    const [currentHour] = timePart.split(":").map(Number);

    let targetDateStr = `${year}-${month}-${day}`;
    if (currentHour >= REPORT_HOUR_ET) {
      // Already past today's send time — schedule for tomorrow
      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      const tomorrowET = new Intl.DateTimeFormat("en-US", {
        timeZone: TIMEZONE,
        year: "numeric", month: "2-digit", day: "2-digit",
      }).format(tomorrow);
      const [tm, td, ty] = tomorrowET.split("/");
      targetDateStr = `${ty}-${tm}-${td}`;
    }

    // Build the target UTC time by finding the ET→UTC offset
    const targetNaive = new Date(`${targetDateStr}T${String(REPORT_HOUR_ET).padStart(2, "0")}:00:00`);
    const utcH = parseInt(
      new Intl.DateTimeFormat("en-US", {
        timeZone: TIMEZONE, hour: "2-digit", hour12: false,
      }).format(targetNaive),
      10
    );
    const offsetH = targetNaive.getUTCHours() - (utcH === 24 ? 0 : utcH);
    const targetUTC = new Date(targetNaive.getTime() + offsetH * 60 * 60 * 1000);

    const msUntilFire = targetUTC.getTime() - now.getTime();
    console.log(`[DailyReport] Next report in ${Math.round(msUntilFire / 60000)} minutes (at ${formatDate(targetUTC)})`);

    setTimeout(async () => {
      await sendDailyReport();
      scheduleNext(); // schedule the next day's report
    }, msUntilFire);
  }

  scheduleNext();
}
