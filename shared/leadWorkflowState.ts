export type LeadResearchProgress = {
  leadResearch?: {
    processedIds?: string[]; rowIds?: string[]; attemptedCalls?: number;
    providerCalls?: number; cacheHits?: number; maxProviderCalls?: number;
  };
};
export function leadResearchNeedsRefresh(batch?: { status?: string }, rows: { status?: string }[] = []) {
  return batch?.status === "running" || rows.some(row => row.status === "processing");
}
export function leadRecipient(email: unknown) {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}
export function leadSchedulePreviewReady(
  contactId: string | undefined,
  contact: { id?: string; email?: string } | null | undefined,
  sequence: { renderedSubject?: string | null; renderedBody?: string | null; greetingPreview?: string | null; previewFingerprint?: string | null } | undefined,
) {
  return !!contactId && contact?.id === contactId &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(leadRecipient(contact.email)) &&
    !!sequence?.renderedSubject?.trim() && !!sequence.renderedBody?.trim() &&
    !!sequence.greetingPreview?.trim() && !!sequence.previewFingerprint;
}