import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SalonPilotState, PilotClosedError } from "./salonPilotState";

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "salon-closure-"));
  const pilot = new SalonPilotState(join(dir, "progress.json"), join(dir, "runner.lock"));
  pilot.save({ status: "running", attempts: [{ placeId: "already-initiated" }], rows: {} });
  return { pilot, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("closure is durable despite stale worker saves and preserves in-flight evidence", async () => {
  const { pilot, cleanup } = fixture();
  try {
    pilot.acquire();
    const memory = JSON.parse(readFileSync(pilot.output, "utf8"));
    const closer = new SalonPilotState(pilot.output, pilot.lockPath);
    const closure = closer.requestClose();
    memory.rows["already-initiated"] = { result: "returned before stop completed" };
    memory.status = "running";
    pilot.save(memory);
    assert.throws(() => pilot.assertOpen(), PilotClosedError);
    let requests = 0;
    assert.throws(() => { pilot.assertOpen(); requests++; }, PilotClosedError);
    assert.equal(requests, 0);
    const saved = JSON.parse(readFileSync(pilot.output, "utf8"));
    assert.equal(saved.status, "stopped_by_user");
    assert.equal(saved.closedAt, closure.closedAt);
    assert.equal(saved.attempts.length, 1);
    assert(saved.rows["already-initiated"]);
    setTimeout(() => pilot.release(), 20);
    await closer.waitForWorker(1000);
    assert(!existsSync(pilot.lockPath));
    assert.throws(() => pilot.acquire(), PilotClosedError);
  } finally { cleanup(); }
});

test("closing interrupts hourly waits, final waits, and refuses the next provider call", async () => {
  for (const waitMs of [60000, 600]) {
    const { pilot, cleanup } = fixture();
    try {
      const waiting = pilot.wait(waitMs);
      setTimeout(() => pilot.requestClose(), 10);
      await assert.rejects(waiting, PilotClosedError);
      assert.throws(() => pilot.assertOpen(), PilotClosedError);
    } finally { cleanup(); }
  }
});

test("a dead worker lock can be released only after the stop marker is persisted", async () => {
  const { pilot, cleanup } = fixture();
  try {
    writeFileSync(pilot.lockPath, JSON.stringify({ pid: 1000000000 }));
    pilot.requestClose();
    await pilot.waitForWorker(1000);
    assert(!existsSync(pilot.lockPath));
    assert.throws(() => pilot.acquire(), PilotClosedError);
  } finally { cleanup(); }
});