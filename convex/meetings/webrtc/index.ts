/**
 * WebRTC Module - Barrel Export
 *
 * This module provides a clean interface to WebRTC functionality by re-exporting
 * from specialized modules. This maintains backward compatibility while organizing
 * code by concern.
 *
 * Requirements: 6.2, 6.3, 6.5
 * Compliance: steering/convex_rules.mdc - Proper module organization
 */

// Internal WebRTC signaling functions; the public call mesh API is ./mesh.ts.
export {
  storeConnectionMetrics,
  updateSessionStateInternal,
  cleanupOldWebRTCData,
} from "./signaling";

// Re-export video room management functions
export {
  initializeWebRTCRoom,
  storeRoomConfiguration,
  generateParticipantAccessToken,
  handleConnectionFailure,
  monitorConnectionQuality,
  getParticipantForAccess,
  getMeetingDoc,
  getVideoRoomConfigByMeeting,
} from "./rooms";
