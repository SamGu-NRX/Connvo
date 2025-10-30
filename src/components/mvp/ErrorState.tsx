import React from "react";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ErrorStateProps {
  message: string;
  onRetry: () => void;
}

export default function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <div className="bg-background text-foreground flex min-h-screen flex-col items-center justify-center">
      <AlertCircle className="text-destructive mb-4 h-16 w-16" />
      <h2 className="mb-2 text-2xl font-bold">Oops! Something went wrong</h2>
      <p className="text-muted-foreground mb-4">{message}</p>
      <Button onClick={onRetry}>Try Again</Button>
    </div>
  );
}
