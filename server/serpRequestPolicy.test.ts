import assert from "node:assert/strict";
import test from "node:test";
import { providerHourlyLimit } from "./serpRequestPolicy";

test("Full Research uses its confirmed hourly allowance and leaves legacy callers unchanged", () => {
  assert.equal(providerHourlyLimit(20), 20);
  assert.equal(providerHourlyLimit(5), 5);
  assert.equal(providerHourlyLimit(20, { hourlyLimit: 40, onReservationBlocked: async () => {} }), 40);
  assert.equal(providerHourlyLimit(20, { hourlyLimit: 80, onReservationBlocked: async () => {} }), 80);
  assert.equal(providerHourlyLimit(40, { hourlyLimit: 80, onReservationBlocked: async () => {} }), 80);
  assert.equal(providerHourlyLimit(20, { hourlyLimit: 10, onReservationBlocked: async () => {} }), 10);
  for (const hourlyLimit of [0, -1, 101, 20.5, NaN]) {
    assert.throws(() => providerHourlyLimit(20, { hourlyLimit, onReservationBlocked: async () => {} }), /Invalid/);
  }
});
