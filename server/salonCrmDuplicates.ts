import type { Contact, SalonEnrichmentRow } from "@shared/schema";
import { normalizeEmail, normalizeName, normalizePhoneNumber } from "@shared/utils";

type LeadIdentity = Pick<SalonEnrichmentRow, "businessName" | "address1" | "address" | "zipCode" | "phone" | "placeId">;
type ContactIdentity = Pick<Contact, "id" | "company" | "address" | "zipCode" | "phone" | "email" | "notes">;
export function salonCrmDuplicateReasons(row: LeadIdentity, contact: ContactIdentity, email: string) {
  const reasons: string[] = [];
  const emailKey = normalizeEmail(email), phoneKey = normalizePhoneNumber(row.phone);
  if (emailKey && normalizeEmail(contact.email) === emailKey) reasons.push("Email address");
  if (phoneKey && normalizePhoneNumber(contact.phone) === phoneKey) reasons.push("Phone number");
  const company = normalizeName(row.businessName), address = normalizeName(row.address1 || row.address);
  if (company && address && normalizeName(contact.company) === company && normalizeName(contact.address) === address &&
    (!row.zipCode || !contact.zipCode || row.zipCode === contact.zipCode)) reasons.push("Business and address");
  try {
    const placeId = JSON.parse(contact.notes || "{}")?.placeId;
    if (row.placeId?.trim() && typeof placeId === "string" && placeId.trim().toLowerCase() === row.placeId.trim().toLowerCase()) reasons.push("Place ID");
  } catch { /* Ordinary free-form notes contain no structured Place ID. */ }
  return reasons;
}
export function salonCrmDuplicates<T extends ContactIdentity>(row: LeadIdentity, contacts: T[], email: string) {
  return contacts.filter(contact => salonCrmDuplicateReasons(row, contact, email).length > 0);
}