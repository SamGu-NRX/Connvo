# Intelligent Matching System

The Intelligent Matching System provides real-time, AI-powered user matching for Connvo's professional networking platform. It implements a scalable, multi-factor compatibility scoring engine with comprehensive analytics and feedback loops.

## Features

### 🎯 Real-Time Matching Queue

- **Availability Windows**: Users specify when they're available for meetings
- **Constraint-Based Matching**: Filter by interests, roles, and organizational preferences
- **Priority Ordering**: FIFO queue with retry mechanisms
- **Automatic Expiration**: Clean up expired queue entries

### 🧠 Multi-Factor Compatibility Scoring

- **Interest Overlap**: Shared professional interests and expertise areas
- **Experience Gap**: Optimal mentorship opportunities through complementary experience levels
- **Industry Match**: Same or related professional fields
- **Role Complementarity**: Mentor/mentee, founder/investor pairings
- **Vector Similarity**: Semantic profile matching using AI embeddings
- **Language Compatibility**: Shared communication languages
- **Organizational Constraints**: Same/different company preferences

### ⚡ Scalable Processing

- **Shard-Based Architecture**: Distributed processing for thousands of concurrent users
- **Optimistic Concurrency**: Race condition prevention for match creation
- **Batch Processing**: Efficient queue scanning and match generation
- **Performance Monitoring**: Real-time metrics and SLO tracking

### 📊 Analytics & Feedback

- **Outcome Tracking**: Accept/decline/completion rates
- **Feature Importance**: Data-driven weight optimization
- **User Statistics**: Personal matching success metrics
- **Global Analytics**: System-wide performance insights

## Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Queue API     │    │  Scoring Engine │    │   Analytics     │
│                 │    │                 │    │                 │
│ • Enter Queue   │    │ • Multi-Factor  │    │ • Feedback      │
│ • Cancel Entry  │    │ • Vector Search │    │ • Statistics    │
│ • Get Status    │    │ • Weights       │    │ • Optimization  │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         └───────────────────────┼───────────────────────┘
                                 │
                    ┌─────────────────┐
                    │ Matching Engine │
                    │                 │
                    │ • Shard Process │
                    │ • Match Creation│
                    │ • Concurrency   │
                    └─────────────────┘
```

## API Reference

### Queue Management

#### `enterMatchingQueue`

```typescript
await api.matching.queue.enterMatchingQueue({
  availableFrom: Date.now() + 60000, // 1 minute from now
  availableTo: Date.now() + 3600000, // 1 hour from now
  constraints: {
    interests: ["technology", "ai", "startups"],
    roles: ["mentor", "technical"],
    orgConstraints: "different_org", // optional
  },
});
```

#### `getQueueStatus`

```typescript
const status = await api.matching.queue.getQueueStatus({});
// Returns: { status, estimatedWaitTime, queuePosition, ... }
```

#### `cancelQueueEntry`

```typescript
await api.matching.queue.cancelQueueEntry({
  queueId: "optional_specific_id",
});
```

### Compatibility Scoring

#### `calculateCompatibilityScore`

```typescript
const result = await api.matching.scoring.calculateCompatibilityScore({
  user1Id: "user_123",
  user2Id: "user_456",
  user1Constraints: { interests: ["ai"], roles: ["mentor"] },
  user2Constraints: { interests: ["ml"], roles: ["mentee"] },
});

// Returns: { score: 0.85, features: {...}, explanation: [...] }
```

### Analytics & Feedback

#### `submitMatchFeedback`

```typescript
await api.matching.analytics.submitMatchFeedback({
  matchId: "match_123",
  outcome: "completed",
  feedback: {
    rating: 5,
    comments: "Great conversation!",
  },
});
```

#### `getMatchingStats`

```typescript
const stats = await api.matching.analytics.getMatchingStats({});
// Returns: { totalMatches, successRate, averageRating, topFeatures }
```

## Configuration

### Scoring Weights

Default compatibility scoring weights (can be optimized based on feedback):

```typescript
const DEFAULT_WEIGHTS = {
  interestOverlap: 0.25, // Shared professional interests
  experienceGap: 0.15, // Complementary experience levels
  industryMatch: 0.1, // Same/related fields
  timezoneCompatibility: 0.1, // Meeting time feasibility
  vectorSimilarity: 0.2, // AI semantic matching
  orgConstraintMatch: 0.05, // Company preferences
  languageOverlap: 0.1, // Communication compatibility
  roleComplementarity: 0.05, // Mentor/mentee dynamics
};
```

### Performance Targets

- Queue processing: < 5 minutes between cycles
- Compatibility scoring: < 500ms per pair
- Match creation: < 100ms with concurrency protection
- Analytics queries: < 200ms for user stats

## Automated Processing

The system runs automated jobs via Convex crons:

- **Matching Cycle**: Every 5 minutes, processes active queue entries
- **Queue Maintenance**: Hourly cleanup of expired entries
- **Weight Optimization**: Weekly analysis of feedback data (manual trigger)

## Monitoring & Alerts

### Key Metrics

- **Queue Depth**: Number of waiting users
- **Match Success Rate**: Completed/accepted ratio
- **Processing Time**: Cycle duration and bottlenecks
- **Score Distribution**: Quality of generated matches

### Alerts

- Queue processing failures
- Unusually low match rates
- Performance SLO breaches
- High user cancellation rates

## Testing

Run the comprehensive test suite:

```bash
npm test convex/matching/matching.test.ts
```

Tests cover:

- Queue management edge cases
- Compatibility scoring accuracy
- Match creation race conditions
- Analytics data integrity
- Performance under load

## Future Enhancements

### Planned Features

- **ML Model Integration**: Replace heuristic scoring with trained models
- **Real-Time Notifications**: WebSocket-based match alerts
- **Advanced Scheduling**: Calendar integration for meeting booking
- **Group Matching**: Multi-participant session matching
- **Preference Learning**: Adaptive weights per user

### Scalability Improvements

- **External Vector Store**: Offload similarity search to specialized services
- **Distributed Sharding**: Cross-region queue processing
- **Caching Layer**: Redis for hot user data
- **Stream Processing**: Real-time event-driven matching

## Compliance

This implementation follows:

- **steering/convex_rules.mdc**: Convex best practices and patterns
- **Requirements 12.1-12.5**: All intelligent matching specifications
- **Performance SLOs**: Sub-second response times and high availability
- **Security**: Proper authentication, authorization, and audit logging

## Support

For issues or questions about the matching system:

1. Check the test suite for usage examples
2. Review audit logs for debugging match failures
3. Monitor performance metrics for bottlenecks
4. Consult the analytics dashboard for system health
