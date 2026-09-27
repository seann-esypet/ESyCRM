import type { SalonEnrichmentRow } from "@shared/schema";

export function validFormUrl(formUrl: string | null, websiteUrl: string | null): boolean {
  try {
    const form = new URL(formUrl || "");
    const site = new URL(websiteUrl || "");
    return ["http:", "https:"].includes(form.protocol) &&
      ["http:", "https:"].includes(site.protocol) &&
      !form.username && !form.password &&
      (form.hostname === site.hostname || form.hostname.endsWith(`.${site.hostname}`));
  } catch {
    return false;
  }
}

export function canEnrollFormRow(row: SalonEnrichmentRow): boolean {
  const duplicate = row.duplicateMetadata as { contactIds?: string[] } | null;
  return row.identityMatchStatus === "strong" &&
    row.status === "enriched" &&
    row.contactFormStatus === "verified" &&
    !row.email?.trim() &&
    !row.importedContactId &&
    !duplicate?.contactIds?.length &&
    validFormUrl(row.contactRequestFormUrl, row.websiteUrl);
}

export function nextFormDueAt(submittedAt: Date, daysAfterNoReply: number | null): Date {
  if (!Number.isInteger(daysAfterNoReply) || daysAfterNoReply === null || daysAfterNoReply < 0) {
    throw new Error("Next sequence step needs a nonnegative configured days-after-no-reply delay");
  }
  return new Date(submittedAt.getTime() + daysAfterNoReply * 24 * 60 * 60 * 1000);
}

export function htmlToFormText(body: string): string {
  return body
    .replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_match, href: string, label: string) =>
      `${label.replace(/<[^>]*>/g, "").trim()} (${href.replace(/&amp;/g, "&")})`)
    .replace(/<br\s*\/?>|<\/(?:p|div|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/\n{3,}/g, "\n\n").trim();
}