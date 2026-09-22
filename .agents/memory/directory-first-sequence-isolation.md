---
name: Directory-first sequence isolation
description: Compatibility rule separating directory-first outreach from legacy salon/mobile contact classification.
---

Directory-first email audiences are chosen intentionally when contacts are enrolled. They must not read from or mutate the contact's legacy salon/mobile software classification.

**Why:** The directory offer is a separate outreach strategy, while existing classification continues to drive legacy automation. Coupling them would change current behavior or prevent valid directory enrollment.

**How to apply:** Keep directory templates explicitly classified as their own strategy, preserve legacy as the default for existing records, and use directory track identity rather than contact classification for enrollment and queue chaining.