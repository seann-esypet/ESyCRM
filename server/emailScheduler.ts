import { storage } from "./storage";
import { sendSequenceEmail } from "./sendgrid";
import type { Contact, EmailSequence, EmailSequenceLog } from "@shared/schema";

/**
 * Email Sequence Scheduler
 * This runs periodically to check and send automated email sequences
 * 
 * IMPORTANT: Requires Reserved VM deployment for 24/7 operation
 * 
 * TIMEZONE: All scheduled times are interpreted as Eastern Time (America/New_York)
 * This automatically handles Daylight Saving Time changes.
 */

const TIMEZONE = "America/New_York";

/**
 * Fixed days-after-previous-email schedule:
 * Seq 2 → 7 days after Seq 1
 * Seq 3 → 7 days after Seq 2  (14 days total)
 * Seq 4 → 30 days after Seq 3
 * Seq 5 → 30 days after Seq 4
 */
const SEQUENCE_DAYS_AFTER_PREVIOUS: Record<number, number> = {
  2: 7,
  3: 7,
  4: 30,
  5: 30,
};

/**
 * Get current time in Eastern timezone
 */
function getNowInEastern(): Date {
  const now = new Date();
  const easternString = now.toLocaleString("en-US", { timeZone: TIMEZONE });
  return new Date(easternString);
}

/**
 * Convert a date and time to Eastern timezone for comparison
 * The scheduledDate stores the date the user picked, and scheduledTime is the time in Eastern
 */
function getScheduledDateTimeInEastern(scheduledDate: Date, scheduledTime: string): Date {
  const year = scheduledDate.getUTCFullYear();
  const month = scheduledDate.getUTCMonth();
  const day = scheduledDate.getUTCDate();
  
  const [hours, minutes] = scheduledTime.split(':').map(Number);
  
  const utcDate = new Date(Date.UTC(year, month, day, hours, minutes, 0));
  const easternOffset = getEasternOffset(utcDate);
  
  return new Date(utcDate.getTime() + easternOffset * 60 * 1000);
}

/**
 * Get the offset in minutes between UTC and Eastern time for a given date
 * This handles DST automatically
 */
function getEasternOffset(date: Date): number {
  const utcString = date.toLocaleString("en-US", { timeZone: "UTC" });
  const easternString = date.toLocaleString("en-US", { timeZone: TIMEZONE });
  
  const utcDate = new Date(utcString);
  const easternDate = new Date(easternString);
  
  return (utcDate.getTime() - easternDate.getTime()) / (60 * 1000);
}

/**
 * Check if it's time to send Sequence 1 for a contact
 */
function shouldSendSequence1(
  sequence: EmailSequence,
  existingLogs: EmailSequenceLog[]
): boolean {
  if (existingLogs.some(log => log.sequenceNumber === 1)) {
    return false;
  }

  if (!sequence.scheduledDate || !sequence.scheduledTime) {
    return false;
  }

  const now = new Date();
  
  const scheduledDate = sequence.scheduledDate instanceof Date 
    ? sequence.scheduledDate 
    : new Date(sequence.scheduledDate);
  
  const scheduledDateTime = getScheduledDateTimeInEastern(scheduledDate, sequence.scheduledTime);
  
  return now >= scheduledDateTime;
}

/**
 * Check if it's time to send a follow-up sequence (2-5)
 * Stops if the contact has replied (has inbox messages)
 */
async function shouldSendFollowUpSequence(
  sequenceNumber: number,
  existingLogs: EmailSequenceLog[],
  contactId: string
): Promise<boolean> {
  // Already sent this sequence
  if (existingLogs.some(log => log.sequenceNumber === sequenceNumber)) {
    return false;
  }

  // Check if previous sequence was sent
  const previousSequenceLog = existingLogs.find(
    log => log.sequenceNumber === sequenceNumber - 1
  );

  if (!previousSequenceLog || !previousSequenceLog.sentAt) {
    return false;
  }

  // Stop if the contact has replied to a previous sequence (log-level flag)
  if (previousSequenceLog.emailResponseReceived === "true") {
    return false;
  }

  // Stop if the contact has any inbox messages (actual replies)
  const inboxMessages = await storage.getInboxMessages(null, contactId);
  if (inboxMessages.length > 0) {
    console.log(`Contact ${contactId} has replied — stopping automation at Sequence ${sequenceNumber}`);
    return false;
  }

  // Fixed timing per sequence number
  const daysRequired = SEQUENCE_DAYS_AFTER_PREVIOUS[sequenceNumber] ?? 7;
  const daysSincePrevious = Math.floor(
    (new Date().getTime() - new Date(previousSequenceLog.sentAt).getTime()) / (1000 * 60 * 60 * 24)
  );

  return daysSincePrevious >= daysRequired;
}

// Global lock to prevent concurrent scheduler runs
let isProcessing = false;

/**
 * Process email sequences from the queue with rate limiting
 * Sends max 12 emails per hour (1 email every 5 minutes)
 */
export async function processEmailSequences(): Promise<{
  processed: number;
  sent: number;
  failed: number;
  errors: string[];
}> {
  if (isProcessing) {
    console.log("Email sequence processing already in progress, skipping this run");
    return { processed: 0, sent: 0, failed: 0, errors: [] };
  }
  
  isProcessing = true;
  console.log("Starting email sequence processing...");
  
  const stats = {
    processed: 0,
    sent: 0,
    failed: 0,
    errors: [] as string[],
  };

  try {
    const allLogs = await storage.getEmailSequenceLogs(null);
    
    // Reset stale "processing" logs back to "pending" 
    const STALE_PROCESSING_THRESHOLD_MS = 90 * 60 * 1000;
    const now = new Date();
    
    for (const log of allLogs.filter(l => l.status === "processing")) {
      const processingStarted = log.processingStartedAt ? new Date(log.processingStartedAt) : (log.createdAt ? new Date(log.createdAt) : new Date(0));
      const ageMs = now.getTime() - processingStarted.getTime();
      
      if (ageMs > STALE_PROCESSING_THRESHOLD_MS) {
        console.log(`Resetting stale processing log ${log.id} back to pending (stuck for ${Math.round(ageMs / 60000)} minutes)`);
        await storage.updateEmailSequenceLog(log.id, { status: "pending", processingStartedAt: null }, null);
      }
    }
    
    const refreshedLogs = await storage.getEmailSequenceLogs(null);
    const pendingLogs = refreshedLogs
      .filter(log => {
        if (log.status !== "pending") return false;
        if (log.scheduledSendAt) {
          const scheduledTime = new Date(log.scheduledSendAt);
          if (scheduledTime > now) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return aTime - bTime;
      });

    console.log(`Found ${pendingLogs.length} pending emails in queue`);

    const MAX_EMAILS_PER_RUN = 12;
    const DELAY_BETWEEN_EMAILS_MS = 5 * 60 * 1000;

    for (const log of pendingLogs.slice(0, MAX_EMAILS_PER_RUN)) {
      stats.processed++;
      
      try {
        await storage.updateEmailSequenceLog(log.id, { 
          status: "processing",
          processingStartedAt: new Date()
        }, null);
      } catch (error) {
        console.error(`Failed to mark log ${log.id} as processing:`, error);
        stats.errors.push(`Failed to mark log ${log.id} as processing`);
        continue;
      }

      try {
        const contact = await storage.getContact(log.contactId, null);
        if (!contact || !contact.email) {
          stats.errors.push(`Contact ${log.contactId} not found or has no email`);
          await storage.updateEmailSequenceLog(log.id, { status: "failed" }, null);
          stats.failed++;
          continue;
        }

        const sequence = await storage.getEmailSequence(log.sequenceId, null);
        if (!sequence) {
          stats.errors.push(`Sequence ${log.sequenceId} not found`);
          await storage.updateEmailSequenceLog(log.id, { status: "failed" }, null);
          stats.failed++;
          continue;
        }

        const salesperson = await storage.getUser(log.userId);
        if (!salesperson) {
          stats.errors.push(`Salesperson ${log.userId} not found`);
          await storage.updateEmailSequenceLog(log.id, { status: "failed" }, null);
          stats.failed++;
          continue;
        }

        const result = await sendSequenceEmail({
          contact,
          salesperson,
          sequence,
          customSubject: log.customSubject,
          customBody: log.customBody,
        });

        if (result.success) {
          await storage.updateEmailSequenceLog(
            log.id,
            {
              status: "sent",
              sentAt: new Date(),
            },
            null
          );
          stats.sent++;
          console.log(`Sent Sequence ${sequence.sequenceNumber} to ${contact.email}`);
        } else {
          await storage.updateEmailSequenceLog(
            log.id,
            { status: "failed" },
            null
          );
          stats.failed++;
          stats.errors.push(`Failed to send to ${contact.email}: ${result.error}`);
        }

        if (stats.processed < Math.min(pendingLogs.length, MAX_EMAILS_PER_RUN)) {
          console.log(`Waiting 5 minutes before next email (rate limiting)...`);
          await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_EMAILS_MS));
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        stats.errors.push(`Error processing log ${log.id}: ${errorMessage}`);
        await storage.updateEmailSequenceLog(log.id, { status: "failed" }, null);
        stats.failed++;
      }
    }

    console.log(`Email sequence processing complete:`, stats);
    return stats;
  } catch (error) {
    console.error("Fatal error in email sequence processing:", error);
    throw error;
  } finally {
    isProcessing = false;
  }
}

/**
 * Start the email sequence scheduler
 * Runs every hour
 */
export function startEmailSequenceScheduler(): NodeJS.Timeout {
  console.log("Starting email sequence scheduler (runs every hour)");
  
  processEmailSequences().catch(error => {
    console.error("Error in initial email sequence run:", error);
  });

  const interval = setInterval(() => {
    processEmailSequences().catch(error => {
      console.error("Error in scheduled email sequence run:", error);
    });
  }, 60 * 60 * 1000);

  return interval;
}
