# ESyCRM

## Overview

ESyCRM is a modern, multi-user Customer Relationship Management system offering comprehensive contact management, deal tracking, task organization, and business analytics. It supports secure role-based access control with distinct functionalities for Salespeople (isolated data access) and Administrators (full system oversight). Key capabilities include detailed contact management with duplicate detection and bulk import, a customizable deal pipeline with a dedicated workspace, robust task management, and an advanced email sequencing system for automated outreach. The platform also features an integrated inbox for managing replies, an analytics dashboard for performance insights, and administrative tools for user management and data export. A unique Lead Discovery Module automates business discovery and qualification, particularly for the pet grooming industry, enabling targeted lead generation and direct CRM import. The system is built with a full-stack TypeScript architecture, ensuring type safety and data isolation across the application.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
- **Framework**: React 18, TypeScript, Vite
- **Routing**: Wouter
- **State Management**: TanStack Query
- **UI Framework**: Shadcn/ui (Radix UI + Tailwind CSS)
- **Forms**: React Hook Form with Zod validation

### Backend
- **Runtime**: Node.js, Express.js
- **Language**: TypeScript (ES modules)
- **API Design**: RESTful
- **Authentication**: Replit Auth (OpenID Connect) with Google, GitHub, email/password login
- **Authorization**: Role-Based Access Control (`salesperson`, `admin`) with data isolation

### Data Storage
- **Database**: PostgreSQL
- **ORM**: Drizzle ORM
- **Schema Management**: Drizzle Kit
- **Connection**: Neon Database (serverless)
- **Session Management**: PostgreSQL-backed sessions (`connect-pg-simple`)

### Key Data Models
- Users (roles, professional email)
- Contacts (customer info, groups)
- Contact Groups (campaigns)
- Deals (pipeline stages, plan, won_date)
- Tasks (priorities, due dates)
- Activities (audit trail)
- Email Sequences (templates, scheduling)
- Email Sequence Logs (queue, delivery status)
- Inbox Messages (replies, linked to contacts)
- Commissions (dealId, userId, planName, upfrontAmount, monthlyAmount, confirmedAt)

### Pipeline Stages (11 stages)
`new_lead_unqualified` → `qualified_lead` → `contacted_emailed` → `contacted_phone_spoke_decision_maker` → `contacted_phone_spoke_non_decision_maker` → `contacted_phone_left_message` → `trial_period_started` → `pending_commitment` → `in_negotiation` → `won` / `lost`

### Deal Plans
- Solo - $79/mo or $2 / Appoint (upfront: $71.10, monthly: $7.90)
- Salon - $149/mo or $3 / Appoint (upfront: $134.10, monthly: $14.90)
- Signature - $229/mo (upfront: $206.10, monthly: $22.90)

### Features & Implementations
- **Role-Based Access Control**: Salespeople have isolated data; Admins have full access and oversight.
- **Contact Management**: Duplicate detection, CSV/Excel import with validation, contact grouping.
- **Deal Pipeline**: 11 customizable stages, multiple views (card/table), dedicated deal workspace with contact profile, activity feed, email history, tasks, and deal info. New default stage: `new_lead_unqualified`.
- **Commission System**: When a deal is marked as Won, a popup confirms the plan and records a commission (90% upfront + 10% monthly). Commissions stored in `commissions` table. Salesperson commission page shows upfront/monthly breakdown. Admin rankings show total deal values.
- **Admin Stage Notifications**: Emails sent to seann@esypet.com, ravin@esypet.com, srinath@esyntaxis.com on any stage change (except to `new_lead_unqualified`). Won deals include commission details in the email.
- **Deal Task System**: Full-featured task management within Deal Workspace. New `deal_tasks` table with task type (Call/Email/Demo/Follow-up/Site Visit/Other), priority, due date/time, assigned rep, reminder scheduling (15min/1hr/1day/custom), auto-follow-up creation on completion, overdue detection, grouped sections (Overdue/Today/Upcoming/Completed), activity feed integration, and 15-minute reminder email scheduler.
- **Email Sequences**: Automated campaigns with a three-track system (No Software / Uses Competitor / Custom General), 10-sequence system per salesperson, queue management, rate limiting, smart scheduling, Brevo integration, and activity tracking. Custom track sequences skip contact-track matching and accept per-contact custom subject/body email content (snapshotted in `emailSequenceLogs.customSubject`/`customBody`).
- **Inbox System**: Routes incoming replies to salesperson's inbox, message management, admin oversight.
- **Analytics Dashboard**: Real-time sales performance insights for salespeople and administrators.
- **Admin Tools**: User management (create, edit, roles), CSV data export, salesperson rankings with total deal values.
- **Lead Discovery Module**: Automated business discovery (pet grooming) by ZIP code using SerpAPI (Google/Bing), website crawling, software detection, contact extraction, and direct CRM import/export.
- **Secure Authentication**: Replit Auth with various providers, secure session management, protected API routes.

## External Dependencies

- **Database**: Neon Database, PostgreSQL
- **Email Service**: Brevo (outbound), Mailgun (inbound replies)
- **Search API**: SerpAPI
- **Frontend Build**: Vite
- **Backend Runtime**: Node.js, Express.js
- **ORM**: Drizzle ORM
- **UI Libraries**: Radix UI, Tailwind CSS, Lucide-React
- **Form/Validation**: React Hook Form, Zod
- **State Management**: TanStack Query
- **Routing**: Wouter
- **Session Management**: connect-pg-simple
- **Utility Libraries**: date-fns, nanoid, clsx, tailwind-merge