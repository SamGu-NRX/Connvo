export type CameraQuality = "data-saver" | "standard" | "hd";
export type CameraFacing = "user" | "environment";

export const CAMERA_QUALITY = {
  "data-saver": { width: 640, height: 360, frameRate: 15 },
  standard: { width: 1280, height: 720, frameRate: 24 },
  hd: { width: 1920, height: 1080, frameRate: 30 },
} satisfies Record<
  CameraQuality,
  { width: number; height: number; frameRate: number }
>;

/** Ideal constraints let older cameras choose their nearest supported mode. */
export function cameraConstraints({
  quality,
  facing,
  deviceId,
}: {
  quality: CameraQuality;
  facing: CameraFacing;
  deviceId: string | null;
}): MediaTrackConstraints {
  const preset = CAMERA_QUALITY[quality];
  return {
    width: { ideal: preset.width },
    height: { ideal: preset.height },
    frameRate: { ideal: preset.frameRate, max: preset.frameRate },
    ...(deviceId
      ? { deviceId: { exact: deviceId } }
      : { facingMode: { ideal: facing } }),
  };
}
