// @/types/user.ts

// Define ConnectionType based on usage in Profile and UserCardTags
export type ConnectionType =
  | "b2b"
  | "collaboration"
  | "mentorship"
  | "investment";

// Presence status for online indicator
export type PresenceStatus = "online" | "away" | "offline";

// Connection quality for video meeting context
export type ConnectionQuality = "excellent" | "good" | "poor" | "offline";

// Define Interest based on usage in Profile and UserCardInterests
export interface Interest {
  type: "academic" | "industry" | "skill";
  name: string;
}

// Define MeetingStats based on usage in UserCardStats
export interface MeetingStats {
  totalMeetings: number;
  totalMinutes: number;
  averageRating: number; // Assuming rating is a number (e.g., 1-5)
}

// Central UserInfo type
export interface UserInfo {
  id: string;
  name: string;
  avatar: string | null; // URL or null
  bio: string;
  profession: string;
  company: string;
  school: string;
  experience: number; // Years
  sharedInterests: Interest[]; // Use the defined Interest type
  connectionType: ConnectionType; // Use the defined ConnectionType
  isBot?: boolean;
  // Presence and connection quality
  status?: PresenceStatus;
  connectionStatus?: ConnectionQuality;

  // Optional fields potentially used by UserCard or other components
  interests?: string[]; // General list of interests
  isSpeaking?: boolean; // For meeting context
  meetingStats?: MeetingStats; // Use the defined MeetingStats type
}
