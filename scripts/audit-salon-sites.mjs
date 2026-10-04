import { readFileSync, writeFileSync } from "node:fs";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { pathToFileURL } from "node:url";

const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const blockedHost = /(^|\.)(facebook\.com|instagram\.com|twitter\.com|x\.com|linkedin\.com|yelp\.com|tiktok\.com|youtube\.com|youtu\.be|vagaro\.com|squareup\.com|moego\.pet|spoton\.com|rymap\.org|rymaps\.org|groomore\.com)$/i;
const unrelatedCategory = /^(American restaurant|Grocery store|Supermarket|Dollar store|Pharmacy)$/i;

function decode(text) {
  return text.replace(/&amp;/gi, "&").replace(/&commat;|&#64;|&#x40;/gi, "@")
    .replace(/&nbsp;|&#160;/gi, " ").replace(/&quot;/gi, '"')
    .replace(/&#39;|&#x27;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">");
}

function visible(html) {
  return decode(html.replace(/<(script|style|svg|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
}

function safeUrl(raw) {
  const url = new URL(raw);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password ||
      !url.hostname.includes(".") || isIP(url.hostname) || /(^|\.)(localhost|local|internal)$/i.test(url.hostname))
    throw new Error("Unsafe URL");
  url.hash = "";
  return url;
}

async function publicHost(host) {
  const addresses = await lookup(host, { all: true });
  return addresses.length > 0 && addresses.every(({ address }) =>
    !/^(?:0\.|10\.|127\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.|192\.168\.|224\.|240\.|::1$|fc|fd|fe80)/i.test(address));
}

async function fetchPage(input, originalHost) {
  let url = safeUrl(input);
  for (let redirects = 0; redirects < 3; redirects++) {
    if (url.hostname.replace(/^www\./, "") !== originalHost.replace(/^www\./, "") ||
        !(await publicHost(url.hostname))) throw new Error("Off-domain or private redirect");
    let response;
    for (const headers of [
      { "User-Agent": "Mozilla/5.0 (compatible; SalonContactAudit/1.0)", Accept: "text/html" },
      { Accept: "text/html" },
    ]) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      try {
        response = await fetch(url, { headers, redirect: "manual", signal: controller.signal });
        if (response.ok || (response.status >= 300 && response.status < 400)) break;
      } catch (error) {
        if (headers.Accept && !headers["User-Agent"]) throw error;
      } finally {
        clearTimeout(timer);
      }
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Redirect without Location");
      url = safeUrl(new URL(location, url).href);
      continue;
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (!/text\/html|application\/xhtml\+xml/i.test(response.headers.get("content-type") || ""))
      throw new Error("Not an HTML page");
    const length = Number(response.headers.get("content-length") || 0);
    if (length > 800000) throw new Error("Page too large");
    const html = await response.text();
    if (html.length > 800000) throw new Error("Page too large");
    return { url: url.href, html };
  }
  throw new Error("Too many redirects");
}

function extractEmails(html, url) {
  const sanitized = html.replace(/<(script|style|svg|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ");
  const text = visible(sanitized);
  const all = [...text.matchAll(emailPattern)].map(match => ({
    email: match[0].toLowerCase(), sourceUrl: url,
    context: text.slice(Math.max(0, match.index - 95), match.index + match[0].length + 95),
  }));
  for (const match of sanitized.matchAll(/href=["']mailto:([^"'?]+)[^"']*["']/gi)) {
    const email = decode(match[1]).trim().toLowerCase();
    if (emailPattern.test(email)) all.push({ email, sourceUrl: url, context: "mailto link" });
    emailPattern.lastIndex = 0;
  }
  return [...new Map(all.filter(x => !/\.(?:png|jpg|jpeg|gif|svg)$/i.test(x.email))
    .map(x => [x.email, x])).values()];
}

function extractForms(html, url) {
  return [...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form\s*>/gi)].flatMap(([, attrs, body]) => {
    const fields = [...body.matchAll(/<(?:input|textarea)\b([^>]*)>/gi)].map(x =>
      x[1].match(/\b(?:name|placeholder)=["']([^"']+)["']/i)?.[1] || "").filter(Boolean);
    const hasMessage = /<textarea\b/i.test(body) || fields.some(x => /message|comment|inquir/i.test(x));
    const hasSubmit = /<button\b/i.test(body) || /<input\b[^>]*type=["']?submit/i.test(body);
    const context = visible(body).slice(0, 300);
    if (!hasMessage || !hasSubmit || /book(?:ing)?|appointment|reserv|newsletter|subscribe/i.test(`${attrs} ${context}`)) return [];
    return [{ sourceUrl: url, fields, context }];
  });
}

function sameSiteLinks(html, base, host) {
  const links = [];
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const label = `${match[1]} ${visible(match[2])}`;
    if (!/contact|about|reach.us|get.in.touch|inquir/i.test(label) ||
        /book|appointment|reserv|schedule/i.test(label)) continue;
    try {
      const target = safeUrl(new URL(decode(match[1]), base).href);
      if (target.hostname.replace(/^www\./, "") === host.replace(/^www\./, "") &&
          !links.includes(target.href)) links.push(target.href);
    } catch { /* Ignore links that cannot be audited safely. */ }
  }
  return links.slice(0, 3);
}

export async function audit(row) {
  const record = { ...row, outcome: "not_assessed", pages: [], errors: [] };
  if (row.stratum === "unrelated_category_control" || unrelatedCategory.test(row.category)) {
    record.outcome = "unrelated_business_control";
    return record;
  }
  let start;
  try { start = safeUrl(row.url); } catch { record.outcome = "unsafe_url"; return record; }
  if (blockedHost.test(start.hostname)) {
    record.outcome = "social_booking_or_directory_url";
    return record;
  }
  const queue = [start.href];
  const tried = new Set();
  while (queue.length && record.pages.length + record.errors.length < 4) {
    const next = queue.shift();
    if (tried.has(next)) continue;
    tried.add(next);
    try {
      const page = await fetchPage(next, start.hostname);
      record.pages.push({
        url: page.url,
        title: decode(page.html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() || ""),
        identityContext: visible(page.html).slice(0, 450),
        emails: extractEmails(page.html, page.url),
        generalFormCandidates: extractForms(page.html, page.url),
      });
      if (record.pages.length === 1) {
        queue.push(...sameSiteLinks(page.html, page.url, start.hostname));
        if (queue.length === 0) {
          queue.push(new URL("/contact", page.url).href, new URL("/about", page.url).href);
        }
      }
    } catch (error) {
      record.errors.push({ url: next, reason: error.message });
    }
  }
  record.outcome = record.pages.length ? "pages_retrieved_review_required" : "crawl_failed";
  return record;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const selection = JSON.parse(readFileSync("reports/salon-site-audit-selection.json", "utf8")).rows;
  const output = "reports/salon-site-crawl-evidence.json";
  const results = [];
  for (let i = 0; i < selection.length; i += 3) {
    results.push(...await Promise.all(selection.slice(i, i + 3).map(audit)));
    writeFileSync(output, JSON.stringify({ method: "Read-only GET; maximum four same-domain HTML pages per business; no social/booking/directory scraping, no form submissions", results }, null, 2));
    console.log(`Audited ${results.length}/${selection.length}`);
  }
  console.log(`Saved ${output}`);
}