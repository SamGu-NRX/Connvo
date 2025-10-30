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
      className="bg-background/80 flex items-center justify-center backdrop-blur-xs"
    >
      <div className="bg-card w-full max-w-md rounded-lg p-6 shadow-lg">
        <h2 className="mb-4 text-center text-2xl font-bold">Match Found!</h2>
        <UserCard user={user} />
        <div className="mt-6 flex justify-center space-x-4">
          <Button onClick={onDecline} variant="outline">
            Decline
          </Button>
          <Button onClick={onAccept}>Accept</Button>
        </div>
      </div>
    </motion.div>
  );
}
