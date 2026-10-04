import test from "node:test";
import assert from "node:assert/strict";
import { storage } from "./storage";
import { pool } from "./db";
import { searchWithSerpApi } from "./lead-discovery";

test("last-moment closure prevents the HTTP request and releases only its unused reservation", async () => {
  const originals = {
    getSerpCache: storage.getSerpCache,
    getOrCreateSerpUsage: storage.getOrCreateSerpUsage,
    getOrCreateLeadDiscoveryConfig: storage.getOrCreateLeadDiscoveryConfig,
    reserveSerpCall: storage.reserveSerpCall,
    releaseSerpCall: storage.releaseSerpCall,
  };
  const originalFetch = globalThis.fetch;
  let requests = 0, reservations = 0, releases = 0;
  storage.getSerpCache = async () => undefined;
  storage.getOrCreateSerpUsage = async () => ({ usedCredits: 0, hardStopAt: 200 }) as any;
  storage.getOrCreateLeadDiscoveryConfig = async () => ({ maxSerpCallsPerHour: 20 }) as any;
  storage.reserveSerpCall = async () => { reservations++; return "isolated-reservation"; };
  storage.releaseSerpCall = async () => { releases++; };
  globalThis.fetch = async () => { requests++; throw new Error("simulated uncertain network failure"); };
  try {
    // Existing key is checked for presence only and never accessed or displayed.
    await assert.rejects(searchWithSerpApi("Fixture", "00000", "CA", "fixture", {
      placeId: "fixed", beforeProviderRequest: () => { throw new Error("pilot closed"); },
    }), /pilot closed/);
    assert.equal(requests, 0);
    assert.equal(reservations, 1);
    assert.equal(releases, 1);
    await assert.rejects(searchWithSerpApi("Fixture", "00000", "CA", "fixture"),
      /simulated uncertain network failure/);
    assert.equal(requests, 1);
    assert.equal(reservations, 2);
    assert.equal(releases, 1, "initiated requests retain their allowance when billing is uncertain");
  } finally {
    Object.assign(storage, originals);
    globalThis.fetch = originalFetch;
  }
});
test.after(() => pool.end());