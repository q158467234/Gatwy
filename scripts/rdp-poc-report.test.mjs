import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  aggregate,
  emptyRuns,
  evaluate,
  initMeasurements,
  loadMeasurements,
  median,
  parseCpu,
  parseServerLog,
  renderReport,
  summarizeRun,
  verdict,
} from './rdp-poc-report.mjs';

const window = (overrides = {}) => ({
  t_s: 5,
  window_ms: 5000,
  fps: 30,
  draws: 100,
  mpx: 10,
  down_mbps: 20,
  lat_p50_ms: 10,
  lat_p95_ms: 20,
  longtask_ms: 100,
  ...overrides,
});

const serverLine = (down) => `2026-10-27 [rdp-metrics] {"session":"s","t_s":5,"window_ms":5000,"down_bytes":1,"up_bytes":1,"down_mbps":${down},"up_mbps":0.1}`;

/** Writes 3 runs per scenario per path; `b` overrides path B's figures per scenario. */
function fixture({ a = {}, b = {}, h264 = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'rdp-poc-'));
  for (const [path, overrides] of [['A', a], ['B', b]]) {
    for (const s of ['S1', 'S2', 'S3', 'S4']) {
      for (let run = 1; run <= 3; run++) {
        const o = { mbps: 20, cpu: 50, fps: 30, p95: 20, ...overrides[s] };
        const runDir = join(dir, `${path}-${s}-${run}`);
        mkdirSync(runDir);
        const extra = (decoded, stalls) => ({ hardware: true, decoded, errors: 0, stalls, decodeMsMax: 4, formats: { NV12: decoded } });
        const windows = [0, 1].map((i) =>
          window({
            fps: o.fps,
            down_mbps: o.mbps,
            lat_p95_ms: o.p95,
            ...(path === 'B' ? { extra: extra(i * 100, i * (h264.stalls ?? 0)) } : {}),
          }),
        );
        writeFileSync(join(runDir, 'client.json'), JSON.stringify(windows));
        writeFileSync(join(runDir, 'server.log'), `noise\n${serverLine(o.mbps)}\n${serverLine(o.mbps)}\n`);
        writeFileSync(join(runDir, 'cpu.txt'), `${o.cpu}, ${o.cpu}\n${o.cpu}`);
      }
    }
  }
  return dir;
}

describe('parsers', () => {
  it('keeps only rdp-metrics window lines from a server log', () => {
    const log = `x\n${serverLine(3)}\n[rdp-metrics] {"session":"s","summary":true,"down_mbps":9}\n[rdp-metrics] not-json\n`;
    assert.deepEqual(parseServerLog(log).map((r) => r.down_mbps), [3]);
  });

  it('reads CPU readings separated by whitespace or commas', () => {
    assert.deepEqual(parseCpu('12, 14\n 16 x'), [12, 14, 16]);
  });

  it('computes medians for odd and even counts and ignores nulls', () => {
    assert.equal(median([3, null, 1, 2]), 2);
    assert.equal(median([4, 1, 3, 2]), 2.5);
    assert.equal(median([null]), null);
  });
});

describe('summarizeRun', () => {
  it('turns cumulative H.264 counters into per-run deltas', () => {
    const run = summarizeRun({
      client: [
        window({ extra: { hardware: true, decoded: 10, errors: 1, stalls: 0, decodeMsMax: 3, formats: { NV12: 10 } } }),
        window({ extra: { hardware: true, decoded: 70, errors: 2, stalls: 1, decodeMsMax: 9, formats: { NV12: 70 } } }),
      ],
      server: [{ down_mbps: 4 }, { down_mbps: 6 }],
      cpu: [10, 20],
    });
    assert.equal(run.serverMbps, 5);
    assert.equal(run.cpu, 15);
    assert.deepEqual(run.h264, { hardware: true, decoded: 60, errors: 1, stalls: 1, decodeMsMax: 9, formats: { NV12: 70 } });
  });
});

describe('evaluation', () => {
  const good = {
    S1: { mbps: 18, cpu: 50 },
    S2: { mbps: 10 },
    S3: { mbps: 10 },
    S4: { mbps: 8, cpu: 30, fps: 30 },
  };

  it('is Go when every threshold passes', () => {
    const report = renderReport(loadMeasurements(fixture({ b: good })));
    assert.match(report, /\*\*结论：Go/);
    assert.doesNotMatch(report, /❌/);
  });

  it('flags decoder stalls before anything else', () => {
    const report = renderReport(loadMeasurements(fixture({ b: good, h264: { stalls: 1 } })));
    assert.match(report, /No-Go 候选：出现解码卡顿/);
    assert.match(report, /卡顿：12/); // 1 per run × 3 runs × 4 scenarios
  });

  it('is conditional Go when only CPU misses', () => {
    const groups = loadMeasurements(fixture({ b: { ...good, S4: { mbps: 8, cpu: 45, fps: 30 } } }));
    const checks = evaluate(groups.A, groups.B);
    assert.equal(checks.find((c) => c.name.startsWith('S4 客户端 CPU')).pass, false);
    assert.match(verdict(checks, { stalls: 0 }), /有条件 Go/);
  });

  it('is No-Go when latency regresses by more than a frame', () => {
    const groups = loadMeasurements(fixture({ b: { ...good, S2: { mbps: 10, p95: 60 } } }));
    assert.match(verdict(evaluate(groups.A, groups.B), { stalls: 0 }), /^No-Go/);
  });

  it('refuses to judge incomplete data', () => {
    const groups = { A: { S4: aggregate([summarizeRun({ client: [window()], server: [], cpu: [] })]) }, B: {} };
    assert.equal(verdict(evaluate(groups.A, groups.B), { stalls: 0 }), '数据不全，无法判定');
  });
});

describe('initMeasurements', () => {
  it('creates empty run folders that the report skips and lists as missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rdp-poc-init-'));
    assert.equal(initMeasurements(dir, ['S4']).length, 6);
    assert.deepEqual(emptyRuns(dir), ['A-S4-1', 'A-S4-2', 'A-S4-3', 'B-S4-1', 'B-S4-2', 'B-S4-3']);
    assert.deepEqual(loadMeasurements(dir), {});
    assert.match(renderReport(loadMeasurements(dir)), /数据不全，无法判定/);
  });
});
