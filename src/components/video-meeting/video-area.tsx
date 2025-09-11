"use client";

import { useEffect, useRef, useState } from "react";
import { ConnectionBadge } from "./connection-badge";
import type { User, SpeakingState, ConnectionState } from "@/types/meeting";
import { MicOff, VideoOff } from "lucide-react";

interface VideoAreaProps {
  activeVideo: string | null;
  users: { [key: string]: User };
  speakingStates: SpeakingState;
  connectionStates: { [key: string]: ConnectionState };
  onVideoClick: (userId: string) => void;
  isMuted?: boolean;
  isVideoOff?: boolean;
}

export function VideoArea({
  activeVideo,
  users,
  speakingStates,
  connectionStates,
  onVideoClick,
  isMuted = false,
  isVideoOff = false,
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
    const connection = connectionStates[userId] ?? { status: "offline", latency: 0 };
    const isLocal = userId === "you";
    const showVideoOff = isLocal ? isVideoOff : false;
    const displayName = user?.name ?? (isLocal ? "You" : "Unknown");

    // Local camera preview for the local user
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const [localStream, setLocalStream] = useState<MediaStream | null>(null);

    useEffect(() => {
      let mounted = true;
      async function enableCamera() {
        if (!isLocal || showVideoOff) return;
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
          if (!mounted) {
            stream.getTracks().forEach((t) => t.stop());
            return;
          }
          setLocalStream(stream);
        } catch (e) {
          console.error("getUserMedia error", e);
        }
      }
      enableCamera();
      return () => {
        mounted = false;
        if (localStream) {
          localStream.getTracks().forEach((t) => t.stop());
          setLocalStream(null);
        }
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isLocal, showVideoOff]);

    useEffect(() => {
      if (videoRef.current && localStream) {
        try {
          (videoRef.current as HTMLVideoElement).srcObject = localStream;
        } catch (e) {
          console.error(e);
        }
      }
    }, [localStream]);

    return (
      <div
        className={`relative overflow-hidden rounded-xl ${isMain ? "h-full" : "h-full"} cursor-pointer shadow-lg transition-colors duration-300 ${isSpeaking ? "ring-2 ring-green-500" : ""}`}
        onClick={() => onVideoClick(userId)}
      >
        <div
          className={`absolute inset-0 flex items-center justify-center ${isMain ? `bg-zinc-800` : `bg-zinc-900`} `}
        >
          {showVideoOff ? (
            <div className="flex flex-col items-center justify-center text-center">
              <div className="mb-2">
                <VideoOff className="h-12 w-12 text-zinc-400" />
              </div>
              <div className="text-sm font-medium text-zinc-300">{isLocal ? "Your video is off" : displayName}</div>
            </div>
          ) : (
            // Simulated video: show avatar or placeholder with name
            <div className="relative h-full w-full">
              {isLocal ? (
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="absolute inset-0 bg-gradient-to-br from-zinc-700 to-zinc-900 flex items-center justify-center">
                  <div className="text-center">
                    <div className="mb-2 text-lg font-semibold text-zinc-100">{displayName}</div>
                    <div className="text-xs text-zinc-400">Simulated video</div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Bottom left badge */}
        <div className="absolute bottom-4 left-4 flex items-center space-x-2 rounded-full bg-black/50 px-3 py-1.5 backdrop-blur-xs">
          <ConnectionBadge
            status={connection.status}
            latency={connection.latency}
            name={displayName}
          />
        </div>

        {/* Muted indicator for local user */}
        {isLocal && isMuted && (
          <div className="absolute top-3 right-3 rounded-full bg-red-600/90 p-2 text-white">
            <MicOff className="h-4 w-4" />
          </div>
        )}
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
