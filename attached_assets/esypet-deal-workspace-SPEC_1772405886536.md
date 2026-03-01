# EsyPet CRM — Deal Workspace Rebuild
## Specification for Replit Agent
---

## OVERVIEW

The Pipeline currently opens a small popup when a contact/deal is clicked. This must be replaced with a **full Deal Workspace** — a dedicated page or full-screen panel that serves as the single command center for a salesperson working that deal. The salesperson should never need to leave the Deal Workspace to access any information about the contact, deal, activity history, tasks, or email sequences.

The UI mockup file `esypet-deal-workspace-mockup.html` shows the target layout. Use it as the visual reference.

---

## LAYOUT STRUCTURE

The Deal Workspace uses a **3-column layout** inside a full-height container:

```
┌─────────────┬──────────────────────┬─────────────┐
│  LEFT PANEL │    CENTER PANEL      │ RIGHT PANEL │
│  280px      │    flex: 1           │   320px     │
│             │                      │             │
│  Contact &  │  Activity Feed +     │  Tasks +    │
│  Company    │  Tabs                │  Deal Info  │
│  Info       │                      │             │
└─────────────┴──────────────────────┴─────────────┘
```

A **top bar** spans the full width showing:
- Breadcrumb: Pipeline › [Stage Name] › [Deal Title — Contact Name]
- Current Pipeline Stage pill (colored badge)
- Probability % badge
- "Back to Pipeline" button
- "Move Stage" button (opens a dropdown to change pipeline stage)

---

## LEFT PANEL — Contact & Company Information

Display ALL fields from the existing Edit Contact form, read-only with an "Edit Contact Info" button at the bottom.

**Always prominently show at the top:**
- Contact avatar (initials-based colored circle)
- Full Name + Company Name
- Interest Level badge — color coded:
  - High = green
  - Medium = yellow  
  - Low = gray

**CRITICAL — Current Software field:**
- Show this prominently with a red/warning color chip (e.g. 🔴 MoeGo)
- This is essential — sales reps must see this BEFORE making a call
- Show Booking Software URL as a clickable link below it

**Fields to display (grouped):**

Group: Primary Contact
- Cell Phone (clickable tel: link)
- Work Phone (clickable tel: link)
- Email (clickable mailto: link)
- Job Title

Group: Location
- Full Address
- City
- Number of Locations
- Number of Groomers / Employees

Group: Current Software (highlighted/warning)
- Uses Software (Yes/No/Unknown)
- Current Software Used (red chip)
- Booking Software URL

Group: Digital Presence
- Has Website + Website Address (clickable)
- Contact Request Form URL
- Facebook Page URL
- Instagram Handle

Group: Secondary Contact
- First Name + Last Name

Group: Pain Points
- Display as a text block with subtle background

Group: Lead Info
- Lead Source
- Status (Active/Inactive)
- Assigned Sales Person

Group: Notes (general contact notes)
- Display as readable text block
- Does NOT replace the Activity Feed notes

Button at bottom: "✏️ Edit Contact Info" — opens the existing edit modal

---

## CENTER PANEL — Activity Feed

This is the main workspace. It shows a **chronological reverse-ordered timeline** of everything that has happened on this deal.

### Tab Bar (top of center panel):
- **Activity Feed** (default active tab) — shows all activity types mixed
- **Email History** — shows only emails sent/received (with unread badge count)
- **Sequences** — shows email sequence status and steps
- **Notes** — shows only manual notes

### Activity Feed — Item Types

Each activity item has:
- An icon circle (color coded by type)
- Activity type label (CALL LOGGED, EMAIL REPLY, NOTE, SITE VISIT, STAGE CHANGE, TASK CREATED, SEQUENCE STEP)
- Timestamp
- Rep name who logged it
- A content card below

**1. CALL LOG** (green)
Fields when logging:
- Date/Time (auto-filled, editable)
- Outcome chip: "Spoke to Owner" | "Spoke to Manager" | "Left Voicemail" | "No Answer" | "Spoke to Staff"
- Person spoken to (free text or secondary contact)
- Call duration (optional, manual entry or future: auto from VoIP)
- Notes/summary (text area — required)
- Next action (optional: creates a follow-up task automatically)

**2. EMAIL NOTE** (blue)
For manually logging an email sent outside the system, or adding notes about an email reply received:
Fields:
- Direction: Sent | Received
- Subject line
- Date/Time
- Summary/notes (text area)

(Automated email sequence steps appear separately, pulled from existing email system)

**3. NOTE** (yellow)
- General free-text note
- Rep name + timestamp
- No additional structured fields

**4. SITE VISIT** (purple)
Fields when logging:
- Visit Date
- Location visited (address or "Primary" / "Secondary")
- Who was met: Owner | Manager | Staff | No one available
- Number of groomers confirmed (editable)
- Software observed in use (pre-filled from contact, editable)
- Materials left (checkbox: Brochure, Business Card, Demo Link, Other)
- Notes/summary (text area — required)

**5. STAGE CHANGE** (gray, compact)
- Auto-logged when pipeline stage is changed
- Shows: Previous Stage → New Stage
- Rep name + timestamp
- No content card, just a compact horizontal line item

**6. TASK CREATED / COMPLETED** (red)
- Auto-logged when a task is added or marked done
- Shows task title and due date

**7. EMAIL SEQUENCE STEP** (blue, auto)
- Auto-logged when a sequence email is sent or replied to
- Pulled from existing email system — no manual entry needed

### Log Action Bar (bottom of center panel, always visible)

A fixed bottom toolbar with quick-log buttons:
```
Log: [📞 Call] [✉ Email Note] [📝 Note] [🏪 Site Visit] [⊕ Add Task]    [📅 Schedule Demo →]
```

Each button opens a modal/slide-up form for logging that activity type.

---

## RIGHT PANEL — Tasks & Deal Info

### Open Tasks Section

Displays all tasks associated with this deal, sorted by due date (overdue first).

**Task visual states:**
- 🔴 OVERDUE — red border, shown at top
- 🟡 DUE TODAY — yellow border
- Normal future task — default border
- ✓ DONE — faded/strikethrough, collapsed by default

**Each task card shows:**
- Checkbox (click to complete)
- Task title
- Task type chip: Call | Email | Demo | Follow-up | Site Visit | Other
- Due date with color coding
- Reminder indicator (bell icon if email reminder set)

**Add Task / Reminder Modal** (opened by "+ Add Task" button or log bar button):

Fields:
- Task Title (required)
- Task Type: Call | Email | Demo | Follow-up | Site Visit | Other
- Due Date (date picker, required)
- Due Time (time picker, optional)
- Assigned To (dropdown of sales reps, defaults to current user)
- Reminder: None | 15 min before | 1 hour before | 1 day before | Custom date
- Reminder Method: Email | (future: SMS)
- Notes (optional text)

**Reminder email** — when a reminder fires, send an email to the assigned rep with:
- Subject: "⚑ Task Due: [Task Title] — [Contact Name]"
- Body: Task details, deal stage, link back to the Deal Workspace
- A daily digest email can be added later (all tasks due today across all deals)

### Email Sequence Status (below tasks)

Show a compact step-by-step sequence progress:
- Step 1 — [name] — Sent [date] ✓ (green dot)
- Step 2 — [name] — Sent [date] ✓ (green dot)
- Step 3 — [name] — Active / Pending (pulsing blue dot)
- Step 4 — [name] — Scheduled [date] (gray dot)

Pull from existing email sequence data.

### Deal Info (bottom of right panel)

Quick-view stats:
- Plan Selected
- Expected Close Date
- Probability %
- Last Touch (how many days since last activity)
- Open Tasks count (red if any overdue)

---

## DATABASE SCHEMA ADDITIONS

The following new tables are needed. Add to the existing database:

### Table: `deal_activities`
```
id              INTEGER PRIMARY KEY AUTOINCREMENT
deal_id         INTEGER NOT NULL (FK → deals.id)
contact_id      INTEGER NOT NULL (FK → contacts.id)
activity_type   TEXT NOT NULL 
                  -- 'call', 'email_note', 'note', 'site_visit', 
                  --  'stage_change', 'task_created', 'task_completed', 
                  --  'sequence_step'
created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
created_by      TEXT NOT NULL (sales rep name or user_id)
notes           TEXT
metadata        TEXT (JSON blob for type-specific fields)
```

The `metadata` JSON field stores type-specific data:

For `call`:
```json
{
  "outcome": "spoke_to_owner|spoke_to_manager|left_voicemail|no_answer|spoke_to_staff",
  "person_spoken_to": "Ted Crocket",
  "duration_minutes": 8,
  "next_action": "Schedule demo call"
}
```

For `email_note`:
```json
{
  "direction": "sent|received",
  "subject": "Re: EsyPet Demo",
  "summary": "Ted replied and wants to schedule a call"
}
```

For `site_visit`:
```json
{
  "location_visited": "Primary - Huntington",
  "person_met": "owner|manager|staff|none",
  "groomers_confirmed": 4,
  "software_observed": "MoeGo",
  "materials_left": ["brochure", "business_card"],
  "summary": "Clean shop, busy Saturday..."
}
```

For `stage_change`:
```json
{
  "from_stage": "New Lead Unqualified",
  "to_stage": "Qualified Lead"
}
```

### Table: `deal_tasks`
```
id              INTEGER PRIMARY KEY AUTOINCREMENT
deal_id         INTEGER NOT NULL (FK → deals.id)
contact_id      INTEGER NOT NULL (FK → contacts.id)
title           TEXT NOT NULL
task_type       TEXT NOT NULL
                  -- 'call', 'email', 'demo', 'followup', 'site_visit', 'other'
due_date        DATE NOT NULL
due_time        TIME
assigned_to     TEXT NOT NULL (sales rep email or name)
reminder_timing TEXT -- 'none', '15min', '1hour', '1day', 'custom'
reminder_method TEXT -- 'email'
reminder_sent   BOOLEAN DEFAULT FALSE
completed       BOOLEAN DEFAULT FALSE
completed_at    DATETIME
notes           TEXT
created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
created_by      TEXT NOT NULL
```

### Existing Tables — Additions

Add to `deals` table:
```
last_activity_at  DATETIME  (updated whenever a new activity is logged)
```

---

## EMAIL REMINDER SYSTEM

### Trigger: Task Reminders
When a task is created with a reminder set, schedule a job (or use a cron check) that:
1. Queries `deal_tasks` where `completed = false` AND `reminder_sent = false` AND the reminder trigger time has passed
2. Sends an email to `assigned_to` with:
   - Subject: `⚑ Task Due: {title} — {contact first name} {last name}`
   - Body includes: task type, due date/time, deal stage, contact name, contact phone, a direct link to the Deal Workspace for that deal
3. Sets `reminder_sent = true`

### Implementation Options (pick simplest for current stack):
- If using Node.js/Express: use `node-cron` to run a check every 15 minutes
- If using Python/Flask: use APScheduler or a simple cron endpoint
- Email sending: use existing email provider (SendGrid, Nodemailer, etc. — whatever the app already uses for sequence emails)

### Daily Digest (optional, Phase 2):
Send each sales rep a morning email at 8:00 AM listing all their tasks due today or overdue across ALL their deals.

---

## NAVIGATION CHANGE

### From the Pipeline Board:
- Currently: clicking a contact name opens a small popup
- NEW BEHAVIOR: clicking a contact name OR the deal card navigates to `/deal/{deal_id}` — the full Deal Workspace page
- The "Edit" button in the pipeline card can be removed (editing happens inside the workspace)
- Keep the drag-and-drop stage changing on the Kanban board for quick moves

### URL Structure:
```
/pipeline          — existing kanban board
/deal/{id}         — new Deal Workspace page
/deal/{id}/edit    — optional: direct to edit mode
```

---

## MODAL: LOG A CALL

When the "📞 Call" button is clicked in the log bar, show a modal with:

```
┌─ Log a Call ──────────────────────────────────┐
│                                                │
│  Date/Time:  [Feb 27, 2025] [2:14 PM]         │
│                                                │
│  Call Outcome:                                 │
│  ○ Spoke to Owner  ○ Spoke to Manager          │
│  ○ Left Voicemail  ○ No Answer  ○ Staff        │
│                                                │
│  Person Spoken To: [___________________]       │
│  (pre-filled with contact name)                │
│                                                │
│  Duration (min): [___]  (optional)             │
│                                                │
│  Notes / Summary: (required)                   │
│  [                                    ]        │
│  [                                    ]        │
│                                                │
│  Create follow-up task? □                      │
│  If checked, show: Task title / Due date       │
│                                                │
│  [Cancel]                    [Save Call Log]   │
└────────────────────────────────────────────────┘
```

---

## MODAL: ADD TASK / REMINDER

```
┌─ Add Task or Reminder ────────────────────────┐
│                                                │
│  Task Title: (required)                        │
│  [___________________________________]         │
│                                                │
│  Task Type:                                    │
│  [Call ▾]  (Call|Email|Demo|Follow-up|         │
│             Site Visit|Other)                  │
│                                                │
│  Due Date: [___________] Time: [___]           │
│                                                │
│  Assigned To: [Sarah M. ▾]                     │
│                                                │
│  Reminder:                                     │
│  ○ None  ○ 1 hour before  ○ 1 day before       │
│  ○ Custom date/time                            │
│                                                │
│  Send reminder to: (email auto-filled)         │
│  [sarah@esypet.com]                            │
│                                                │
│  Notes: (optional)                             │
│  [                                    ]        │
│                                                │
│  [Cancel]                        [Add Task]    │
└────────────────────────────────────────────────┘
```

---

## MODAL: LOG A SITE VISIT

```
┌─ Log a Site Visit ────────────────────────────┐
│                                                │
│  Visit Date: [___________]                     │
│                                                │
│  Location: ○ Primary  ○ Secondary  ○ Other     │
│  Address: [pre-filled, editable]               │
│                                                │
│  Person Met:                                   │
│  ○ Owner  ○ Manager  ○ Staff  ○ No one         │
│                                                │
│  # Groomers Confirmed: [4]                     │
│  (pre-filled from contact, editable)           │
│                                                │
│  Software Observed: [MoeGo]                    │
│  (pre-filled from contact, editable)           │
│                                                │
│  Materials Left:                               │
│  □ Brochure  □ Business Card                   │
│  □ Demo Link  □ Other: [_____]                 │
│                                                │
│  Notes / Summary: (required)                   │
│  [                                    ]        │
│  [                                    ]        │
│                                                │
│  [Cancel]                  [Save Site Visit]   │
└────────────────────────────────────────────────┘
```

---

## IMPLEMENTATION PRIORITY ORDER

**Phase 1 — Core Workspace (do first):**
1. Create `/deal/{id}` route and page
2. Build the 3-column layout
3. Left panel: display all contact + deal fields (read-only)
4. Right panel: Deal Info section (from existing deal data)
5. Center panel: placeholder activity feed
6. "Back to Pipeline" navigation

**Phase 2 — Activity Logging:**
1. Create `deal_activities` table
2. Build Log Call modal + save to DB
3. Build Log Note modal + save to DB
4. Build Log Email Note modal + save to DB
5. Build Log Site Visit modal + save to DB
6. Display activity feed from DB (chronological, with icons)
7. Auto-log stage changes as activities

**Phase 3 — Tasks & Reminders:**
1. Create `deal_tasks` table
2. Build Add Task modal
3. Display tasks in right panel with color-coded states
4. Mark task complete (checkbox)
5. Email reminder cron job / scheduled check
6. Reminder email template

**Phase 4 — Polish:**
1. Daily digest email for reps
2. "Last Touch" calculation
3. Mobile responsive adjustments
4. Calendar event integration (Google Calendar — future)

---

## REFERENCE: VISUAL MOCKUP

See the attached HTML file `esypet-deal-workspace-mockup.html` for the visual design reference. The color scheme, layout proportions, activity card styles, task states, and button designs in that file should be adapted to match the existing EsyPet CRM visual style.

Key design decisions shown in the mockup:
- Current Software always shown in a red warning chip (highest visibility)
- Interest Level shown as a colored badge next to contact name
- Task overdue state uses red border on the task card
- Activity items use colored icon circles to quickly scan the timeline by type
- The log bar is fixed at the bottom of the center panel — always accessible
- Stage changes are shown as compact single-line items (no full card needed)
