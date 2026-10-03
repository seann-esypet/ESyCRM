// Isolated browser fixtures: every /api/ request is intercepted. No real
// authentication, enrollment, rescheduling, database writes or email sending.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";

const profile = await mkdtemp(join(tmpdir(), "pipeline-email-browser-"));
const chrome = spawn("chromium", ["--headless", "--no-sandbox", "--disable-dev-shm-usage",
  "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
let ws;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const errors = [];
const pending = new Map();
let nextId = 0;
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 15000);
    pending.set(id, { resolve, reject, timeout });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result?.value;
}
async function until(expression, label) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return;
    await pause(100);
  }
  throw new Error(`Browser did not reach ${label}`);
}
async function click(selector) {
  await until(`!!document.querySelector(${JSON.stringify(selector)})`, selector);
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
}
async function select(testId, label) {
  await evaluate(`(() => {
    const el=document.querySelector('[data-testid="${testId}"]');
    el.focus(); el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
  })()`);
  await until(`Array.from(document.querySelectorAll('[role="option"]')).some(el=>el.textContent.trim()===${JSON.stringify(label)})`, label);
  await evaluate(`(() => {
    const el=Array.from(document.querySelectorAll('[role="option"]')).find(el=>el.textContent.trim()===${JSON.stringify(label)});
    el.focus(); el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
  })()`);
  await pause(150);
}
async function input(selector, value) {
  await evaluate(`(() => {
    const el=document.querySelector(${JSON.stringify(selector)});
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});
    el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true}));
  })()`);
}

const date = "2026-10-01T14:00:00.000Z";
let role = "admin";
let failSummaries = false;
let failLogs = false;
let scheduled = false;
let summaryReads = 0;
let fakeMutations = 0;
const contact = (id, email = `${id}@example.test`, userId = "owner-a") => ({
  id, email, userId, firstName: "Fixture", lastName: id, company: id,
  usesSoftware: "No", businessType: "salon", status: "pipeline",
});
const contacts = [contact("empty"), contact("pending"), contact("sent"), contact("failed"),
  contact("replied"), contact("no-address", null), contact("other", "other@example.test", "owner-b")];
const deal = (id, contactId = id, userId = "owner-a") => ({
  id, contactId, userId, title: `Fixture deal ${id}`, stage: "qualified_lead",
  value: "149", probability: 10, createdAt: date, expectedCloseDate: null, description: "",
});
const deals = [...contacts.map(c => deal(c.id, c.id, c.userId)),
  deal("shared-sent", "sent"), deal("no-contact", null), deal("unavailable", "missing")];
const base = id => ({
  contactId: id, contactState: "available", email: contacts.find(c => c.id === id)?.email ?? null,
  sequenceStatus: "not_enrolled", logCount: 0, sentCount: 0, latestSentAt: null,
  scheduledCount: 0, processingCount: 0, failedCount: 0, nextScheduledAt: null, historyUncertain: false,
});
const summaries = () => ({
  empty: { ...base("empty"), ...(scheduled ? { sequenceStatus: "scheduled", logCount: 1, scheduledCount: 1 } : {}) },
  pending: { ...base("pending"), sequenceStatus: "scheduled", logCount: 1, scheduledCount: 1 },
  sent: { ...base("sent"), sequenceStatus: "scheduled", logCount: 2, sentCount: 1, latestSentAt: date, scheduledCount: 1 },
  failed: { ...base("failed"), sequenceStatus: "failed", logCount: 1, failedCount: 1 },
  replied: { ...base("replied"), sequenceStatus: "reply_stopped", logCount: 1, historyUncertain: true },
  "no-address": { ...base("no-address"), sequenceStatus: "historical", logCount: 1, sentCount: 1, latestSentAt: date },
  other: base("other"),
  missing: { ...base("missing"), contactState: "unavailable", sequenceStatus: "unavailable" },
});
const historyLog = (id, status = "sent") => ({
  id: `log-${id}`, contactId: id, userId: "owner-a", sequenceId: "sequence-1",
  sequenceTrack: "salon_no_software", sequenceNumber: 1, status,
  sentAt: status === "sent" ? date : null, scheduledSendAt: "2027-01-10T14:00:00.000Z",
  emailResponseReceived: "false", createdAt: date,
});
const scope = url => role === "salesperson" ? "owner-a" : url.searchParams.get("filterUserId");
function response(request) {
  const url = new URL(request.url);
  const owner = scope(url);
  if (request.method !== "GET") {
    if (url.pathname === "/api/email-sequence-logs/initiate") {
      fakeMutations++; scheduled = true;
      return { body: historyLog("empty", "pending") };
    }
    if (/\/api\/email-sequence-logs\/.*\/reschedule$/.test(url.pathname)) {
      fakeMutations++;
      return { body: historyLog("sent", "pending") };
    }
    throw new Error(`Unexpected mutation blocked: ${request.method} ${url.pathname}`);
  }
  if (url.pathname === "/api/auth/user") return { body: {
    id: "owner-a", role, email: "fixture-owner@example.test", firstName: "Fixture", lastName: "Owner",
  } };
  if (url.pathname === "/api/admin/users") return { body: [
    { id: "owner-a", firstName: "Owner", lastName: "A" }, { id: "owner-b", firstName: "Owner", lastName: "B" },
  ] };
  if (url.pathname === "/api/deals") return { body: deals.filter(d => !owner || d.userId === owner) };
  if (url.pathname === "/api/contacts") return { body: contacts.filter(c => !owner || c.userId === owner) };
  if (url.pathname === "/api/deals/email-summaries") {
    summaryReads++;
    if (failSummaries) return { status: 503, body: { message: "Fixture summary failure" } };
    const wanted = new Set(deals.filter(d => !owner || d.userId === owner).map(d => d.contactId));
    return { body: Object.fromEntries(Object.entries(summaries()).filter(([id]) => wanted.has(id))) };
  }
  if (url.pathname === "/api/email-sequence-logs") {
    if (failLogs) return { status: 503, body: { message: "Fixture history failure" } };
    const id = url.searchParams.get("contactId");
    return { body: id === "empty" ? scheduled ? [historyLog("empty", "pending")] : [] : [historyLog(id)] };
  }
  if (url.pathname === "/api/email-sequences") return { body: [{
    id: "sequence-1", subject: "Fixture sequence", strategy: "legacy", sequenceNumber: 1,
    sequenceTrack: "salon_no_software", userId: "owner-a",
  }] };
  return { body: [] };
}

try {
  let port;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { port = Number((await readFile(join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]); break; }
    catch { await pause(100); }
  }
  assert.ok(port, "Chromium must start");
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  ws = new WebSocket(pages.find(page => page.type === "page").webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject); });
  ws.on("message", async raw => {
    const message = JSON.parse(raw.toString());
    if (message.id) {
      const call = pending.get(message.id);
      if (call) {
        clearTimeout(call.timeout); pending.delete(message.id);
        message.error ? call.reject(new Error(message.error.message)) : call.resolve(message.result);
      }
    } else if (message.method === "Fetch.requestPaused") {
      try {
        const result = response(message.params.request);
        await send("Fetch.fulfillRequest", {
          requestId: message.params.requestId, responseCode: result.status ?? 200,
          responseHeaders: [{ name: "Content-Type", value: "application/json" }],
          body: Buffer.from(JSON.stringify(result.body)).toString("base64"),
        });
      } catch (error) {
        errors.push(error.message);
        await send("Fetch.failRequest", { requestId: message.params.requestId, errorReason: "BlockedByClient" });
      }
    } else if (message.method === "Runtime.exceptionThrown") {
      errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    }
  });
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Fetch.enable", { patterns: [{ urlPattern: "*://*/api/*" }] });
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
  const origin = process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "http://127.0.0.1:5000";
  await send("Page.navigate", { url: `${origin}/deals` });
  await until(`document.querySelector('[data-testid="deal-row-empty"]')?.innerText.includes('Not in a sequence')`, "loaded Pipeline");
  const row = id => `document.querySelector('[data-testid="deal-row-${id}"]')?.innerText`;
  assert.match(await evaluate(row("empty")), /No recorded emails sent/);
  assert.match(await evaluate(row("pending")), /Scheduled[\s\S]*No recorded emails sent/);
  assert.match(await evaluate(row("sent")), /1 recorded sent/);
  assert.match(await evaluate(row("shared-sent")), /1 recorded sent/);
  assert.match(await evaluate(row("failed")), /Failed attempt[\s\S]*No recorded emails sent/);
  assert.match(await evaluate(row("replied")), /Stopped after reply[\s\S]*History incomplete/);
  assert.match(await evaluate(row("no-address")), /No email address[\s\S]*1 recorded sent/);
  assert.match(await evaluate(row("no-contact")), /No linked contact/);
  assert.match(await evaluate(row("unavailable")), /Contact unavailable/);
  console.log("PASS table status, missing contact/address, uncertain history and shared-contact counts");

  await click('[data-testid="sort-title"]');
  assert.equal(await evaluate(`document.querySelector('[data-testid^="deal-row-"]').getAttribute('data-testid')`), "deal-row-empty");
  await input('[data-testid="search-input"]', "sent@example.test");
  await until(`document.querySelectorAll('[data-testid^="deal-row-"]').length===2`, "email search alongside sorting");
  await input('[data-testid="search-input"]', "no-fixture-matches-this");
  await until(`document.body?.innerText?.includes('No deals match these filters')`, "empty search");
  await evaluate(`Array.from(document.querySelectorAll('button')).find(el=>el.textContent==='Clear filters').click()`);
  assert.equal(await evaluate(`document.querySelector('[data-testid="search-input"]').value`), "");
  await until(`document.querySelectorAll('[data-testid^="deal-row-"]').length===10`, "cleared search");
  await select("filter-sequence-status", "Status unavailable");
  assert.equal(await evaluate(`document.querySelectorAll('[data-testid^="deal-row-"]').length`), 2);
  await select("filter-sequence-status", "All sequence statuses");
  await select("filter-recorded-sends", "No recorded sends");
  assert.equal(await evaluate(`document.querySelectorAll('[data-testid^="deal-row-"]').length`), 4);
  await select("filter-recorded-sends", "All send history");
  console.log("PASS search/sort coexistence, visible search reset and honest unavailable/no-send filters");

  await select("filter-recorded-sends", "Has recorded sends");
  assert.equal(await evaluate(`document.querySelectorAll('[data-testid^="deal-row-"]').length`), 3);
  await select("filter-sequence-status", "Scheduled");
  assert.equal(await evaluate(`document.querySelectorAll('[data-testid^="deal-row-"]').length`), 2);
  await click('[data-testid="view-card"]');
  assert.equal(await evaluate(`document.querySelectorAll('[data-testid^="deal-card-"]').length`), 2);
  assert.match(await evaluate(`document.querySelector('[data-testid="deal-card-sent"]').innerText`), /1 recorded sent/);
  await select("filter-recorded-sends", "All send history");
  await select("filter-sequence-status", "All sequence statuses");
  await select("select-filter-user-deals", "Owner B");
  await until(`document.querySelectorAll('[data-testid^="deal-card-"]').length===1`, "owner filtering");
  await select("select-filter-user-deals", "All Salespeople");
  await until(`document.querySelectorAll('[data-testid^="deal-card-"]').length===10`, "all owners");
  console.log("PASS combined filters, view switching and administrator owner selection");

  await evaluate(`document.querySelector('[data-testid="deal-card-empty"] button[aria-label="Email history"]').click()`);
  await until(`!!document.querySelector('[data-testid="button-initiate-sequence"]')`, "history dialog");
  const before = summaryReads;
  await click('[data-testid="button-initiate-sequence"]');
  await input('[data-testid="input-initiate-date"]', "2027-01-10");
  await input('[data-testid="input-initiate-time"]', "09:00");
  await click('[data-testid="button-submit-initiate"]');
  await until(`document.querySelector('[data-testid="deal-card-empty"]')?.innerText.includes('Scheduled')`, "summary refresh after mocked initiation");
  assert.equal(fakeMutations, 1);
  assert.ok(summaryReads > before);
  await until(`!!document.querySelector('[data-testid="button-reschedule-log-empty"]')`, "reschedule action");
  const beforeReschedule = summaryReads;
  await click('[data-testid="button-reschedule-log-empty"]');
  await input('[data-testid="input-reschedule-date-log-empty"]', "2027-01-12");
  await click('[data-testid="button-submit-reschedule-log-empty"]');
  await until(`!document.querySelector('[data-testid="button-submit-reschedule-log-empty"]')`, "mocked reschedule completed");
  assert.equal(fakeMutations, 2);
  assert.ok(summaryReads > beforeReschedule);
  await evaluate(`document.querySelector('[role="dialog"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
  await send("Emulation.setDeviceMetricsOverride", { width: 402, height: 874, deviceScaleFactor: 1, mobile: true });
  await click('[data-testid="button-toggle-sidebar"]');
  await until(`document.querySelector('[data-testid="header"]').clientWidth>250`, "existing sidebar collapsed for phone use");
  await until(`document.querySelector('[data-testid="deal-card-empty"]')?.innerText.includes('Scheduled')`, "mobile card rendering");
  const headerFits = await evaluate(`document.querySelector('[data-testid="header"]').scrollWidth<=document.querySelector('[data-testid="header"]').clientWidth+2`);
  assert.ok(headerFits, "Pipeline controls must fit the phone viewport");
  console.log("PASS history navigation, mocked initiation/rescheduling refresh and mobile card rendering");

  failSummaries = true;
  await send("Page.reload", { ignoreCache: true });
  await until(`document.body?.innerText?.includes('Pipeline email status could not be loaded')`, "summary error");
  assert.doesNotMatch(await evaluate(row("empty")) ?? "", /No recorded emails sent/);
  failSummaries = false;
  await evaluate(`Array.from(document.querySelectorAll('button')).find(el=>el.textContent.includes('Retry status')||el.getAttribute('aria-label')==='Retry email status').click()`);
  await until(`document.querySelector('[data-testid="deal-row-empty"]')?.innerText.includes('Scheduled')`, "summary retry");
  console.log("PASS failed summaries remain unknown and retry restores status");

  role = "salesperson";
  await send("Page.reload", { ignoreCache: true });
  await until(`!!document.querySelector('[data-testid="deal-row-empty"]')`, "salesperson view");
  assert.equal(await evaluate(`!!document.querySelector('[data-testid="select-filter-user-deals"]')`), false);
  assert.equal(await evaluate(`!!document.querySelector('[data-testid="deal-row-other"]')`), false);
  failLogs = true;
  await evaluate(`document.querySelector('[data-testid="deal-row-empty"] button[aria-label="Email history"]').click()`);
  await until(`document.body?.innerText?.includes('Email history could not be loaded')`, "failed history dialog");
  assert.equal(await evaluate(`!!document.querySelector('[data-testid="button-initiate-sequence"]')`), false);
  console.log("PASS salesperson owner controls and failed history cannot offer initiation");
  assert.deepEqual(errors, []);
  console.log(`Browser fixture checks passed; ${fakeMutations} intercepted mock mutation, zero real API mutations.`);
} finally {
  ws?.close();
  chrome.kill("SIGTERM");
  await pause(300);
  await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
}