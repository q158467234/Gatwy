// Opt-in RDP render meter and prototype switches for the EGFX/WebCodecs prototype (docs/rdp-webcodecs-poc.md).
// Enable with `localStorage.setItem('gatwy.rdpMetrics', '1')`. Works on the JS side only —
// WebSocket arrivals and canvas `putImageData` calls — so RFX and H.264 paths are measured alike.

const STORAGE_KEY = 'gatwy.rdpMetrics';
const EGFX_STORAGE_KEY = 'gatwy.rdpEgfx';
const H264_STORAGE_KEY = 'gatwy.rdpH264';
/** A message with no draw within this window (keepalive, input echo) is not a pending update. */
const STALE_PENDING_MS = 1000;

function storageValue(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageFlag(key: string): boolean {
  return storageValue(key) === '1';
}

export function rdpMetricsEnabled(): boolean {
  return storageFlag(STORAGE_KEY);
}

export interface RdpGraphicsMode {
  /** Advertise the graphics pipeline (EGFX). */
  egfx: boolean;
  /** Decode its H.264 stream with WebCodecs; implies `egfx`. */
  h264: boolean;
}

/**
 * Picks the RDP graphics path. The server default (`GATWY_RDP_H264`) applies unless this browser
 * overrides it: `gatwy.rdpH264` = `1`/`0` turns H.264 on/off, `gatwy.rdpEgfx` = `1` enables the
 * graphics pipeline without H.264 and `0` turns both off.
 */
export function rdpGraphicsMode(serverH264Default: boolean, read: (key: string) => string | null = storageValue): RdpGraphicsMode {
  const egfxFlag = read(EGFX_STORAGE_KEY);
  const h264Flag = read(H264_STORAGE_KEY);
  const h264 = h264Flag === '1' || (h264Flag !== '0' && serverH264Default);
  const egfx = egfxFlag !== '0' && (egfxFlag === '1' || h264);
  return { egfx, h264: egfx && h264 };
}

export function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

export interface RdpRenderWindow {
  t_s: number;
  window_ms: number;
  /** Draw batches per second (≈ presented frames). */
  fps: number;
  draws: number;
  mpx: number;
  down_mbps: number;
  lat_p50_ms: number | null;
  lat_p95_ms: number | null;
  longtask_ms: number;
  /** Snapshot from `RdpRenderMeterOptions.extra`, e.g. H.264 decoder stats. */
  extra?: unknown;
}

export interface RdpRenderMeterOptions {
  intervalMs?: number;
  now?: () => number;
  log?: (line: string) => void;
  /** Runs `fn` after the current task; defaults to `queueMicrotask`. */
  afterTask?: (fn: () => void) => void;
  /** Extra state recorded with each window (cumulative values, copied at flush time). */
  extra?: () => unknown;
}

const round = (n: number, digits = 1) => Math.round(n * 10 ** digits) / 10 ** digits;

class Accumulator {
  batches = 0;
  draws = 0;
  pixels = 0;
  bytes = 0;
  longtaskMs = 0;
  latencies: number[] = [];

  merge(o: Accumulator) {
    this.batches += o.batches;
    this.draws += o.draws;
    this.pixels += o.pixels;
    this.bytes += o.bytes;
    this.longtaskMs += o.longtaskMs;
    for (const l of o.latencies) this.latencies.push(l);
  }

  report(elapsedMs: number) {
    const s = elapsedMs / 1000;
    const lat = [...this.latencies].sort((a, b) => a - b);
    const p50 = percentile(lat, 50);
    const p95 = percentile(lat, 95);
    return {
      window_ms: Math.round(elapsedMs),
      fps: s > 0 ? round(this.batches / s) : 0,
      draws: this.draws,
      mpx: round(this.pixels / 1e6, 2),
      down_mbps: s > 0 ? round((this.bytes * 8) / (s * 1e6), 3) : 0,
      lat_p50_ms: p50 === null ? null : round(p50),
      lat_p95_ms: p95 === null ? null : round(p95),
      longtask_ms: Math.round(this.longtaskMs),
    };
  }
}

export class RdpRenderMeter {
  readonly windows: RdpRenderWindow[] = [];
  summary: (Omit<RdpRenderWindow, 't_s'> & { summary: true }) | null = null;

  private readonly intervalMs: number;
  private readonly now: () => number;
  private readonly log: (line: string) => void;
  private readonly afterTask: (fn: () => void) => void;
  private readonly extra: (() => unknown) | undefined;
  private readonly startedAt: number;
  private windowStart: number;
  private win = new Accumulator();
  private total = new Accumulator();
  private pendingSince: number | null = null;
  private batchOpen = false;
  private stopped = false;

  constructor(opts: RdpRenderMeterOptions = {}) {
    this.intervalMs = opts.intervalMs ?? 5000;
    this.now = opts.now ?? (() => performance.now());
    this.log = opts.log ?? ((line) => console.info(line));
    this.afterTask = opts.afterTask ?? ((fn) => queueMicrotask(fn));
    this.extra = opts.extra;
    this.startedAt = this.now();
    this.windowStart = this.startedAt;
  }

  get interval(): number {
    return this.intervalMs;
  }

  onMessage(bytes: number): void {
    if (this.stopped) return;
    const t = this.now();
    this.win.bytes += bytes;
    if (this.pendingSince === null || t - this.pendingSince > STALE_PENDING_MS) this.pendingSince = t;
  }

  onDraw(pixels: number): void {
    if (this.stopped) return;
    this.win.draws += 1;
    this.win.pixels += pixels;
    if (this.batchOpen) return;
    this.batchOpen = true;
    this.afterTask(() => this.closeBatch());
  }

  onLongTask(durationMs: number): void {
    if (this.stopped) return;
    this.win.longtaskMs += durationMs;
  }

  /** Emits the current window; call every `interval` ms. */
  flush(): void {
    const t = this.now();
    const elapsed = t - this.windowStart;
    if (elapsed <= 0) return;
    const record: RdpRenderWindow = { t_s: round((t - this.startedAt) / 1000), ...this.win.report(elapsed) };
    if (this.extra) record.extra = structuredClone(this.extra());
    this.windows.push(record);
    this.log(`[rdp-metrics] ${JSON.stringify(record)}`);
    this.total.merge(this.win);
    this.win = new Accumulator();
    this.windowStart = t;
  }

  stop(): void {
    if (this.stopped) return;
    this.flush();
    this.stopped = true;
    this.summary = { summary: true, ...this.total.report(this.now() - this.startedAt) };
    this.log(`[rdp-metrics] ${JSON.stringify(this.summary)}`);
  }

  private closeBatch(): void {
    this.batchOpen = false;
    if (this.stopped) return;
    const t = this.now();
    this.win.batches += 1;
    if (this.pendingSince !== null && t - this.pendingSince <= STALE_PENDING_MS) {
      this.win.latencies.push(t - this.pendingSince);
    }
    this.pendingSince = null;
  }
}

declare global {
  interface Window {
    __gatwyRdpMetrics?: RdpRenderMeter;
  }
}

/**
 * Instruments the session canvas and returns a teardown that stops the meter and restores it.
 * The WASM client draws through the canvas's 2D context, looked up per call, so an own-property
 * override on that context intercepts every blit.
 */
export function attachRdpRenderMeter(canvas: HTMLCanvasElement, meter: RdpRenderMeter): () => void {
  const ctx = canvas.getContext('2d');
  const original = ctx?.putImageData;
  if (ctx && original) {
    ctx.putImageData = function (this: CanvasRenderingContext2D, image: ImageData, ...rest: unknown[]) {
      meter.onDraw(image.width * image.height);
      return (original as (...args: unknown[]) => void).call(this, image, ...rest);
    } as CanvasRenderingContext2D['putImageData'];
  }

  let observer: PerformanceObserver | null = null;
  try {
    observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) meter.onLongTask(entry.duration);
    });
    observer.observe({ type: 'longtask', buffered: false });
  } catch {
    observer = null; // longtask timing unsupported (non-Chromium)
  }

  const timer = window.setInterval(() => meter.flush(), meter.interval);
  window.__gatwyRdpMetrics = meter;

  return () => {
    window.clearInterval(timer);
    observer?.disconnect();
    if (ctx && original) delete (ctx as unknown as Record<string, unknown>).putImageData;
    meter.stop();
  };
}

/** Byte length of a WebSocket message payload as delivered to `onmessage`. */
export function messageByteLength(data: unknown): number {
  if (data instanceof ArrayBuffer) return data.byteLength;
  if (ArrayBuffer.isView(data)) return data.byteLength;
  if (typeof Blob !== 'undefined' && data instanceof Blob) return data.size;
  if (typeof data === 'string') return data.length;
  return 0;
}
