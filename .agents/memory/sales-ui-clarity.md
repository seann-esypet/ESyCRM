---
name: Sales-facing UI clarity
description: The user's standing requirement for labels salespeople can understand without internal terminology
---

The user needs salespeople to understand what a feature is and what they should use it for. Use plain, task-based names and explain the result of an action; internal terms such as “JSON report” and “reviewed pilot” must not be the main upload choices.

**Why:** The user repeated that salespeople need to know what these controls mean and said they did not understand them either.

**How to apply:** Make the ordinary list-upload path obvious, state accepted file formats, and distinguish uploading the user's list from loading sample leads or importing a pre-checked report. Keep review, contact creation, and outreach as clearly explained separate actions.

Make the Leads workflow very obvious and step by step for salespeople: “You just uploaded…”, “These are the researched businesses…”, “These businesses still need review…”, and “Next step…”.

**Why:** The user said researched and untouched rows all looked the same, they did not know where to start, and asked for explicit progress wording and directions for salespeople.

**How to apply:** Present understandable counts and direct actions together. Distinguish uploaded, attempted, completed, blocked, reviewed, and ready-for-Contacts businesses; never imply that a research attempt found an email.

When delivering a research spreadsheet, explicitly say whether it is a research report or an upload-ready file for a specific import screen. If the user asks for an import file, validate it against that screen's recognized headings and keep unapproved findings separate from actionable contact fields.

**Why:** The user uploaded an agent-generated crawler report into the CRM because its intended use was not clear; they then deleted the business-name column while trying to fix the mapping.

**How to apply:** State the exact upload destination with the download. Preserve business names and evidence. For direct CRM imports, leave unapproved emails and unknown personal names blank; warn about existing incomplete records before a repeat import.

For Leads review uploads, include saved email addresses as review candidates and preserve their original evidence and review classification instead of blanking them.

**Why:** The user explicitly asked to put email addresses back so they could import the full list into Sales Lead Review. Applying the direct-CRM export rule to a review list hid useful findings.

**How to apply:** Validate against the named upload destination, distinguish prior confirmation from fresh verification, and do not treat uploading candidates as approval for CRM contact creation or outreach.

Salespeople should use one Leads workflow whether businesses came from an internal search, an ordinary spreadsheet, or a source-reviewed report.

**Why:** The user cannot remember whether to use Lead Discovery, Upload Salon List, or Sales Lead Review, and expects hired salespeople to understand the CRM without knowing how a research file was produced.

**How to apply:** Keep technical format recognition behind Search for Businesses and Upload a List. Review evidence, approve, add to CRM, and confirm a sequence separately; never introduce another salesperson-facing importer.

Missing verified emails must be prominent, not small metadata beside the date.

**Why:** The user asked for “no_verified_email” to be highlighted in a larger font after previously requesting prominent contact and email information.

**How to apply:** Give missing-email status a clear, readable label and visual emphasis in the lead header. Do not imply that completed research found an email or change research/review status merely for presentation.

Newly added Contacts must be discoverable in the normal unfiltered list, not only through search.

**Why:** The user reported that an added contact appeared in search results but not the ordinary Contacts list, making a successful import appear to have lost the record.

**How to apply:** Keep cross-screen contact creation/linking and list visibility consistent. Respect explicit filters and ownership, but do not require search or a hard refresh merely to see newly saved contacts.