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
    // Redirect to the hosted WorkOS AuthKit sign-in flow
    window.location.href = "/auth/sign-in";
  };

  return (
    <Button onClick={handleSignIn} className={className} variant="default">
      <LogIn className="mr-2 h-4 w-4" />
      {children || "Sign In"}
    </Button>
  );
}
