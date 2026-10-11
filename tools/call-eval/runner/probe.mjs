/**
 * RTCPeerConnection / getUserMedia probe, injected per browser context
 * (CONTRACT.md "Runner contract"). All receipt evidence comes from the DOM
 * contract plus this probe — never app internals.
 *
 * probeInit is the raw init-script source (addInitScript accepts a string).
 * An optional RTCConfiguration override is delivered by a second init script
 * (probeConfigInit) that scenarios H-07 / H-15 enable: the wrapped constructor
 * then forces every peer connection onto the harness-controlled relay path
 * (local TURN behind the UDP shaper, iceTransportPolicy "relay").
 */

export const probeInit = String.raw`
(() => {
  if (window.__callProbe) return;
  const NativePC = window.RTCPeerConnection;
  const NativeGUM = navigator.mediaDevices
    ? navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
    : null;

  const probe = {
    connections: { live: 0, opened: 0 },
    tracks: { live: 0, created: 0 },
    getStatsCalls: 0,
    pcs: [],
  };
  window.__callProbe = probe;
  let seq = 0;

  function recount() {
    let live = 0;
    let opened = 0;
    for (const r of probe.pcs) {
      if (r.connectionState !== 'closed') live++;
      if (r.everConnected) opened++;
    }
    probe.connections.live = live;
    probe.connections.opened = opened;
  }

  function record(pc) {
    const rec = {
      id: ++seq,
      connectionState: pc.connectionState,
      iceConnectionState: pc.iceConnectionState,
      signalingState: pc.signalingState,
      // H-11 asserts on closed directly; the reviewed bug never recorded it,
      // so every record read as not-closed regardless of the real state.
      closed: pc.connectionState === 'closed',
      everConnected: false,
    };
    probe.pcs.push(rec);
    const sync = () => {
      rec.connectionState = pc.connectionState;
      rec.iceConnectionState = pc.iceConnectionState;
      rec.signalingState = pc.signalingState;
      rec.closed = pc.connectionState === 'closed';
      if (pc.connectionState === 'connected') rec.everConnected = true;
      recount();
    };
    pc.addEventListener('connectionstatechange', sync);
    pc.addEventListener('iceconnectionstatechange', sync);
    pc.addEventListener('signalingstatechange', sync);
    return rec;
  }

  class WrappedPC extends NativePC {
    constructor(cfg) {
      super(window.__probeRtcConfig || cfg);
      this.__probe = record(this);
      // Registry of the real pc instances (probe.pcs holds records only):
      // the runner reads receivers/getStats through these, which also keeps
      // getStatsCalls honest (H-11 counts deltas, not absolutes).
      (window.__wrappedPcs = window.__wrappedPcs || []).push(this);
    }
    getStats(...args) {
      probe.getStatsCalls++;
      return super.getStats(...args);
    }
  }
  window.RTCPeerConnection = WrappedPC;

  if (NativeGUM) {
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await NativeGUM(constraints);
      for (const track of stream.getTracks()) {
        probe.tracks.created++;
        probe.tracks.live++;
        track.addEventListener('ended', () => {
          probe.tracks.live--;
        });
      }
      return stream;
    };
  }
})();
`;

/** Second init script: installs the relay-only RTCConfiguration override. */
export const probeConfigInit = (config) => {
  window.__probeRtcConfig = config;
};

export function hasProbe() {
  return typeof window !== 'undefined' && !!window.__callProbe;
}
