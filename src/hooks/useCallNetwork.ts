"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  NetworkQualityMonitor,
  type NetworkQualitySnapshot,
} from "@/lib/call/network-quality";

/** Each transport peer owns one monitor; closing a peer stops its sampling. */
export function useCallNetwork() {
  const monitors = useRef(
    new Map<
      string,
      { monitor: NetworkQualityMonitor; unsubscribe: () => void }
    >(),
  );
  const [peers, setPeers] = useState<NetworkQualitySnapshot[]>([]);
  const publish = useCallback(() => {
    setPeers(
      [...monitors.current.values()].map(({ monitor }) =>
        monitor.getSnapshot(),
      ),
    );
  }, []);
  const onPeerConnection = useCallback(
    (id: string, connection: RTCPeerConnection | null) => {
      const previous = monitors.current.get(id);
      previous?.unsubscribe();
      previous?.monitor.dispose();
      monitors.current.delete(id);
      if (connection) {
        const monitor = new NetworkQualityMonitor();
        const unsubscribe = monitor.subscribe(publish);
        monitors.current.set(id, { monitor, unsubscribe });
        monitor.attach(connection);
      }
      publish();
    },
    [publish],
  );
  useEffect(() => {
    const owned = monitors.current;
    return () => {
      for (const { monitor, unsubscribe } of owned.values()) {
        unsubscribe();
        monitor.dispose();
      }
      owned.clear();
    };
  }, []);
  return { peers, onPeerConnection };
}
