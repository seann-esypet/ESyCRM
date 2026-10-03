// Intercept every API call: no real research, CRM writes, enrollment or sends.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { directoryEligibility, directoryEligibilitySummary, groomingReviewFor, directoryObject, withDirectoryNotes } from "../shared/directoryEligibility.ts";
const profile = await mkdtemp(join(tmpdir(), "directory-review-browser-"));
const chrome = spawn("chromium", ["--headless", "--no-sandbox", "--disable-dev-shm-usage",
  "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const pending = new Map(), errors = [], mutations = [];
let ws, nextId = 0;
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${method}`)); }, 15000);
    pending.set(id, { resolve, reject, timeout }); ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const value = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (value.exceptionDetails) throw new Error(value.exceptionDetails.exception?.description || value.exceptionDetails.text);
  return value.result?.value;
}
async function until(expression, label) {
  for (let attempt = 0; attempt < 160; attempt++) {
    if (await evaluate(`Boolean(${expression})`)) return;
    await pause(100);
  }
  throw new Error(`${label}: ${await evaluate("document.body.innerText.slice(-1800)")}`);
}
const emptyOwner = { status: "not_searched", candidates: [], selectedCandidateId: null, approvedAt: null,
  usePersonalName: false, providerCalls: 0, pagesFetched: 0 };
const originalRows = ["Pharmacy", "Pet boarding service", "Pet groomer"].map((category, index) => ({
  id: `fixture-${index}`, batchId: "fixture-batch", userId: "fixture-user", rowNumber: index + 1,
  businessName: `Fixture Business ${index}`, company: `Fixture Business ${index}`,
  address: "12 Main Street", state: "TX", placeId: `fixture-place-${index}`, identityMatchStatus: "strong",
  email: "hello@fixture.example", candidateEmail: "hello@fixture.example", reviewStatus: "needs_review",
  status: "enriched", importedContactId: null, isImported: "false", category: "verified_public_email",
  sourceData: { category: "verified_public_email" }, audienceTrack: "directory_general",
  evidence: { directoryListing: { categories: [category], name: `Fixture Business ${index}`,
    address: "12 Main Street", placeId: `fixture-place-${index}`, provider: "Fixture Maps",
    sourceUrl: "https://fixture.example/" } },
  ownerName: emptyOwner, confidence: {}, serpCallsUsed: 0,
}));
let rows = [], ownerConfirmed = true;
const batch = { id: "fixture-batch", name: "Fixture review", status: "completed", totalRows: 3, fileName: "fixture.csv", enrichedRows: 3, approvedRows: 0 };
const job = { id: "fixture-job", state: "TX", status: "completed", leadsFound: 3, createdAt: "2026-10-03T12:00:00Z" };
async function response(request) {
  const url = new URL(request.url);
  if (request.method !== "GET") {
    assert.equal(request.method, "POST");
    assert.ok(/\/eligibility$/.test(url.pathname), `Unexpected mutation: ${url.pathname}`);
    const payload = JSON.parse(request.postData || "{}");
    assert.equal(payload.confirmed, true); assert.ok(payload.note.trim());
    const id = url.pathname.split("/").at(-2), current = rows.find(row => row.id === id);
    assert.ok(current);
    current.evidence = { ...directoryObject(current.evidence), groomingReview: groomingReviewFor(current, payload.decision, payload.note) };
    mutations.push(payload);
    return { row: current, eligibility: directoryEligibility(current) };
  }
  if (url.pathname === "/api/auth/user") return { id: "fixture-user", role: "admin", firstName: "Fixture", lastName: "User" };
  if (url.pathname === "/api/deal-workspace/fixture-deal") return {
    deal: { id: "fixture-deal", contactId: "fixture-0", userId: "fixture-user", title: "Fixture Business 0",
      stage: "new_lead_unqualified", probability: 0, createdAt: "2026-10-03T12:00:00Z" },
    contact: { ...originalRows[0], firstName: ownerConfirmed ? "Jane" : null, lastName: ownerConfirmed ? "Smith" : null,
      useBusinessNameForEmail: "Yes", notes: JSON.stringify({ evidence: { ownerName: emptyOwner } }) },
    tasks: [], activities: [],
  };
  if (url.pathname === "/api/salon-search-report") return { rows: rows.map(row => ({ ...row, eligibility: directoryEligibility(row) })),
    batches: [batch], totals: { rows: 3, batches: 1, byCategory: { verified_public_email: 3 } },
    eligibilitySummary: directoryEligibilitySummary(rows), pagination: { total: 3, limit: 50, offset: 0 } };
  if (url.pathname.endsWith("/eligibility-summary")) return directoryEligibilitySummary(rows);
  if (url.pathname.endsWith("/fixture-batch/rows")) return rows;
  if (url.pathname.endsWith("/fixture-batch")) return batch;
  if (url.pathname.endsWith("/verification-estimate")) return { mode: "none", eligibleRows: 0, estimatedSerpCalls: 0, active: false };
  if (url.pathname === "/api/lead-discovery/jobs") return [job];
  if (url.pathname === "/api/lead-discovery/all-results" || url.pathname.endsWith("/fixture-job/results")) {
    return rows.map(row => ({ ...row, notes: withDirectoryNotes("Fixture original notes", row.evidence) }));
  }
  return [];
}
try {
  let port;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { port = Number((await readFile(join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]); break; }
    catch { await pause(100); }
  }
  assert.ok(port);
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  ws = new WebSocket(pages.find(page => page.type === "page").webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject); });
  ws.on("message", async raw => {
    const message = JSON.parse(raw.toString());
    if (message.id) {
      const call = pending.get(message.id);
      if (call) { clearTimeout(call.timeout); pending.delete(message.id);
        message.error ? call.reject(new Error(message.error.message)) : call.resolve(message.result); }
    } else if (message.method === "Fetch.requestPaused") {
      try {
        const body = await response(message.params.request);
        await send("Fetch.fulfillRequest", { requestId: message.params.requestId, responseCode: 200,
          responseHeaders: [{ name: "Content-Type", value: "application/json" }], body: Buffer.from(JSON.stringify(body)).toString("base64") });
      } catch (error) {
        errors.push(error.message);
        await send("Fetch.failRequest", { requestId: message.params.requestId, errorReason: "BlockedByClient" });
      }
    } else if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.exception?.description);
  });
  await send("Page.enable"); await send("Runtime.enable");
  await send("Fetch.enable", { patterns: [{ urlPattern: "*://*/api/*" }] });
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
  const origin = process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "http://127.0.0.1:5000";
  const scope = "Array.from(document.querySelectorAll('[aria-label=\"Directory eligibility evidence\"]')).find(el=>el.innerText.includes('Pharmacy'))";
  const button = label => `Array.from((${scope}).querySelectorAll('button')).find(el=>el.textContent.trim()===${JSON.stringify(label)})`;
  for (const route of ["/salon-search-report", "/salon-enrichment/fixture-batch", "/lead-discovery"]) {
    rows = structuredClone(originalRows);
    await send("Page.navigate", { url: origin + route });
    if (route === "/lead-discovery") {
      await until("document.querySelector('[data-testid=\"tab-all-results\"]')", "all-results tab");
      await evaluate("(() => { const el=document.querySelector('[data-testid=\"tab-all-results\"]'); el.focus(); el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})); })()");
    }
    await until("document.body?.innerText?.includes('Fixture Business 0')", "fixture records");
    await evaluate("document.querySelectorAll('details').forEach(el=>el.open=true)");
    await until(`${scope}`, "category evidence");
    assert.equal(await evaluate(`${button("Approve grooming")}.disabled`), true);
    assert.ok(await evaluate("document.body.innerText.includes('Flagged:')"));
    assert.equal(await evaluate(`(${scope}).innerText.includes('Exact match on comparable source values')`), true);
    await evaluate(`(() => { const el=(${scope}).querySelector('textarea');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,'Reviewed current grooming services');
      el.dispatchEvent(new Event('input',{bubbles:true})); })()`);
    assert.equal(await evaluate(`${button("Approve grooming")}.disabled`), true);
    await evaluate(`(${scope}).querySelector('[role="checkbox"]').click()`);
    await until(`!${button("Approve grooming")}.disabled`, "explicit confirmation");
    await evaluate(`${button("Approve grooming")}.click()`);
    await until(`(${scope}).innerText.includes('Human approved')`, "persisted grooming approval");
    assert.equal(rows[0].reviewStatus, "needs_review");
    await evaluate(`(() => { const el=(${scope}).querySelector('textarea');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,'Correction: unrelated pharmacy');
      el.dispatchEvent(new Event('input',{bubbles:true})); })()`);
    await evaluate(`(${scope}).querySelector('[role="checkbox"]').click()`);
    await until(`!${button("Exclude")}.disabled`, "exclusion confirmation");
    await evaluate(`${button("Exclude")}.click()`);
    await until(`(${scope}).innerText.includes('Human excluded')`, "persisted exclusion");
    assert.equal(rows.length, 3);
    assert.equal(rows[0].reviewStatus, "needs_review");
  }
  assert.equal(mutations.length, 6);
  for (const confirmed of [true, false]) {
    ownerConfirmed = confirmed;
    await send("Page.navigate", { url: origin + "/deal/fixture-deal" });
    await until("document.body?.innerText?.includes('Owner’s Name')", "Pipeline owner field");
    const ownerField = "Array.from(document.querySelectorAll('p')).find(el=>el.textContent==='Owner’s Name').parentElement";
    await until(`(${ownerField}).innerText.includes(${JSON.stringify(confirmed ? "Jane Smith" : "Not confirmed")})`, "saved owner display");
    assert.equal(await evaluate(`(${ownerField}).innerText.includes('Fixture Business 0')`), false);
  }
  await send("Emulation.setDeviceMetricsOverride", { width: 402, height: 874, deviceScaleFactor: 1, mobile: true });
  await until("document.body.innerText.includes('Owner’s Name')", "phone owner field");
  assert.deepEqual(errors, []);
  console.log("PASS: report, enrichment and lead discovery show identity/category evidence, enforce note + confirmation, persist approval/exclusion separately, retain rows and refresh full counts. Pipeline shows saved owner or Not confirmed independently of email greetings, including phone viewport. No real writes or paid calls.");
} finally {
  ws?.close(); chrome.kill("SIGTERM");
  for (const call of pending.values()) clearTimeout(call.timeout);
  if (chrome.exitCode === null) await new Promise(resolve => chrome.once("exit", resolve));
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}