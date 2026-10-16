/**
 * WebSocket signaling adapter for the eval reference server
 * (tools/call-eval/reference/signaling-server.mjs). Wire format: the client
 * sends hello, signal, state, ping and bye; the server answers welcome,
 * peer-joined, peer-left, signal, remote-state, pong and error.
 *
 * Presence: the client pings every HEARTBEAT_MS and treats the connection as
 * lost when no pong arrives within HEARTBEAT_TIMEOUT_MS. A half-open socket
 * (laptop sleep, a dropped Wi-Fi link) otherwise looks open for minutes.
 */
import type {
  P2PSignal,
  SignalingAdapter,
  SignalingHandlers,
} from "./signaling";

const HEARTBEAT_MS = 2000;
const HEARTBEAT_TIMEOUT_MS = 6000;
/** Close codes the reference server uses for refusals that retrying cannot fix. */
const REJECTION_CODES = new Set([4004, 4005, 4006]);
/** The server closes an older socket with this code when the same identity says hello again. */
const REPLACED_CODE = 4007;

type Down =
  | { type: "welcome"; selfId: string; peers: string[] }
  | { type: "peer-joined"; participantId: string }
  | { type: "peer-left"; participantId: string; reason: string }
  | { type: "signal"; from: string; data: P2PSignal }
  | {
      type: "remote-state";
      from: string;
      micOn: boolean;
      cameraOn: boolean;
      screenSharing?: boolean;
    }
  | { type: "pong" }
  | { type: "error"; code: string; message: string };

export function websocketSignaling(url: string): SignalingAdapter {
  return {
    open(session, handlers: SignalingHandlers) {
      let ws: WebSocket | null = null;
      let closedByUs = false;
      let reported = false;
      let rejection: string | null = null;
      let lastPong = Date.now();
      let heartbeat: ReturnType<typeof setInterval> | null = null;

      const report = (reason: Parameters<SignalingHandlers["onClosed"]>[0]) => {
        if (reported || closedByUs) return;
        reported = true;
        stop();
        handlers.onClosed(reason);
      };
      const stop = () => {
        if (heartbeat) clearInterval(heartbeat);
        heartbeat = null;
        if (ws) {
          ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
          if (
            ws.readyState === WebSocket.OPEN ||
            ws.readyState === WebSocket.CONNECTING
          )
            ws.close();
        }
      };
      const send = (message: object) => {
        if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
      };

      void (async () => {
        let token: string;
        try {
          token = await session.identityToken();
        } catch (err) {
          report({
            kind: "lost",
            message:
              err instanceof Error ? err.message : "could not get a call token",
          });
          return;
        }
        if (closedByUs) return;
        ws = new WebSocket(url);
        ws.onopen = () => {
          send({ type: "hello", token, meetingId: session.meetingId });
          lastPong = Date.now();
          heartbeat = setInterval(() => {
            if (Date.now() - lastPong > HEARTBEAT_TIMEOUT_MS) {
              report({
                kind: "lost",
                message: "the signaling service stopped answering",
              });
              return;
            }
            send({ type: "ping" });
          }, HEARTBEAT_MS);
        };
        ws.onmessage = (event) => {
          let message: Down;
          try {
            message = JSON.parse(String(event.data)) as Down;
          } catch {
            return;
          }
          lastPong = Date.now();
          switch (message.type) {
            case "welcome":
              handlers.onWelcome(message.peers);
              break;
            case "peer-joined":
              handlers.onPeerJoined(message.participantId);
              break;
            case "peer-left":
              handlers.onPeerLeft(message.participantId, message.reason);
              break;
            case "signal":
              handlers.onSignal(message.from, message.data);
              break;
            case "remote-state":
              handlers.onRemoteState({
                participantId: message.from,
                micOn: message.micOn,
                cameraOn: message.cameraOn,
                screenSharing: message.screenSharing,
              });
              break;
            case "error":
              if (message.code === "auth") rejection = message.message;
              break;
            case "pong":
              break;
          }
        };
        ws.onclose = (event) => {
          if (event.code === REPLACED_CODE) {
            report({
              kind: "replaced",
              message: "This call is open in another window or tab.",
            });
            return;
          }
          if (rejection || REJECTION_CODES.has(event.code)) {
            report({
              kind: "rejected",
              message:
                rejection ?? (event.reason || "the call refused this identity"),
            });
          } else {
            report({
              kind: "lost",
              message: "lost the connection to the signaling service",
            });
          }
        };
        ws.onerror = () => {
          /* onclose follows and reports */
        };
      })();

      return {
        send: (to, signal) => send({ type: "signal", to, data: signal }),
        publishState: (state) =>
          send({
            type: "state",
            micOn: state.micOn,
            cameraOn: state.cameraOn,
            screenSharing: state.screenSharing ?? false,
          }),
        close: () => {
          closedByUs = true;
          send({ type: "bye" });
          stop();
        },
      };
    },
  };
}
