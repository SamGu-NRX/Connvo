"use client";

/**
 * Block or report (cv6-profile-availability-ui): the small menu on a recap
 * participant chip. Renders for everyone except the signed-in viewer; the
 * viewer id comes from getCurrentUserProfile, which is only subscribed once
 * the Convex client is authenticated (the history components' rule).
 */

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import { MoreHorizontal, ShieldOff, Flag } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useHistoryAuth } from "./useHistoryAuth";

export function ParticipantActions({
  userId,
  displayName,
  meetingId,
}: {
  userId: Id<"users">;
  displayName: string | null;
  meetingId: Id<"meetings">;
}) {
  const auth = useHistoryAuth();
  const profile = useQuery(
    api.profiles.queries.getCurrentUserProfile,
    auth === "ready" ? {} : "skip",
  );
  const blockUser = useMutation(api.profiles.moderation.blockUser);
  const reportUser = useMutation(api.profiles.moderation.reportUser);

  const [blockOpen, setBlockOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const name = displayName ?? "this person";

  if (!profile || profile.userId === userId) return null;

  const handleBlock = async () => {
    setBusy(true);
    try {
      await blockUser({ blockedId: userId });
      toast.success(`${name} is blocked`, {
        description: "You won't be matched with them again.",
      });
      setBlockOpen(false);
    } catch (error) {
      console.error("Block failed:", error);
      toast.error("Couldn't block — try again.");
    } finally {
      setBusy(false);
    }
  };

  const handleReport = async () => {
    const trimmed = reason.trim();
    if (trimmed.length === 0) return;
    setBusy(true);
    try {
      await reportUser({ reportedId: userId, meetingId, reason: trimmed });
      toast.success("Report sent", {
        description: "Thank you — a moderator will take a look.",
      });
      setReportOpen(false);
      setReason("");
    } catch (error) {
      console.error("Report failed:", error);
      toast.error("Couldn't send the report — try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Block or report ${name}`}
            data-testid={`participant-actions-${userId}`}
            className="hover:bg-muted -mr-1 grid h-6 w-6 place-items-center rounded"
          >
            <MoreHorizontal className="text-muted-foreground h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setReportOpen(true)}>
            <Flag className="mr-2 h-4 w-4" /> Report {name}
          </DropdownMenuItem>
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onSelect={() => setBlockOpen(true)}
          >
            <ShieldOff className="mr-2 h-4 w-4" /> Block {name}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={blockOpen} onOpenChange={setBlockOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Block {name}?</AlertDialogTitle>
            <AlertDialogDescription>
              They will never be paired with you again, and you won&apos;t see
              each other in shared lists. This cannot be undone from here.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                handleBlock();
              }}
            >
              Block
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={reportOpen} onOpenChange={setReportOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Report {name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Tell a moderator what went wrong in this conversation. Reports are
              private.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="What happened?"
            rows={4}
            maxLength={500}
            className="text-sm"
          />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <Button
              disabled={busy || reason.trim().length === 0}
              onClick={handleReport}
            >
              Send report
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
