import { existsSync, readFileSync, writeFileSync, renameSync, openSync, closeSync, unlinkSync } from "node:fs";

export class PilotClosedError extends Error {
  constructor() { super("PILOT_CLOSED_BY_USER_NOT_RESUMED"); }
}

/** A stop marker is independent of stale worker memory and cannot be erased by saves. */
export class SalonPilotState {
  readonly stopPath: string;
  constructor(readonly output: string, readonly lockPath: string) {
    this.stopPath = `${output}.closed`;
  }
  closure(): { status: string; closedAt: string; closeReason: string } | null {
    if (existsSync(this.stopPath)) return JSON.parse(readFileSync(this.stopPath, "utf8"));
    if (existsSync(this.output)) {
      const saved = JSON.parse(readFileSync(this.output, "utf8"));
      if (saved.status === "stopped_by_user") return {
        status: saved.status, closedAt: saved.closedAt, closeReason: saved.closeReason,
      };
    }
    return null;
  }
  assertOpen() { if (this.closure()) throw new PilotClosedError(); }
  requestClose() {
    const closure = this.closure() || {
      status: "stopped_by_user", closedAt: new Date().toISOString(),
      closeReason: "User requested finalizing existing results without another hourly batch; unattempted rows remain untested.",
    };
    try { writeFileSync(this.stopPath, JSON.stringify(closure), { flag: "wx" }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    return closure;
  }
  acquire() {
    this.assertOpen();
    const fd = openSync(this.lockPath, "wx");
    try { writeFileSync(fd, JSON.stringify({ pid: process.pid })); } finally { closeSync(fd); }
    try { this.assertOpen(); } catch (error) { this.release(); throw error; }
  }
  release() { if (existsSync(this.lockPath)) unlinkSync(this.lockPath); }
  save(state: any) {
    const closed = this.closure();
    if (closed) Object.assign(state, closed);
    state.updatedAt = new Date().toISOString();
    const temp = `${this.output}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify(state, null, 2));
    renameSync(temp, this.output);
    // Close may arrive between the check and rename. The durable marker wins.
    if (existsSync(this.stopPath) && state.status !== "stopped_by_user") this.save(state);
  }
  async wait(ms: number) {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      if (existsSync(this.stopPath)) throw new PilotClosedError();
      await new Promise(resolve => setTimeout(resolve, Math.min(250, until - Date.now())));
    }
    this.assertOpen();
  }
  async waitForWorker(timeoutMs = 180000) {
    const until = Date.now() + timeoutMs;
    while (existsSync(this.lockPath)) {
      const owner = JSON.parse(readFileSync(this.lockPath, "utf8"));
      if (!Number.isInteger(owner.pid) || owner.pid < 1) throw new Error("Unverifiable runner lock; stop its owner before final accounting");
      try { process.kill(owner.pid, 0); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
        this.release(); // Stop marker already prevents any new owner acquiring.
        return;
      }
      if (Date.now() >= until) throw new Error("Stop marker persisted; worker has not finished its in-flight work");
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
}