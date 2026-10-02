---
name: Contact deletion safety
description: Why imported-business cleanup must not cascade into pipeline and financial history
---

Permanent CRM contact deletion is for cleaning up unwanted business records, not deleting linked deals or financial history. Protect contacts associated with deals or deal history and offer Archive instead. Preserve message, task, and activity history while removing obsolete contact links, and require reviewed source leads to be reviewed again before reimport.

**Why:** The user needed to remove an incorrect spreadsheet import. The old delete routine attempted to remove deals too and could leave a partial cleanup when newer foreign-key references blocked deletion. A cleanup operation must not erase unrelated sales or financial records.

**How to apply:** Keep deletion ownership-scoped and transactional, require explicit selection and confirmation in the UI, report partial failures honestly, and never identify an import batch merely by guessing that the latest records belong to it.

Check which screen the user means by “imported businesses”: they may mean uploaded review rows, not CRM contacts.

**Why:** The user requested removal after an upload to Sales Lead Review, while the CRM contact count had not changed. Providing deletion only on Contacts would not remove the actual uploaded list.

**How to apply:** Keep source-row deletion separate from CRM deletion. Block active verification and already-imported sources, retain the original saved search results, and use the batch's import/verification lock order.