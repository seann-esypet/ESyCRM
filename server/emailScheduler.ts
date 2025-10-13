import { storage } from "./storage";
import { sendSequenceEmail } from "./sendgrid";
import type { Contact, EmailSequence, EmailSequenceLog } from "@shared/schema";

/**
 * Email Sequence Scheduler
 * This runs periodically to check and send automated email sequences
 * 
 * IMPORTANT: Requires Reserved VM deployment for 24/7 operation
 */

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

  const now = new Date();
  
  // scheduledDate is already a Date object from Drizzle
  const scheduledDate = sequence.scheduledDate instanceof Date 
    ? sequence.scheduledDate 
    : new Date(sequence.scheduledDate);
  
  // Create scheduled datetime by combining date and time
  const scheduledDateTime = new Date(scheduledDate);
  const [hours, minutes] = sequence.scheduledTime.split(':');
  scheduledDateTime.setHours(parseInt(hours, 10), parseInt(minutes, 10), 0, 0);
  
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

/**
 * Process email sequences for all qualified leads
 */
export async function processEmailSequences(): Promise<{
  processed: number;
  sent: number;
  failed: number;
  errors: string[];
}> {
  console.log("Starting email sequence processing...");
  
  const stats = {
    processed: 0,
    sent: 0,
    failed: 0,
    errors: [] as string[],
  };

  try {
    // Get all contacts with "qualified_lead" status
    // Note: We need to get all contacts (admin view) to process all users' sequences
    const allContacts = await storage.getContacts(null);
    const qualifiedLeads = allContacts.filter(contact => {
      // Check if contact is in a deal with qualified_lead stage or later
      // For now, we'll assume contacts are qualified if they have email
      // You may want to add a specific field or check deals
      return contact.email && contact.status === "active";
    });

    console.log(`Found ${qualifiedLeads.length} qualified leads to process`);

    for (const contact of qualifiedLeads) {
      stats.processed++;

      try {
        // Get the user's (salesperson's) email sequences
        const userSequences = await storage.getEmailSequences(contact.userId);
        
        // Filter for active sequences only
        const activeSequences = userSequences.filter(seq => seq.isActive === "true");
        
        if (activeSequences.length === 0) {
          continue;
        }

        // Get existing logs for this contact
        const existingLogs = await storage.getEmailSequenceLogs(contact.userId, contact.id);

        // Get the user (salesperson) details
        const salesperson = await storage.getUser(contact.userId);
        if (!salesperson) {
          stats.errors.push(`Salesperson not found for contact ${contact.id}`);
          continue;
        }

        // Check each sequence (1-5) in order
        for (const sequence of activeSequences.sort((a, b) => a.sequenceNumber - b.sequenceNumber)) {
          let shouldSend = false;

          if (sequence.sequenceNumber === 1) {
            shouldSend = shouldSendSequence1(sequence, existingLogs);
          } else {
            shouldSend = shouldSendFollowUpSequence(sequence.sequenceNumber, sequence, existingLogs);
          }

          if (shouldSend) {
            // Send the email
            const result = await sendSequenceEmail({
              contact,
              salesperson,
              sequence,
            });

            // Log the send attempt
            if (result.success) {
              await storage.createEmailSequenceLog({
                contactId: contact.id,
                sequenceId: sequence.id,
                sequenceNumber: sequence.sequenceNumber,
                sentAt: new Date(),
                status: "sent",
                emailResponseReceived: "false",
              }, contact.userId);

              stats.sent++;
              console.log(`Sent Sequence ${sequence.sequenceNumber} to ${contact.email}`);
            } else {
              await storage.createEmailSequenceLog({
                contactId: contact.id,
                sequenceId: sequence.id,
                sequenceNumber: sequence.sequenceNumber,
                status: "failed",
                emailResponseReceived: "false",
              }, contact.userId);

              stats.failed++;
              stats.errors.push(`Failed to send Sequence ${sequence.sequenceNumber} to ${contact.email}: ${result.error}`);
            }

            // Only send one sequence per contact per run
            break;
          }
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        stats.errors.push(`Error processing contact ${contact.id}: ${errorMessage}`);
        stats.failed++;
      }
    }

    console.log(`Email sequence processing complete:`, stats);
    return stats;
  } catch (error) {
    console.error("Fatal error in email sequence processing:", error);
    throw error;
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
