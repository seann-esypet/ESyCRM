# SendGrid Configuration for EsyPet CRM
## Instructions for Sri

Hi Sri,

We need to configure our EsyPet Twilio/SendGrid business account to power the email features in our new CRM app. There are two things to set up:

1. **Outbound sending** — so emails don't go to spam
2. **Inbound parse** — so when leads reply, their replies appear in the CRM's Inbox

---

## Part 1 — API Key

**In SendGrid → Settings → API Keys:**

Create a new API Key:
- **Name:** `EsyPet CRM`
- **Permissions:** Full Access (or at minimum: Mail Send + Inbound Parse)

Send me the key. I will enter it into the CRM app as a secret.

---

## Part 2 — Domain Authentication (Fixes Spam)

This is what stops our emails from landing in spam. It proves to email providers that SendGrid is authorized to send on behalf of esypet.com.

**In SendGrid → Settings → Sender Authentication → Authenticate Your Domain:**

- **Domain:** `esypet.com`
- Follow the steps — SendGrid will give you a set of **CNAME records** to add to our DNS

**Please add those CNAME records in our domain registrar (wherever esypet.com DNS is managed).**

Once verified, emails sent from `seann@esypet.com` through SendGrid will be trusted and should not go to spam.

---

## Part 3 — Verified Sender

**In SendGrid → Settings → Sender Authentication → Verify a Single Sender:**

- **From Name:** `Seann Sackett`
- **From Email:** `seann@esypet.com`
- **Reply To:** `seann@esypet.com`

Verify it (SendGrid will send a confirmation email to seann@esypet.com).

---

## Part 4 — Inbound Parse (Makes the CRM Inbox Work)

This is what allows replies from leads to appear in the CRM's Inbox. When a lead replies to an email, SendGrid intercepts it and sends the reply data to the CRM.

We need a dedicated subdomain so that incoming reply emails don't conflict with our regular esypet.com email.

### Step A — DNS: Add an MX Record for a subdomain

**In our domain DNS settings, add:**

| Type | Host/Name         | Value/Points To      | Priority |
|------|-------------------|----------------------|----------|
| MX   | `inbound.esypet.com` | `mx.sendgrid.net` | 10       |

This tells email servers: "When someone sends an email to anything@inbound.esypet.com, deliver it to SendGrid."

### Step B — Configure SendGrid Inbound Parse

**In SendGrid → Settings → Inbound Parse → Add Host & URL:**

- **Receiving Domain:** `inbound.esypet.com`
- **Destination URL:** `https://EsyPet-CRM.replit.app/api/webhooks/sendgrid/inbound`
- Check **"POST the raw, full MIME message"**
- Click **Save**

### Step C — No additional DNS needed

The CNAME records from Part 2 handle outbound authentication.
The MX record in Step A handles inbound replies.
These are on different subdomains, so there is no conflict.

---

## Summary of Email Addresses Used in the CRM

| Purpose | Address |
|--------|---------|
| FROM (sequences sent to leads) | `seann@esypet.com` |
| REPLY-TO (where lead replies go) | `seann@inbound.esypet.com` |
| Salesperson notification emails | `seann@esypet.com` |

**How it works end to end:**
1. CRM sends sequence email → FROM `seann@esypet.com`, REPLY-TO `seann@inbound.esypet.com`
2. Lead clicks Reply and sends their response
3. Their reply goes to `seann@inbound.esypet.com`
4. SendGrid catches it via the MX record and sends the content to the CRM webhook
5. The reply appears in the CRM Inbox instantly
6. Seann gets a notification email at `seann@esypet.com`

---

## What I Will Do on the CRM Side

Once you send me the API Key:
1. I will update the CRM to use the new key
2. I will update the FROM address to `seann@esypet.com`
3. I will update the REPLY-TO address to `seann@inbound.esypet.com`

---

## Checklist Summary for Sri

- [ ] Create API Key named **EsyPet CRM** → send me the key
- [ ] Authenticate domain **esypet.com** → add the CNAME records to DNS
- [ ] Verify sender **seann@esypet.com**
- [ ] Add MX record: `inbound.esypet.com` → `mx.sendgrid.net` (priority 10)
- [ ] Configure Inbound Parse for `inbound.esypet.com` → `https://EsyPet-CRM.replit.app/api/webhooks/sendgrid/inbound`

Thank you!
