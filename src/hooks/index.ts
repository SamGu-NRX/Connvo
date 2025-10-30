/**
 * Hooks Index
 * 
 * Central export for all custom React hooks
 */

// Authentication
export { useWorkOSAuth } from "./useWorkOSAuth";
export type { WorkOSUser } from "./useWorkOSAuth";

// Pre-call features
export { usePreCallPrompts } from "./usePreCallPrompts";
export type {
  PreCallPrompt,
  UsePreCallPromptsResult,
} from "./usePreCallPrompts";

// In-call features
export { useInCallPrompts } from "./useInCallPrompts";
export type {
  InCallPrompt,
  InCallPromptsSubscription,
  UseInCallPromptsResult,
} from "./useInCallPrompts";

export { useTranscription } from "./useTranscription";
export type {
  TranscriptSegment,
  UseTranscriptionResult,
} from "./useTranscription";

export { useCollaborativeNotes, calculateOperation } from "./useCollaborativeNotes";
export type {
  MeetingNote,
  NoteOperation,
  UseCollaborativeNotesResult,
} from "./useCollaborativeNotes";

// Post-call features
export { usePostCallInsights } from "./usePostCallInsights";
export type {
  MeetingWithInsights,
  MeetingInsights,
  UsePostCallInsightsResult,
} from "./usePostCallInsights";

// Meeting lifecycle
export { useMeetingLifecycle } from "./useMeetingLifecycle";
export type {
  CreateMeetingParams,
  MeetingConnectionInfo,
  UseMeetingLifecycleResult,
} from "./useMeetingLifecycle";