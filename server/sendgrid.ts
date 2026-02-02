import sgMail from "@sendgrid/mail";
import type { Contact, User, EmailSequence } from "@shared/schema";

// Initialize SendGrid with API key from environment
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;

if (SENDGRID_API_KEY) {
  sgMail.setApiKey(SENDGRID_API_KEY);
}

/**
 * Replace template variables in email content
 * Supported variables:
 * - [Contact_First_Name] - Contact's first name
 * - [Sales_Person] - Salesperson's full name
 * - [Business_Name] - Contact's company/business name
 */
export function replaceTemplateVariables(
  content: string,
  contact: Contact,
  salesperson: User
): string {
  const salespersonName = `${salesperson.firstName || ''} ${salesperson.lastName || ''}`.trim() || salesperson.email || 'Sales Team';
  const businessName = contact.company || 'your business';
  
  return content
    .replace(/\[Contact_First_Name\]/g, contact.firstName)
    .replace(/\[Sales_Person\]/g, salespersonName)
    .replace(/\[Business_Name\]/g, businessName);
}

/**
 * Send email via SendGrid
 */
export async function sendEmail({
  to,
  subject,
  body,
  fromEmail = "noreply@esypet.com",
  fromName = "EsyPet CRM",
  replyTo
}: {
  to: string;
  subject: string;
  body: string;
  fromEmail?: string;
  fromName?: string;
  replyTo?: string;
}): Promise<{ success: boolean; error?: string }> {
  if (!SENDGRID_API_KEY) {
    console.error("SendGrid API key not configured");
    return { success: false, error: "Email service not configured" };
  }

  if (!to) {
    return { success: false, error: "Recipient email is required" };
  }

  try {
    const msg: any = {
      to,
      from: {
        email: fromEmail,
        name: fromName,
      },
      subject,
      text: body,
      html: body.replace(/\n/g, '<br>'),
    };

    // Add reply-to if provided
    if (replyTo) {
      msg.replyTo = replyTo;
    }

    await sgMail.send(msg);
    console.log(`Email sent successfully to ${to}`);
    return { success: true };
  } catch (error: any) {
    console.error("SendGrid error:", error);
    const errorMessage = error.response?.body?.errors?.[0]?.message || error.message || "Unknown error";
    return { success: false, error: errorMessage };
  }
}

/**
 * Send sequence email to a contact
 */
export async function sendSequenceEmail({
  contact,
  salesperson,
  sequence,
}: {
  contact: Contact;
  salesperson: User;
  sequence: EmailSequence;
}): Promise<{ success: boolean; error?: string }> {
  if (!contact.email) {
    return { success: false, error: "Contact has no email address" };
  }

  // Replace template variables
  const subject = replaceTemplateVariables(sequence.subject, contact, salesperson);
  const body = replaceTemplateVariables(sequence.body, contact, salesperson);

  const salespersonName = `${salesperson.firstName || ''} ${salesperson.lastName || ''}`.trim() || salesperson.email || 'Sales Team';
  
  // Use workEmail if available, otherwise fall back to regular email
  const fromEmail = salesperson.workEmail || salesperson.email || "noreply@esypet.com";
  const replyToEmail = salesperson.workEmail || salesperson.email || undefined;

  return await sendEmail({
    to: contact.email,
    subject,
    body,
    fromEmail,
    fromName: salespersonName,
    replyTo: replyToEmail,
  });
}
