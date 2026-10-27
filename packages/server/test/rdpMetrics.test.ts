import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRdpByteMeter } from '../src/ws/rdpMetrics.js';

function harness() {
  let t = 1_000;
  let tick: (() => void) | null = null;
  let cleared = false;
  const lines: Array<Record<string, unknown>> = [];
  const meter = createRdpByteMeter('s1', {
    intervalMs: 5000,
    now: () => t,
    log: (line) => {
      assert.ok(line.startsWith('[rdp-metrics] '));
      lines.push(JSON.parse(line.slice('[rdp-metrics] '.length)));
    },
    setInterval: (fn) => { tick = fn; return 1; },
    clearInterval: () => { cleared = true; },
  });
  return {
    meter,
    lines,
    advance(ms: number) { t += ms; },
    tick() { tick!(); },
    get cleared() { return cleared; },
  };
}

describe('createRdpByteMeter', () => {
  it('reports per-window bytes and Mbps, then resets the window', () => {
    const h = harness();
    h.meter.down(625_000); // 5 Mbit
    h.meter.up(6_250);
    h.advance(5000);
    h.tick();
    h.meter.down(1_250);
    h.advance(5000);
    h.tick();

    assert.equal(h.lines.length, 2);
    assert.deepEqual(h.lines[0], {
      session: 's1', t_s: 5, window_ms: 5000,
      down_bytes: 625_000, up_bytes: 6_250, down_mbps: 1, up_mbps: 0.01,
    });
    assert.equal(h.lines[1].down_bytes, 1_250);
    assert.equal(h.lines[1].up_bytes, 0);
    assert.equal(h.lines[1].t_s, 10);
  });

  it('flushes the partial window and logs a summary on stop, only once', () => {
    const h = harness();
    h.meter.down(1_000_000);
    h.advance(5000);
    h.tick();
    h.meter.down(250_000);
    h.advance(2000);
    h.meter.stop();
    h.meter.stop();
    h.meter.down(999); // ignored after stop

    assert.ok(h.cleared);
    assert.equal(h.lines.length, 3);
    assert.equal(h.lines[1].window_ms, 2000);
    assert.equal(h.lines[1].down_bytes, 250_000);
    assert.deepEqual(h.lines[2], {
      session: 's1', summary: true, duration_ms: 7000,
      down_bytes: 1_250_000, up_bytes: 0, down_mbps: 1.429, up_mbps: 0,
    });
  });

  it('skips an empty-duration window on immediate stop', () => {
    const h = harness();
    h.meter.stop();
    assert.equal(h.lines.length, 1);
    assert.equal(h.lines[0].summary, true);
    assert.equal(h.lines[0].down_mbps, 0);
  });
});
