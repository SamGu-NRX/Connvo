/**
 * Collaborative Notes Module Index
 *
 * This module exports all collaborative notes functionality including
 * operational transform, real-time synchronization, and offline support.
 *
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5
 * Compliance: steering/convex_rules.mdc - Proper module organization
 */

// Export all operations and types
export * from "./operations";

// Export mutations
export {
  applyNoteOperation,
  batchApplyNoteOperations,
  composeConsecutiveOperations,
  rebaseNotesDocument,
  rollbackToSequence,
  cleanupOldNoteOperations,
} from "./mutations";

// Export queries (minimal for insights path)
export { getMeetingNotes } from "./queries";

// Export offline support
export {
  queueOfflineOperations,
  syncOfflineOperations,
  getOfflineQueueStatus,
  retryFailedOperations,
  clearSyncedOperations,
  createOfflineCheckpoint,
  restoreFromCheckpoint,
  cleanupOfflineData,
} from "./offline";

// Export types for client use
export type {
  Operation,
  OperationWithMetadata,
  DocumentState,
} from "./operations";
export type {
  QueuedOperation,
  SyncResult,
  QueuedOperation as OfflineQueuedOperation,
} from "./offline";
