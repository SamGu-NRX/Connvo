"use client";

import { useAuth } from "@workos-inc/authkit-nextjs/components";
import { Button } from "@/components/ui/button";
import { LogIn } from "lucide-react";

interface SignInButtonProps {
  className?: string;
  children?: React.ReactNode;
}

export function SignInButton({ className, children }: SignInButtonProps) {
  const { user } = useAuth();

  // Don't show sign-in button if already authenticated
  if (user) {
    return null;
  }

  const handleSignIn = () => {
    // Redirect to WorkOS AuthKit sign-in
    window.location.href = "/api/auth/login";
  };

  return (
    <Button onClick={handleSignIn} className={className} variant="default">
      <LogIn className="mr-2 h-4 w-4" />
      {children || "Sign In"}
    </Button>
  );
}
