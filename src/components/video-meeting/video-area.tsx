"use client";

import { ConnectionBadge } from "./connection-badge";
import type { User, SpeakingState, ConnectionState } from "@/types/meeting";

interface VideoAreaProps {
  activeVideo: string | null;
  users: { [key: string]: User };
  speakingStates: SpeakingState;
  connectionStates: { [key: string]: ConnectionState };
  onVideoClick: (userId: string) => void;
}

export function VideoArea({
  activeVideo,
  users,
  speakingStates,
  connectionStates,
  onVideoClick,
}: VideoAreaProps) {
  const VideoContainer = ({
    userId,
    isMain = false,
  }: {
    userId: string;
    isMain?: boolean;
  }) => {
    const user = users[userId];
    const isSpeaking = speakingStates[userId];
    const connection = connectionStates[userId];

    return (
      <div
        className={`relative overflow-hidden rounded-xl ${
          isMain ? "h-full" : "h-full"
        } cursor-pointer shadow-lg transition-colors duration-300 ${isSpeaking ? "ring-2 ring-green-500" : ""}`}
        onClick={() => onVideoClick(userId)}
      >
        <div
          className={`absolute inset-0 ${isMain ? `bg-zinc-800` : `bg-zinc-900`}`}
        >
          {/* Video placeholder */}
        </div>
        <div className="absolute bottom-4 left-4 flex items-center space-x-2 rounded-full bg-black/50 px-3 py-1.5 backdrop-blur-xs">
          <ConnectionBadge
            status={connection.status}
            latency={connection.latency}
            name={user.name}
          />
        </div>
      </div>
    );
  };

  if (activeVideo === null) {
    return (
      <div className="grid h-[calc(100%-64px)] grid-cols-2 gap-4">
        <VideoContainer userId="partner" />
        <VideoContainer userId="you" />
      </div>
    );
  }

  return (
    <div className="relative h-[calc(100%-64px)]">
      <VideoContainer userId={activeVideo} isMain />
      <div className="absolute right-4 bottom-4 z-30 h-32 w-48 transition-transform duration-200 hover:scale-102">
        <VideoContainer
          userId={activeVideo === "partner" ? "you" : "partner"}
        />
      </div>
    </div>
  );
}
