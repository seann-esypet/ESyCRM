import type { Contact, SalonEnrichmentRow } from "./schema";

// Internal evidence records, not uploaded lead lists or executable research runs.
export const CONTACT_OWNER_LOOKUP_PURPOSE = "contact_owner_lookup";

export function contactOwnerLookupIdentity(contact: Contact) {
  return {
    businessName: contact.company?.trim() || "",
    address: contact.address,
    address1: contact.address,
    city: contact.city,
    state: contact.state,
    zipCode: contact.zipCode,
    websiteUrl: contact.websiteUrl,
    email: contact.email,
    phone: contact.phone,
  };
}

export function contactOwnerLookupMatches(row: SalonEnrichmentRow, contact: Contact): boolean {
  const identity = contactOwnerLookupIdentity(contact);
  return (["businessName", "address", "address1", "city", "state", "zipCode", "websiteUrl"] as const)
    .every(key => row[key] === identity[key]);
}
