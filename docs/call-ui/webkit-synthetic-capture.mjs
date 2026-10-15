// Shared by the call check and its standalone reproduction.
export const syntheticCaptureInit = ({ id }) => {
  window.__captureDiagnostic = { stage: "audio context" };
  const devices = navigator.mediaDevices;
  window.__syntheticMediaDevices = devices;
  try {
    const audio = new AudioContext();
    const oscillator = audio.createOscillator();
    oscillator.frequency.value = id === "A" ? 440 : 660;
    const output = audio.createMediaStreamDestination();
    oscillator.connect(output);
    oscillator.start();
    document.addEventListener("click", () => void audio.resume());
    window.__captureDiagnostic.stage = "install override";
    const syntheticCapture = async (options) => {
      window.__captureDiagnostic.lastRequest = options;
      const tracks = [];
      if (options.audio) tracks.push(output.stream.getAudioTracks()[0].clone());
      if (options.video) {
        const canvas = document.createElement("canvas");
        canvas.width = 640;
        canvas.height = 360;
        const paint = canvas.getContext("2d");
        let frame = 0;
        const draw = () => {
          paint.fillStyle = id === "A" ? "#bc3434" : "#157b58";
          paint.fillRect(0, 0, 640, 360);
          paint.fillStyle = "white";
          paint.fillRect((frame++ * 4) % 640, 80, 30, 200);
        };
        draw();
        const track = canvas.captureStream(20).getVideoTracks()[0];
        const timer = setInterval(() => {
          if (track.readyState === "ended") clearInterval(timer);
          else draw();
        }, 50);
        tracks.push(track);
      }
      window.__captureDiagnostic.trackKinds = tracks.map((track) => track.kind);
      return new MediaStream(tracks);
    };
    // Stream's legacy Safari shim rewrites this method during module loading.
    // The fixture keeps its own synthetic source while recording those writes.
    Object.defineProperty(devices, "getUserMedia", {
      configurable: true,
      get: () => syntheticCapture,
      set: (replacement) => {
        window.__captureDiagnostic.adapterWrites =
          (window.__captureDiagnostic.adapterWrites ?? 0) + 1;
        window.__captureDiagnostic.replacement = replacement.toString();
      },
    });
    devices.enumerateDevices = async () => [
      {
        kind: "videoinput",
        deviceId: "synthetic-camera",
        label: "Synthetic WebKit camera",
        groupId: "test",
      },
      {
        kind: "audioinput",
        deviceId: "synthetic-mic",
        label: "Synthetic WebKit microphone",
        groupId: "test",
      },
    ];
    window.__captureDiagnostic.stage = "override installed";
  } catch (error) {
    window.__captureDiagnostic.error = {
      name: error.name,
      message: error.message,
    };
  }
};
