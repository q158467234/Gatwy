// Live connection statistics for the overlay drawn over an RDP session (toggled from the session
// panel or with Ctrl+Alt+Shift+S). Counts the session's WebSocket traffic and canvas presents,
// and turns them, together with decoder and round-trip figures, into the overlay's text.

/** A message with no draw within this window (keepalive, input echo) is not a pending update. */
const STALE_PENDING_MS = 1000;
/** Latency samples kept for the percentiles: a few seconds of updates. */
const LATENCY_SAMPLES = 240;

export type RdpStatsOverlayMode = 'off' | 'compact' | 'detailed';

const OVERLAY_MODES: readonly RdpStatsOverlayMode[] = ['off', 'compact', 'detailed'];
const OVERLAY_MODE_KEY = 'gatwy.rdp.statsOverlay';

export function nextOverlayMode(mode: RdpStatsOverlayMode): RdpStatsOverlayMode {
  return OVERLAY_MODES[(OVERLAY_MODES.indexOf(mode) + 1) % OVERLAY_MODES.length];
}

/** The mode last chosen in this browser; storage may be unavailable (private windows). */
export function loadOverlayMode(): RdpStatsOverlayMode {
  try {
    const saved = localStorage.getItem(OVERLAY_MODE_KEY);
    return OVERLAY_MODES.includes(saved as RdpStatsOverlayMode) ? (saved as RdpStatsOverlayMode) : 'off';
  } catch {
    return 'off';
  }
}

export function saveOverlayMode(mode: RdpStatsOverlayMode): void {
  try {
    localStorage.setItem(OVERLAY_MODE_KEY, mode);
  } catch {
    /* not remembered */
  }
}

/** Rates over the interval since the previous sample. */
export interface RdpLiveSample {
  /** Screen updates: draws that ran in one task count once. */
  fps: number;
  drawsPerSec: number;
  mpxPerSec: number;
  downMbps: number;
  upKbps: number;
  /** WebSocket arrival to the end of the draws it caused, over the last few seconds. */
  latencyP50Ms: number | null;
  latencyP95Ms: number | null;
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

export class RdpLiveStats {
  private readonly now: () => number;
  private readonly afterTask: (fn: () => void) => void;
  private sampledAt: number;
  private bytesDown = 0;
  private bytesUp = 0;
  private batches = 0;
  private draws = 0;
  private pixels = 0;
  private readonly latencies: number[] = [];
  private pendingSince: number | null = null;
  private batchOpen = false;

  constructor(now: () => number = () => performance.now(), afterTask: (fn: () => void) => void = queueMicrotask) {
    this.now = now;
    this.afterTask = afterTask;
    this.sampledAt = now();
  }

  onMessage(bytes: number): void {
    const t = this.now();
    this.bytesDown += bytes;
    if (this.pendingSince === null || t - this.pendingSince > STALE_PENDING_MS) this.pendingSince = t;
  }

  onSend(bytes: number): void {
    this.bytesUp += bytes;
  }

  onDraw(pixels: number): void {
    this.draws += 1;
    this.pixels += pixels;
    if (this.batchOpen) return;
    this.batchOpen = true;
    this.afterTask(() => this.closeBatch());
  }

  /** Rates since the previous call. */
  sample(): RdpLiveSample {
    const t = this.now();
    const s = Math.max((t - this.sampledAt) / 1000, 1e-3);
    const sample: RdpLiveSample = {
      fps: this.batches / s,
      drawsPerSec: this.draws / s,
      mpxPerSec: this.pixels / 1e6 / s,
      downMbps: (this.bytesDown * 8) / 1e6 / s,
      upKbps: (this.bytesUp * 8) / 1e3 / s,
      latencyP50Ms: percentile(this.latencies, 50),
      latencyP95Ms: percentile(this.latencies, 95),
    };
    this.sampledAt = t;
    this.bytesDown = this.bytesUp = this.batches = this.draws = this.pixels = 0;
    return sample;
  }

  private closeBatch(): void {
    this.batchOpen = false;
    const t = this.now();
    this.batches += 1;
    if (this.pendingSince !== null && t - this.pendingSince <= STALE_PENDING_MS) {
      this.latencies.push(t - this.pendingSince);
      if (this.latencies.length > LATENCY_SAMPLES) this.latencies.shift();
    }
    this.pendingSince = null;
  }
}

/** The WebCodecs decoder's cumulative counters (see WebCodecsH264Stats). */
export interface DecoderCounters {
  hardware: boolean;
  submitted: number;
  decoded: number;
  errors: number;
  stalls: number;
  keyFrameRequests: number;
  decodeMsTotal: number;
  decodeMsMax: number;
}

export interface DecoderSample {
  hardware: boolean;
  /** Mean decode time over the interval, or null when nothing was decoded in it. */
  avgMs: number | null;
  /** Longest decode since the session started. */
  maxMs: number;
  /** Submitted pictures not returned yet. */
  pending: number;
  stalls: number;
  keyFrameRequests: number;
  errors: number;
}

/** Interval figures from two snapshots of the decoder's counters. */
export function decoderSample(previous: DecoderCounters | null, current: DecoderCounters): DecoderSample {
  const decoded = current.decoded - (previous?.decoded ?? 0);
  const ms = current.decodeMsTotal - (previous?.decodeMsTotal ?? 0);
  return {
    hardware: current.hardware,
    avgMs: decoded > 0 ? ms / decoded : null,
    maxMs: current.decodeMsMax,
    pending: Math.max(0, current.submitted - current.decoded - current.errors),
    stalls: current.stalls,
    keyFrameRequests: current.keyFrameRequests,
    errors: current.errors,
  };
}

export interface RdpOverlayInfo {
  width: number;
  height: number;
  /** Desktop scale factor in percent, when the session sets one. */
  scaleFactor: number | undefined;
  /** How the screen is encoded, e.g. "H.264 4:2:0". */
  graphics: string;
  /** Where the session composites: the WebGL2 renderer or the 2D canvas; null before the first frame. */
  compositor: 'GPU' | 'CPU' | null;
  live: RdpLiveSample;
  /** Browser to gateway, and gateway to the RDP host (TCP connect), in ms; null while unknown. */
  rttGatewayMs: number | null;
  rttHostMs: number | null;
  decoder: DecoderSample | null;
  connectedSeconds: number;
}

/**
 * How the screen is encoded, from the requested graphics mode and the H.264 decoder's counters
 * (null without a decoder: the browser has no WebCodecs H.264). Windows encodes only what it
 * considers video with H.264 unless AVC444 is prioritized, so a still desktop sends none.
 */
export function graphicsLabel(
  mode: { egfx: boolean; h264: boolean; avc444: boolean },
  h264: { submitted: number; decoded: number } | null,
): string {
  if (!mode.egfx) return 'RemoteFX（经典）';
  if (!mode.h264) return '图形管道';
  if (h264 === null) return '图形管道（浏览器不支持 H.264）';
  if (h264.submitted === 0) return '图形管道（服务器未发送 H.264）';
  if (h264.decoded === 0) return 'H.264（解码失败）';
  return mode.avc444 ? 'H.264（允许 4:4:4）' : 'H.264 4:2:0';
}

/** Normal, worth a look, or a problem; colors the value in the overlay. */
export type OverlayLevel = 'ok' | 'warn' | 'bad';

export interface OverlayPart {
  text: string;
  level?: OverlayLevel;
}

export interface OverlayLine {
  label: string;
  parts: OverlayPart[];
}

const rttLevel = (ms: number | null): OverlayLevel => (ms === null ? 'ok' : ms >= 150 ? 'bad' : ms >= 60 ? 'warn' : 'ok');
const decodeLevel = (ms: number | null): OverlayLevel => (ms === null ? 'ok' : ms >= 33 ? 'bad' : ms >= 16 ? 'warn' : 'ok');
const latencyLevel = (ms: number | null): OverlayLevel => (ms === null ? 'ok' : ms >= 50 ? 'bad' : ms >= 20 ? 'warn' : 'ok');
const countLevel = (n: number): OverlayLevel => (n > 0 ? 'warn' : 'ok');

function ms(value: number | null): string {
  if (value === null) return '—';
  return value < 10 ? `${value.toFixed(1)} ms` : `${Math.round(value)} ms`;
}

function rate(value: number, unit: string): string {
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${unit}`;
}

function duration(seconds: number): string {
  const s = Math.floor(seconds);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

/** The overlay's text: one line in compact mode, one per topic in detailed mode. */
export function overlayLines(info: RdpOverlayInfo, mode: RdpStatsOverlayMode): OverlayLine[] {
  if (mode === 'off') return [];
  const { live, decoder } = info;
  const rtt =
    info.rttHostMs === null && info.rttGatewayMs === null
      ? '—'
      : `${ms(info.rttGatewayMs).replace(' ms', '')}+${ms(info.rttHostMs).replace(' ms', '')} ms`;
  const worstRtt = Math.max(info.rttGatewayMs ?? 0, info.rttHostMs ?? 0);

  if (mode === 'compact') {
    const parts: OverlayPart[] = [
      { text: `${Math.round(live.fps)} fps` },
      { text: rate(live.downMbps, 'Mbps') },
      { text: `RTT ${rtt}`, level: rttLevel(info.rttHostMs === null && info.rttGatewayMs === null ? null : worstRtt) },
    ];
    if (decoder?.avgMs != null) parts.push({ text: `解码 ${ms(decoder.avgMs)}`, level: decodeLevel(decoder.avgMs) });
    return [{ label: '', parts }];
  }

  const screen: OverlayPart[] = [
    { text: `${info.width}×${info.height}${info.scaleFactor !== undefined ? ` @${info.scaleFactor}%` : ''}` },
    { text: info.graphics },
  ];
  if (info.compositor) screen.push({ text: `${info.compositor} 合成` });
  if (decoder) screen.push({ text: decoder.hardware ? '硬解' : '软解', level: decoder.hardware ? 'ok' : 'warn' });

  const lines: OverlayLine[] = [
    { label: '画面', parts: screen },
    {
      label: '帧率',
      parts: [
        { text: `${Math.round(live.fps)} 更新/s` },
        { text: `${Math.round(live.drawsPerSec)} 绘制/s` },
        { text: rate(live.mpxPerSec, 'Mpx/s') },
      ],
    },
    {
      label: '带宽',
      parts: [{ text: `↓ ${rate(live.downMbps, 'Mbps')}` }, { text: `↑ ${rate(live.upKbps, 'kbps')}` }],
    },
    {
      label: '延迟',
      parts: [
        { text: `浏览器→网关 ${ms(info.rttGatewayMs)}`, level: rttLevel(info.rttGatewayMs) },
        { text: `网关→主机 ${ms(info.rttHostMs)}`, level: rttLevel(info.rttHostMs) },
      ],
    },
  ];
  if (decoder) {
    lines.push({
      label: '解码',
      parts: [
        { text: `平均 ${ms(decoder.avgMs)}`, level: decodeLevel(decoder.avgMs) },
        { text: `峰值 ${ms(decoder.maxMs)}` },
        { text: `排队 ${decoder.pending}`, level: decoder.pending > 2 ? 'warn' : 'ok' },
        { text: `卡顿 ${decoder.stalls}`, level: countLevel(decoder.stalls) },
        { text: `关键帧请求 ${decoder.keyFrameRequests}`, level: countLevel(decoder.keyFrameRequests) },
        { text: `错误 ${decoder.errors}`, level: countLevel(decoder.errors) },
      ],
    });
  }
  lines.push(
    {
      label: '处理',
      parts: [
        { text: `上屏 p50 ${ms(live.latencyP50Ms)}`, level: latencyLevel(live.latencyP50Ms) },
        { text: `p95 ${ms(live.latencyP95Ms)}`, level: latencyLevel(live.latencyP95Ms) },
      ],
    },
    { label: '会话', parts: [{ text: duration(info.connectedSeconds) }] },
  );
  return lines;
}
