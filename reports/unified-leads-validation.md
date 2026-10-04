# Unified Leads workflow: implementation and validation

## Salesperson path

Use **Leads → Search for Businesses / Upload a List → Find Contact Details → Review → Add to CRM**.

- Searches retain ZIP, state, targeted-state and national controls. Saved search results stage into the same saved-list representation and duplicate-handling transaction as uploads.
- One upload accepts ordinary CSV/Excel lists and supported evidence reports. Automatic recognition, editable column mapping, preview and explicit confirmation precede staging.
- Saved lists retain their input, research notes, evidence, original dates, historical findings and linked CRM records. Historical source confirmation is not current approval.
- Review confirms business identity and email-source evidence explicitly. Contact-name review and named-mailbox personalization are independent; unknown names remain blank.
- **Add to CRM** creates or explicitly links a contact. Pipeline tracks the opportunity. Scheduling requires a separate recipient/template/history preview and future-date confirmation.
- The in-app guide and Contacts, Pipeline and Outreach explanations distinguish these purposes. Form follow-ups are separate manual work, not another lead-upload entry.
- Old discovery, enrichment and research-review URLs lead to the unified workspace or the corresponding saved list.

## Preserved restored-list findings

The restored 36-row CSV adapter was tested against the original saved file:

| Finding | Rows | Treatment |
| --- | ---: | --- |
| Saved email findings | 18 | Visible candidates, not automatically actionable |
| Historically source-confirmed findings | 7 | Distinguished historical evidence; explicit review required |
| Review-only candidates | 11 | Unapproved suggestions |
| Missing email | 18 | Unresolved |

No development test promoted these records, created their contacts, scheduled outreach, or researched them.

## Research and evidence safeguards

- Shared orchestration prioritizes a matched business/location website and uses the existing bounded public-search service for unresolved contact details.
- Matched pages supply email and role/name evidence together. Additional paid name research remains a separate capped, confirmed action.
- Booking, social and directory links are not silently presented as business-owned websites. No detected booking signal means **Unknown**, not proof of no software.
- Cache hits do not consume the confirmed additional-call allowance. Initiated failures remain counted independently of row results.
- Progress, pause, explicitly confirmed resume and interrupted-work recovery preserve the original allowance. Recovery does not start research or refund attempts.
- Upload limits are 20,000 rows and 20 MB; individual fields are limited to 64,000 characters and rows to 256,000 bytes. Oversized material is rejected rather than silently truncating original notes.
- Duplicate preview offers skip, link or appended source suggestions. Approved evidence, manual contact details, deals, outreach and financial history are not replaced.

## Recipient-address outreach safeguards

Introductory enrollment and send-time claims use trimmed, case-normalized actual recipient addresses, without speculative alias merging. Address history covers contacts, tracks and CRM owners.

Atomic reservations prevent concurrent introductory scheduling/sending. Intended subsequent sequence steps remain possible. Cross-owner warnings do not reveal private contacts or message details.

Scheduled/attempted/sent recipient snapshots survive later contact edits. Legacy sends without a historical recipient remain uncertain rather than being described using today's contact email.

Ambiguous outcomes hold the queue for review. Provider acceptance followed by failed local persistence retains uncertain receipt evidence and does not trigger another provider send. Explicit reconciliation requires the actual recipient, acceptance receipt/date where applicable, and a review note.

## Validation performed

- TypeScript: `npx tsc --noEmit --incremental false` passed.
- Production build: `npm run build` passed.
- Server tests: **193 tests, 192 passed, zero failures, one skipped**. The skipped real-database directory fixture is intentionally opt-in; ordinary testing must not stage the full directory or modify CRM records.
- Isolated Chromium browser fixtures passed for **administrator and salesperson**:
  - Upload preview/confirmation → evidence approval → contact link → Pipeline → separately confirmed scheduling.
  - Saved internal-search results → common staging/review → contact link → Pipeline → separately confirmed scheduling.
  - Desktop and mobile rendering, no mobile horizontal overflow, and legacy-route compatibility.
  - Asynchronous research completion refreshes candidates without navigation; progress reads the saved batch contract.
  - CRM links refresh recipient history and the complete message preview. Scheduling is disabled for a missing, incomplete or stale-contact preview; a server fingerprint also checks the current recipient and rendered message.
  - Multiple duplicate choices include non-email matches. An explicitly selected matching contact can be linked without replacing its existing address or manual details.
  - All API traffic was intercepted; unexpected mutations fail the fixture. These checks did not bypass real application authentication.
- Policy/service fixtures cover historical evidence, original-workbook adaptation, long notes, restricted/irrelevant addresses, independent name approval, duplicate correction, cache/budget behavior, normalized-address conflicts, cross-owner privacy, concurrent reservations/claims, edited contact addresses, legacy uncertainty, provider-success/status-save failures and permitted follow-ups.
- The managed **development** database was missing an already-defined nullable progress column. Only that column was added. No production database changes, real lead/contact imports, deletions, enrollment, provider calls or sends were performed.

### Verification limitation

The real signed-in application could not be accessed by the capture browser; it displayed an access-block page. Therefore the real signed-in administrator/salesperson UI was **not visually verified**. Isolated fixture screenshots are in `reports/workflow-fixtures/`; they are not production screenshots.

## Observed research results reused, not new paid research

| Existing sample | General-contact email result | Name result / limitation |
| --- | --- | --- |
| Original 100-business evidence review | 24 source-confirmed emails | Not a measured high-yield name finder |
| Selected 20-business unresolved subset | 3 additional source-confirmed emails | Selected subset, not a full-directory forecast |
| Three-business owner validation | Email approval remains separate | 1 source-supported owner candidate; not named-mailbox approval |
| Closed paired provider pilot | 13 source-reviewed email businesses per provider in the identical 81-row paired subset | No owner-name enrichment in this comparison |

The closed pilot records **81 SerpApi rows: 80 initiated attempts and one application-cache hit**, with **39 untested rows**. It remains stopped; no further comparison lookups are scheduled. The paired review separately records seven unclear identities per provider, nine unconfirmed-grooming businesses per provider, four versus six rejected-site/non-grooming controls, and two rejected metadata-email businesses per provider.

See `reports/salon-provider-comparison-results.md`, its workbook and `reports/salon-provider-comparison-review.json` for the original measurements and limitations. Neither these samples nor the workflow fixtures establish deliverability, guaranteed first names, a universally cheapest provider, or expected full-directory yield.

**Additional paid research/provider usage during this implementation: zero.** Any future live pilot requires the user's separately approved cap.

## Release boundary

The application has not been published by this task. Code consolidation does not authorize production record updates, automatic research, CRM import, enrollment or sending. Publishing remains the user's separate action.