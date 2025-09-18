# **CURRENT** Project Structure & Organization (WIP, subject to change)

## Root Directory Layout

```
├── .kiro/              # Kiro AI assistant configuration
├── .next/              # Next.js build output
├── convex/             # Convex backend functions and schema
├── public/             # Static assets (images, logos, icons)
├── src/                # Frontend source code
├── styles/             # Global styles and fonts
├── types/              # Global TypeScript type definitions
└── package.json        # Dependencies and scripts
```

## Hybrid Backend Architecture

### Next.js App Directory API Routes (`/src/app/api`)

- **`/auth`** - WorkOS authentication callbacks and session management
- **`/messages`** - Traditional REST endpoints for messaging features
- **`/webhooks`** - External service webhooks (GetStream, AI providers)
- **`/uploads`** - File upload and media processing endpoints

### Convex Backend Organization (`/convex`)

#### Core Backend Structure

- **`/auth`** - Authentication guards and permissions
- **`/users`** - User management queries and mutations
- **`/meetings`** - Meeting lifecycle and management
- **`/transcripts`** - Live transcription ingestion and queries
- **`/notes`** - Collaborative notes with operational transform
- **`/prompts`** - AI-powered conversation prompts
- **`/insights`** - Post-call insights and analytics
- **`/matching`** - Intelligent user matching system
- **`/embeddings`** - Vector embeddings and similarity search

### Schema and Types

- **`/schema`** - Convex schema definitions by domain
- **`/types`** - Centralized TypeScript types and validators
  - `/entities` - Core entity type definitions
  - `/validators` - Convex validators for all types
  - `/api` - API response types and pagination
  - `/domain` - Domain-specific complex types

### Infrastructure

- **`/lib`** - Shared utilities and configurations
- **`/system`** - System-level functions (rate limiting, maintenance)
- **`/test`** - Integration and performance tests
- **`schema.ts`** - Main schema export
- **`convex.config.ts`** - Convex configuration

## Frontend Organization (`/src`)

### Core Application Structure

- **`/app`** - Next.js App Router pages and layouts
  - `/api` - API routes and webhooks
  - `/app` - Main application pages
  - `/onboarding` - User onboarding flow
  - `/videocall` - Video call interface

- **`/components`** - React components organized by feature
  - `/ui` - Shadcn UI components
  - `/app` - Application-specific components
  - `/onboarding` - Onboarding flow components
  - `/video-meeting` - Video call components
  - `/queue` - Matching queue components

### Data & Business Logic

- **`/providers`** - React context providers (Convex, GetStream, WebRTC)
- **`/schemas`** - Zod validation schemas for forms
- **`/types`** - Frontend TypeScript type definitions
- **`/hooks`** - Custom React hooks
- **`/services`** - API service layers for Next.js endpoints

### Utilities & Configuration

- **`/lib`** - Shared utilities and configurations
  - `/shadcn` - UI component utilities
  - `/getstream` - GetStream API configuration (paid tier)
  - `/webrtc` - WebRTC utilities and signaling (free tier)
- **`/utils`** - Helper functions and utilities
- **`/styles`** - Style utilities and theme configuration

## Key Conventions

### File Naming

- Components use PascalCase: `UserProfile.tsx`
- Utilities use camelCase: `avatarUtils.ts`
- Pages follow Next.js conventions: `page.tsx`, `layout.tsx`
- Convex functions use camelCase: `getUserById.ts`

### Import Aliases

- `@/` maps to `./src/`
- `@/components` for UI components
- `@/lib` for utilities
- `@convex/` maps to `./convex/`

### Convex Schema

- Located in `convex/schema.ts`
- Domain-specific schemas in `convex/schema/`
- Centralized types in `convex/types/`
- Key collections: users, meetings, transcripts, notes, prompts, insights

### Component Organization

- Feature-based organization under `/components`
- Shared UI components in `/components/ui`
- Each feature has its own subdirectory
- Real-time components use Convex reactive queries
