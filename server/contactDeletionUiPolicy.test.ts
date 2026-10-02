import assert from "node:assert/strict";
import test from "node:test";
import { contactDeletionLabel, deleteContactBatch } from "../client/src/lib/contact-deletion";

test("imported businesses with no mapped company or name remain identifiable by phone", () => {
  assert.equal(contactDeletionLabel({ company: "Salon", phone: "555-0100" }), "Salon");
  assert.equal(contactDeletionLabel({ firstName: "Jane", lastName: "Smith" }), "Jane Smith");
  assert.equal(contactDeletionLabel({ company: "", firstName: "", phone: "555-0100" }), "555-0100");
});

test("no selected IDs means no deletion requests", async () => {
  let called = false;
  assert.deepEqual(await deleteContactBatch([], async () => { called = true; }), { removedIds: [], failures: [] });
  assert.equal(called, false);
});

test("bulk removal awaits one request per unique selected ID without touching other records", async () => {
  const calls: string[] = [];
  let active = 0;
  const result = await deleteContactBatch(["first", "second", "first"], async id => {
    assert.equal(active, 0);
    active++;
    await Promise.resolve();
    calls.push(id);
    active--;
  });
  assert.deepEqual(calls, ["first", "second"]);
  assert.deepEqual(result, { removedIds: ["first", "second"], failures: [] });
});

test("partial failures never count protected or failed rows as removed", async () => {
  const result = await deleteContactBatch(["ok", "linked", "missing", "network", "last"], async id => {
    if (id === "linked") throw new Error("409: linked deal");
    if (id === "missing") throw new Error("404: not found");
    if (id === "network") throw new Error("Network unavailable");
  });
  assert.deepEqual(result.removedIds, ["ok", "last"]);
  assert.deepEqual(result.failures, [
    { id: "linked", status: "409" }, { id: "missing", status: "404" }, { id: "network", status: "" },
  ]);
});