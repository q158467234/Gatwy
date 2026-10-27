import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { RdpRenderMeter, loadRdpSessionSettings, messageByteLength, percentile, rdpGraphicsMode } from '../src/services/rdpMetrics.js';

function harness() {
  let t = 0;
  const tasks: Array<() => void> = [];
  const lines: string[] = [];
  const meter = new RdpRenderMeter({
    intervalMs: 1000,
    now: () => t,
    log: (line) => lines.push(line),
    afterTask: (fn) => tasks.push(fn),
  });
  return {
    meter,
    lines,
    at(ms: number) { t = ms; },
    endTask() { while (tasks.length) tasks.shift()!(); },
  };
}

describe('percentile', () => {
  it('uses nearest-rank on sorted input', () => {
    assert.equal(percentile([], 50), null);
    assert.equal(percentile([10], 95), 10);
    assert.equal(percentile([1, 2, 3, 4], 50), 2);
    assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95), 10);
  });
});

describe('RdpRenderMeter', () => {
  it('counts draws in one task as one batch and measures message-to-batch latency', () => {
    const h = harness();
    h.at(100); h.meter.onMessage(1000);
    h.at(105); h.meter.onMessage(500); // same pending update
    h.at(120); h.meter.onDraw(64 * 64); h.meter.onDraw(64 * 64);
    h.at(130); h.endTask();

    h.at(500); h.meter.onMessage(250);
    h.at(510); h.meter.onDraw(100); h.endTask();

    h.at(1000); h.meter.flush();
    const w = h.meter.windows[0];
    assert.equal(w.draws, 3);
    assert.equal(w.fps, 2);
    assert.equal(w.lat_p50_ms, 10);
    assert.equal(w.lat_p95_ms, 30);
    assert.equal(w.down_mbps, 0.014); // 1750 B over 1 s
  });

  it('drops stale pending messages that produced no draw', () => {
    const h = harness();
    h.at(0); h.meter.onMessage(10); // keepalive, never drawn
    h.at(2000); h.meter.onMessage(10); // restarts pending
    h.at(2020); h.meter.onDraw(1); h.endTask();
    h.at(5000); h.meter.onDraw(1); h.endTask(); // no pending message: no latency sample
    h.meter.flush();
    assert.equal(h.meter.windows[0].lat_p50_ms, 20);
    assert.equal(h.meter.windows[0].lat_p95_ms, 20);
  });

  it('summarizes all windows on stop and ignores later events', () => {
    const h = harness();
    h.at(10); h.meter.onDraw(1_000_000); h.endTask();
    h.meter.onLongTask(60);
    h.at(1000); h.meter.flush();
    h.at(1500); h.meter.onDraw(500_000); h.endTask();
    h.at(2000); h.meter.stop();
    h.meter.onDraw(1); h.meter.stop();

    assert.equal(h.meter.windows.length, 2);
    assert.deepEqual(h.meter.summary, {
      summary: true, window_ms: 2000, fps: 1, draws: 2, mpx: 1.5,
      down_mbps: 0, lat_p50_ms: null, lat_p95_ms: null, longtask_ms: 60,
    });
    assert.equal(h.lines.length, 3);
    assert.ok(h.lines.every((l) => l.startsWith('[rdp-metrics] ')));
  });
});

describe('messageByteLength', () => {
  it('handles the payload types a WebSocket can deliver', () => {
    assert.equal(messageByteLength(new ArrayBuffer(8)), 8);
    assert.equal(messageByteLength(new Uint8Array(3)), 3);
    assert.equal(messageByteLength(new Blob(['abcd'])), 4);
    assert.equal(messageByteLength('xy'), 2);
    assert.equal(messageByteLength(null), 0);
  });
});

describe('RdpRenderMeter extra', () => {
  it('records a copy of the extra state with each window', () => {
    let t = 0;
    const stats = { decoded: 1 };
    const meter = new RdpRenderMeter({ now: () => t, log: () => {}, afterTask: () => {}, extra: () => stats });
    t = 1000;
    meter.flush();
    stats.decoded = 2;
    t = 2000;
    meter.flush();
    assert.deepEqual(meter.windows.map((w) => w.extra), [{ decoded: 1 }, { decoded: 2 }]);
  });
});

describe('rdpGraphicsMode', () => {
  it('maps the rdp.graphics_mode setting', () => {
    assert.deepEqual(rdpGraphicsMode('legacy'), { egfx: false, h264: false });
    assert.deepEqual(rdpGraphicsMode('egfx'), { egfx: true, h264: false });
    assert.deepEqual(rdpGraphicsMode('h264'), { egfx: true, h264: true });
  });

  it('treats a missing or unknown value as the classic path', () => {
    assert.deepEqual(rdpGraphicsMode(undefined), { egfx: false, h264: false });
    assert.deepEqual(rdpGraphicsMode('H264'), { egfx: false, h264: false });
  });
});

describe('loadRdpSessionSettings', () => {
  const respond = (status: number, body: unknown) =>
    (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

  it('reads both settings from the public settings endpoint', async () => {
    let url = '';
    const fetchImpl = (async (input: RequestInfo | URL) => {
      url = String(input);
      return new Response(JSON.stringify({ settings: { 'rdp.graphics_mode': 'h264', 'rdp.metrics_enabled': 'true' } }));
    }) as typeof fetch;
    assert.deepEqual(await loadRdpSessionSettings(fetchImpl), { graphics: { egfx: true, h264: true }, metrics: true });
    assert.equal(url, '/api/v1/settings/public');
  });

  it('falls back to the classic path without metrics when the request fails', async () => {
    const warn = console.warn;
    console.warn = () => {};
    try {
      const off = { graphics: { egfx: false, h264: false }, metrics: false };
      assert.deepEqual(await loadRdpSessionSettings(respond(500, {})), off);
      assert.deepEqual(await loadRdpSessionSettings((async () => { throw new Error('offline'); }) as unknown as typeof fetch), off);
      assert.deepEqual(await loadRdpSessionSettings(respond(200, {})), off);
    } finally {
      console.warn = warn;
    }
  });
});
