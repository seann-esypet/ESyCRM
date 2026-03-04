# New Salesperson Onboarding — ESyCRM Setup Guide

> Share this document with Sri or any developer when a new salesperson is hired.

---

## Overview

When you hire a new salesperson (example: **Stephanie**), there are three areas to configure:

1. Create her company email address
2. (If needed) Add her as a verified sender in SendGrid
3. Create and configure her account in ESyCRM

The inbound reply-to address requires **no setup per person** — it works automatically once you've configured it for the domain.

---

## Step 1 — Create the Company Email Address

**Where:** Your email/domain hosting provider (e.g. Google Workspace, Microsoft 365, Namecheap, etc.)

**Action:** Create a real mailbox for `stephanie@esypet.com`

**Why it matters:**
- ESyCRM sends her notification emails (e.g. "a lead replied") to this address
- Lead replies route to her CRM Inbox via the reply-to address, but having a real mailbox ensures nothing bounces or gets flagged as spoofed

**Notes:**
- The password for this mailbox is separate from her CRM login
- She can access it via webmail or configure it in Outlook/Gmail

---

## Step 2 — SendGrid Sender Setup (check first — may not be needed)

### Check your current setup

Log in to [SendGrid](https://app.sendgrid.com) and go to:
**Settings → Sender Authentication**

**If you see "Domain Authentication" set up for `esypet.com` (DKIM/SPF verified):**
→ **You do NOT need to do anything in SendGrid for each new salesperson.**
   Any `@esypet.com` address works automatically as a FROM address.

**If you only have "Single Sender Verification" (one email address listed):**
→ You **do** need to add and verify each salesperson's email address.
   Steps for this case are below.

### How to add a new sender (only if using Single Sender Verification)

1. In SendGrid → **Settings → Sender Authentication → Single Sender Verification**
2. Click **"Create New Sender"**
3. Fill in:
   - From Name: `Stephanie [Last Name]`
   - From Email: `stephanie@esypet.com`
   - Reply To: `stephanie@inbound.esypet.com`
   - Company Address: (your business address)
4. Click **Save**
5. SendGrid will send a verification email to `stephanie@esypet.com`
6. Stephanie opens that email and clicks **"Verify Single Sender"**
7. Done — she can now be used as a FROM address in SendGrid

### Recommended: Switch to Domain Authentication (one-time setup, eliminates Step 2 forever)

If you haven't already, set up Domain Authentication for `esypet.com`:
1. SendGrid → **Settings → Sender Authentication → Authenticate Your Domain**
2. Follow the steps — SendGrid gives you DNS records to add to your domain registrar
3. Once verified, **any** `@esypet.com` address is automatically valid as a sender
4. You never need to repeat this for any new salesperson

Ask Sri to set this up if it hasn't been done yet.

---

## Step 3 — Reply-To (Inbound Parse) — No Action Required

The Reply-To address format `stephanie@inbound.esypet.com` works automatically.

**How it works:**
- The DNS MX record for `inbound.esypet.com` is already set to point to SendGrid's Inbound Parse servers
- Any email sent to `*@inbound.esypet.com` is caught by SendGrid and forwarded to the CRM's webhook
- The CRM identifies which salesperson the reply belongs to by matching the address prefix
- No setup is needed per person — it just works

---

## Step 4 — Create the Salesperson Account in ESyCRM

**Where:** ESyCRM → Admin → Users

1. Log in as Admin at your ESyCRM URL
2. Go to **Settings → Users** (or the Admin section)
3. Click **"Add User"** or **"Create Account"**
4. Fill in:
   | Field | Value |
   |---|---|
   | First Name | Stephanie |
   | Last Name | [Last Name] |
   | Login Email | `stephanie@gmail.com` (or whatever she uses to log in) |
   | Role | `salesperson` |
   | Work Email (FROM) | `stephanie@esypet.com` |
   | Reply-To Email | `stephanie@inbound.esypet.com` |
5. Save

**Important field notes:**
- **Login Email** — what she uses to sign in via Google/Replit Auth. Can be her personal Gmail.
- **Work Email (FROM)** — what leads see in the "From:" field of sequence emails. Must be `@esypet.com`.
- **Reply-To Email** — where leads' replies are routed into her CRM Inbox. Always use the format `name@inbound.esypet.com`.

---

## Step 5 — Confirm Everything Works

Have Stephanie:
1. Log in to ESyCRM using her Gmail (or whatever login was set)
2. Verify her name and email settings look correct in her profile
3. Have an admin send a test sequence email to a test contact — confirm it arrives with `From: stephanie@esypet.com`
4. Reply to that test email and confirm the reply appears in her **CRM Inbox**

---

## Quick Reference — Per-Person Checklist

When hiring a new salesperson, run through this checklist:

- [ ] Create `name@esypet.com` mailbox at your email hosting provider
- [ ] (If Single Sender only) Add and verify `name@esypet.com` in SendGrid
- [ ] Create their account in ESyCRM Admin with:
  - [ ] Login Email set correctly
  - [ ] Work Email = `name@esypet.com`
  - [ ] Reply-To Email = `name@inbound.esypet.com`
- [ ] Test: send a sequence email and reply — confirm both directions work

---

## Email Address Reference Table

| Salesperson | Login | FROM (sequences) | Reply-To (CRM Inbox) |
|---|---|---|---|
| Seann | seann@gmail.com (or Replit) | seann@esypet.com | seann@inbound.esypet.com |
| Stephanie | stephanie@gmail.com | stephanie@esypet.com | stephanie@inbound.esypet.com |
| (Next hire) | their login | name@esypet.com | name@inbound.esypet.com |

---

## Who Does What

| Task | Who |
|---|---|
| Create company mailbox | Seann (domain admin) or Sri |
| SendGrid sender verification | Sri |
| DNS / Domain Authentication setup | Sri |
| Create CRM user account | Seann (CRM Admin role) |
| Test confirmation | Seann + new hire |
