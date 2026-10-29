import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  RdpLiveStats,
  decoderSample,
  graphicsLabel,
  nextOverlayMode,
  overlayLines,
  type RdpOverlayInfo,
} from '../src/services/rdpLiveStats.js';

function clock() {
  let t = 0;
  const tasks: (() => void)[] = [];
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
    afterTask: (fn: () => void) => tasks.push(fn),
    runTasks: () => tasks.splice(0).forEach((fn) => fn()),
  };
}

describe('RdpLiveStats', () => {
  it('reports rates over the interval since the last sample, then starts over', () => {
    const c = clock();
    const stats = new RdpLiveStats(c.now, c.afterTask);
    stats.onMessage(125_000); // 1 Mbit
    stats.onSend(1_000); // 8 kbit
    c.advance(5);
    stats.onDraw(1_000_000);
    stats.onDraw(1_000_000);
    c.runTasks(); // both draws ran in one task: one update
    c.advance(495);
    const first = stats.sample();
    assert.equal(first.fps, 2); // one update in 0.5 s
    assert.equal(first.drawsPerSec, 4);
    assert.equal(first.mpxPerSec, 4);
    assert.equal(first.downMbps, 2);
    assert.equal(first.upKbps, 16);
    assert.equal(first.latencyP50Ms, 5);

    c.advance(1000);
    const second = stats.sample();
    assert.deepEqual([second.fps, second.downMbps, second.upKbps], [0, 0, 0]);
    assert.equal(second.latencyP50Ms, 5, 'percentiles span recent samples, not just the interval');
  });

  it('does not count a message no draw followed as latency', () => {
    const c = clock();
    const stats = new RdpLiveStats(c.now, c.afterTask);
    stats.onMessage(10); // keepalive
    c.advance(2000);
    stats.onMessage(10);
    c.advance(3);
    stats.onDraw(1);
    c.runTasks();
    assert.equal(stats.sample().latencyP95Ms, 3);
  });
});

describe('decoderSample', () => {
  const counters = { hardware: true, submitted: 10, decoded: 8, errors: 1, stalls: 0, keyFrameRequests: 0, decodeMsTotal: 16, decodeMsMax: 5 };

  it('averages decode time over the interval and counts what is still out', () => {
    const later = { ...counters, submitted: 20, decoded: 18, decodeMsTotal: 46 };
    const sample = decoderSample(counters, later);
    assert.equal(sample.avgMs, 3);
    assert.equal(sample.pending, 1);
    assert.equal(decoderSample(null, counters).avgMs, 2);
  });

  it('has no average when nothing was decoded', () => {
    assert.equal(decoderSample(counters, counters).avgMs, null);
  });
});

describe('graphicsLabel', () => {
  it('names the codec in use', () => {
    const off = { egfx: false, h264: false, avc444: false };
    const h264 = { egfx: true, h264: true, avc444: false };
    assert.equal(graphicsLabel(off, null), 'RemoteFX（经典）');
    assert.equal(graphicsLabel({ ...off, egfx: true }, null), '图形管道');
    assert.equal(graphicsLabel(h264, null), '图形管道（浏览器不支持 H.264）');
    assert.equal(graphicsLabel(h264, { submitted: 0, decoded: 0 }), '图形管道（服务器未发送 H.264）');
    assert.equal(graphicsLabel(h264, { submitted: 3, decoded: 0 }), 'H.264（解码失败）');
    assert.equal(graphicsLabel(h264, { submitted: 5, decoded: 5 }), 'H.264 4:2:0');
    assert.equal(graphicsLabel({ ...h264, avc444: true }, { submitted: 5, decoded: 5 }), 'H.264（允许 4:4:4）');
  });
});

describe('overlay', () => {
  const info: RdpOverlayInfo = {
    width: 1920,
    height: 1080,
    scaleFactor: 150,
    graphics: 'H.264 4:2:0',
    compositor: 'GPU',
    live: { fps: 59.6, drawsPerSec: 60, mpxPerSec: 2.07, downMbps: 12.44, upKbps: 46, latencyP50Ms: 4.2, latencyP95Ms: 11 },
    rttGatewayMs: 0.4,
    rttHostMs: 18,
    decoder: { hardware: true, avgMs: 2.1, maxMs: 9, pending: 1, stalls: 0, keyFrameRequests: 0, errors: 0 },
    connectedSeconds: 2533,
  };
  const text = (mode: 'compact' | 'detailed', i = info) =>
    overlayLines(i, mode).map((l) => [l.label, ...l.parts.map((p) => p.text)].filter(Boolean).join(' '));

  it('cycles off, compact, detailed', () => {
    assert.equal(nextOverlayMode('off'), 'compact');
    assert.equal(nextOverlayMode('compact'), 'detailed');
    assert.equal(nextOverlayMode('detailed'), 'off');
    assert.deepEqual(overlayLines(info, 'off'), []);
  });

  it('fits the essentials on one line', () => {
    assert.deepEqual(text('compact'), ['60 fps 12 Mbps RTT 0.4+18 ms 解码 2.1 ms']);
  });

  it('lists every figure in detailed mode', () => {
    assert.deepEqual(text('detailed'), [
      '画面 1920×1080 @150% H.264 4:2:0 GPU 合成 硬解',
      '帧率 60 更新/s 60 绘制/s 2.1 Mpx/s',
      '带宽 ↓ 12 Mbps ↑ 46 kbps',
      '延迟 浏览器→网关 0.4 ms 网关→主机 18 ms',
      '解码 平均 2.1 ms 峰值 9.0 ms 排队 1 卡顿 0 关键帧请求 0 错误 0',
      '处理 上屏 p50 4.2 ms p95 11 ms',
      '会话 00:42:13',
    ]);
  });

  it('leaves out what is unknown and flags what is off', () => {
    const lines = overlayLines(
      { ...info, scaleFactor: undefined, compositor: null, decoder: null, rttGatewayMs: null, rttHostMs: 200 },
      'detailed',
    );
    assert.equal(lines.length, 6, 'no decoder line');
    assert.deepEqual(lines[0].parts.map((p) => p.text), ['1920×1080', 'H.264 4:2:0']);
    assert.deepEqual(
      lines[3].parts.map((p) => [p.text, p.level]),
      [['浏览器→网关 —', 'ok'], ['网关→主机 200 ms', 'bad']],
    );
  });
});
