# Collaborative Notes with Operational Transform

This module implements a comprehensive real-time collaborative notes system using Operational Transform (OT) for conflict resolution. It provides enterprise-grade features including offline support, conflict resolution, and comprehensive audit logging.

## Features

### ✅ Operational Transform Infrastructure

- **Complete OT Implementation**: Insert, delete, and retain operations with proper transformation rules
- **Conflict Resolution**: Automatic resolution of concurrent edits using OT algorithms
- **Operation Composition**: Optimization through operation merging and normalization
- **Comprehensive Validation**: Input validation and error handling for all operations

### ✅ Real-Time Synchronization

- **Reactive Queries**: Live updates using Convex reactive patterns
- **Sequence-Based Ordering**: Deterministic operation ordering with sequence numbers
- **Version Tracking**: Document versioning for optimistic updates and rollback
- **Cursor-Based Pagination**: Efficient streaming of operation history

### ✅ Offline Support

- **Operation Queuing**: Client-side operation buffering for offline scenarios
- **Sync-on-Reconnect**: Automatic synchronization when connection is restored
- **Conflict-Safe Merging**: Proper transformation of queued operations against server state
- **Checkpoint System**: Restore points for efficient synchronization

### ✅ Performance & Scalability

- **Batched Operations**: Efficient processing of multiple operations
- **Operation Coalescing**: Automatic merging of consecutive operations
- **Rate Limiting**: Protection against abuse and spam
- **Cleanup Jobs**: Automatic removal of old operations and data

### ✅ Audit & Monitoring

- **Comprehensive Logging**: All operations and conflicts are logged
- **Performance Metrics**: Real-time monitoring of operation throughput and latency
- **Conflict Analytics**: Detailed tracking of transformation events
- **Health Monitoring**: Queue status and synchronization health checks

## Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Client A      │    │   Client B      │    │   Client C      │
│                 │    │                 │    │                 │
│ ┌─────────────┐ │    │ ┌─────────────┐ │    │ ┌─────────────┐ │
│ │ Local Ops   │ │    │ │ Local Ops   │ │    │ │ Local Ops   │ │
│ │ Queue       │ │    │ │ Queue       │ │    │ │ Queue       │ │
│ └─────────────┘ │    │ └─────────────┘ │    │ └─────────────┘ │
└─────────┬───────┘    └─────────┬───────┘    └─────────┬───────┘
          │                      │                      │
          │                      │                      │
          └──────────────────────┼──────────────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │     Convex Backend      │
                    │                         │
                    │ ┌─────────────────────┐ │
                    │ │ Operational         │ │
                    │ │ Transform Engine    │ │
                    │ └─────────────────────┘ │
                    │                         │
                    │ ┌─────────────────────┐ │
                    │ │ meetingNotes        │ │
                    │ │ (Materialized)      │ │
                    │ └─────────────────────┘ │
                    │                         │
                    │ ┌─────────────────────┐ │
                    │ │ noteOps             │ │
                    │ │ (Operation Log)     │ │
                    │ └─────────────────────┘ │
                    │                         │
                    │ ┌─────────────────────┐ │
                    │ │ offlineOperationQueue│ │
                    │ │ (Offline Support)   │ │
                    │ └─────────────────────┘ │
                    └─────────────────────────┘
```

## Core Components

### 1. Operations (`operations.ts`)

- **Operation Types**: Insert, Delete, Retain operations
- **Transform Functions**: Core OT transformation logic
- **Validation**: Operation validation and normalization
- **Utilities**: Composition, inversion, and diff creation

### 2. Mutations (`mutations.ts`)

- **applyNoteOperation**: Apply single operation with conflict resolution
- **batchApplyNoteOperations**: Efficient batch processing
- **composeConsecutiveOperations**: Operation optimization
- **rebaseNotesDocument**: Document reconstruction from operations
- **rollbackToSequence**: Rollback to specific point in history

### 3. Queries (`queries.ts`)

- **subscribeMeetingNotes**: Real-time document content subscription
- **subscribeNoteOperations**: Live operation stream
- **getNotesCollaborationStats**: Analytics and statistics
- **getNotesSyncStatus**: Synchronization status for clients

### 4. Offline Support (`offline.ts`)

- **queueOfflineOperations**: Queue operations for offline scenarios
- **syncOfflineOperations**: Synchronize queued operations
- **getOfflineQueueStatus**: Monitor queue health
- **createOfflineCheckpoint**: Create restore points

## Usage Examples

### Basic Real-Time Editing

```typescript
import { useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";

function CollaborativeEditor({ meetingId }) {
  // Subscribe to document content
  const notes = useQuery(api.notes.queries.subscribeMeetingNotes, { meetingId });

  // Apply operations
  const applyOperation = useMutation(api.notes.mutations.applyNoteOperation);

  const handleTextChange = async (operation) => {
    try {
      const result = await applyOperation({
        meetingId,
        operation,
        clientSequence: getClientSequence(),
        expectedVersion: notes?.version,
      });

      if (result.conflicts.length > 0) {
        console.log("Conflicts resolved:", result.conflicts);
      }
    } catch (error) {
      console.error("Failed to apply operation:", error);
    }
  };

  return (
    <div>
      <textarea
        value={notes?.content || ""}
        onChange={(e) => {
          const operation = createOperationFromChange(e);
          handleTextChange(operation);
        }}
      />
    </div>
  );
}
```

### Offline Support

```typescript
import { useMutation } from "convex/react";
import { api } from "../convex/_generated/api";

function OfflineEditor({ meetingId, clientId }) {
  const queueOperations = useMutation(api.notes.offline.queueOfflineOperations);
  const syncOperations = useMutation(api.notes.offline.syncOfflineOperations);

  // Queue operations when offline
  const handleOfflineEdit = async (operations) => {
    await queueOperations({
      meetingId,
      operations,
      clientId,
    });
  };

  // Sync when back online
  const handleReconnect = async () => {
    const result = await syncOperations({
      meetingId,
      clientId,
    });

    console.log(`Synced ${result.synced} operations, ${result.conflicts} conflicts`);
  };

  return (
    <div>
      {/* Editor UI */}
    </div>
  );
}
```

### Operation Monitoring

```typescript
import { useQuery } from "convex/react";
import { api } from "../convex/_generated/api";

function CollaborationStats({ meetingId }) {
  const stats = useQuery(api.notes.queries.getNotesCollaborationStats, { meetingId });

  return (
    <div>
      <h3>Collaboration Statistics</h3>
      <p>Total Operations: {stats?.totalOperations}</p>
      <p>Active Authors: {stats?.totalAuthors}</p>
      <p>Document Length: {stats?.contentLength} characters</p>
      <p>Recent Activity: {stats?.recentActivity.operationsLastMinute} ops/min</p>

      <h4>Author Breakdown</h4>
      {stats?.authorStats.map(author => (
        <div key={author.authorId}>
          <p>Author: {author.authorId}</p>
          <p>Operations: {author.operationCount}</p>
          <p>Inserts: {author.operationTypes.insert}</p>
          <p>Deletes: {author.operationTypes.delete}</p>
        </div>
      ))}
    </div>
  );
}
```

## Data Model

### meetingNotes

```typescript
{
  meetingId: Id<"meetings">,
  content: string,           // Current document content
  version: number,           // Document version number
  lastRebasedAt: number,     // Last rebase timestamp
  updatedAt: number,         // Last update timestamp
}
```

### noteOps

````typescript
{
  meetingId: Id<"meetings">,
  sequence: number,          // Monotonic per-meeting sequence
  operationId: string,       // Idempotency token (dedupe on retries)
  authorId: Id<"users">,     // Server-derived from auth; ignore client input
  operation: {
    type: "insert" | "delete" | "retain",
    position: number,
    content?: string,        // For insert operations
    length?: number,         // For delete/retain operations
  },
  timestamp: number,         // Operation timestamp
  applied: boolean,          // True if applied post-transform; false only if tombstoned/rolled back
}

### offlineOperationQueue

```typescript
{
  meetingId: Id<"meetings">,
  clientId: string,          // Client identifier
  queueId: string,           // Queue batch identifier
  operation: Operation,      // The queued operation
  operationId: string,       // Unique operation ID
  authorId: Id<"users">,     // Operation author
  clientSequence: number,    // Client-side sequence
  timestamp: number,         // Original timestamp
  queuedAt: number,          // When queued
  attempts: number,          // Sync attempts
  status: "pending" | "syncing" | "synced" | "failed",
}
````

## Performance Considerations

### Optimization Strategies

1. **Operation Batching**: Process multiple operations in single transactions
2. **Coalescing**: Merge consecutive operations from same author
3. **Cleanup Jobs**: Remove old operations beyond retention period
4. **Rate Limiting**: Prevent abuse and maintain system stability

### Scalability Limits

- **Operations per Meeting**: ~100,000 operations (with cleanup)
- **Concurrent Editors**: 50+ simultaneous editors per meeting
- **Operation Rate**: 100+ operations per second per meeting
- **Offline Queue**: 1,000+ operations per client

### Monitoring Metrics

- Operation throughput (ops/second)
- Conflict resolution rate
- Synchronization latency
- Queue health status
- Document size growth

## Security & Access Control

### Permission Model

- **Meeting Participants**: Can read and write notes
- **Meeting Hosts**: Can rollback operations and manage document
- **System Admins**: Can access audit logs and performance metrics

### Audit Logging

All operations are logged with:

- Actor user ID and meeting ID
- Operation type and metadata
- Conflict resolution details
- Performance metrics
- Error conditions

### Data Retention

- **Raw Operations**: 90 days (configurable)
- **Materialized Documents**: 1 year
- **Audit Logs**: 1 year
- **Offline Queues**: 7 days

## Testing

The system includes comprehensive tests covering:

- ✅ Operation creation and validation
- ✅ Document application logic
- ✅ Operational transform algorithms
- ✅ Conflict resolution scenarios
- ✅ Batch processing and composition
- ✅ Edge cases and error conditions

Run tests with:

```bash
npm test convex/notes/operations.test.ts
```

## Migration & Deployment

### From Simple Text Storage

1. Create initial `meetingNotes` documents from existing text
2. Set version to 0 and lastRebasedAt to current time
3. No operation history needed for existing documents

### Rollback Strategy

1. Use `rollbackToSequence` to revert to specific point
2. Rebase document from clean state
3. Audit all rollback operations

### Performance Monitoring

1. Monitor operation throughput and latency
2. Track conflict resolution rates
3. Alert on queue health issues
4. Regular cleanup job execution

## Future Enhancements

### Planned Features

- **Rich Text Support**: Extend operations for formatting
- **Collaborative Cursors**: Real-time cursor position sharing
- **Presence Indicators**: Show active editors
- **Comment System**: Threaded comments on document ranges
- **Version History**: Visual diff and restore interface

### Advanced OT Features

- **Intention Preservation**: Better semantic conflict resolution
- **Undo/Redo**: Operation-based undo system
- **Branching**: Support for document forks and merges
- **Compression**: Operation log compression for long documents

## Troubleshooting

### Common Issues

**High Conflict Rate**

- Check for rapid concurrent editing
- Verify client-side debouncing
- Monitor operation frequency

**Sync Failures**

- Check network connectivity
- Verify authentication tokens
- Review rate limiting settings

**Performance Degradation**

- Monitor operation log size
- Check cleanup job execution
- Review indexing performance

**Data Inconsistency**

- Verify operation ordering
- Check transformation logic
- Review rebase operations

### Debug Tools

```typescript
// Get detailed sync status
const syncStatus = await getNotesSyncStatus({
  meetingId,
  clientSequence,
  clientVersion,
});

// Monitor performance
const metrics = await getNotesPerformanceMetrics({
  meetingId,
  timeRangeMs: 3600000, // 1 hour
});

// Check offline queue health
const queueStatus = await getOfflineQueueStatus({
  meetingId,
  clientId,
});
```

## Contributing

When contributing to the collaborative notes system:

1. **Follow OT Principles**: Ensure all operations maintain convergence properties
2. **Add Comprehensive Tests**: Cover all transformation scenarios
3. **Monitor Performance**: Profile new features for scalability impact
4. **Document Changes**: Update this README for new features
5. **Security Review**: Ensure proper access control for new endpoints

## References

- [Operational Transform Theory](https://en.wikipedia.org/wiki/Operational_transformation)
- [Convex Reactive Queries](https://docs.convex.dev/database/queries)
- [Real-time Collaboration Patterns](https://docs.convex.dev/production/best-practices)
