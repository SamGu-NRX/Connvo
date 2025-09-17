"use client";

import { ReactNode, useEffect, useState } from "react";
import { StreamVideoClient, StreamVideo } from "@stream-io/video-react-sdk";
import { tokenProvider } from "@/actions/stream.actions";
import Loader from "@/components/Loader";
import { useWorkOSAuth } from "@/hooks/useWorkOSAuth";

const API_KEY = process.env.NEXT_PUBLIC_STREAM_API_KEY;

const StreamVideoProvider = ({ children }: { children: ReactNode }) => {
  const [videoClient, setVideoClient] = useState<StreamVideoClient | null>(
    null,
  );
  const { user, loading } = useWorkOSAuth();

  useEffect(() => {
    // If no API key, skip initialization (frontend-only simulation mode)
    if (!API_KEY) {
      console.warn(
        "Stream API key missing - skipping StreamVideo initialization (frontend-only mode).",
      );
      return;
    }

    if (loading || !user) return;

    const client = new StreamVideoClient({
      apiKey: API_KEY,
      user: {
        id: user.id,
        name:
          (user.firstName && user.lastName
            ? `${user.firstName} ${user.lastName}`
            : user.firstName || user.email || user.id) ?? user.id,
        image: user.profilePictureUrl,
      },
      tokenProvider,
    });

    setVideoClient(client);

    return () => {
      // best-effort cleanup
      try {
        // StreamVideoClient may have a disconnect/close method depending on SDK version
        // @ts-ignore
        if (client && typeof client.disconnect === "function")
          client.disconnect(); //disconnectUser?
      } catch {
        // ignore cleanup errors
      }
    };
  }, [user, loading]);

  // If API key is not provided, render children (skip Stream provider)
  if (!API_KEY) return <>{children}</>;

  // While client is initializing show loader
  if (!videoClient) return <Loader />;

  return <StreamVideo client={videoClient}>{children}</StreamVideo>;
};

export default StreamVideoProvider;
