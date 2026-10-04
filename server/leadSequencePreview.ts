import { createHash } from "node:crypto";
import type { Contact, EmailSequence, User } from "@shared/schema";
import { leadRecipient } from "@shared/leadWorkflowState";
import { replaceTemplateVariables } from "./sendgrid";

export function renderLeadSequencePreview(sequence: EmailSequence, contact: Contact, sender: User) {
  const renderedSubject = replaceTemplateVariables(sequence.subject, contact, sender);
  const renderedHtml = replaceTemplateVariables(sequence.body, contact, sender);
  const greetingPreview = replaceTemplateVariables("[Contact_Greeting]", contact, sender);
  const previewFingerprint = createHash("sha256").update(JSON.stringify([
    sequence.id, contact.id, leadRecipient(contact.email), renderedSubject, renderedHtml, greetingPreview,
  ])).digest("hex");
  return { renderedSubject, renderedBody: renderedHtml.replace(/<[^>]*>/g, ""), greetingPreview, previewFingerprint };
}