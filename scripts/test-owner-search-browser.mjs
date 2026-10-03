// All API requests are intercepted before navigation. Unexpected writes are
// blocked; these fixtures never research, mutate CRM records, or send emails.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";

const profile = await mkdtemp(join(tmpdir(), "owner-search-browser-"));
const chrome = spawn("chromium", ["--headless", "--no-sandbox", "--disable-dev-shm-usage",
  "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let ws, nextId = 0, delayEstimate = 0, zeroBudget = false;
const pending = new Map(), errors = [], estimates = [], searches = [];
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
    await pause(75);
  }
  throw new Error(`Browser did not reach ${label}: ${await evaluate("document.body.innerText.slice(-1200)")}`);
}
const button = (text, scope = "document") => `Array.from(${scope}.querySelectorAll('button')).find(el=>el.textContent.trim()===${JSON.stringify(text)})`;
async function clickText(text, scope) {
  const expression = button(text, scope);
  await until(`${expression} && !${expression}.disabled`, text);
  await evaluate(`${expression}.click()`);
}
async function click(selector) {
  await until(`!!document.querySelector(${JSON.stringify(selector)})`, selector);
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
}
async function select(selector, label) {
  await evaluate(`(() => {
    const el=document.querySelector(${JSON.stringify(selector)});
    el.focus(); el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
  })()`);
  await until(`Array.from(document.querySelectorAll('[role="option"]')).some(el=>el.textContent.trim()===${JSON.stringify(label)})`, label);
  await evaluate(`(() => {
    const el=Array.from(document.querySelectorAll('[role="option"]')).find(el=>el.textContent.trim()===${JSON.stringify(label)});
    el.focus(); el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
  })()`);
}
const emptyOwner = { status: "not_searched", candidates: [], selectedCandidateId: null,
  approvedAt: null, usePersonalName: false, providerCalls: 0, pagesFetched: 0 };
const rows = ["A", "B"].map((name, index) => ({
  id: `fixture-${index}`, batchId: "fixture-batch", rowNumber: index + 1,
  businessName: `Fixture Salon ${name}`, city: "Example City", state: "TX",
  address: "1 Example Street", zipCode: "75001", category: "review_only",
  status: "enriched", identityMatchStatus: "strong", reviewStatus: "pending",
  sourceData: { category: "review_only" }, evidence: {}, confidence: {},
  ownerName: emptyOwner, serpCallsUsed: 0,
}));
const batch = { id: "fixture-batch", name: "Fixture salon list", totalRows: 2,
  status: "completed", needsReviewRows: 2, enrichedRows: 2, failedRows: 0,
  createdAt: "2026-10-03T12:00:00Z", fileName: "fixture.csv" };
async function response(request) {
  const url = new URL(request.url);
  if (request.method !== "GET") {
    const data = JSON.parse(request.postData || "{}");
    if (url.pathname === "/api/salon-owner-names/estimate") {
      estimates.push(data);
      if (delayEstimate) await pause(delayEstimate);
      return { searchesPerRow: data.searchesPerRow, maxProviderCalls: zeroBudget ? 0 : Math.min(data.rowIds.length * data.searchesPerRow, 4),
        maxPages: data.rowIds.length * 4, remainingCredits: 4, allowed: true };
    }
    if (url.pathname === "/api/salon-owner-names/search") {
      assert.equal(data.confirmed, true);
      assert.ok(data.maxProviderCalls <= data.rowIds.length * data.searchesPerRow);
      searches.push(data);
      return { callsUsed: Math.min(2, data.maxProviderCalls),
        results: data.rowIds.map(rowId => ({ rowId, ownerName: { ...emptyOwner, status: "not_found" } })) };
    }
    throw new Error(`Unexpected mutation blocked: ${request.method} ${url.pathname}`);
  }
  if (url.pathname === "/api/auth/user") return { id: "fixture-user", role: "admin", firstName: "Fixture", lastName: "User" };
  if (url.pathname === "/api/salon-search-report") return { rows, batches: [batch],
    totals: { rows: 2, batches: 1, byCategory: { review_only: 2 } }, pagination: { total: 2, limit: 50, offset: 0 } };
  if (url.pathname === "/api/salon-enrichment/batches/fixture-batch/rows") return rows;
  if (url.pathname === "/api/salon-enrichment/batches/fixture-batch") return batch;
  if (url.pathname.endsWith("/verification-estimate")) return { mode: "none", eligibleRows: 0, estimatedSerpCalls: 0, active: false };
  return [];
}
try {
  let port;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { port = Number((await readFile(join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]); break; }
    catch { await pause(100); }
  }
  assert.ok(port, "Chromium starts");
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
        const body = await response(message.params.request);
        await send("Fetch.fulfillRequest", { requestId: message.params.requestId, responseCode: 200,
          responseHeaders: [{ name: "Content-Type", value: "application/json" }],
          body: Buffer.from(JSON.stringify(body)).toString("base64") });
      } catch (error) {
        errors.push(error.message);
        await send("Fetch.failRequest", { requestId: message.params.requestId, errorReason: "BlockedByClient" });
      }
    } else if (message.method === "Runtime.exceptionThrown") {
      errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    }
  });
  await send("Page.enable"); await send("Runtime.enable");
  await send("Fetch.enable", { patterns: [{ urlPattern: "*://*/api/*" }] });
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
  const origin = process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "http://127.0.0.1:5000";
  const reviewSelector = '[aria-label="Owner name review for Fixture Salon A"]';
  const review = `document.querySelector(${JSON.stringify(reviewSelector)})`;
  const phraseSelector = '[aria-label="Owner search phrases per salon"]';
  for (const route of ["/salon-search-report", "/salon-enrichment/fixture-batch"]) {
    await send("Page.navigate", { url: `${origin}${route}` });
    await until(`document.body?.innerText?.includes('Fixture Salon A')`, "fixture rows");
    await evaluate("document.querySelectorAll('details').forEach(el=>el.open=true)");
    await clickText("Search owner", review);
    await until(`${review}.innerText.includes('Confirm owner lookup')`, "default single estimate");
    assert.equal(estimates.at(-1).searchesPerRow, 1);
    assert.equal(searches.length, route === "/salon-search-report" ? 0 : 3);
    await select(`${reviewSelector} ${phraseSelector}`, "Up to 3 phrases · explicit expanded search");
    await until(`${review}.innerText.includes('Up to 3 additional paid searches')`, "expanded single estimate");
    assert.equal(estimates.at(-1).searchesPerRow, 3);
    await clickText("Confirm & search", review);
    await until("document.body.innerText.includes('2 provider calls used')", "actual single usage");
    assert.deepEqual(searches.at(-1), { rowIds: ["fixture-0"], searchesPerRow: 3, maxProviderCalls: 3, confirmed: true });

    await click('[aria-label="Select Fixture Salon A for owner search"]');
    await click('[aria-label="Select Fixture Salon B for owner search"]');
    const estimateText = route === "/salon-search-report" ? "Estimate & search selected" : "Estimate selected search";
    await clickText(estimateText);
    await until("document.body.innerText.includes('Batch-wide cap:')", "batch default confirmation");
    assert.equal(estimates.at(-1).searchesPerRow, 1);
    await select(phraseSelector, "Up to 3 phrases per salon");
    await until("document.body.innerText.includes('4 provider calls')", "expanded capped batch estimate");
    assert.deepEqual(estimates.at(-1).rowIds, ["fixture-0", "fixture-1"]);
    await clickText("Confirm searches");
    await until(`${button("Confirm searches")}===undefined`, "batch finished");
    assert.deepEqual(searches.at(-1), { rowIds: ["fixture-0", "fixture-1"], searchesPerRow: 3, maxProviderCalls: 4, confirmed: true });

    // A selection change during an in-flight estimate must invalidate its result.
    await click('[aria-label="Select Fixture Salon A for owner search"]');
    delayEstimate = 600;
    await clickText(estimateText);
    await click('[aria-label="Select Fixture Salon A for owner search"]');
    await pause(850);
    assert.equal(await evaluate(`${button("Confirm searches")}!==undefined`), false);
    delayEstimate = 0;

    // Zero-cost lookup can be confirmed but cannot spend a paid credit.
    zeroBudget = true;
    await clickText("Search owner", review);
    await until(`${review}.innerText.includes('no paid request will be made')`, "free single confirmation");
    await clickText("Confirm & search", review);
    await until("document.body.innerText.includes('0 provider calls used')", "zero actual usage");
    assert.equal(searches.at(-1).maxProviderCalls, 0);
    zeroBudget = false;
    console.log(`PASS ${route}: explicit opt-in, single/batch caps, actual usage, stale selection and zero-budget confirmation`);
  }
  assert.deepEqual(errors, []);
  console.log(`Browser fixtures passed; ${searches.length} mock searches, zero real API mutations.`);
} finally {
  ws?.close(); chrome.kill("SIGTERM");
  await pause(300);
  await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
}