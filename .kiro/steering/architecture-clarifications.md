---
description: Key architectural clarifications for LinkedUp project
globs: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx", "**/*.md"]
---

# LinkedUp Architecture Clarifications

## Hybrid Backend Architecture

LinkedUp uses a **hybrid backend architecture** combining:

1. **Next.js App Directory API Routes** (`/src/app/api/`)
   - Traditional REST endpoints for external integrations
   - Webhook handlers for third-party services
   - File upload and media processing
   - Authentication callbacks (WorkOS)

2. **Convex Reactive Backend** (`/convex/`)
   - Real-time data synchronization
   - Collaborative features (notes, transcripts)
   - Live queries and subscriptions
   - Type-safe functions with validators

## Tiered Video Calling System

LinkedUp implements a **tiered video calling approach**:

### Free Tier - WebRTC/Custom Pipeline

- **Technology**: Native WebRTC with custom signaling
- **Participants**: Up to 4 participants
- **Features**:
  - Basic video/audio calling
  - Screen sharing
  - Chat messaging
  - Live transcription (external service)
- **Infrastructure**:
  - STUN servers (Google)
  - Optional TURN servers for NAT traversal
  - Custom signaling via Convex

### Paid Tier - GetStream Video

- **Technology**: GetStream Video API
- **Participants**: Up to 100 participants
- **Features**:
  - Enterprise-grade video/audio
  - Cloud recording with storage
  - Advanced transcription
  - Multiple layouts (grid, spotlight)
  - Connection quality monitoring
  - Webhook integration
- **Infrastructure**:
  - GetStream's global CDN
  - Automatic quality adaptation
  - Built-in recording and storage

## Provider Selection Logic

The system automatically selects the appropriate video provider based on:

```typescript
// From convex/lib/videoProviders.ts
VideoProviderFactory.selectProvider(
  userPlan: "free" | "paid",
  participantCount: number,
  recordingRequired: boolean,
  meetingType?: "one-on-one" | "small-group" | "large-meeting" | "webinar"
)
```

**Selection Rules**:

- **GetStream (Paid)**: When user has paid plan AND (>4 participants OR recording required OR large meeting/webinar)
- **WebRTC (Free)**: All other cases (≤4 participants, no recording, free tier users)

## Data Flow Architecture

### Real-time Features (Convex)

- Live collaborative notes with operational transform
- Real-time transcript streaming
- Meeting state synchronization
- Participant presence tracking
- AI-powered prompts and insights

### Traditional API Features (Next.js)

- Authentication flows and callbacks
- File uploads and media processing
- External service webhooks
- Third-party integrations
- Batch processing endpoints

## Testing Strategy

### Convex Functions

- Use `convex-test` library for backend function testing
- Mock external services (WorkOS, AI providers)
- Test real-time subscriptions and reactive queries

### Next.js API Routes

- Use standard Jest/Vitest for API route testing
- Mock external HTTP calls
- Test webhook signature verification

### Video Providers

- Mock both GetStream and WebRTC providers
- Test provider selection logic
- Validate tier-specific feature availability

## Key Implementation Files

### Video Provider Abstraction

- `convex/lib/videoProviders.ts` - Provider interface and factory
- `convex/lib/getstreamServer.ts` - GetStream integration
- `convex/meetings/webrtc/` - WebRTC signaling and management

### API Integration

- `src/app/api/auth/` - WorkOS authentication callbacks
- `src/app/api/webhooks/` - External service webhooks
- `convex/http.ts` - Convex HTTP actions for webhooks

### Frontend Integration

- `src/lib/getstream-client.ts` - GetStream client setup
- `src/lib/webrtc/` - WebRTC client utilities
- `src/components/video-meeting/` - Video calling components

## Environment Configuration

### Required Environment Variables

```bash
# WorkOS Authentication
WORKOS_CLIENT_ID=
WORKOS_API_KEY=
WORKOS_COOKIE_PASSWORD=

# GetStream Video (Paid Tier)
STREAM_API_KEY=
STREAM_SECRET=
NEXT_PUBLIC_STREAM_API_KEY=

# WebRTC (Free Tier)
TURN_SERVER_URL=          # Optional TURN server
TURN_USERNAME=            # Optional TURN credentials
TURN_CREDENTIAL=          # Optional TURN credentials

# Convex
CONVEX_DEPLOY_KEY=
NEXT_PUBLIC_CONVEX_URL=

# AI Providers (Optional)
OPENAI_API_KEY=
```

## Development Workflow

### Adding New Features

1. **Real-time Features**: Implement in Convex with reactive queries
2. **External Integrations**: Use Next.js API routes
3. **Video Features**: Use provider abstraction layer
4. **Testing**: Use appropriate testing strategy for each layer

### Deployment Considerations

- **Convex Functions**: Deploy via `npx convex deploy`
- **Next.js App**: Standard Vercel/Next.js deployment
- **Environment Variables**: Configure per environment (local/staging/prod)
- **Video Providers**: Ensure proper API keys and webhook URLs

This hybrid architecture provides the best of both worlds: real-time reactivity where needed and traditional REST APIs for external integrations, with a flexible video calling system that scales from free to enterprise users.
