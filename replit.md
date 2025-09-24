# CRM Tracker

## Overview

CRM Tracker is a modern Customer Relationship Management system built with a full-stack TypeScript architecture. The application provides comprehensive contact management, deal tracking, task organization, and business analytics features. It's designed as a single-page application with a clean, responsive interface that helps businesses manage their customer relationships effectively.

The system follows a monorepo structure with shared TypeScript schemas and utilities, ensuring type safety across the entire application stack.

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
- **Contacts**: Customer information with personal and business details
- **Deals**: Sales opportunities with pipeline stages and value tracking
- **Tasks**: Action items with priorities, due dates, and completion status
- **Activities**: Audit trail for all system actions and interactions

### Authentication and Authorization
- **Session Management**: Connect-pg-simple for PostgreSQL-backed sessions
- **Security**: Express session middleware with secure cookie handling
- Currently implements basic session management foundation for future authentication features

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

### Development-Specific Dependencies
- **@replit/vite-plugin-runtime-error-modal**: Development error overlay
- **@replit/vite-plugin-cartographer**: Development mapping utility
- **@replit/vite-plugin-dev-banner**: Development environment indicator