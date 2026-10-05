// All API traffic is intercepted before navigation. Saves live only in memory;
// no real authentication, database writes, commissions or notifications occur.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";

const plans = [
  "Solo - $79/mo or $2 / Appoint", "Salon - $149/mo or $3 / Appoint",
  "Signature - $229/mo", "Unknown", "Free Directory", "$2 Pay As You Go", "$3Pay As You Go",
];
const profile = await mkdtemp(join(tmpdir(), "deal-plans-browser-"));
const chrome = spawn("chromium", ["--headless", "--no-sandbox", "--disable-dev-shm-usage",
  "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const pending = new Map();
const errors = [];
const writes = [];
const deals = [];
let nextId = 0;
let ws;
const contact = { id: "fixture-contact", userId: "fixture-user", firstName: "Fixture",
  lastName: "Contact", company: "Fixture Salon", usesSoftware: "No", status: "active" };

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${method}`)); }, 15000);
    pending.set(id, { resolve, reject, timeout });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result?.value;
}
async function until(expression, label = expression) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return;
    await pause(100);
  }
  throw new Error(`Browser did not reach ${label}`);
}
const selector = id => `[data-testid="${id}"]`;
async function click(id) {
  await until(`!!document.querySelector(${JSON.stringify(selector(id))})`);
  await evaluate(`document.querySelector(${JSON.stringify(selector(id))}).click()`);
}
async function openSelect(id) {
  await until(`!!document.querySelector(${JSON.stringify(selector(id))})`);
  await evaluate(`(() => {
    const el=document.querySelector(${JSON.stringify(selector(id))});
    el.focus(); el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
  })()`);
  await until(`document.querySelectorAll('[role="option"]').length > 0`);
}
async function choose(id, label) {
  await openSelect(id);
  await evaluate(`(() => {
    const el=Array.from(document.querySelectorAll('[role="option"]')).find(el=>el.textContent.trim()===${JSON.stringify(label)});
    if(!el) throw new Error('Missing option');
    el.focus(); el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
  })()`);
  await until(`document.querySelectorAll('[role="option"]').length === 0`);
}
async function checkOptions(id) {
  await openSelect(id);
  assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('[role="option"]')).map(el=>el.textContent.trim())`), plans);
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape" });
  await until(`document.querySelectorAll('[role="option"]').length === 0`);
}
async function input(id, value) {
  await evaluate(`(() => {
    const el=document.querySelector(${JSON.stringify(selector(id))});
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});
    el.dispatchEvent(new Event('input',{bubbles:true}));
  })()`);
}
function response(request) {
  const path = new URL(request.url).pathname;
  const method = request.method;
  if (method !== "GET") {
    const body = JSON.parse(request.postData ?? "{}");
    writes.push({ path, method, body });
    if (method === "POST" && path === "/api/deals") {
      const deal = { ...body, id: `fixture-${deals.length}`, userId: "fixture-user", createdAt: "2026-10-01T12:00:00Z" };
      deals.push(deal);
      return deal;
    }
    if (["PUT", "PATCH"].includes(method) && path.startsWith("/api/deals/")) {
      const deal = deals.find(d => path === `/api/deals/${d.id}`);
      assert.ok(deal, "Only fixture deals can be updated");
      Object.assign(deal, body);
      return deal;
    }
    if (method === "POST" && path === "/api/commissions") {
      const deal = deals.find(d => d.id === body.dealId);
      assert.ok(deal);
      assert.ok(plans.includes(body.planName));
      Object.assign(deal, { plan: body.planName, stage: "won" });
      return { id: `commission-${deal.id}`, ...body, upfrontAmount: "0.00", monthlyAmount: "0.00" };
    }
    throw new Error(`Blocked unexpected mutation ${method} ${path}`);
  }
  if (path === "/api/auth/user") return { id: "fixture-user", firstName: "Fixture", role: "salesperson" };
  if (path === "/api/contacts") return [contact];
  if (path === "/api/deals") return deals;
  if (path === "/api/deals/email-summaries") return {};
  if (path.startsWith("/api/deal-workspace/")) return {
    deal: deals.find(d => path === `/api/deal-workspace/${d.id}`), contact, activities: [],
  };
  if (path.startsWith("/api/deals/")) return deals.find(d => path === `/api/deals/${d.id}`) ?? [];
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
      if (call) {
        clearTimeout(call.timeout); pending.delete(message.id);
        message.error ? call.reject(new Error(message.error.message)) : call.resolve(message.result);
      }
    } else if (message.method === "Fetch.requestPaused") {
      try {
        const body = response(message.params.request);
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
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Fetch.enable", { patterns: [{ urlPattern: "*://*/api/*" }] });
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
  const origin = `https://${process.env.REPLIT_DEV_DOMAIN}`;
  assert.ok(process.env.REPLIT_DEV_DOMAIN, "Use the proxied development preview");
  async function navigate(path) {
    await send("Page.navigate", { url: `${origin}${path}` });
    await until(`!!document.querySelector(${JSON.stringify(selector(path === "/deals" ? "add-new-button" : "button-edit-plan"))})`);
  }
  for (const plan of plans.slice(4)) {
    await navigate("/deals");
    await click("add-new-button");
    await input("input-title", `Fixture ${plan}`);
    await choose("select-contact", "Fixture Contact - Fixture Salon");
    await checkOptions("select-plan");
    await choose("select-plan", plan);
    await click("button-submit");
    await until(`!document.querySelector('[data-testid="deal-form"]')`);
    const deal = deals.at(-1);
    assert.equal(deal.plan, plan);
    assert.equal(deal.value, "", "New plans do not introduce an automatic deal price");
    await click(`edit-deal-${deal.id}`);
    assert.equal(await evaluate(`document.querySelector('[data-testid="select-plan"]').textContent.trim()`), plan);
    await choose("select-plan", "Solo - $79/mo or $2 / Appoint");
    await choose("select-plan", plan);
    await click("button-submit");
    await until(`!document.querySelector('[data-testid="deal-form"]')`);
    assert.equal(deal.value, "79", "Existing Solo autofill remains; new choices do not overwrite it");
    await navigate("/deals");
    await click(`edit-deal-${deal.id}`);
    assert.equal(await evaluate(`document.querySelector('[data-testid="select-plan"]').textContent.trim()`), plan);
    await click("button-cancel");

    await navigate(`/deal/${deal.id}`);
    await click("button-edit-plan");
    await checkOptions("select-edit-plan");
    await choose("select-edit-plan", "Signature - $229/mo");
    await click("button-save-plan");
    await until(`document.querySelector('[data-testid="text-deal-plan"]')?.textContent.trim()==='Signature - $229/mo'`);
    await click("button-edit-plan");
    await choose("select-edit-plan", plan);
    await click("button-save-plan");
    await until(`document.querySelector('[data-testid="text-deal-plan"]')?.textContent.trim()===${JSON.stringify(plan)}`);
    await navigate(`/deal/${deal.id}`);
    assert.equal(await evaluate(`document.querySelector('[data-testid="text-deal-plan"]').textContent.trim()`), plan);
    await click("button-edit-plan");
    assert.equal(await evaluate(`document.querySelector('[data-testid="select-edit-plan"]').textContent.trim()`), plan);
    await click("button-cancel-plan");

    // Exercise both Won confirmations with fixture-only commission storage.
    for (const workspace of [true, false]) {
      deal.stage = "qualified_lead";
      await navigate(workspace ? `/deal/${deal.id}` : "/deals");
      if (workspace) {
        await evaluate(`(() => { const el=document.querySelector('[data-testid="button-move-stage"]'); el.focus(); el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})); })()`);
        await click("menu-stage-won");
      } else {
        await choose(`select-stage-${deal.id}`, "Won");
      }
      const dialog = workspace ? "dialog-won-commission" : "dialog-won-commission-deals";
      const select = workspace ? "select-won-plan" : "select-won-plan-deals";
      await until(`!!document.querySelector(${JSON.stringify(selector(dialog))})`);
      await checkOptions(select);
      await choose(select, plan);
      const text = await evaluate(`document.querySelector(${JSON.stringify(selector(dialog))}).textContent`);
      assert.equal((text.match(/\$0\.00/g) ?? []).length, 2, "Both commissions are zero");
      if (plan === "$3Pay As You Go" && workspace) {
        const image = await send("Page.captureScreenshot", { format: "png" });
        await writeFile("/tmp/deal-plans-won-fixture.png", Buffer.from(image.data, "base64"));
      }
      await click(workspace ? "button-confirm-won" : "button-confirm-won-deals");
      await until(`!document.querySelector(${JSON.stringify(selector(dialog))})`);
      assert.equal(writes.at(-1).body.planName, plan);
      assert.equal(deal.plan, plan);
      assert.equal(deal.stage, "won");
    }
  }
  assert.equal(writes.filter(w => w.method === "POST" && w.path === "/api/deals").length, 3);
  assert.equal(writes.filter(w => w.method === "PUT").length, 3);
  assert.equal(writes.filter(w => w.method === "PATCH").length, 6);
  assert.equal(writes.filter(w => w.path === "/api/commissions").length, 6);
  assert.deepEqual(errors, []);
  console.log("PASS: all three plans create, edit, reopen and refresh; all four selectors match; both Won flows retain exact names and zero commissions. All API writes were isolated.");
} finally {
  for (const call of pending.values()) clearTimeout(call.timeout);
  ws?.close();
  chrome.kill("SIGTERM");
  await pause(300);
  await rm(profile, { recursive: true, force: true });
}