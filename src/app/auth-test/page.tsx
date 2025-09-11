"use client";

import { AuthGuard } from "@/components/auth/AuthGuard";
import { UserProfile } from "@/components/auth/UserProfile";
import { SignInButton } from "@/components/auth/SignInButton";
import { useWorkOSAuth } from "@/hooks/useWorkOSAuth";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { CheckCircle, XCircle, RefreshCw } from "lucide-react";

export default function AuthTestPage() {
  const { loading, isAuthenticated, user, convexUser, organizationId, role } =
    useWorkOSAuth();
  const syncUser = useMutation(api.users.mutations.upsertUser);
  const updateActivity = useMutation(api.users.mutations.updateLastSeen);

  const handleSyncUser = async () => {
    try {
      if (!user) return;
      const displayName = [user.firstName, user.lastName]
        .filter(Boolean)
        .join(" ")
        .trim();
      await syncUser({
        workosUserId: user.id,
        email: user.email,
        displayName: displayName || undefined,
        orgId: organizationId,
        orgRole: role,
      });
      console.log("User synced successfully");
    } catch (error) {
      console.error("Failed to sync user:", error);
    }
  };

  const handleUpdateActivity = async () => {
    try {
      await updateActivity({});
      console.log("Activity updated successfully");
    } catch (error) {
      console.error("Failed to update activity:", error);
    }
  };

  return (
    <div className="container mx-auto space-y-6 py-8">
      <div className="space-y-2 text-center">
        <h1 className="text-3xl font-bold">Authentication Test Page</h1>
        <p className="text-muted-foreground">
          Test WorkOS authentication integration with Convex
        </p>
      </div>

      {/* Authentication Status */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center">
            {isAuthenticated ? (
              <CheckCircle className="mr-2 h-5 w-5 text-green-500" />
            ) : (
              <XCircle className="mr-2 h-5 w-5 text-red-500" />
            )}
            Authentication Status
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm font-medium">Loading:</p>
              <Badge variant={loading ? "default" : "secondary"}>
                {loading ? "Yes" : "No"}
              </Badge>
            </div>
            <div>
              <p className="text-sm font-medium">Authenticated:</p>
              <Badge variant={isAuthenticated ? "default" : "destructive"}>
                {isAuthenticated ? "Yes" : "No"}
              </Badge>
            </div>
          </div>

          {!isAuthenticated && (
            <div className="pt-4">
              <SignInButton />
            </div>
          )}
        </CardContent>
      </Card>

      {/* WorkOS User Data */}
      {user && (
        <Card>
          <CardHeader>
            <CardTitle>WorkOS User Data</CardTitle>
            <CardDescription>Information from WorkOS JWT</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="font-medium">User ID:</p>
                <p className="text-muted-foreground">{user.id}</p>
              </div>
              <div>
                <p className="font-medium">Email:</p>
                <p className="text-muted-foreground">{user.email}</p>
              </div>
              <div>
                <p className="font-medium">First Name:</p>
                <p className="text-muted-foreground">
                  {user.firstName || "N/A"}
                </p>
              </div>
              <div>
                <p className="font-medium">Last Name:</p>
                <p className="text-muted-foreground">
                  {user.lastName || "N/A"}
                </p>
              </div>
              <div>
                <p className="font-medium">Organization ID:</p>
                <p className="text-muted-foreground">
                  {organizationId || "N/A"}
                </p>
              </div>
              <div>
                <p className="font-medium">Role:</p>
                <p className="text-muted-foreground">{role || "N/A"}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Convex User Data */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            Convex User Data
            <div className="space-x-2">
              <Button onClick={handleSyncUser} size="sm" variant="outline">
                <RefreshCw className="mr-2 h-4 w-4" />
                Sync User
              </Button>
              <Button
                onClick={handleUpdateActivity}
                size="sm"
                variant="outline"
              >
                Update Activity
              </Button>
            </div>
          </CardTitle>
          <CardDescription>User data stored in Convex database</CardDescription>
        </CardHeader>
        <CardContent>
          {convexUser ? (
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="font-medium">Database ID:</p>
                <p className="text-muted-foreground">{convexUser._id}</p>
              </div>
              <div>
                <p className="font-medium">WorkOS ID:</p>
                <p className="text-muted-foreground">
                  {convexUser.workosUserId}
                </p>
              </div>
              <div>
                <p className="font-medium">Display Name:</p>
                <p className="text-muted-foreground">
                  {convexUser.displayName || "N/A"}
                </p>
              </div>
              <div>
                <p className="font-medium">Email:</p>
                <p className="text-muted-foreground">{convexUser.email}</p>
              </div>
              <div>
                <p className="font-medium">Organization:</p>
                <p className="text-muted-foreground">
                  {convexUser.orgId || "N/A"}
                </p>
              </div>
              <div>
                <p className="font-medium">Org Role:</p>
                <p className="text-muted-foreground">
                  {convexUser.orgRole || "N/A"}
                </p>
              </div>
              <div>
                <p className="font-medium">Active:</p>
                <Badge
                  variant={convexUser.isActive ? "default" : "destructive"}
                >
                  {convexUser.isActive ? "Yes" : "No"}
                </Badge>
              </div>
              <div>
                <p className="font-medium">Last Seen:</p>
                <p className="text-muted-foreground">
                  {convexUser.lastSeenAt
                    ? new Date(convexUser.lastSeenAt).toLocaleString()
                    : "Never"}
                </p>
              </div>
            </div>
          ) : (
            <div className="py-8 text-center">
              <p className="text-muted-foreground">
                {isAuthenticated
                  ? "User not synced to database yet. Click 'Sync User' to create."
                  : "Please sign in to view Convex user data."}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* User Profile Component */}
      <AuthGuard>
        <UserProfile />
      </AuthGuard>

      {/* Role-based Access Test */}
      <Card>
        <CardHeader>
          <CardTitle>Role-based Access Control Test</CardTitle>
          <CardDescription>
            Test different access control scenarios
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <AuthGuard requireRole="admin">
            <div className="rounded border border-green-200 bg-green-50 p-4">
              <p className="text-green-800">✅ You have admin access!</p>
            </div>
          </AuthGuard>

          <AuthGuard requireOrganization>
            <div className="rounded border border-blue-200 bg-blue-50 p-4">
              <p className="text-blue-800">
                ✅ You are part of an organization!
              </p>
            </div>
          </AuthGuard>

          <AuthGuard requireRole="super-admin">
            <div className="rounded border border-red-200 bg-red-50 p-4">
              <p className="text-red-800">
                ❌ This should not show (super-admin required)
              </p>
            </div>
          </AuthGuard>
        </CardContent>
      </Card>
    </div>
  );
}
