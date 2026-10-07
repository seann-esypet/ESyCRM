---
name: Salon name evidence boundary
description: Why owner identity, mailbox attribution, and personal-name salutations require separate decisions.
---

Finding a salon owner does not prove that person monitors the salon's public mailbox. Keep owner-name review independent of email review, and keep approved contact names independent of the choice to use a personal greeting.

**Why:** The salon list contains general business addresses, team mentions, and co-owners. Inferring a mailbox's addressee from those facts would make personalization look more certain than the public evidence supports. Retaining a verified name in Contacts should not force a first-name greeting.

**How to apply:** Default to business-name salutations until the user explicitly chooses personal-name personalization. Require an explicit owner role and matching business/location before approving an owner; team and summary mentions remain unresolved. Do not combine co-owners, guess surnames, or interpret name approval as email approval.

The user wants mixed-group sequence greetings to automatically say “Hi Eliud,” when a personal name is enabled and “Hi Curly Tails team,” otherwise. They want the same personal-or-team selection in the subject line.

**Why:** The user sends groups of 25 or 50 and may have first names for half or fewer; missing names must not require individual template edits.

**How to apply:** Keep one shared template and resolve the greeting per recipient. Preserve personal-name opt-in independently of stored owner names.

Owner-lookup improvements do not authorize a paid production research pilot. Obtain separate approval before testing discovery yield with live paid searches.

**Why:** The owner-research scope separates implementation and controlled verification from additional provider spending.

**How to apply:** Use mocked searches for implementation checks. Treat a live owner-research sample as a separate, explicitly budgeted decision; never approve names, update contacts, enroll, or send as part of that research.

Keep owner discovery broader than owner approval. An interview that names the business but omits its current street address can suggest a review candidate; it must not silently satisfy the exact-location or fetched ownership evidence checks.

**Why:** The user found an owner through a simple Google search while the CRM exhausted its bounded crawl on website pages. Public interviews can contain useful ownership statements without the address needed for automatic identity verification.

**How to apply:** Prefer business/locality discovery and relevant ownership sources within the existing cap, reserving capacity for organic evidence rather than spending every attempt on website paths. Preserve strict approval, mailbox attribution, and personal-greeting safeguards instead of increasing spending or treating search snippets as verified evidence.

An approved salon identity and a targeted Google query do not establish that every returned search result belongs to that salon.

**Why:** The user showed an owner lookup suggesting people from other businesses even though the selected salon had strong, approved identity evidence. Search providers can return unrelated results; marking their names “unconfirmed” still creates confusing review work.

**How to apply:** Independently check discovery relevance before extracting people or using the limited page budget. Keep unrelated stored summary suggestions out of the review UI without silently editing saved evidence or Contacts. Relevance remains distinct from verified ownership and exact-location approval.

Google AI Overview claims and their citations are discovery suggestions, not verified page evidence. A citation must not be represented as if its linked page was fetched and confirmed the AI's ownership claim.

**Why:** The user demonstrated that a basic business/address Google search can show a first-name owner in an AI Overview when ordinary organic results omit that name. SerpAPI may return overview text inline, or only a retrieval token requiring another provider request; the latter is not a free continuation of the original search.

**How to apply:** Keep relevant AI suggestions reviewable even when the cited page is inaccessible. Verify the actual linked source and exact business/location before allowing approval or personal-name use. Never automatically redeem an overview retrieval token outside an explicitly authorized request budget, and explain unavailable overview text rather than treating a token as a completed overview search.

Existing Contacts need direct owner-name research from their Pipeline workspace, without repeating Leads import or creating another Contact.

**Why:** The user moves old Contacts into Pipeline and wants to find a missing owner's name there, save it to the Contact card, and see the name in sequence emails.

**How to apply:** Reuse the latest bounded discovery and evidence review, keep saved Contact names unchanged while searching, and make personal-email use an explicit save choice. Separate this research from lead-list execution and from sequence enrollment or sending.