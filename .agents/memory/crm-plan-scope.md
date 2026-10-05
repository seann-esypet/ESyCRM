---
name: CRM plan scope
description: Business boundary for directory and pay-as-you-go deal plan assignments.
---

Treat directory and pay-as-you-go CRM plan selections as sales assignment labels, not authorization to implement billing, appointment pricing, new commission rates, or updates to historical financial records.

**Why:** The requested dropdown expansion explicitly excludes payment collection, per-appointment pricing logic, new rates, and changes to existing financial history. Dollar amounts in a label alone are not a commercial specification.

**How to apply:** Keep the existing zero-commission fallback for these assignments unless the user separately approves new financial behavior. Test Won flows with isolated fixtures rather than creating real financial records or notifications.