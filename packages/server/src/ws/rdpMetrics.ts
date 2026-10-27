// Opt-in RDP throughput meter (Settings → General → RDP → "Performance metrics").
// Counts bytes relayed between the browser WebSocket and the RDP server and logs one JSON line
// per interval plus a summary when the session ends.

const RDP_METRICS_INTERVAL_MS = Number.parseInt(process.env.GATWY_RDP_METRICS_INTERVAL_MS ?? '5000', 10);

export interface RdpByteMeter {
  /** Bytes received from the RDP server (relayed to the browser). */
  down(bytes: number): void;
  /** Bytes received from the browser (relayed to the RDP server). */
  up(bytes: number): void;
  /** Flushes the last partial interval and logs the session summary. Idempotent. */
  stop(): void;
}

export interface RdpByteMeterOptions {
  intervalMs?: number;
  now?: () => number;
  log?: (line: string) => void;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
}

const mbps = (bytes: number, ms: number) => (ms > 0 ? Math.round(((bytes * 8) / (ms * 1000)) * 1000) / 1000 : 0);

export function createRdpByteMeter(sessionId: string, opts: RdpByteMeterOptions = {}): RdpByteMeter {
  const intervalMs = opts.intervalMs ?? (Number.isFinite(RDP_METRICS_INTERVAL_MS) && RDP_METRICS_INTERVAL_MS > 0 ? RDP_METRICS_INTERVAL_MS : 5000);
  const now = opts.now ?? Date.now;
  const log = opts.log ?? ((line: string) => console.info(line));
  const schedule = opts.setInterval ?? ((fn, ms) => setInterval(fn, ms));
  const unschedule = opts.clearInterval ?? ((h) => clearInterval(h as NodeJS.Timeout));

  const startedAt = now();
  let windowStart = startedAt;
  let windowDown = 0;
  let windowUp = 0;
  let totalDown = 0;
  let totalUp = 0;
  let stopped = false;

  const emit = (record: Record<string, unknown>) => log(`[rdp-metrics] ${JSON.stringify({ session: sessionId, ...record })}`);

  const flushWindow = () => {
    const t = now();
    const elapsed = t - windowStart;
    if (elapsed <= 0) return;
    emit({
      t_s: Math.round((t - startedAt) / 100) / 10,
      window_ms: elapsed,
      down_bytes: windowDown,
      up_bytes: windowUp,
      down_mbps: mbps(windowDown, elapsed),
      up_mbps: mbps(windowUp, elapsed),
    });
    windowStart = t;
    windowDown = 0;
    windowUp = 0;
  };

  const handle = schedule(flushWindow, intervalMs);

  return {
    down(bytes) {
      if (stopped) return;
      windowDown += bytes;
      totalDown += bytes;
    },
    up(bytes) {
      if (stopped) return;
      windowUp += bytes;
      totalUp += bytes;
    },
    stop() {
      if (stopped) return;
      stopped = true;
      unschedule(handle);
      flushWindow();
      const duration = now() - startedAt;
      emit({
        summary: true,
        duration_ms: duration,
        down_bytes: totalDown,
        up_bytes: totalUp,
        down_mbps: mbps(totalDown, duration),
        up_mbps: mbps(totalUp, duration),
      });
    },
  };
}
