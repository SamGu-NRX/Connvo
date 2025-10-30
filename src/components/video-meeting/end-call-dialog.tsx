"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface EndCallDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  theme?: "light" | "dark";
}

export function EndCallDialog({
  open,
  onOpenChange,
  onConfirm,
  theme = "dark",
}: EndCallDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`sm:max-w-[400px] ${
        theme === "dark"
          ? "border-zinc-800 bg-zinc-900"
          : "border-zinc-200 bg-white"
      }`}>
        <DialogHeader>
          <DialogTitle className={theme === "dark" ? "text-zinc-200" : "text-zinc-800"}>End Call</DialogTitle>
          <DialogDescription className={theme === "dark" ? "text-zinc-400" : "text-zinc-600"}>
            Are you sure you want to end this call? This action cannot be
            undone.
          </DialogDescription>
        </DialogHeader>
        <div className="mt-4 flex justify-end space-x-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            End Call
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
