"use client";

import { useWorkOSAuth } from "@/hooks/useWorkOSAuth";
import { SignInButton } from "./SignInButton";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Shield, AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface AuthGuardProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  requireRole?: string;
  requireOrganization?: boolean;
}

export function AuthGuard({
  children,
  fallback,
  requireRole,
  requireOrganization = false,
}: AuthGuardProps) {
  const { loading, isAuthenticated, user, role, organizationId } =
    useWorkOSAuth();

  // Show loading state
  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <Card className="w-full max-w-md">
          <CardHeader>
            <div className="flex items-center space-x-2">
              <Skeleton className="h-6 w-6 rounded" />
              <Skeleton className="h-6 w-32" />
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-10 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  // Show sign-in if not authenticated
  if (!isAuthenticated || !user) {
    if (fallback) {
      return <>{fallback}</>;
    }

    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <Shield className="text-muted-foreground mx-auto mb-4 h-12 w-12" />
            <CardTitle>Authentication Required</CardTitle>
            <CardDescription>
              Please sign in to access this page
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SignInButton className="w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  // Check role requirement
  if (requireRole && role !== requireRole) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <AlertCircle className="text-destructive mx-auto mb-4 h-12 w-12" />
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>
              You don't have the required role ({requireRole}) to access this
              page
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Your current role: {role || "No role assigned"}
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Check organization requirement
  if (requireOrganization && !organizationId) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <AlertCircle className="text-destructive mx-auto mb-4 h-12 w-12" />
            <CardTitle>Organization Required</CardTitle>
            <CardDescription>
              You must be part of an organization to access this page
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Please contact your administrator to be added to an
                organization.
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      </div>
    );
  }

  // All checks passed, render children
  return <>{children}</>;
}
