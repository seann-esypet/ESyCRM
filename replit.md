# ESyCRM

## Overview

ESyCRM is a modern, multi-user Customer Relationship Management system built with a full-stack TypeScript architecture. The application provides comprehensive contact management, deal tracking, task organization, and business analytics features with secure user authentication and complete data isolation.

**Key Features:**
- **Role-Based Access Control**: Multi-user system with two distinct roles
  - **Salespeople**: Personal portal with isolated data (contacts, deals, tasks)
  - **Administrators**: Full system access with oversight capabilities
- **Contact Management**: Track customer information, companies, and relationships with duplicate detection
  - **Duplicate Detection**: Automatically identifies duplicates by normalized phone number, email, or first+last name combination
  - **CSV/Excel Import**: Bulk upload contacts from CSV or Excel files with validation, error reporting, and duplicate resolution
  - **Contact Groups/Campaigns**: Organize contacts into groups for targeted outreach with CSV import support
- **Deal Pipeline**: Manage sales opportunities through customizable stages
  - **Multiple Views**: Switch between detailed card view and compact table view
  - **Smart Sorting**: Sortable columns with default ordering (open deals first, newest first)
- **Task Management**: Organize follow-ups and action items with priorities and due dates
- **Email Sequences**: Automated email campaigns with queue system and rate limiting (requires Reserved VM deployment)
  - **5-Sequence System**: Create up to 5 automated email sequences per salesperson
  - **Queue System**: Add multiple contacts to sequences via bulk selection, tracks pending/processing/sent status
  - **Rate Limiting**: Sends max 1 email per 5 minutes (12/hour) to maintain sender reputation and avoid spam
  - **Smart Scheduling**: Sequence 1 sends on scheduled date/time, sequences 2-5 send after no reply
  - **Stale Log Recovery**: Automatically resets stuck processing logs after 90 minutes using dedicated processingStartedAt timestamp (handles process crashes)
  - **Template Variables**: Dynamic content with [Contact_First_Name] and [Sales_Person] placeholders
  - **SendGrid Integration**: Professional email delivery with branded domain support
  - **Activity Tracking**: Monitor email sends, responses, and sequence status per contact with queue visibility
- **Inbox System**: Email reply management with role-based access
  - **Individual Email Addresses**: Each salesperson uses their professional email (e.g., john@esypet.com) for sequences
  - **Reply Tracking**: Incoming replies automatically routed to salesperson's inbox via SendGrid Inbound Parse
  - **Message Management**: Read/unread status, delete functionality, and contact linking
  - **Admin Access**: Administrators can view all salesperson inboxes for oversight
  - **Security Note**: Webhook accepts emails only from known contacts; consider adding SendGrid signature verification for production
- **Analytics Dashboard**: Real-time insights into sales performance and pipeline health
  - **Salesperson View**: Personal metrics (revenue, pipeline, conversion rate, task completion)
  - **Admin View**: Salesperson rankings by deals closed, total value, and win rate
- **Admin Data Export**: CSV export functionality for contacts, deals, and tasks (admin-only)
- **Profile Settings**: Personal settings management for salespeople
  - **Work Email Configuration**: Set professional email address (e.g., john@esypet.com) used as sender for email sequences
  - **Account Information**: View Replit account details and user role
- **Secure Authentication**: Login with Google, GitHub, or email/password via Replit Auth

The system follows a monorepo structure with shared TypeScript schemas and utilities, ensuring type safety across the entire application stack. Data access is automatically controlled based on user role: salespeople see only their own data, while administrators have full system visibility.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript and Vite for fast development and building
- **Routing**: Wouter for lightweight client-side routing
- **State Management**: TanStack Query (React Query) for server state management and caching
- **UI Framework**: Shadcn/ui components built on Radix UI primitives with Tailwind CSS for styling
- **Forms**: React Hook Form with Zod validation for type-safe form handling
- **Build Tool**: Vite with custom configuration for development and production builds

### Backend Architecture
- **Runtime**: Node.js with Express.js web framework
- **Language**: TypeScript with ES modules
- **Development Server**: Custom Vite integration for hot module replacement in development
- **API Design**: RESTful endpoints following conventional HTTP methods and status codes
- **Error Handling**: Centralized error middleware with proper HTTP status codes

### Data Storage Solutions
- **Database**: PostgreSQL with Drizzle ORM for type-safe database operations
- **Schema Management**: Drizzle Kit for database migrations and schema management
- **Connection**: Neon Database serverless PostgreSQL connection
- **Development Storage**: In-memory storage implementation for development/testing
- **Schema Definition**: Centralized schema definitions in `shared/schema.ts` with Zod validation

### Key Data Models
- **Users**: User accounts with role (salesperson/admin), OAuth profile, and optional professional email address (workEmail) for sending sequences
- **Contacts**: Customer information with personal and business details, optional group assignment
- **Contact Groups**: Organize contacts into named groups/campaigns for targeted outreach
- **Deals**: Sales opportunities with pipeline stages and value tracking
- **Tasks**: Action items with priorities, due dates, and completion status
- **Activities**: Audit trail for all system actions and interactions
- **Email Sequences**: Automated email campaign templates with scheduling rules (5 sequences per user)
- **Email Sequence Logs**: Queue system tracking (pending → processing → sent/failed), with delivery status and response monitoring
- **Inbox Messages**: Received email replies from contacts, linked to sender contact and salesperson owner

### Authentication and Authorization
- **Authentication Provider**: Replit Auth (OpenID Connect) with support for Google, GitHub, X, Apple, and email/password login
- **Session Management**: PostgreSQL-backed sessions using connect-pg-simple with 7-day TTL
- **User Management**: Automatic user creation and updates via OAuth claims
- **Role-Based Access Control**:
  - **User Roles**: `salesperson` (default) and `admin`
  - **Role Persistence**: Stored in database users table, refreshed on each request
  - **Data Isolation**: Salespeople see only their own data; admins see all data
  - **Admin-Only Features**: CSV export, salesperson rankings, system-wide reporting
- **Security Features**:
  - Secure session cookies with httpOnly and secure flags
  - Automatic token refresh for expired sessions
  - Protected API routes with `isAuthenticated` middleware
  - Admin-only routes protected with `isAdmin` middleware
  - Role-aware data filtering via `getUserIdForQuery` helper (returns null for admin, userId for salesperson)
  - Per-user data isolation - each salesperson sees only their own contacts, deals, tasks, and activities
- **Authorization**: All API endpoints require authentication and automatically filter data by authenticated user role
- **Environment Variables Required**:
  - `SESSION_SECRET`: Secret key for session encryption (auto-provided by Replit)
  - `REPLIT_DOMAINS`: Comma-separated list of deployment domains (auto-provided)
  - `DATABASE_URL`: PostgreSQL connection string (auto-provided)
  - `SENDGRID_API_KEY`: SendGrid API key for email sequences (optional, user-provided)

### Development and Build Process
- **Type Safety**: Comprehensive TypeScript coverage across client, server, and shared code
- **Code Quality**: Consistent coding standards with shared utilities and type definitions
- **Development Experience**: Hot reloading, error overlays, and development banners via Replit plugins
- **Build Process**: Separate client (Vite) and server (esbuild) build processes for optimized production deployment

### Styling and Design System
- **CSS Framework**: Tailwind CSS with custom design tokens and CSS variables
- **Theme System**: Light/dark mode support with semantic color variables
- **Component Library**: Modular UI components with consistent spacing, typography, and interaction patterns
- **Responsive Design**: Mobile-first approach with responsive breakpoints

## External Dependencies

### Core Runtime Dependencies
- **@neondatabase/serverless**: Serverless PostgreSQL driver for Neon Database
- **drizzle-orm**: Type-safe SQL query builder and ORM
- **express**: Web application framework for Node.js
- **react** and **react-dom**: UI library for building user interfaces

### Development and Build Tools
- **vite**: Frontend build tool and development server
- **tsx**: TypeScript execution environment for Node.js
- **esbuild**: Fast JavaScript bundler for server-side code
- **drizzle-kit**: Database migration and introspection tool

### UI and Styling Libraries
- **@radix-ui**: Unstyled, accessible UI components
- **tailwindcss**: Utility-first CSS framework
- **lucide-react**: Icon library with React components
- **class-variance-authority**: Utility for managing component variants

### Form and Validation
- **react-hook-form**: Performant forms with easy validation
- **@hookform/resolvers**: Validation resolver for various schema libraries
- **zod**: TypeScript-first schema validation library
- **drizzle-zod**: Integration between Drizzle ORM and Zod validation

### State Management and Data Fetching
- **@tanstack/react-query**: Data fetching and caching library
- **wouter**: Minimalist routing for React applications

### Session and Security
- **connect-pg-simple**: PostgreSQL session store for Express sessions
- **express-session**: Session middleware for Express (implied dependency)

### Utility Libraries
- **clsx** and **tailwind-merge**: Utility functions for conditional CSS classes
- **date-fns**: Date utility library for formatting and manipulation
- **nanoid**: Secure URL-friendly unique string ID generator

### Email Integration
- **@sendgrid/mail**: SendGrid email service integration for automated sequences
- **Email Scheduler**: Background job processor for automated email sequences (runs hourly on Reserved VM)

### Development-Specific Dependencies
- **@replit/vite-plugin-runtime-error-modal**: Development error overlay
- **@replit/vite-plugin-cartographer**: Development mapping utility
- **@replit/vite-plugin-dev-banner**: Development environment indicator