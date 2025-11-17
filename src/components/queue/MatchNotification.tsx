import React from "react";
import { motion } from "motion/react";
import UserCard from "@/components/mvp/user-card";
import { Button } from "@/components/ui/button";

interface MatchNotificationProps {
  matchData: {
    id: string;
    name: string;
    avatar: string | null;
    bio: string;
    profession: string;
    company: string;
    school: string;
    experience: number;
    sharedInterests: Array<{
      type: "academic" | "industry" | "skill";
      name: string;
    }>;
    connectionType: "b2b" | "collaboration" | "mentorship" | "investment";
    isBot?: boolean;
    // Additional fields specific to match notifications but not used in UserCard
    tag?: string;
    upvotes?: number;
  };
  onAccept: () => void;
  onDecline: () => void;
}

export default function MatchNotification({
  matchData,
  onAccept,
  onDecline,
}: MatchNotificationProps) {
  // Build UserInfo for UserCard
  const user = {
    id: matchData.id,
    name: matchData.name,
    avatar: matchData.avatar,
    bio: matchData.bio,
    profession: matchData.profession,
    company: matchData.company,
    school: matchData.school,
    experience: matchData.experience,
    sharedInterests: matchData.sharedInterests,
    connectionType: matchData.connectionType,
    isBot: matchData.isBot || false,
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 50 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -50 }}
      className="flex flex-col items-center gap-4 text-center"
    >
      <h2 className="text-xl font-semibold text-emerald-900 dark:text-emerald-200">
        Match Found!
      </h2>
      <UserCard user={user} showContactActions={false} />
      <div className="flex justify-center gap-2.5">
        <Button
          onClick={onDecline}
          variant="outline"
          className="w-32 rounded-sm border border-surface bg-white px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-900/80 transition-colors duration-200 hover:bg-emerald-50/60 dark:bg-emerald-950/40 dark:text-emerald-100/80 dark:hover:bg-emerald-900/60"
        >
          Decline
        </Button>
        <Button
          onClick={onAccept}
          className="w-32 rounded-sm bg-emerald-500/85 px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-white transition-colors duration-200 hover:bg-emerald-500"
        >
          Accept
        </Button>
      </div>
    </motion.div>
  );
}
