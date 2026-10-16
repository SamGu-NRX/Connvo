"use client";

/**
 * The availability step of onboarding (cv6-profile-availability-ui): goals,
 * timezone, weekly free time and chat cadence, saved through setChatPreferences
 * and replaceAvailability when the user continues.
 */

import { useState } from "react";
import { motion } from "motion/react";
import { useMutation } from "convex/react";
import { api } from "@convex/../convex/_generated/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import {
  AvailabilityEditor,
  defaultTimezone,
  type AvailabilityValue,
  type Intent,
} from "@/components/availability/AvailabilityEditor";
import { blocksToGrid, gridToBlocks } from "@/lib/availability/schedule";

export default function AvailabilityStep({
  onNext,
  onBack,
}: {
  onNext: () => void;
  onBack: () => void;
}) {
  const setChatPreferences = useMutation(api.profiles.availability.setChatPreferences);
  const replaceAvailability = useMutation(api.profiles.availability.replaceAvailability);
  const [saving, setSaving] = useState(false);
  const [value, setValue] = useState<AvailabilityValue>({
    intents: [] as Intent[],
    timezone: defaultTimezone(),
    chatsPerWeek: 1,
    grid: blocksToGrid([]),
  });

  const handleNext = async () => {
    setSaving(true);
    try {
      await setChatPreferences({
        intents: value.intents,
        timezone: value.timezone,
        chatsPerWeek: value.chatsPerWeek,
      });
      await replaceAvailability({ blocks: gridToBlocks(value.grid) });
      onNext();
    } catch (error) {
      console.error("Failed to save availability:", error);
      toast.error("Couldn't save your availability", {
        description: "Check your connection and try again.",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.3 }}
      className="relative z-10 flex flex-col gap-6"
    >
      <div>
        <h2 className="text-xl font-semibold">When can we find you?</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Tell us what you&apos;re looking for and when you&apos;re free — the
          matcher pairs you for coffee chats in your own timezone.
        </p>
      </div>

      <AvailabilityEditor value={value} onChange={setValue} disabled={saving} />

      <div className="flex justify-between">
        <Button variant="ghost" onClick={onBack} disabled={saving}>
          Back
        </Button>
        <Button onClick={handleNext} disabled={saving}>
          {saving ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving…
            </>
          ) : (
            "Continue"
          )}
        </Button>
      </div>
    </motion.div>
  );
}
