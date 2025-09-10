# **CURRENT** Technology Stack & Build System (WIP)

## Frontend Stack

- **Framework**: Next.js 15+ with React 19
- **Styling**: Tailwind CSS 4.0 with Shadcn UI components (New York style)
- **TypeScript**: Strict mode enabled
- **Icons**: Lucide React + Tabler Icons
- **Animations**: Framer Motion
- **State Management**: React Hook Form with Zod validation

## Backend & Database

- **Database**: PostgreSQL with Supabase
- **ORM**: Drizzle ORM with migrations in `/drizzle` folder
- **Authentication**: Clerk for user management
- **Real-time Communication**: Stream API for voice/video calls

## Development Tools

- **Package Manager**: Uses both npm and bun (bun.lock present)
- **Linting**: ESLint with Next.js config
- **Formatting**: Prettier with Tailwind plugin
- **Git Hooks**: Husky for pre-commit hooks

## Common Commands

### Development

```bash
npm run dev          # Start development server with Turbo
npm run build        # Build for production
npm run start        # Start production server
npm run lint         # Run ESLint
```

### Database Operations

```bash
npm run db:generate  # Generate Drizzle migrations
npm run db:push      # Push schema changes to database
npm run db:pull      # Pull schema from database
npm run db:studio    # Open Drizzle Studio
npm run db:seed      # Seed database
npm run db:reset     # Reset database
```

## Environment Setup

- Copy `.env.example` to `.env.local` for local development
- Required environment variables include Clerk, Supabase, and Stream API keys
- Database URL configured in `drizzle.config.ts`

## Build Configuration

- Next.js config includes SVG handling with @svgr/webpack
- Turbo mode enabled for faster builds
- TypeScript and ESLint errors ignored during builds (development setting)
