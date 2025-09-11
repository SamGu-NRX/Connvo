/**
 * Legacy Meeting Mutations (Deprecated)
 *
 * This module contains legacy meeting mutations that have been moved to
 * the lifecycle.ts module. This file is kept for backward compatibility.
 *
 * Requirements: 2.5, 6.1, 6.4
 * Compliance: steering/convex_rules.mdc - Uses proper Convex mutation patterns
 */

// Re-export functions from lifecycle.ts for backward compatibility
export {
  createMeeting,
  addParticipant,
  removeParticipant,
  updateParticipantRole,
  startMeeting,
  endMeeting,
  joinMeeting,
  leaveMeeting,
  cancelMeeting,
} from "./lifecycle";

// All meeting mutations have been moved to lifecycle.ts for better organization
// This file exists only for backward compatibility
