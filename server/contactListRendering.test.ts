import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Contact } from "@shared/schema";
import ContactList from "../client/src/components/contacts/contact-list";
import { getContactDisplay } from "../client/src/lib/contact-display";

const fixture = (overrides: Partial<Contact> = {}) => ({
  id: "fixture-contact",
  firstName: null,
  lastName: null,
  company: "Curly Tails",
  email: "hello@example.test",
  status: "active",
  ...overrides,
} as Contact);

function renderContacts(contacts: Contact[]) {
  return renderToStaticMarkup(createElement(ContactList, {
    contacts,
    isLoading: false,
    sortColumn: null,
    sortDir: "asc",
    onSortChange: () => {},
    onEdit: () => {},
    onArchive: () => {},
    onUnarchive: () => {},
    onStatusChange: () => {},
    selectedContactIds:new Set<string>(), isDeleting:false,
    onToggleSelection:()=>{}, onToggleSelectVisible:()=>{}, onDelete:()=>{}, onDeleteSelected:()=>{},
  }));
}

test("Contacts renders a mixed list with business-only and first-name-only records", () => {
  const html = renderContacts([
    fixture(),
    fixture({ id: "named", firstName: "Eliud", lastName: null }),
    fixture({ id: "full", firstName: "Jane", lastName: "Smith" }),
  ]);
  assert.match(html, /data-testid="contacts-table"/);
  assert.match(html, /data-testid="link-contact-details-fixture-contact"[^>]*>Curly Tails</);
  assert.match(html, /data-testid="link-contact-details-named"[^>]*>Eliud</);
  assert.match(html, /data-testid="link-contact-details-full"[^>]*>Jane Smith</);
});

test("Contacts renders blank names and records with no business or email", () => {
  const html = renderContacts([
    fixture({ firstName: "  ", lastName: "", company: "Curly Tails" }),
    fixture({ id: "email-only", company: null }),
    fixture({ id: "empty", company: null, email: null }),
  ]);
  assert.match(html, /data-testid="link-contact-details-fixture-contact"[^>]*>Curly Tails</);
  assert.match(html, /data-testid="link-contact-details-email-only"[^>]*>hello@example.test</);
  assert.match(html, /data-testid="link-contact-details-empty"[^>]*>Unnamed contact</);
});

test("list and details use safe initials without inventing personal names", () => {
  assert.deepEqual(getContactDisplay(fixture()), { name: "Curly Tails", initials: "CT" });
  assert.deepEqual(getContactDisplay(fixture({ firstName: "Eliud" })), { name: "Eliud", initials: "E" });
  assert.deepEqual(getContactDisplay(fixture({ firstName: " Jane ", lastName: " Smith " })), { name: "Jane Smith", initials: "JS" });
  assert.deepEqual(getContactDisplay(fixture({ company: null, email: null })), { name: "Unnamed contact", initials: "?" });
});