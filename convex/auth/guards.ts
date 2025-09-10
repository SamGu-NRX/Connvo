import { v } from "convex/values";
import { Id } from "../_generated/dataModel";

export type AuthIdentity = {
  userId: string;
  workosUserId: string;
  orgId: string | null;
  orgRole: string | null;
  email: string | null;
  firstName?: string | null;
  lastName?: string | null;
};

export function requireIdentity(ctx: any): AuthIdentity {
  const identity = ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("Authentication required");
  }

  // Extract WorkOS-specific claims from JWT
  const claims = identity as any;

  return {
    userId: identity.subject,
    workosUserId: identity.subject, // WorkOS user ID
    orgId: claims.org_id ?? claims.organization_id ?? null,
    orgRole: claims.org_role ?? claims.role ?? null,
    email: claims.email ?? null,
    firstName: claims.first_name ?? claims.given_name ?? null,
    lastName: claims.last_name ?? claims.family_name ?? null,
  };
}

export async function assertMeetingAccess(
  ctx: any,
  meetingId: Id<"meetings">,
  requiredRole?: "host" | "participant",
) {
  const { workosUserId } = requireIdentity(ctx);

  // Find the user in our database
  const user = await ctx.db
    .query("users")
    .withIndex("by_workos_id", (q: any) => q.eq("workosUserId", workosUserId))
    .unique();

  if (!user) {
    throw new Error("User not found in database");
  }

  const mp = await ctx.db
    .query("meetingParticipants")
    .withIndex("by_meeting_and_user", (q: any) =>
      q.eq("meetingId", meetingId).eq("userId", user._id),
    )
    .unique();

  if (!mp) throw new Error("FORBIDDEN: Not a participant in this meeting");
  if (requiredRole && mp.role !== requiredRole) {
    throw new Error(
      `FORBIDDEN: Required role '${requiredRole}', but user has role '${mp.role}'`,
    );
  }

  return mp;
}

export async function assertOrganizationAccess(
  ctx: any,
  requiredOrgId?: string,
  requiredRole?: string,
) {
  const { orgId, orgRole } = requireIdentity(ctx);

  if (requiredOrgId && orgId !== requiredOrgId) {
    throw new Error(
      `FORBIDDEN: Required organization '${requiredOrgId}', but user is in '${orgId}'`,
    );
  }

  if (requiredRole && orgRole !== requiredRole) {
    throw new Error(
      `FORBIDDEN: Required organization role '${requiredRole}', but user has role '${orgRole}'`,
    );
  }

  return { orgId, orgRole };
}

export async function getUserFromAuth(ctx: any) {
  const { workosUserId } = requireIdentity(ctx);

  const user = await ctx.db
    .query("users")
    .withIndex("by_workos_id", (q: any) => q.eq("workosUserId", workosUserId))
    .unique();

  if (!user) {
    throw new Error(
      "User not found in database. Please ensure user is properly synced.",
    );
  }

  return user;
}
