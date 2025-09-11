# GetStream Video Integration Guide

This document provides a comprehensive guide for the GetStream Video integration in LinkedUp, covering setup, usage, and best practices for paid tier video calling features.

## Overview

The GetStream integration provides enterprise-grade video calling capabilities for paid tier users, including:

- **High-quality video/audio calling** with adaptive bitrate
- **Recording capabilities** with cloud storage
- **Real-time transcription** with accuracy optimization
- **Screen sharing** with audio support
- **Advanced layouts** (grid, spotlight, custom)
- **Participant management** with role-based permissions
- **Connection quality monitoring** and optimization
- **Webhook integration** for real-time event processing

## Architecture

### Backend Components

1. **Stream Integration Module** (`convex/meetings/stream.ts`)
   - Call creation and management
   - Token generation and authentication
   - Recording and transcription controls
   - Webhook event processing

2. **HTTP Router** (`convex/http.ts`)
   - Webhook endpoint for GetStream events
   - Signature verification for security
   - Asynchronous event processing

3. **Database Schema** (`convex/schema.ts`)
   - `streamCallConfigs` - Call configuration storage
   - `recordingSessions` - Recording session tracking
   - Enhanced meeting state management

### Frontend Components

1. **GetStream Client** (`src/lib/getstream-client.ts`)
   - Client initialization and configuration
   - Call management utilities
   - Error handling and retry logic

2. **Video Call Component** (`src/components/video-meeting/GetStreamVideoCall.tsx`)
   - Complete video calling interface
   - Recording controls and status
   - Participant management UI

## Setup Instructions

### 1. Environment Variables

Add the following environment variables to your `.env.local`:

```bash
# GetStream Configuration
STREAM_API_KEY=your_stream_api_key
STREAM_SECRET=your_stream_secret
NEXT_PUBLIC_STREAM_API_KEY=your_stream_api_key

# Webhook Configuration
STREAM_WEBHOOK_SECRET=your_webhook_secret
```

### 2. GetStream Dashboard Configuration

1. **Create a GetStream Account**
   - Sign up at [getstream.io](https://getstream.io)
   - Create a new Video & Audio application

2. **Configure Webhook Endpoints**

   ```
   Webhook URL: https://your-domain.com/webhooks/getstream
   Events: call.session_started, call.session_ended, call.recording_ready, call.transcription_ready
   ```

3. **Set Recording Storage** (Optional)
   - Configure S3 or other cloud storage for recordings
   - Set up transcription services if needed

### 3. Dependencies

The required dependencies are already included in `package.json`:

```json
{
  "@stream-io/video-react-sdk": "^1.21.0",
  "@stream-io/node-sdk": "^0.6.6"
}
```

## Usage Examples

### Basic Video Call

```tsx
import { GetStreamVideoCall } from "@/components/video-meeting/GetStreamVideoCall";
import { Id } from "../convex/_generated/dataModel";

function MeetingPage({ meetingId }: { meetingId: Id<"meetings"> }) {
  return (
    <div className="h-screen">
      <GetStreamVideoCall
        meetingId={meetingId}
        onLeave={() => router.push("/dashboard")}
      />
    </div>
  );
}
```

### Custom Call Manager

```tsx
import { useGetStreamCall } from "@/lib/getstream-client";
import { useConvex } from "convex/react";

function CustomVideoInterface({ meetingId }: { meetingId: Id<"meetings"> }) {
  const convex = useConvex();
  const { callManager, join, leave, startRecording } = useGetStreamCall(
    convex,
    meetingId,
  );

  useEffect(() => {
    // Set up event listeners
    callManager.on("callJoined", (call) => {
      console.log("Joined call:", call.id);
    });

    callManager.on("recordingStarted", (recording) => {
      console.log("Recording started:", recording.recordingId);
    });

    return () => {
      // Cleanup listeners
    };
  }, [callManager]);

  return (
    <div>
      <button onClick={join}>Join Call</button>
      <button onClick={() => startRecording({ quality: "1080p" })}>
        Start Recording
      </button>
    </div>
  );
}
```

## API Reference

### Backend Functions

#### `createStreamRoom`

Creates a GetStream call for a meeting.

```typescript
await ctx.runAction(internal.meetings.stream.createStreamRoom, {
  meetingId: "meeting_id",
  organizerId: "user_id",
  title: "Meeting Title",
  recordingEnabled: true,
  transcriptionEnabled: true,
});
```

#### `generateParticipantTokenPublic`

Generates authentication token for participants.

```typescript
const tokenResponse = await convex.action(
  api.meetings.stream.generateParticipantTokenPublic,
  { meetingId: "meeting_id" },
);
```

#### `startRecording`

Starts recording for a call (host only).

```typescript
await convex.action(api.meetings.stream.startRecording, {
  meetingId: "meeting_id",
  externalStorage: "s3-bucket-name", // optional
});
```

### Frontend Utilities

#### `createStreamClient`

Initializes GetStream client with configuration.

```typescript
import { createStreamClient } from "@/lib/getstream-client";

const client = createStreamClient({
  apiKey: process.env.NEXT_PUBLIC_STREAM_API_KEY!,
  user: { id: "user_id", name: "User Name" },
  token: "jwt_token",
  tokenProvider: async () => await refreshToken(),
});
```

#### `joinCall`

Joins a GetStream call with retry logic.

```typescript
import { joinCall } from "@/lib/getstream-client";

const result = await joinCall(call, {
  create: false,
  data: {
    members: [{ user_id: "user_id", role: "admin" }],
  },
});
```

## Webhook Events

The integration handles the following GetStream webhook events:

### Call Lifecycle

- `call.session_started` - First participant joins
- `call.session_ended` - Last participant leaves
- `call.session_participant_joined` - Participant joins
- `call.session_participant_left` - Participant leaves

### Recording Events

- `call.recording_started` - Recording begins
- `call.recording_stopped` - Recording ends
- `call.recording_ready` - Recording processed and available

### Transcription Events

- `call.transcription_started` - Transcription begins
- `call.transcription_stopped` - Transcription ends
- `call.transcription_ready` - Transcript chunk available

## Error Handling

### Common Error Scenarios

1. **Authentication Failures**

   ```typescript
   // Token expired or invalid
   if (error.message.includes("token")) {
     await refreshToken();
     retry();
   }
   ```

2. **Network Issues**

   ```typescript
   // Connection problems
   if (error.message.includes("NetworkError")) {
     showNetworkErrorDialog();
   }
   ```

3. **Permission Denied**
   ```typescript
   // Insufficient permissions
   if (error.message.includes("PermissionDenied")) {
     showPermissionErrorDialog();
   }
   ```

### Retry Logic

The integration includes automatic retry logic for:

- Call joining (3 attempts with exponential backoff)
- Token refresh (automatic on expiry)
- Webhook processing (with circuit breaker)

## Performance Optimization

### Connection Quality Monitoring

```typescript
// Monitor connection quality
call.on("connection.changed", (event) => {
  const quality = event.connection_quality;
  adjustVideoQuality(quality);
});

// Get detailed statistics
const stats = await getCallStats(call);
console.log("Bitrate:", stats.bitrate);
console.log("Packet Loss:", stats.packetLoss);
```

### Adaptive Bitrate

```typescript
// Configure adaptive settings based on connection
const settings = {
  video: {
    target_resolution:
      connectionQuality === "poor"
        ? { width: 640, height: 480 }
        : { width: 1280, height: 720 },
    max_bitrate: connectionQuality === "poor" ? 500000 : 2000000,
  },
};
```

## Security Considerations

### Webhook Signature Verification

```typescript
// Verify webhook signatures in production
const crypto = require("crypto");
const expectedSignature = crypto
  .createHmac("sha256", process.env.STREAM_SECRET)
  .update(body)
  .digest("hex");

if (signature !== expectedSignature) {
  throw new Error("Invalid webhook signature");
}
```

### Token Security

- Tokens expire after 1 hour by default
- Automatic refresh on expiry
- Scoped to specific calls for security
- Role-based permissions (admin vs user)

## Troubleshooting

### Common Issues

1. **Call Not Found**
   - Ensure call was created before joining
   - Check call ID format and validity

2. **Recording Fails**
   - Verify user has host permissions
   - Check external storage configuration

3. **Webhook Not Received**
   - Verify webhook URL is accessible
   - Check signature verification
   - Review GetStream dashboard logs

### Debug Mode

Enable debug logging:

```typescript
// Client-side debugging
localStorage.setItem("stream-video-debug", "true");

// Server-side debugging
console.log("GetStream event:", JSON.stringify(webhookData, null, 2));
```

## Best Practices

### 1. Error Handling

- Always wrap GetStream calls in try-catch blocks
- Provide user-friendly error messages
- Implement retry logic for transient failures

### 2. Performance

- Monitor connection quality and adjust settings
- Use appropriate video resolutions for bandwidth
- Implement graceful degradation for poor connections

### 3. User Experience

- Show loading states during call operations
- Provide clear feedback for recording status
- Handle network interruptions gracefully

### 4. Security

- Verify webhook signatures in production
- Use short-lived tokens with automatic refresh
- Implement proper role-based access control

## Monitoring and Analytics

### Key Metrics to Track

1. **Call Quality**
   - Connection success rate
   - Average call duration
   - Participant drop-off rate

2. **Recording Usage**
   - Recording success rate
   - Storage usage and costs
   - Transcription accuracy

3. **Performance**
   - Call join latency
   - Video/audio quality scores
   - Bandwidth usage patterns

### Integration with Analytics

```typescript
// Track call events
await trackMeetingEvent(ctx, {
  meetingId,
  event: "getstream_call_started",
  userId,
  duration: callDuration,
  success: true,
  metadata: {
    participantCount,
    recordingEnabled,
    connectionQuality,
  },
});
```

## Support and Resources

- [GetStream Documentation](https://getstream.io/video/docs/)
- [React SDK Reference](https://getstream.io/video/docs/react/)
- [Webhook Events Guide](https://getstream.io/video/docs/api/webhooks/)
- [Best Practices Guide](https://getstream.io/video/docs/guides/best-practices/)

For additional support, contact the development team or refer to the GetStream support channels.
