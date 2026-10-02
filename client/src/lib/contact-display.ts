import type { Contact } from "@shared/schema";

export function getContactDisplay(
  contact: Pick<Contact, "firstName" | "lastName" | "company" | "email">,
): { name: string; initials: string } {
  const firstName = contact.firstName?.trim() || "";
  const lastName = contact.lastName?.trim() || "";
  const personName = [firstName, lastName].filter(Boolean).join(" ");
  const company = contact.company?.trim() || "";
  const email = contact.email?.trim() || "";
  const name = personName || company || email || "Unnamed contact";
  const initials = personName
    ? `${firstName.charAt(0)}${lastName.charAt(0)}`
    : (company || email).split(/\s+/).slice(0, 2).map(word => word.charAt(0)).join("");
  return { name, initials: initials.toUpperCase() || "?" };
}