# ESyCRM Design Guidelines

## Design Approach: Design System (Linear + Pipedrive Hybrid)

**Rationale:** CRM tools demand efficiency, data clarity, and professional polish. Drawing from Linear's modern minimalism and Pipedrive's sales-focused UX, with Material Design's data visualization principles.

**Core Principles:**
- Information density without clutter
- Instant data scanability
- Professional, trustworthy aesthetic
- Efficient workflows over decorative elements

---

## Color Palette

**Light Mode:**
- Primary: 220 70% 50% (Professional blue)
- Background: 0 0% 100% (Pure white)
- Surface: 220 20% 97% (Light gray)
- Border: 220 15% 88%
- Text Primary: 220 15% 20%
- Text Secondary: 220 10% 50%
- Success: 145 65% 45% (Deal won)
- Warning: 35 90% 55% (Follow-up needed)
- Danger: 0 70% 55% (Overdue)

**Dark Mode:**
- Primary: 220 75% 55%
- Background: 220 15% 10%
- Surface: 220 12% 15%
- Border: 220 10% 25%
- Text Primary: 220 10% 95%
- Text Secondary: 220 8% 65%

---

## Typography

**Font Stack:** Inter (via Google Fonts CDN)
- Headings: 600-700 weight, tight tracking (-0.02em)
- Body: 400-500 weight, relaxed leading (1.6)
- Data/Numbers: 500 weight, tabular-nums

**Scale:**
- Page Titles: text-2xl (24px)
- Section Headers: text-lg (18px)
- Body: text-sm (14px)
- Labels/Meta: text-xs (12px)

---

## Layout System

**Spacing Primitives:** Use 2, 4, 6, 8, 12, 16 units
- Compact spacing: p-2, gap-4 (dense tables, cards)
- Standard spacing: p-4, gap-6 (forms, content)
- Section spacing: p-8, gap-12 (page sections)

**Structure:**
- Sidebar: 260px fixed width, full height
- Main content: Remaining width with max-w-7xl container
- Cards: rounded-lg (8px), subtle shadow
- Grid: 12-column base, responsive breakdowns

---

## Component Library

### Navigation & Structure

**Sidebar Navigation:**
- Dark background (surface color)
- Icon + label format with Heroicons
- Active state: primary color + background tint
- Sections: Dashboard, Contacts, Deals, Tasks, Import
- Bottom: User profile with dropdown

**Top Bar:**
- Search bar (prominent, 400px width)
- Quick actions: "+ New Contact", "+ New Deal"
- Notifications bell with badge
- User avatar dropdown

### Dashboard Components

**Stats Cards (4-column grid):**
- Large number display (text-3xl, tabular-nums)
- Label below in muted text
- Trend indicator (arrow icon + percentage)
- Subtle border, no heavy shadows

**Recent Activity Feed:**
- Timeline-style layout with icons
- Timestamp (relative: "2h ago")
- Action description with linked entities
- Avatar for user who performed action

**Deal Pipeline Chart:**
- Horizontal bar chart showing stages
- Color-coded by stage (cool grays → warm greens)
- Click to filter deals
- Total value displayed per stage

### Data Tables

**Contact/Deal Tables:**
- Sticky header with sort indicators
- Row hover: subtle background change
- Checkbox column for bulk actions
- Status badges (rounded-full, text-xs)
- Action menu (3-dot) on row hover
- Pagination: 25/50/100 per page options

**Table Columns:**
- Contacts: Avatar, Name, Company, Email, Phone, Last Contact, Status
- Deals: Name, Contact, Value, Stage, Probability, Close Date, Owner

### Forms

**Input Fields:**
- Labels above (text-sm, font-medium)
- Border-only style, focus ring (primary color)
- Placeholder text in muted color
- Helper text below when needed
- Error states: red border + message

**Form Layout:**
- Two-column grid for related fields
- Full-width for text areas
- Save/Cancel buttons: right-aligned
- Auto-save indicator: "Last saved 30s ago"

### CSV Upload Feature

**Upload Interface (Modal/Page):**
- Large dropzone (h-64): dashed border, hover state
- Drag & drop or "Browse files" button
- Accepted formats shown: CSV, XLS, XLSX
- File size limit displayed (10MB max)

**Upload Progress:**
- Linear progress bar (primary color)
- Percentage + "Processing row X of Y"
- File name and size displayed
- Cancel button during upload

**Results Display:**
- Success summary card (green border):
  - Total uploaded, successful imports, duplicates skipped
- Error list (if any):
  - Expandable accordion per error type
  - Row number + specific error message
  - "Download error report" button
- Preview table: First 10 imported contacts
- "View all imported contacts" button

---

## Data Visualization

**Deal Pipeline (Kanban Board):**
- Columns: Lead, Qualified, Proposal, Negotiation, Closed
- Cards: compact with deal value (large), company name, owner avatar
- Drag & drop between columns
- Column totals in header

**Charts:**
- Line charts for revenue trends (minimal, no grid clutter)
- Bar charts for performance metrics
- Use primary color with opacity variations

---

## Interactive States

**Buttons:**
- Primary: bg-primary, white text, hover: darken 10%
- Secondary: border-primary, primary text
- Ghost: text-primary, hover: background tint

**Loading States:**
- Skeleton screens for tables (shimmer effect)
- Spinner for actions (sm size, inline)
- Disabled state: 50% opacity

---

## Responsive Behavior

**Desktop (1440px+):** Full sidebar, multi-column layouts
**Tablet (768-1439px):** Collapsed sidebar (icons only), 2-column grids
**Mobile (<768px):** Bottom navigation bar, single column, swipe actions on table rows

---

## Images

**No hero images needed** - This is a utility application focused on productivity. Images used sparingly:
- Empty states: Simple illustrations (e.g., "No contacts yet" with document icon)
- User avatars: Throughout tables and activity feeds
- Company logos: In contact/deal cards (32x32px)

---

## Animations

**Minimal, purposeful only:**
- Page transitions: 150ms ease-out
- Modal entry/exit: scale(0.95) to scale(1), 200ms
- Dropdown menus: slide-down 150ms
- Toast notifications: slide-in from top-right
- **No decorative animations** - maintain professional feel

---

## Key Differentiators

- **Data-first design:** Tables and charts optimized for quick scanning
- **Action-oriented:** CTAs always visible, minimal clicks to tasks
- **Status clarity:** Color-coded badges, clear visual hierarchy
- **Bulk operations:** Multi-select, batch actions prominently placed
- **Import workflow:** Clear, error-tolerant with detailed feedback

This design prioritizes salesperson efficiency with a polished, modern interface that scales from individual contributors to teams.