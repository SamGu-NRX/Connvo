"use client";

import { useAuth } from "@workos-inc/authkit-nextjs/components";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";

interface SignOutButtonProps {
  className?: string;
  children?: React.ReactNode;
  variant?:
    | "default"
    | "outline"
    | "ghost"
    | "link"
    | "destructive"
    | "secondary";
}

export function SignOutButton({
  className,
  children,
  variant = "outline",
}: SignOutButtonProps) {
  const { user } = useAuth();

  // Don't show sign-out button if not authenticated
  if (!user) {
    return null;
  }

  const handleSignOut = () => {
    // Redirect to WorkOS AuthKit sign-out
    window.location.href = "/api/auth/signout";
  };

  return (
    <Button onClick={handleSignOut} className={className} variant={variant}>
      <LogOut className="mr-2 h-4 w-4" />
      {children || "Sign Out"}
    </Button>
  );
}
