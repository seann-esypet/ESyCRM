import type { EmailSequence, SalonEnrichmentRow, User } from "@shared/schema";
import { replaceTemplateVariables } from "./sendgrid";
import { htmlToFormText } from "./formOutreachPolicy";
import { isStrongApprovedOwnerCandidate, type OwnerNameResult } from "@shared/salonOwnerName";

export function renderContactFormDraft(row: SalonEnrichmentRow, owner: OwnerNameResult, sequence: EmailSequence, sender: User) {
  if (!owner.lookedUpAt || Number.isNaN(Date.parse(owner.lookedUpAt)) || owner.status === "not_searched") {
    throw new Error("Run owner research first and review its result before generating a contact-form draft.");
  }
  const candidate = isStrongApprovedOwnerCandidate(owner);
  const personalized = Boolean(candidate && owner.usePersonalName);
  const contact = {
    company: row.businessName, city: row.city,
    firstName: personalized ? candidate!.firstName : null,
    lastName: personalized ? candidate!.lastName : null,
    useBusinessNameForEmail: personalized ? "No" : "Yes",
  } as Parameters<typeof replaceTemplateVariables>[1];
  const greeting = replaceTemplateVariables("[Contact_Greeting]", contact, sender);
  const renderedBody = htmlToFormText(replaceTemplateVariables(sequence.body, contact, sender));
  if (!renderedBody) throw new Error("This saved message has no body. Choose a completed outreach message.");
  const body = renderedBody.startsWith(greeting) ? renderedBody
    : `${greeting}\n\n${renderedBody.replace(/^\s*(?:Hi|Hello|Hey|Dear)\b[^\n,!]{0,100}[,\n!]\s*/i,"")}`;
  return {
    name: [sender.firstName, sender.lastName].filter(Boolean).join(" "),
    replyEmail: sender.replyToEmail || sender.workEmail || sender.email || "",
    subject: replaceTemplateVariables(sequence.subject, contact, sender),
    body,
    greeting,
    personalized,
    ownerSearch: { status: owner.status, lookedUpAt: owner.lookedUpAt, error: owner.error || null },
    notice: "Saved-message draft only: no AI charge, form submission, email send or delivered-message record. Review and copy it into the business's contact form yourself.",
  };
}
