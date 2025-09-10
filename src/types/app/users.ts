// @/types/app.ts

// --- Re-export Enums for TS ---
// These types mirror the DB enums for type safety in frontend code
export type ConnectionStatus = "online" | "away" | "offline";
export type ConnectionType =
  | "b2b"
  | "collaboration"
  | "mentorship"
  | "investment"
  | "general";
export type InterestCategory = "academic" | "industry" | "skill" | "personal";

// --- UI Interest (Mirrors DB structure closely) ---
export interface UiInterest {
  // id: number; // Optional: if needed in UI
  name: string;
  category: InterestCategory;
  iconName?: string | null;
}

// --- Canonical UI User Type ---
// This structure is what components like UserCard will consume.
// It's derived from the result of our DB query (user + interests).
export interface UiUser {
  // Core IDs (string for UI state/keys)
  id: string; // Mapped from DB users.id (number)
  clerkId: string; // From DB users.clerkId

  // Essential Info
  email: string; // From DB users.email
  name: string; // From DB users.name
  avatarUrl: string | null; // From DB users.avatarUrl (or generated)

  // Profile Details (nullable to match DB)
  bio?: string | null;
  profession?: string | null; // Mapped from DB users.jobTitle
  company?: string | null;
  school?: string | null;
  experience?: number | null;
  linkedinUrl?: string | null;

  // Status & Connection Type (nullable to match DB)
  connectionStatus?: ConnectionStatus | null; // From DB users.connectionStatus
  connectionType?: ConnectionType | null; // From DB users.defaultConnectionType or specific connection

  // Interests (Mapped from relation)
  interests: UiInterest[];

  // Add other DB fields if needed by UI
  // field?: string | null;
}

// --- UI Message Type ---
export interface UiMessage {
  id: string; // DB messages.id (uuid string)
  connectionId: string; // DB messages.connectionId (uuid string)
  senderId: string; // Mapped from DB messages.senderId (number) to UiUser['id'] (string)
  content: string; // DB messages.content
  createdAt: Date; // DB messages.createdAt (Date object)
}
