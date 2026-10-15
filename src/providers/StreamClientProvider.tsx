"use client";

import { ReactNode, useEffect, useState, useSyncExternalStore } from "react";
import { StreamVideoClient, StreamVideo } from "@stream-io/video-react-sdk";
import { tokenProvider } from "@/actions/stream.actions";
import Loader from "@/components/Loader";
import { useWorkOSAuth } from "@/hooks/useWorkOSAuth";

const API_KEY = process.env.NEXT_PUBLIC_STREAM_API_KEY;

function createClientStore() {
  let current: { userId: string; client: StreamVideoClient } | null = null;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => current,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    publish: (value: typeof current) => {
      current = value;
      listeners.forEach((listener) => listener());
    },
  };
}
const serverClientSnapshot = () => null;

const StreamVideoProvider = ({ children }: { children: ReactNode }) => {
  // Unconfigured queue pages do not need a WorkOS or Stream account.
  if (!API_KEY) return <>{children}</>;
  return <ConfiguredStreamVideoProvider>{children}</ConfiguredStreamVideoProvider>;
};

const ConfiguredStreamVideoProvider = ({ children }: { children: ReactNode }) => {
  const [clientStore] = useState(createClientStore);
  const connection = useSyncExternalStore(
    clientStore.subscribe,
    clientStore.getSnapshot,
    serverClientSnapshot,
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

    clientStore.publish({ userId: user.id, client });

    return () => {
      clientStore.publish(null);
      // best-effort cleanup
      if (client && typeof client.disconnectUser === "function") {
        client.disconnectUser().catch(() => {
          /* ignore cleanup errors */
        });
      }
    };
  }, [user, loading, clientStore]);

  // While client is initializing show loader
  if (!connection || loading || connection.userId !== user?.id)
    return <Loader />;

  return <StreamVideo client={connection.client}>{children}</StreamVideo>;
};

export default StreamVideoProvider;
