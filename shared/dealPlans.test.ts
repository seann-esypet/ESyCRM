import assert from "node:assert/strict";
import { test } from "node:test";
import { DEAL_PLANS } from "./dealPlans";
import { insertDealSchema } from "./schema";
import { calculateCommission, getCommissionAmounts } from "./utils";

test("plan choices preserve exact existing and requested names", () => {
  assert.deepEqual(DEAL_PLANS, [
    "Solo - $79/mo or $2 / Appoint",
    "Salon - $149/mo or $3 / Appoint",
    "Signature - $229/mo",
    "Unknown",
    "Free Directory",
    "$2 Pay As You Go",
    "$3Pay As You Go",
  ]);
});

for (const plan of DEAL_PLANS) {
  test(`${plan} survives create/update validation and JSON round trips`, () => {
    const created = insertDealSchema.parse({ title: "Fixture deal", plan, value: "149" });
    const updated = insertDealSchema.partial().parse({ plan });
    assert.equal(JSON.parse(JSON.stringify(created)).plan, plan);
    assert.equal(JSON.parse(JSON.stringify(updated)).plan, plan);
  });
}

test("subscription commissions are unchanged; new plans keep the zero fallback", () => {
  const expected = [
    { upfront: 71.10, monthly: 7.90 },
    { upfront: 134.10, monthly: 14.90 },
    { upfront: 206.10, monthly: 22.90 },
    ...Array.from({ length: 4 }, () => ({ upfront: 0, monthly: 0 })),
  ];
  DEAL_PLANS.forEach((plan, i) => {
    assert.deepEqual(getCommissionAmounts(plan), expected[i]);
    assert.equal(calculateCommission(plan), expected[i].upfront);
  });
});