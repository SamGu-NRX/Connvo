# **CURRENT** Technology Stack & Build System (WIP, subject to change)

## Frontend Stack

- **Framework**: Next.js 15+ with React 19
- **Styling**: Tailwind CSS with Shadcn UI components (New York style)
- **TypeScript**: Strict mode enabled
- **Icons**: Lucide React + Tabler Icons
- **Animations**: Framer Motion
- **State Management**: React Hook Form with Zod validation

## Backend & Database

- **Database**: Convex (reactive backend-as-a-service)
- **Schema**: Convex schema with TypeScript validators
- **Authentication**: WorkOS Auth Kit for enterprise-grade authentication
- **API Layer**: Next.js App Directory API routes for traditional REST endpoints
- **Real-time Communication**: Hybrid - GetStream Video (paid tier) + WebRTC/custom pipeline (free tier)
- **Real-time Data**: Convex reactive queries and WebSocket subscriptions

## Development Tools

- **Package Manager**: Bun (bun.lock present)
- **Linting**: ESLint with Next.js config
- **Formatting**: Prettier with Tailwind plugin
- **Git Hooks**: Husky for pre-commit hooks
- **Testing**: Vitest with convex-test for backend testing

## Common Commands

### Development

```bash
bun run dev          # Start development server
bun run build        # Build for production
bun run start        # Start production server
bun run lint         # Run ESLint
bun run test         # Run test suite
```

### Convex Operations

```bash
npx convex dev       # Start Convex development server
npx convex deploy    # Deploy to Convex
npx convex dashboard # Open Convex dashboard
npx convex import    # Import data
npx convex export    # Export data
```

## Environment Setup

- Copy `.env.example` to `.env.local` for local development
- Required environment variables include WorkOS, GetStream, and AI provider keys
- Convex deployment configured in `convex.json`

## Build Configuration

- Next.js config includes SVG handling with @svgr/webpack
- TypeScript strict mode enabled
- Convex functions use new function syntax with args and returns validators
