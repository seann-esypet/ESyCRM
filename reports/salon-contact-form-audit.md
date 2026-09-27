# Original 20-salon contact-form audit

## Findings

Reviewed the 20 original pilot records represented by the workbook's earlier pilot tabs and `reports/salon-email-pilot-10.csv`.

- **5 verified salon-owned general message forms:** Calis Pet Grooming, Throw Me A Bone, Grooming 4 Less, Shake and Tail Dog Grooming, and Loyl's Natural Pet Grocery & Groomery.
- **5 previously verified salon email addresses** across Felix's Pet Grooming, Throw Me A Bone, Jackson's Place, Grooming 4 Less, and Shake and Tail.
- **10 unique verified contact channels** (the 5 distinct verified email addresses plus the 5 distinct general-form URLs); **7 distinct pilot salons** have at least one of these channels.
- **0 messages submitted.** No SerpApi or paid-search calls were made for this audit.

The new workbook copy adds the exact `Usable Contact Form` column to the main sheet. It contains clickable URL values only for the five verified forms; the old sheets and their existing cells were retained. The workbook's `Contact form audit` sheet records a finding and evidence for every pilot row, plus the separate counts.

## Form verification

The listed salon-owned pages were retrieved with read-only GET requests and visibly contained general-contact message fields and a submit control:

| Salon | Verified form URL |
|---|---|
| Calis Pet Grooming | https://www.calisgrooming.com/contact |
| Throw Me A Bone | https://www.throwmeabone.nyc/contact |
| Grooming 4 Less | https://grooming4less.com/contacts |
| Shake and Tail Dog Grooming | https://www.shakeandtailny.com/ |
| Loyl's Natural Pet Grocery & Groomery | https://loyls.com/contact/ |

“Verified” here means the salon attribution and general message-form controls were visible in the retrieved page HTML. No form was submitted, so successful backend delivery was not tested.

## Exclusions and limits

- Doggy Style Salon's Groomer.io page is a service/appointment request flow, not a general-contact form. Felix's site links to booking; no general form was verified. Jackson's Place has a verified email/contact link but no message form in the retrieved contact page.
- Mike's Pet Store resolves to a third-party directory; Best Paws evidence was a map/directory and Facebook post; The Woof Lounge URL is a third-party directory whose form is for customer reviews. These are not salon-owned message forms.
- Towne House's site returned HTTP 403 and was not verifiable during this check. The remaining no-form findings reflect no matched salon-owned site/form in supplied pilot evidence, not proof that no form exists.
- Read-only direct GET requests were made to identified salon-site/contact URLs; blocked, missing, or unavailable sites are identified in the workbook evidence sheet. Dynamic or access-controlled forms may not be represented in the fetched HTML.
- Sources: the original pilot workbook (`Public web FB pilot`, `Pilot 2 evidence`, `Review evidence`, and `Facebook email search` tabs), `reports/salon-email-pilot-10.csv`, and direct salon website GET responses. Directory and Facebook references were used only as contextual evidence, not as proof of salon-owned forms.