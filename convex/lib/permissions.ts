/**
 * Centralized permission mapping for realtime resources.
 * Ensures consistent, type-safe permission checks across modules.
 */

import { v } from "convex/values";

export type MeetingRole = "host" | "participant" | "observer";
export type PermissionRole = "host" | "participant";

export const permissionList = [
  "read",
  "write",
  "manage",
  "export",
  "invite",
  "remove",
] as const;

export type Permission = (typeof permissionList)[number];

export function normalizeRole(role: MeetingRole): PermissionRole {
  return role === "observer" ? "participant" : role;
}

export function permissionsForResource(
  resourceType: string,
  role: PermissionRole,
): Permission[] {
  switch (resourceType) {
    case "meetingNotes":
      return role === "host"
        ? ["read", "write", "manage", "export"]
        : ["read", "write"];
    case "transcripts":
      return role === "host" ? ["read", "export", "manage"] : ["read"];
    case "meetingParticipants":
    case "participants":
      return role === "host"
        ? ["read", "invite", "remove", "manage"]
        : ["read"];
    default:
      throw new Error("Unknown resource type");
  }
}
