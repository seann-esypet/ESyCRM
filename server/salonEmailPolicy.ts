// Provider-owned mailboxes are not salon contacts, even when a salon uses
// that provider to host its website or booking page.
const providerDomains = [
  "webador.com", "webador.co.uk", "jouwweb.nl", "jouwweb.be",
  "wix.com", "wixpress.com", "squarespace.com", "wordpress.com",
  "weebly.com", "godaddy.com", "google.com", "youtube.com", "youtu.be",
  "vimeo.com", "facebook.com", "instagram.com", "gingrapp.com",
  "groomer.io", "moego.pet", "vagaro.com", "booksy.com", "pawfinity.com",
  "schedulicity.com", "acuityscheduling.com", "calendly.com",
  "pocketsuite.io", "setmore.com", "cuddlesapp.com",
];

export function salonEmailDomainRestriction(email: string): string | null {
  const [local, domain] = email.trim().toLowerCase().split("@");
  if (!local || !domain) return "Invalid email address";
  if (providerDomains.some(provider => domain === provider || domain.endsWith(`.${provider}`))) {
    return "Website, booking or social-platform mailbox, not a salon contact";
  }
  if (/^(?:no-?reply|do-?not-?reply|mailer-daemon|postmaster)$/i.test(local)) {
    return "Automated or non-reply mailbox, not a general contact";
  }
  return null;
}

export function salonEmailContextRestriction(context: string): string | null {
  const text = context.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
  if (/\b(?:vaccination|vaccine|rabies|immunization)\b/i.test(text) &&
      /\b(?:records?|proof|paperwork|submit|send|upload)\b/i.test(text)) {
    return "Mailbox designated for vaccination records or client paperwork";
  }
  if (/\b(?:booking|bookings|appointments?|reservations?)\s+(?:requests?\s+)?only\b/i.test(text) ||
      /\bonly\s+(?:for\s+)?(?:booking|bookings|appointments?|reservations?)\b/i.test(text) ||
      /\b(?:existing|current)\s+(?:clients?|customers?)\s+only\b/i.test(text)) {
    return "Mailbox explicitly restricted to bookings or existing clients";
  }
  if (/\b(?:web(?:site)?|site)\s+(?:design(?:ed)?|develop(?:ed|ment)|built|created|support|builder)\b/i.test(text) ||
      /\b(?:powered|website)\s+by\b/i.test(text)) {
    return "Website-builder or design-credit context; salon attribution requires review";
  }
  return null;
}