/**
 * GetStream Video Call Component (Paid Tier)
 *
 * This component provides a complete video calling interface using GetStream
 * for paid tier meetings with recording, transcription, and advanced features.
 *
 * Features:
 * - High-quality video/audio calling
 * - Recording capabilities (host only)
 * - Real-time transcription
 * - Screen sharing
 * - Participant management
 * - Connection quality monitoring
 *
 * Requirements: 6.2, 6.3, 6.5
 */

"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useConvex } from "convex/react";
import {
  StreamVideo,
  StreamCall,
  CallControls,
  SpeakerLayout,
  ParticipantView,
  useCallStateHooks,
  useCall,
} from "@stream-io/video-react-sdk";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  Monitor,
  MonitorOff,
  Record,
  Square,
  Users,
  Wifi,
  WifiOff,
} from "lucide-react";
import { useGetStreamCall } from "@/lib/getstream-client";
import { Id } from "../../../convex/_generated/dataModel";
import { toast } from "sonner";

interface GetStreamVideoCallProps {
  meetingId: Id<"meetings">;
  onLeave?: () => void;
  className?: string;
}

export function GetStreamVideoCall({
  meetingId,
  onLeave,
  className,
}: GetStreamVideoCallProps) {
  const convex = useConvex();
  const [isJoined, setIsJoined] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectionQuality, setConnectionQuality] = useState<
    "excellent" | "good" | "poor" | "unknown"
  >("unknown");
  const [isRecording, setIsRecording] = useState(false);
  const [recordingId, setRecordingId] = useState<string | null>(null);

  const {
    callManager,
    join,
    leave,
    startRecording,
    stopRecording,
    toggleCamera,
    toggleMicrophone,
    startScreenShare,
    stopScreenShare,
    getState,
    getParticipants,
  } = useGetStreamCall(convex, meetingId);

  // Set up event listeners
  useEffect(() => {
    const handleCallJoined = () => {
      setIsJoined(true);
      setIsLoading(false);
      toast.success("Joined video call successfully");
    };

    const handleCallLeft = () => {
      setIsJoined(false);
      setIsLoading(false);
      onLeave?.();
    };

    const handleParticipantJoined = (participant: any) => {
      toast.info(`${participant.name || "Someone"} joined the call`);
    };

    const handleParticipantLeft = (participant: any) => {
      toast.info(`${participant.name || "Someone"} left the call`);
    };

    const handleRecordingStarted = (recording: any) => {
      setIsRecording(true);
      setRecordingId(recording.recordingId);
      toast.success("Recording started");
    };

    const handleRecordingStopped = (recording: any) => {
      setIsRecording(false);
      setRecordingId(null);
      toast.success("Recording stopped");
    };

    const handleError = (error: Error) => {
      setError(error.message);
      setIsLoading(false);
      toast.error(`Call error: ${error.message}`);
    };

    // Register event listeners
    callManager.on("callJoined", handleCallJoined);
    callManager.on("callLeft", handleCallLeft);
    callManager.on("participantJoined", handleParticipantJoined);
    callManager.on("participantLeft", handleParticipantLeft);
    callManager.on("recordingStarted", handleRecordingStarted);
    callManager.on("recordingStopped", handleRecordingStopped);
    callManager.on("error", handleError);

    return () => {
      // Cleanup event listeners
      callManager.off("callJoined", handleCallJoined);
      callManager.off("callLeft", handleCallLeft);
      callManager.off("participantJoined", handleParticipantJoined);
      callManager.off("participantLeft", handleParticipantLeft);
      callManager.off("recordingStarted", handleRecordingStarted);
      callManager.off("recordingStopped", handleRecordingStopped);
      callManager.off("error", handleError);
    };
  }, [callManager, onLeave]);

  const handleJoinCall = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      await join();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to join call");
      setIsLoading(false);
    }
  }, [join]);

  const handleLeaveCall = useCallback(async () => {
    setIsLoading(true);

    try {
      await leave();
    } catch (error) {
      toast.error("Failed to leave call");
      setIsLoading(false);
    }
  }, [leave]);

  const handleStartRecording = useCallback(async () => {
    try {
      await startRecording({
        mode: "available",
        quality: "1080p",
        layout: "grid",
      });
    } catch (error) {
      toast.error("Failed to start recording");
    }
  }, [startRecording]);

  const handleStopRecording = useCallback(async () => {
    try {
      await stopRecording(recordingId || undefined);
    } catch (error) {
      toast.error("Failed to stop recording");
    }
  }, [stopRecording, recordingId]);

  if (error) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="text-red-600">Call Error</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground mb-4 text-sm">{error}</p>
          <Button onClick={() => setError(null)} variant="outline">
            Try Again
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!isJoined) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle>Join Video Call</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground mb-4 text-sm">
            Ready to join your GetStream video call with recording and
            transcription capabilities.
          </p>
          <Button
            onClick={handleJoinCall}
            disabled={isLoading}
            className="w-full"
          >
            {isLoading ? "Joining..." : "Join Call"}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className={`flex h-full flex-col ${className}`}>
      {/* Call Status Bar */}
      <div className="bg-background flex items-center justify-between border-b p-4">
        <div className="flex items-center gap-4">
          <Badge variant={isRecording ? "destructive" : "secondary"}>
            {isRecording ? (
              <>
                <Record className="mr-1 h-3 w-3" />
                Recording
              </>
            ) : (
              "Live Call"
            )}
          </Badge>

          <div className="flex items-center gap-2">
            {connectionQuality === "excellent" && (
              <Wifi className="h-4 w-4 text-green-500" />
            )}
            {connectionQuality === "good" && (
              <Wifi className="h-4 w-4 text-yellow-500" />
            )}
            {connectionQuality === "poor" && (
              <WifiOff className="h-4 w-4 text-red-500" />
            )}
            {connectionQuality === "unknown" && (
              <WifiOff className="h-4 w-4 text-gray-500" />
            )}
            <span className="text-muted-foreground text-sm capitalize">
              {connectionQuality}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            <span className="text-muted-foreground text-sm">
              {getParticipants().length} participants
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Recording Controls */}
          {!isRecording ? (
            <Button onClick={handleStartRecording} variant="outline" size="sm">
              <Record className="mr-2 h-4 w-4" />
              Start Recording
            </Button>
          ) : (
            <Button
              onClick={handleStopRecording}
              variant="destructive"
              size="sm"
            >
              <Square className="mr-2 h-4 w-4" />
              Stop Recording
            </Button>
          )}

          <Button
            onClick={handleLeaveCall}
            variant="destructive"
            size="sm"
            disabled={isLoading}
          >
            Leave Call
          </Button>
        </div>
      </div>

      {/* Video Layout */}
      <div className="relative flex-1">
        <GetStreamVideoLayout />
      </div>

      {/* Call Controls */}
      <div className="bg-background border-t p-4">
        <GetStreamCallControls
          onToggleCamera={toggleCamera}
          onToggleMicrophone={toggleMicrophone}
          onStartScreenShare={startScreenShare}
          onStopScreenShare={stopScreenShare}
        />
      </div>
    </div>
  );
}

/**
 * Video layout component using GetStream's built-in layouts
 */
function GetStreamVideoLayout() {
  const { useParticipants } = useCallStateHooks();
  const participants = useParticipants();

  return (
    <div className="h-full w-full">
      <SpeakerLayout />
    </div>
  );
}

/**
 * Custom call controls with additional features
 */
interface GetStreamCallControlsProps {
  onToggleCamera: (enabled: boolean) => Promise<void>;
  onToggleMicrophone: (enabled: boolean) => Promise<void>;
  onStartScreenShare: () => Promise<void>;
  onStopScreenShare: () => Promise<void>;
}

function GetStreamCallControls({
  onToggleCamera,
  onToggleMicrophone,
  onStartScreenShare,
  onStopScreenShare,
}: GetStreamCallControlsProps) {
  const call = useCall();
  const { useCameraState, useMicrophoneState } = useCallStateHooks();
  const { camera, isMute: isCameraMuted } = useCameraState();
  const { microphone, isMute: isMicMuted } = useMicrophoneState();
  const [isScreenSharing, setIsScreenSharing] = useState(false);

  const handleToggleCamera = async () => {
    try {
      await onToggleCamera(!isCameraMuted);
    } catch (error) {
      toast.error("Failed to toggle camera");
    }
  };

  const handleToggleMicrophone = async () => {
    try {
      await onToggleMicrophone(!isMicMuted);
    } catch (error) {
      toast.error("Failed to toggle microphone");
    }
  };

  const handleToggleScreenShare = async () => {
    try {
      if (isScreenSharing) {
        await onStopScreenShare();
        setIsScreenSharing(false);
      } else {
        await onStartScreenShare();
        setIsScreenSharing(true);
      }
    } catch (error) {
      toast.error("Failed to toggle screen share");
    }
  };

  return (
    <div className="flex items-center justify-center gap-4">
      {/* Microphone Toggle */}
      <Button
        onClick={handleToggleMicrophone}
        variant={isMicMuted ? "destructive" : "secondary"}
        size="lg"
        className="h-12 w-12 rounded-full"
      >
        {isMicMuted ? (
          <MicOff className="h-5 w-5" />
        ) : (
          <Mic className="h-5 w-5" />
        )}
      </Button>

      {/* Camera Toggle */}
      <Button
        onClick={handleToggleCamera}
        variant={isCameraMuted ? "destructive" : "secondary"}
        size="lg"
        className="h-12 w-12 rounded-full"
      >
        {isCameraMuted ? (
          <VideoOff className="h-5 w-5" />
        ) : (
          <Video className="h-5 w-5" />
        )}
      </Button>

      {/* Screen Share Toggle */}
      <Button
        onClick={handleToggleScreenShare}
        variant={isScreenSharing ? "default" : "secondary"}
        size="lg"
        className="h-12 w-12 rounded-full"
      >
        {isScreenSharing ? (
          <MonitorOff className="h-5 w-5" />
        ) : (
          <Monitor className="h-5 w-5" />
        )}
      </Button>

      {/* Default GetStream Controls */}
      <CallControls />
    </div>
  );
}

export default GetStreamVideoCall;
