"use client";

import { useWorkOSAuth } from "@/hooks/useWorkOSAuth";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { SignOutButton } from "./SignOutButton";
import { User, Building, Shield } from "lucide-react";

interface UserProfileProps {
  className?: string;
}

export function UserProfile({ className }: UserProfileProps) {
  const { loading, isAuthenticated, user, convexUser, organizationId, role } =
    useWorkOSAuth();

  if (loading) {
    return (
      <Card className={className}>
        <CardHeader>
          <div className="flex items-center space-x-4">
            <Skeleton className="h-12 w-12 rounded-full" />
            <div className="space-y-2">
              <Skeleton className="h-4 w-[200px]" />
              <Skeleton className="h-4 w-[150px]" />
            </div>
          </div>
        </CardHeader>
      </Card>
    );
  }

  if (!isAuthenticated || !user) {
    return null;
  }

  const displayName =
    user.firstName && user.lastName
      ? `${user.firstName} ${user.lastName}`
      : user.firstName || user.email;

  const initials =
    user.firstName && user.lastName
      ? `${user.firstName[0]}${user.lastName[0]}`
      : user.email[0].toUpperCase();

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center">
            <User className="mr-2 h-5 w-5" />
            Profile
          </span>
          <SignOutButton variant="ghost" />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center space-x-4">
          <Avatar className="h-12 w-12">
            <AvatarImage src={user.profilePictureUrl} alt={displayName} />
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
          <div className="space-y-1">
            <h3 className="font-semibold">{displayName}</h3>
            <p className="text-muted-foreground text-sm">{user.email}</p>
          </div>
        </div>

        {organizationId && (
          <div className="flex items-center space-x-2">
            <Building className="text-muted-foreground h-4 w-4" />
            <span className="text-sm">Organization: {organizationId}</span>
          </div>
        )}

        {role && (
          <div className="flex items-center space-x-2">
            <Shield className="text-muted-foreground h-4 w-4" />
            <Badge variant="secondary">{role}</Badge>
          </div>
        )}

        {convexUser && (
          <div className="text-muted-foreground text-xs">
            <p>Synced with database</p>
            <p>
              Last seen:{" "}
              {convexUser.lastSeenAt
                ? new Date(convexUser.lastSeenAt).toLocaleString()
                : "Never"}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
