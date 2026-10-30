// Remote desktop size for an RDP session's container, by the `rdp.resolution` setting
// (Settings → General → RDP):
// - `sharp`: one remote pixel per device pixel, with the remote UI scaled to the browser's device
//   pixel ratio, so text stays as large as on a 100% screen but is not blurred by upscaling;
// - `saver`: one remote pixel per CSS pixel (the browser upscales on high-DPI screens), fewer
//   pixels to encode, send and decode.

export type RdpResolution = 'sharp' | 'saver';

/** Display Control requires each desktop edge to be at least 200 pixels. */
const MIN_EDGE = 200;
/** RDP caps each desktop edge at 8192 pixels (MS-RDPEDISP 2.2.2.2.1). */
const MAX_EDGE = 8192;

/** Maps the `rdp.resolution` setting; anything else is `sharp`. */
export function rdpResolution(setting: string | undefined): RdpResolution {
  return setting === 'saver' ? 'saver' : 'sharp';
}

export interface RdpDesktopSize {
  width: number;
  height: number;
  /** Desktop scale factor in percent to request, or undefined to leave the server's. */
  scaleFactor: number | undefined;
}

/**
 * The desktop to request for a container of `cssWidth` by `cssHeight` CSS pixels on a screen with
 * `devicePixelRatio`. The width is even, as display control requires; a desktop that would exceed
 * the protocol limit is scaled down, keeping its aspect ratio and a matching scale factor.
 */
export function rdpDesktopSize(
  cssWidth: number,
  cssHeight: number,
  devicePixelRatio: number,
  resolution: RdpResolution,
): RdpDesktopSize {
  let ratio = resolution === 'sharp' && Number.isFinite(devicePixelRatio) ? Math.max(1, devicePixelRatio) : 1;
  ratio = Math.min(ratio, MAX_EDGE / Math.max(cssWidth, 1), MAX_EDGE / Math.max(cssHeight, 1));
  const width = Math.max(MIN_EDGE, Math.floor(Math.round(cssWidth * ratio) / 2) * 2);
  const height = Math.max(MIN_EDGE, Math.round(cssHeight * ratio));
  // Windows offers scales in 25% steps.
  const scaleFactor =
    resolution === 'sharp' ? Math.min(500, Math.max(100, Math.round((ratio * 100) / 25) * 25)) : undefined;
  return { width, height, scaleFactor };
}
