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
- Deals (pipeline stages)
- Tasks (priorities, due dates)
- Activities (audit trail)
- Email Sequences (templates, scheduling)
- Email Sequence Logs (queue, delivery status)
- Inbox Messages (replies, linked to contacts)

### Features & Implementations
- **Role-Based Access Control**: Salespeople have isolated data; Admins have full access and oversight.
- **Contact Management**: Duplicate detection, CSV/Excel import with validation, contact grouping.
- **Deal Pipeline**: Customizable stages, multiple views (card/table), dedicated deal workspace with contact profile, activity feed, email history, tasks, and deal info.
- **Task Management**: Prioritized tasks with due dates.
- **Email Sequences**: Automated campaigns with a two-track system (No Software/Uses Competitor), 10-sequence system per salesperson, queue management, rate limiting, smart scheduling, SendGrid integration, and activity tracking.
- **Inbox System**: Routes incoming replies to salesperson's inbox, message management, admin oversight.
- **Analytics Dashboard**: Real-time sales performance insights for salespeople and administrators.
- **Admin Tools**: User management (create, edit, roles), CSV data export.
- **Lead Discovery Module**: Automated business discovery (pet grooming) by ZIP code using SerpAPI (Google/Bing), website crawling, software detection, contact extraction, and direct CRM import/export.
- **Secure Authentication**: Replit Auth with various providers, secure session management, protected API routes.

## External Dependencies

- **Database**: Neon Database, PostgreSQL
- **Email Service**: SendGrid (@sendgrid/mail)
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