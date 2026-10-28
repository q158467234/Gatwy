import { getSetting } from './settings.js';

/**
 * RDP graphics path, applied to new sessions:
 * - `legacy`: RemoteFX/bitmaps over the classic fast-path updates
 * - `egfx`: the graphics pipeline (MS-RDPEGFX) with the codecs the client decodes itself
 * - `h264`: the graphics pipeline with H.264 (AVC420) decoded by the browser (WebCodecs); falls
 *   back to `egfx` in browsers without it
 * - `h264-444`: as `h264`, also accepting AVC444 (full chroma, two pictures per update)
 */
export const RDP_GRAPHICS_MODES = ['legacy', 'egfx', 'h264', 'h264-444'] as const;
export type RdpGraphicsMode = (typeof RDP_GRAPHICS_MODES)[number];

export const RDP_GRAPHICS_MODE_KEY = 'rdp.graphics_mode';
/** Logs RDP throughput (server) and render timing (browser console) per session. */
export const RDP_METRICS_KEY = 'rdp.metrics_enabled';
/** Composites graphics pipeline sessions with WebGL2 in the browser (falls back to the CPU). */
export const RDP_GPU_COMPOSITING_KEY = 'rdp.gpu_compositing';
/** Remote desktop resolution: `sharp` (device pixels, scaled UI) or `saver` (CSS pixels). */
export const RDP_RESOLUTION_KEY = 'rdp.resolution';
const RDP_RESOLUTIONS = ['sharp', 'saver'];

const RDP_BOOLEAN_KEYS = [RDP_METRICS_KEY, RDP_GPU_COMPOSITING_KEY];

/** Returns an error message for an invalid RDP setting in a settings update, or null. */
export function validateRdpSettings(updates: Record<string, unknown>): string | null {
  if (RDP_GRAPHICS_MODE_KEY in updates && !RDP_GRAPHICS_MODES.includes(updates[RDP_GRAPHICS_MODE_KEY] as RdpGraphicsMode)) {
    return `${RDP_GRAPHICS_MODE_KEY} 必须是以下值之一：${RDP_GRAPHICS_MODES.join(', ')}`;
  }
  if (RDP_RESOLUTION_KEY in updates && !RDP_RESOLUTIONS.includes(updates[RDP_RESOLUTION_KEY] as string)) {
    return `${RDP_RESOLUTION_KEY} 必须是以下值之一：${RDP_RESOLUTIONS.join(', ')}`;
  }
  for (const key of RDP_BOOLEAN_KEYS) {
    if (key in updates && !['true', 'false'].includes(updates[key] as string)) {
      return `${key} 必须是 "true" 或 "false"`;
    }
  }
  return null;
}

export function rdpMetricsEnabled(): boolean {
  return getSetting(RDP_METRICS_KEY) === 'true';
}
