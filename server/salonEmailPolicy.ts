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

/**
 * Include a mailbox's containing-section labels, not other sections' inboxes.
 * Flattening or splitting at every block tag loses labels such as:
 * <div>For bookings only<p><a href="mailto:...">Email</a></p></div>.
 */
export function salonEmailHtmlContextRestriction(email: string, html: string): string | null {
  type Node = { tag: string; own: string; children: Node[]; parent?: Node };
  const root: Node = { tag: "", own: "", children: [] };
  const stack: Node[] = [root];
  const nodes: Node[] = [];
  const blocks = new Set(["p", "div", "li", "td", "section", "article", "address",
    "blockquote", "fieldset", "form", "footer", "header", "aside", "h1", "h2", "h3", "h4", "h5", "h6"]);
  const voids = new Set(["area", "base", "br", "col", "embed", "hr", "img",
    "input", "link", "meta", "param", "source", "track", "wbr"]);
  const markup = html.replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|head|template|noscript|svg|textarea)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ");
  for (const token of markup.match(/<\/?[a-z][\w:-]*\b[^>]*>|[^<]+|</gi) ?? []) {
    const tag = token.match(/^<\/?([a-z][\w:-]*)\b/i)?.[1]?.toLowerCase();
    if (!tag) {
      stack[stack.length - 1].own += ` ${token}`;
    } else if (token.startsWith("</")) {
      for (let index = stack.length - 1; index > 0; index--) {
        if (stack[index].tag === tag) {
          stack.length = index;
          break;
        }
      }
    } else {
      const parent = stack[stack.length - 1];
      const node: Node = { tag, own: token, children: [], parent };
      parent.children.push(node);
      nodes.push(node);
      if (!voids.has(tag) && !/\/\s*>$/.test(token)) stack.push(node);
      if (stack.length > 128) return "Mailbox context is too deeply nested to verify safely";
    }
  }
  const flatten = (node: Node, includeBlocks: boolean): string => [
    node.own,
    ...node.children.filter(child => includeBlocks || !blocks.has(child.tag))
      .map(child => flatten(child, includeBlocks)),
  ].join(" ");
  const needle = email.toLowerCase();
  for (const node of [root, ...nodes].filter(node => node.own.toLowerCase().includes(needle))) {
    // Preserve inline labels around mailto links as well as visible addresses.
    let current: Node = node;
    while (!blocks.has(current.tag) && current.parent) current = current.parent;
    let context = flatten(current, false);
    let reason = salonEmailContextRestriction(context);
    if (reason) return reason;
    for (let parent = current.parent; parent; parent = parent.parent) {
      // Document-level containers do not make one section's restrictions global.
      if (!blocks.has(parent.tag)) continue;
      const labels = parent.children.filter(child => {
        const text = flatten(child, true);
        const plain = text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
        // Opening hours in another section do not designate this mailbox.
        // Keep explicit email/booking/client restrictions, even inside hours.
        const openingHoursOnly = /\b(?:opening|business|operating|office)\s+hours\b|\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(plain)
          && !/\b(?:e-?mail|mailbox|inbox|bookings?|reservations?|requests?|clients?|customers?|vaccination|records?|paperwork)\b/i.test(plain);
        return !/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(text) &&
          !openingHoursOnly &&
          (/^(?:h[1-6]|label|legend)$/.test(child.tag) || Boolean(salonEmailContextRestriction(text)));
      }).map(child => flatten(child, true));
      context += ` ${flatten(parent, false)} ${labels.join(" ")}`;
      reason = salonEmailContextRestriction(context);
      if (reason) return reason;
    }
  }
  return null;
}