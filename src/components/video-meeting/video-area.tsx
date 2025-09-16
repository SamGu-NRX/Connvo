"use client";

import { useEffect, useRef, useState } from "react";
import { ConnectionBadge } from "./connection-badge";
import type { User, SpeakingState, ConnectionState } from "@/types/meeting";
import { MicOff, VideoOff } from "lucide-react";

/**
 * Top-level VideoContainer component moved out of VideoArea to avoid remounts
 * (defining a component inside another causes a new type every render and forces remounts,
 *  which created the flicker). This component is stable and accepts all required props.
 */
type VideoContainerProps = {
  userId: string;
  isMain?: boolean;
  users: { [key: string]: User };
  speakingStates: SpeakingState;
  connectionStates: { [key: string]: ConnectionState };
  onVideoClick: (userId: string) => void;
  isMuted?: boolean;
  isVideoOff?: boolean;
};

function VideoContainerComp({
  userId,
  isMain = false,
  users,
  speakingStates,
  connectionStates,
  onVideoClick,
  isMuted = false,
  isVideoOff = false,
}: VideoContainerProps) {
  const user = users[userId];
  const isSpeaking = speakingStates[userId];
  const connection = connectionStates[userId] ?? {
    status: "offline",
    latency: 0,
  };
  const isLocal = userId === "you";
  const showVideoOff = isLocal ? isVideoOff : false;
  const displayName = user?.name ?? (isLocal ? "You" : "Unknown");

  // Use a ref for the stream to avoid stale-closure cleanup issues
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    let mounted = true;
    async function enableMedia() {
      if (!isLocal || showVideoOff) return;
      try {
        const win = window as any;
        let stream: MediaStream | undefined = win.__localMediaStream;
        if (!stream) {
          stream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: true,
          });
          // cache globally to avoid multiple prompts / duplicate streams
          win.__localMediaStream = stream;
          // attach a one-time cleanup on unload
          if (!win.__localMediaCleanupAttached) {
            win.__localMediaCleanupAttached = true;
            window.addEventListener("beforeunload", () => {
              try {
                win.__localMediaStream
                  ?.getTracks()
                  .forEach((t: MediaStreamTrack) => t.stop());
                win.__localMediaStream = undefined;
              } catch {}
            });
          }
        }
        if (!mounted) return;
        streamRef.current = stream;
        if (videoRef.current) {
          (videoRef.current as HTMLVideoElement).srcObject = stream;
        }
        // ensure audio tracks reflect initial mute state
        try {
          stream.getAudioTracks().forEach((t) => {
            t.enabled = !isMuted;
          });
        } catch {}
      } catch (e) {
        console.error("getUserMedia error", e);
      }
    }
    enableMedia();
    return () => {
      mounted = false;
      // detach local reference but do not stop the global stream here
      streamRef.current = null;
      if (videoRef.current) {
        try {
          (videoRef.current as HTMLVideoElement).srcObject = null;
        } catch {}
      }
    };
    // only depend on flags that should re-enable/disable the camera
  }, [isLocal, showVideoOff]);

  // Toggle audio tracks when mute state changes (use global stream if present)
  useEffect(() => {
    const win = typeof window !== "undefined" ? (window as any) : undefined;
    const stream = streamRef.current ?? win?.__localMediaStream;
    if (!stream) return;
    try {
      stream.getAudioTracks().forEach((t: MediaStreamTrack) => {
        t.enabled = !isMuted;
      });
    } catch (e) {
      // ignore
    }
  }, [isMuted]);

  return (
    <div
      className={`relative overflow-hidden rounded-xl ${isMain ? "h-full" : "h-full"} cursor-pointer shadow-lg transition-colors duration-300 ${
        isSpeaking ? "ring-2 ring-green-500" : ""
      }`}
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
            <div className="text-sm font-medium text-zinc-300">
              {isLocal ? "Your video is off" : displayName}
            </div>
          </div>
        ) : (
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
              <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-zinc-700 to-zinc-900">
                <div className="text-center">
                  <div className="mb-2 text-lg font-semibold text-zinc-100">
                    {displayName}
                  </div>
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
}

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
  // Using top-level VideoContainerComp to avoid remounts (stable component)

  if (activeVideo === null) {
    return (
      <div className="grid h-[calc(100%-64px)] grid-cols-2 gap-4">
        <VideoContainerComp
          userId="partner"
          users={users}
          speakingStates={speakingStates}
          connectionStates={connectionStates}
          onVideoClick={onVideoClick}
          isMuted={isMuted}
          isVideoOff={isVideoOff}
        />
        <VideoContainerComp
          userId="you"
          users={users}
          speakingStates={speakingStates}
          connectionStates={connectionStates}
          onVideoClick={onVideoClick}
          isMuted={isMuted}
          isVideoOff={isVideoOff}
        />
      </div>
    );
  }

  return (
    <div className="relative h-[calc(100%-64px)]">
      <VideoContainerComp
        userId={activeVideo!}
        isMain
        users={users}
        speakingStates={speakingStates}
        connectionStates={connectionStates}
        onVideoClick={onVideoClick}
        isMuted={isMuted}
        isVideoOff={isVideoOff}
      />
      <div className="absolute right-4 bottom-4 z-30 h-32 w-48 transition-transform duration-200 hover:scale-102">
        <VideoContainerComp
          userId={activeVideo === "partner" ? "you" : "partner"}
          users={users}
          speakingStates={speakingStates}
          connectionStates={connectionStates}
          onVideoClick={onVideoClick}
          isMuted={isMuted}
          isVideoOff={isVideoOff}
        />
      </div>
    </div>
  );
}
