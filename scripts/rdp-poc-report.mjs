#!/usr/bin/env node
// Summarizes RDP prototype measurements and evaluates the Go/No-Go thresholds of
// docs/rdp-webcodecs-poc.md §6.
//
// Usage: node scripts/rdp-poc-report.mjs <measurements-dir>
//
// One sub-directory per run, named <path>-<scenario>-<run>, e.g. A-S4-1 or B-S2-3
// (path A = RFX baseline, B = EGFX + H.264; scenarios S1..S4), containing:
//   client.json  output of copy(JSON.stringify(window.__gatwyRdpMetrics.windows.slice(-12)))
//   server.log   the server's [rdp-metrics] lines for the same 60 s (other lines are ignored)
//   cpu.txt      Chrome task manager CPU readings, whitespace or comma separated

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const SCENARIOS = ['S1', 'S2', 'S3', 'S4'];
const SCENARIO_NAMES = { S1: '打字', S2: '滚动', S3: '拖拽', S4: '视频' };
const FRAME_MS = 33;

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function median(xs) {
  const v = xs.filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

export function parseServerLog(text) {
  return text
    .split('\n')
    .flatMap((line) => {
      const at = line.indexOf('[rdp-metrics] ');
      if (at < 0) return [];
      try {
        return [JSON.parse(line.slice(at + '[rdp-metrics] '.length))];
      } catch {
        return [];
      }
    })
    .filter((r) => !r.summary);
}

export function parseCpu(text) {
  return text
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number)
    .filter(Number.isFinite);
}

/** Per-run figures from one run's client windows, server windows and CPU readings. */
export function summarizeRun({ client, server, cpu }) {
  const extras = client.map((w) => w.extra).filter((e) => e && typeof e === 'object');
  const first = extras[0];
  const last = extras[extras.length - 1];
  const delta = (key) => (first && last ? (last[key] ?? 0) - (first[key] ?? 0) : null);
  return {
    serverMbps: mean(server.map((r) => r.down_mbps)),
    clientMbps: mean(client.map((w) => w.down_mbps)),
    cpu: mean(cpu),
    longtaskMs: mean(client.map((w) => w.longtask_ms)),
    fps: mean(client.map((w) => w.fps)),
    latP50: median(client.map((w) => w.lat_p50_ms)),
    latP95: median(client.map((w) => w.lat_p95_ms)),
    h264: last
      ? {
          hardware: last.hardware,
          decoded: delta('decoded'),
          errors: delta('errors'),
          stalls: delta('stalls'),
          decodeMsMax: last.decodeMsMax,
          formats: last.formats,
        }
      : null,
  };
}

const METRICS = ['serverMbps', 'clientMbps', 'cpu', 'longtaskMs', 'fps', 'latP50', 'latP95'];

/** Median of each metric across runs, plus summed H.264 health counters. */
export function aggregate(runs) {
  const out = { runs: runs.length };
  for (const m of METRICS) out[m] = median(runs.map((r) => r[m]));
  const h264 = runs.map((r) => r.h264).filter(Boolean);
  out.h264 = h264.length
    ? {
        hardware: h264.every((h) => h.hardware === true),
        decoded: h264.reduce((n, h) => n + (h.decoded ?? 0), 0),
        errors: h264.reduce((n, h) => n + (h.errors ?? 0), 0),
        stalls: h264.reduce((n, h) => n + (h.stalls ?? 0), 0),
        decodeMsMax: Math.max(...h264.map((h) => h.decodeMsMax ?? 0)),
        formats: [...new Set(h264.flatMap((h) => Object.keys(h.formats ?? {})))],
      }
    : null;
  return out;
}

/** Evaluates §6 performance thresholds. `a`/`b` map scenario -> aggregate. */
export function evaluate(a, b) {
  const checks = [];
  const check = (name, actual, limit, pass) =>
    checks.push({ name, actual, limit, pass: actual === null || limit === null ? null : pass(actual, limit) });
  const ratio = (s, m) => (a[s]?.[m] && b[s]?.[m] != null ? b[s][m] / a[s][m] : null);

  check('S4 下行带宽 ≤ 基线 50%', ratio('S4', 'serverMbps'), 0.5, (x, l) => x <= l);
  check('S2 下行带宽 ≤ 基线 70%', ratio('S2', 'serverMbps'), 0.7, (x, l) => x <= l);
  check('S3 下行带宽 ≤ 基线 70%', ratio('S3', 'serverMbps'), 0.7, (x, l) => x <= l);
  check('S4 客户端 CPU ≤ 基线 70%', ratio('S4', 'cpu'), 0.7, (x, l) => x <= l);
  check('S1 客户端 CPU ≤ 基线 110%', ratio('S1', 'cpu'), 1.1, (x, l) => x <= l);
  check('S1 下行带宽 ≤ 基线 110%', ratio('S1', 'serverMbps'), 1.1, (x, l) => x <= l);
  check('S4 fps ≥ 基线', b.S4?.fps ?? null, a.S4?.fps ?? null, (x, l) => x >= l);
  check('S4 fps ≥ 25', b.S4?.fps ?? null, 25, (x, l) => x >= l);
  for (const s of SCENARIOS) {
    const limit = a[s]?.latP95 == null ? null : a[s].latP95 + FRAME_MS;
    check(`${s} 延迟 p95 ≤ 基线 + ${FRAME_MS}ms`, b[s]?.latP95 ?? null, limit, (x, l) => x <= l);
  }
  return checks;
}

/** Applies the §6 decision rules. */
export function verdict(checks, health) {
  if (checks.some((c) => c.pass === null)) return '数据不全，无法判定';
  if (health.stalls > 0) return 'No-Go 候选：出现解码卡顿（stalls > 0），先排查硬件解码器缓帧';
  const byName = (prefix) => checks.filter((c) => c.name.startsWith(prefix));
  const bandwidthOk = checks.filter((c) => c.name.includes('带宽') && !c.name.startsWith('S1')).every((c) => c.pass);
  const latencyOk = byName('S').filter((c) => c.name.includes('延迟')).every((c) => c.pass);
  if (checks.every((c) => c.pass)) return 'Go（性能门槛全部达标；功能门槛需人工确认）';
  if (bandwidthOk && latencyOk) return '有条件 Go：带宽达标，CPU/帧率未达标——评估方案 B（WebGL 合成）';
  return 'No-Go：带宽或延迟未达标';
}

const fmt = (x, digits = 1) => (x === null || x === undefined ? '—' : Number(x).toFixed(digits));

export function renderReport(groups) {
  const lines = ['# RDP 原型测量汇总', ''];
  for (const [path, title] of [
    ['A', '路径 A：RFX 基线'],
    ['B', '路径 B：EGFX + H.264 / WebCodecs'],
  ]) {
    lines.push(`## ${title}`, '');
    lines.push('| 场景 | 轮数 | 下行 Mbps（服务端） | 下行 Mbps（客户端） | CPU % | longtask ms/5s | fps | 延迟 p50 / p95 ms |');
    lines.push('|---|---|---|---|---|---|---|---|');
    for (const s of SCENARIOS) {
      const g = groups[path]?.[s];
      lines.push(
        g
          ? `| ${s} ${SCENARIO_NAMES[s]} | ${g.runs} | ${fmt(g.serverMbps, 2)} | ${fmt(g.clientMbps, 2)} | ${fmt(g.cpu)} | ${fmt(g.longtaskMs, 0)} | ${fmt(g.fps)} | ${fmt(g.latP50)} / ${fmt(g.latP95)} |`
          : `| ${s} ${SCENARIO_NAMES[s]} | 0 | — | — | — | — | — | — |`,
      );
    }
    lines.push('');
  }

  const health = { hardware: true, decoded: 0, errors: 0, stalls: 0, decodeMsMax: 0, formats: new Set() };
  for (const g of Object.values(groups.B ?? {})) {
    if (!g.h264) continue;
    health.hardware &&= g.h264.hardware;
    health.decoded += g.h264.decoded;
    health.errors += g.h264.errors;
    health.stalls += g.h264.stalls;
    health.decodeMsMax = Math.max(health.decodeMsMax, g.h264.decodeMsMax);
    g.h264.formats.forEach((f) => health.formats.add(f));
  }
  lines.push('## H.264 解码健康度（路径 B，全部轮次）', '');
  lines.push(
    `硬件解码：${health.hardware ? '是' : '否/不全'} · 解码帧：${health.decoded} · 错误：${health.errors} · 卡顿：${health.stalls} · 单帧最长解码：${fmt(health.decodeMsMax)} ms · 像素格式：${[...health.formats].join(', ') || '—'}`,
    '',
  );

  const checks = evaluate(groups.A ?? {}, groups.B ?? {});
  lines.push('## 性能门槛（计划 §6）', '', '| 指标 | 实测 | 门槛 | 结果 |', '|---|---|---|---|');
  for (const c of checks) {
    const isRatio = c.name.includes('基线') && !c.name.includes('fps') && !c.name.includes('延迟');
    const show = (x) => (x === null ? '—' : isRatio ? `${fmt(x * 100, 0)}%` : fmt(x));
    lines.push(`| ${c.name} | ${show(c.actual)} | ${show(c.limit)} | ${c.pass === null ? '缺数据' : c.pass ? '✅' : '❌'} |`);
  }
  lines.push('', `**结论：${verdict(checks, health)}**`, '');
  lines.push(
    '功能门槛需人工确认：AVC420 生效（事件 162）、无花屏/错位、resize 正常、不支持 WebCodecs 时回落、现有 RDP 功能无回归。',
  );
  return lines.join('\n');
}

export function loadMeasurements(dir) {
  const groups = {};
  for (const name of readdirSync(dir).sort()) {
    const m = /^([AB])-(S[1-4])-(\d+)$/.exec(name);
    if (!m) continue;
    const runDir = join(dir, name);
    const read = (file) => (existsSync(join(runDir, file)) ? readFileSync(join(runDir, file), 'utf8') : '');
    const clientText = read('client.json').trim();
    const run = summarizeRun({
      client: clientText ? JSON.parse(clientText) : [],
      server: parseServerLog(read('server.log')),
      cpu: parseCpu(read('cpu.txt')),
    });
    ((groups[m[1]] ??= {})[m[2]] ??= []).push(run);
  }
  const out = {};
  for (const [path, scenarios] of Object.entries(groups)) {
    out[path] = {};
    for (const [s, runs] of Object.entries(scenarios)) out[path][s] = aggregate(runs);
  }
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const dir = process.argv[2];
  if (!dir) {
    console.error('Usage: node scripts/rdp-poc-report.mjs <measurements-dir>');
    process.exit(2);
  }
  console.log(renderReport(loadMeasurements(dir)));
}
