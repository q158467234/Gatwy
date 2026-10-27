# RDP 原型测量记录

> 计划与指标定义见 [rdp-webcodecs-poc.md](rdp-webcodecs-poc.md) §5–§6。

## 环境记录（每次测量前填写）

| 项 | 值 |
|---|---|
| 日期 | |
| IronRDP 构建 | `IronRDP-poc` commit：，wasm-opt：关 |
| Gatwy 分支 / commit | `poc/rdp-webcodecs` @ |
| RDP 服务器 | Windows 版本：，GPU：，组策略（§2）：已按计划设置 / 偏差： |
| 服务器事件 162 / 170 | |
| 客户端 | Chrome 版本：，GPU / 驱动：，`chrome://gpu` Video Decode： |
| 分辨率 / 缩放 | 1920×1080 / 100% |
| 网络 | 网关 ↔ 服务器：，浏览器 ↔ 网关： |

## 操作步骤

1. 设置 → 管理 → General → RDP：打开 Performance metrics。
2. 同一页选择图形模式并保存，然后打开 RDP 会话；会话界面应全屏到 1920×1080。
   - 路径 A（RFX 基线）：Classic (RemoteFX)
   - 路径 B（EGFX + H.264）：Graphics pipeline + H.264；
     控制台应出现 `[RDP] H.264 via WebCodecs, hardware: true` 与 `Graphics pipeline (EGFX) capabilities confirmed`，
     服务器事件 162 应显示 AVC420。解码器统计（`decoded`/`errors`/`stalls`/`formats`/`decodeMsMax`）随每个窗口记录在
     `window.__gatwyRdpMetrics.windows[i].extra`。
3. 打开 Chrome 任务管理器（Shift+Esc），定位该标签页进程。
4. 每个场景：静止 5s → 开始动作并计时 60s → 停止动作。期间每 10s 读一次 CPU，取 6 个读数均值。
5. 场景结束后，在控制台执行以下代码，复制最近 12 个窗口（60s）：
   ```js
   copy(JSON.stringify(window.__gatwyRdpMetrics.windows.slice(-12)))
   ```
   服务端从日志中取同一时段的 `[rdp-metrics]` 行（按 `session` 过滤）。
6. 每个场景测 3 轮。先用 `node scripts/rdp-poc-report.mjs --init data/rdp-poc`（只测视频：末尾加 `S4`）生成空目录，每轮的原始数据存一个目录 `data/rdp-poc/<路径>-<场景>-<轮次>/`（如 `A-S4-1`、`B-S2-3`），内含：
   - `client.json`：第 5 步 `copy(...)` 的输出
   - `server.log`：同一时段服务端的 `[rdp-metrics]` 行（可连同其他日志一起粘贴，脚本只取这些行）
   - `cpu.txt`：第 4 步的 CPU 读数，空格或逗号分隔
7. 生成汇总表与 §6 判定：`node scripts/rdp-poc-report.mjs data/rdp-poc`。
   脚本取每轮均值（延迟取窗口中位数）、3 轮中位数，按 §6 门槛逐项判定并给出 Go / 有条件 Go / No-Go；
   功能门槛仍需人工确认。

场景定义：S1 记事本持续打字；S2 浏览器匀速滚动长网页；S3 反复拖动非最大化窗口；S4 全屏播放 1080p30 视频。

## 结果

由第 7 步的脚本生成，粘贴到这里；手工填写时口径相同：数值取 60s 内窗口的均值（延迟取窗口 p50/p95 的中位数），3 轮再取中位数。

### 路径 A：RFX 基线（T1）

| 场景 | 下行 Mbps（服务端） | 下行 Mbps（客户端） | CPU % | longtask ms/5s | fps | 延迟 p50 / p95 ms |
|---|---|---|---|---|---|---|
| S1 打字 | | | | | | |
| S2 滚动 | | | | | | |
| S3 拖拽 | | | | | | |
| S4 视频 | | | | | | |

### 路径 B：EGFX + H.264 / WebCodecs（T5）

| 场景 | 下行 Mbps（服务端） | 下行 Mbps（客户端） | CPU % | longtask ms/5s | fps | 延迟 p50 / p95 ms |
|---|---|---|---|---|---|---|
| S1 打字 | | | | | | |
| S2 滚动 | | | | | | |
| S3 拖拽 | | | | | | |
| S4 视频 | | | | | | |

## 备注 / 异常
