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
 * Get current time in Eastern timezone
 */
function getNowInEastern(): Date {
  const now = new Date();
  // Get the current time formatted in Eastern timezone
  const easternString = now.toLocaleString("en-US", { timeZone: TIMEZONE });
  return new Date(easternString);
}

/**
 * Convert a date and time to Eastern timezone for comparison
 * The scheduledDate stores the date the user picked, and scheduledTime is the time in Eastern
 */
function getScheduledDateTimeInEastern(scheduledDate: Date, scheduledTime: string): Date {
  // Get the date components from the scheduled date (which was stored as UTC midnight)
  const year = scheduledDate.getUTCFullYear();
  const month = scheduledDate.getUTCMonth();
  const day = scheduledDate.getUTCDate();
  
  // Parse the time
  const [hours, minutes] = scheduledTime.split(':').map(Number);
  
  // Create a date string in Eastern timezone format
  // We create the datetime as if it's in Eastern time
  const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`;
  
  // Parse this as a local Eastern time by using toLocaleString trick
  // Create date in UTC, then adjust
  const targetDate = new Date(dateStr);
  
  // Get the offset difference between UTC and Eastern for this specific date
  const utcDate = new Date(Date.UTC(year, month, day, hours, minutes, 0));
  const easternOffset = getEasternOffset(utcDate);
  
  // Return the UTC time that corresponds to the Eastern time the user intended
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
  // Already sent Sequence 1
  if (existingLogs.some(log => log.sequenceNumber === 1)) {
    return false;
  }

  // Check if scheduled date/time has passed
  if (!sequence.scheduledDate || !sequence.scheduledTime) {
    return false;
  }

  const now = new Date(); // Current UTC time
  
  // scheduledDate is already a Date object from Drizzle
  const scheduledDate = sequence.scheduledDate instanceof Date 
    ? sequence.scheduledDate 
    : new Date(sequence.scheduledDate);
  
  // Get the scheduled time interpreted as Eastern timezone
  const scheduledDateTime = getScheduledDateTimeInEastern(scheduledDate, sequence.scheduledTime);
  
  return now >= scheduledDateTime;
}

/**
 * Check if it's time to send a follow-up sequence (2-5)
 */
function shouldSendFollowUpSequence(
  sequenceNumber: number,
  sequence: EmailSequence,
  existingLogs: EmailSequenceLog[]
): boolean {
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

  // Check if previous sequence got a reply
  if (previousSequenceLog.emailResponseReceived === "true") {
    return false; // Stop sequence if they replied
  }

  // Check if enough days have passed since previous sequence
  const daysSincePrevious = Math.floor(
    (new Date().getTime() - new Date(previousSequenceLog.sentAt).getTime()) / (1000 * 60 * 60 * 24)
  );

  return daysSincePrevious >= (sequence.daysAfterNoReply || 0);
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
  // Prevent concurrent runs
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
    // Get all pending and processing email sequence logs (queue)
    // Use admin view (null) to process all users' sequences
    const allLogs = await storage.getEmailSequenceLogs(null);
    
    // Reset stale "processing" logs back to "pending" 
    // (logs stuck in processing for >90 minutes, likely due to process crash)
    // Threshold is 90 min because a full scheduler run can take ~60 min (12 emails * 5 min each)
    const STALE_PROCESSING_THRESHOLD_MS = 90 * 60 * 1000; // 90 minutes
    const now = new Date();
    
    for (const log of allLogs.filter(l => l.status === "processing")) {
      // Use processingStartedAt if available, otherwise fall back to createdAt
      const processingStarted = log.processingStartedAt ? new Date(log.processingStartedAt) : (log.createdAt ? new Date(log.createdAt) : new Date(0));
      const ageMs = now.getTime() - processingStarted.getTime();
      
      if (ageMs > STALE_PROCESSING_THRESHOLD_MS) {
        console.log(`Resetting stale processing log ${log.id} back to pending (stuck for ${Math.round(ageMs / 60000)} minutes)`);
        await storage.updateEmailSequenceLog(log.id, { status: "pending", processingStartedAt: null }, null);
      }
    }
    
    // Get fresh list after resetting stale logs
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
      }); // FIFO

    console.log(`Found ${pendingLogs.length} pending emails in queue`);

    // Rate limiting: max 12 emails per hour (1 every 5 minutes)
    const MAX_EMAILS_PER_RUN = 12;
    const DELAY_BETWEEN_EMAILS_MS = 5 * 60 * 1000; // 5 minutes

    for (const log of pendingLogs.slice(0, MAX_EMAILS_PER_RUN)) {
      stats.processed++;
      
      try {
        // Mark as processing immediately to prevent duplicate sends
        // Set processingStartedAt to track when processing began (for stale detection)
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
        // Get the contact
        const contact = await storage.getContact(log.contactId, null);
        if (!contact || !contact.email) {
          stats.errors.push(`Contact ${log.contactId} not found or has no email`);
          await storage.updateEmailSequenceLog(log.id, { status: "failed" }, null);
          stats.failed++;
          continue;
        }

        // Get the sequence
        const sequence = await storage.getEmailSequence(log.sequenceId, null);
        if (!sequence) {
          stats.errors.push(`Sequence ${log.sequenceId} not found`);
          await storage.updateEmailSequenceLog(log.id, { status: "failed" }, null);
          stats.failed++;
          continue;
        }

        // Get the salesperson
        const salesperson = await storage.getUser(log.userId);
        if (!salesperson) {
          stats.errors.push(`Salesperson ${log.userId} not found`);
          await storage.updateEmailSequenceLog(log.id, { status: "failed" }, null);
          stats.failed++;
          continue;
        }

        // Send the email
        const result = await sendSequenceEmail({
          contact,
          salesperson,
          sequence,
        });

        // Update log status
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

        // Rate limiting: wait 5 minutes before next email
        // Only wait if there are more emails to send
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
    // Release the lock
    isProcessing = false;
  }
}

/**
 * Start the email sequence scheduler
 * Runs every hour
 */
export function startEmailSequenceScheduler(): NodeJS.Timeout {
  console.log("Starting email sequence scheduler (runs every hour)");
  
  // Run immediately on start
  processEmailSequences().catch(error => {
    console.error("Error in initial email sequence run:", error);
  });

  // Then run every hour
  const interval = setInterval(() => {
    processEmailSequences().catch(error => {
      console.error("Error in scheduled email sequence run:", error);
    });
  }, 60 * 60 * 1000); // 1 hour

  return interval;
}
