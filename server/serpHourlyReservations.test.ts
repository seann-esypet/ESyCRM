import assert from "node:assert/strict";
import test from "node:test";
import { db } from "./db";
import { storage } from "./storage";
import { serpUsage, serpCallReservations } from "@shared/schema";
import { PgDialect } from "drizzle-orm/pg-core";

test("actual shared reservation guard allows 80/hour, serializes competing lists, and retains the 800 monthly stop", async () => {
  // Exercise real storage logic with an entirely in-memory transaction.
  const usage = { id: "fixture-usage", monthYear: "2026-10", monthlyQuota: 1000, hardStopAt: 800, usedCredits: 200 };
  const reservations: Array<{ id: string; createdAt: Date }> = [];
  let locks = 0, tail = Promise.resolve();
  const dialect = new PgDialect();
  const tx: any = {
    execute: async (query: any) => {
      assert.match(dialect.sqlToQuery(query).sql, /pg_advisory_xact_lock/);
      locks++;
    },
    select: () => {
      let table: any;
      const query: any = {
        from: (value: any) => { table = value; return query; },
        where: () => query,
        limit: () => query,
        then: (resolve: any, reject: any) => Promise.resolve(
          table === serpUsage ? [structuredClone(usage)] : table === serpCallReservations ?
            [{ count: reservations.filter(row => row.createdAt.getTime() >= Date.now() - 3600000).length }] :
            (() => { throw new Error("Unexpected fixture read"); })(),
        ).then(resolve, reject),
      };
      return query;
    },
    update: (table: any) => {
      assert.equal(table, serpUsage);
      return { set: () => ({ where: async () => { usage.usedCredits++; } }) };
    },
    insert: (table: any) => {
      assert.equal(table, serpCallReservations);
      return { values: () => ({ returning: async () => {
        const row = { id: `fixture-reservation-${reservations.length}`, createdAt: new Date() };
        reservations.push(row);
        return [row];
      } }) };
    },
  };
  const original = db.transaction;
  (db as any).transaction = (action: any) => {
    const result = tail.then(() => action(tx));
    tail = result.then(() => undefined, () => undefined);
    return result;
  };
  try {
    const results = await Promise.all(Array.from({ length: 90 }, () => storage.reserveSerpCall("2026-10", 80)));
    assert.equal(results.filter(Boolean).length, 80, "competing lists cannot reserve request 81");
    assert.equal(reservations.length, 80);
    assert.equal(usage.usedCredits, 280, "existing monthly spending is retained");
    assert.equal(await storage.reserveSerpCall("2026-10", 80), null);
    reservations[0].createdAt = new Date(Date.now() - 3600001);
    assert.ok(await storage.reserveSerpCall("2026-10", 80), "one expired reservation frees one hourly slot");
    assert.equal(usage.usedCredits, 281, "hourly expiry never refunds monthly spending");
    reservations.forEach(row => { row.createdAt = new Date(Date.now() - 3600001); });
    usage.usedCredits = 799;
    const monthly = await Promise.all(Array.from({ length: 3 }, () => storage.reserveSerpCall("2026-10", 80)));
    assert.equal(monthly.filter(Boolean).length, 1, "raising hourly throughput cannot bypass the shared monthly stop");
    assert.equal(usage.usedCredits, 800);
    assert.equal(usage.monthlyQuota, 1000);
    assert.equal(usage.hardStopAt, 800);
    assert.equal(locks, 95, "all successes and refusals use the same shared advisory lock");
  } finally { (db as any).transaction = original; }
});
