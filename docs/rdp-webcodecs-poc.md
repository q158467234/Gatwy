# RDP H.264 (EGFX + WebCodecs) 原型：任务拆分与验收指标

> 状态：草案 · 时间盒：10 个工作日（单人） · 日期：2026-10-27

## 1. 目标与非目标

**目标**：用最小代价验证"浏览器端 RDP 走 EGFX H.264 + WebCodecs 硬解"相对现有 RFX 路径，在带宽 / 客户端 CPU / 延迟上是否有足以立项的收益。

**非目标（原型阶段不做）**：
- AVC444（只做 AVC420）
- 方案 B（WebGL 全 GPU 合成）；本原型走方案 A：WebCodecs 解码 → `copyTo` 读回 → 复用上游 CPU 合成器
- Firefox / Safari 适配；多显示器；RemoteApp
- UDP 传输
- 合入 Gatwy 主分支；原型产物以独立分支 + 私有构建存在

## 2. 基准环境（固定，所有对比测量用同一套）

| 项 | 取值 |
|---|---|
| RDP 服务器 | Windows 11 Pro 24H2，带独显（硬编），另备一台无 GPU 的 Windows 11 作对照 |
| 服务器组策略 | `Prioritize H.264/AVC 444 graphics mode`：**禁用**（强制 AVC420）；`Configure H.264/AVC hardware encoding`：启用；`Use hardware graphics adapters for all RDS sessions`：启用 |
| 网关 | 本仓库 Docker 镜像，与服务器同局域网 |
| 客户端 | Chrome 稳定版（记录版本号），记录 GPU 型号与驱动；`chrome://gpu` 中 Video Decode 为 Hardware accelerated |
| 分辨率 | 1920×1080，100% 缩放 |
| 上游基线 | IronRDP master 固定一个 commit（T0 中确定并记录），fork 基于该 commit |

## 3. 技术方案要点

1. **web 端开启 EGFX**：`ironrdp-web/src/session.rs` 中 `support_dyn_vc_gfx_protocol: false` → 可配置；在 `DrdynvcClient`（`session.rs:1737` 附近）注册 `GraphicsPipelineClient`；会话循环里 `drain_output()` / `take_output_reset()` 写入帧缓冲后复用现有 `gui.draw` 路径。
2. **异步解码接口**（改 `ironrdp-egfx`，这是原型的核心改动）：
   - 新增 `AsyncH264Decoder`：`submit(token, data)` 立即返回；解码结果经 `complete(token, Yuv420Frame | error)` 回填。
   - `GraphicsPipelineClient` 在某帧（StartFrame..EndFrame）出现未完成的 AVC 命令时，**按序缓存**该帧后续所有会改动 surface 的命令（SolidFill / SurfaceToSurface / CacheToSurface / WireToSurface 等），全部 AVC 结果回来后按原顺序应用，再生成 `FrameAcknowledge`。
   - 新增 `poll_ready() -> Vec<DvcMessage>`，供 web 会话在 JS 解码回调到达时主动拉取待发送的 ack。
   - 保留原同步 `H264Decoder` 路径不变，两者二选一。
3. **JS 桥**：通过 `SessionBuilder.extension(...)` 注入一个 WebCodecs bridge 对象：
   - `VideoDecoder` 配置：`codec` 由首个 SPS 推导（`avc1.PPCCLL`），不传 `description`（按 Annex B 输入），`hardwareAcceleration: 'prefer-hardware'`，`optimizeForLatency: true`。
   - 连接前 `VideoDecoder.isConfigSupported()`；不支持则**不声明 AVC 能力**，回落 RFX。
   - `output` 回调中 `frame.copyTo()`（处理 I420 / NV12 两种 format）→ 写入 WASM 内存 → `complete(token, …)` → `frame.close()`。
   - 解码错误：`reset()` + 丢弃到下一个 IDR；通过上游已有的"丢弃不可解码更新"路径处理（`dropped_updates` 计数）。
4. **Gatwy 侧**：`packages/client/src/components/RdpSession.tsx` 的 `SessionBuilder` 链上加 extension；依赖改为指向本地构建的 tgz。服务端 `rdpProxy.ts` 不改协议，只加可选的字节计数（见 T1）。

## 4. 任务拆分

| ID | 任务 | 估时 | 交付物 | 完成判据 |
|---|---|---|---|---|
| T0 | Fork 与构建链 | 1.5d | fork 分支；`wasm-pack` 构建脚本；产出 `iron-remote-desktop-rdp-*.tgz` | 用 master 构建产物替换 0.7.0 后，Gatwy 现有 RDP 功能（登录、键鼠、剪贴板、resize、录屏）全部正常；如 master API 与 `packages/client/src/types/ironrdp.d.ts` 不兼容，先修适配 |
| T1 | 测量埋点 + RFX 基线 | 1d | `rdpProxy.ts` 可选字节计数（环境变量开关，每 5s 输出上下行字节）；客户端帧率/流水线延迟埋点；基线数据表 | 4 个场景（见 §5）各测 3 轮，数据入表 |
| T2 | web 端开启 EGFX（不含 H.264） | 2d | EGFX 通道注册、输出排空、ResetGraphics/resize 处理 | Windows 11 上 EGFX 协商成功（服务器事件日志可见 GFX 模式），画面正确，30 分钟无断开；此时服务器走 RemoteFX/ClearCodec |
| T3 | `ironrdp-egfx` 异步解码接口 | 2.5d | `AsyncH264Decoder`、帧内命令缓存、`poll_ready`；单元测试（用模拟解码器乱序/延迟回填） | 单测覆盖：AVC 后跟 SolidFill/SurfaceToSurface 的顺序正确；解码失败时帧被丢弃但会话不断；ack 只在帧应用后发出 |
| T4 | WebCodecs JS 桥 + 接入 | 2d | bridge 模块；能力探测与回落；NV12/I420 读回 | 服务器事件日志确认 AVC420 生效；画面无花屏/错位；关闭硬件加速的 Chrome 上能正确回落到 RFX |
| T5 | 测量与结论 | 1d | 对比数据表 + 一页结论（Go / No-Go + 理由） | §6 中每个指标都有数值 |
| — | 缓冲 | 0~1d | | |

合计 10 个工作日。**止损点**：T3 结束（第 7 天）时若异步接口仍无法保证命令顺序正确，停止并以"需上游配合"结论收尾。

## 5. 测量方法

**场景**（每个 60 秒，每场景 3 轮取中位数）：
1. **S1 办公**：记事本中持续输入文字
2. **S2 滚动**：浏览器中匀速滚动长网页
3. **S3 拖拽**：反复拖动一个最大化以下的窗口
4. **S4 视频**：全屏播放 1080p30 视频

**指标采集**：

| 指标 | 采集方式 |
|---|---|
| 带宽（Mbps，下行） | T1 中 `rdpProxy.ts` 的字节计数 |
| 客户端 CPU（%） | Chrome 任务管理器中该标签页渲染进程 CPU，录屏读数取均值；辅以 Performance 面板确认热点 |
| GPU 解码是否生效 | `chrome://media-internals` 中 decoder 名称（非 FFmpeg/软件解码器） |
| 帧率（fps） | 客户端埋点：每秒 `EndFrame` 被应用的次数 |
| 流水线延迟（ms，p50/p95） | 客户端埋点：PDU 到达 WASM → 对应区域 `draw` 完成 |
| 服务器端编码方式 | 事件查看器 `Microsoft-Windows-RemoteDesktopServices-RdpCoreTS/Operational`，事件 ID 162（AVC 模式）、170（硬件编码） |
| 丢弃更新数 | `dropped_updates` 计数 |

## 6. 验收指标（Go / No-Go）

**功能门槛（全部满足才进入性能评估）**：
- [ ] AVC420 协商成功并持续使用（事件 162 可见）
- [ ] S1–S4 无花屏、错位、残影；`dropped_updates` 在 30 分钟会话中 = 0（不含人为制造的解码错误）
- [ ] resize 后画面正确（允许走重连）
- [ ] WebCodecs 不可用时自动回落 RFX，用户无感知
- [ ] T0 列出的现有 RDP 功能无回归

**性能门槛（相对 T1 的 RFX 基线）**：

| 指标 | Go 条件 |
|---|---|
| S4 视频下行带宽 | ≤ 基线的 50% |
| S2/S3 下行带宽 | ≤ 基线的 70% |
| S4 客户端 CPU | ≤ 基线的 70% |
| S1 客户端 CPU、带宽 | 不劣于基线 +10% |
| S4 帧率 | ≥ 基线，且 ≥ 25fps |
| 流水线延迟 p95（全部场景） | ≤ 基线 p95 + 1 帧（33ms） |

**结论规则**：
- 功能门槛 + 全部性能门槛达标 → **Go**：立项进入 AVC444、兼容性矩阵与上游沟通（向 Devolutions/IronRDP 提异步解码接口 PR）
- 仅带宽达标、CPU/延迟不达标 → **有条件 Go**：评估方案 B（WebGL 合成）是否值得
- 带宽不达标或延迟超标且原因是硬解码器缓存帧（`optimizeForLatency` 无效）→ **No-Go**：停止，回到跟进上游

## 7. 风险

| 风险 | 影响 | 应对 |
|---|---|---|
| master 与 0.7.0 API 不兼容，T0 超时 | 吃掉缓冲 | T0 只做最小适配；超过 2.5d 则改为基于 0.7.0 tag 手动 backport EGFX |
| 硬件解码器输出缓存 1+ 帧 | 延迟超标 | 记录各 GPU 实测；属于 No-Go 判据，不在原型内硬解 |
| `copyTo` 读回 + CPU 合成抵消 GPU 解码收益 | CPU 指标不达标 | 属于"有条件 Go"判据，数据留给方案 B 评估 |
| 上游 egfx 快速演进 | fork 难以 rebase | 原型固定 commit，不追上游；Go 之后再定合入策略 |
| 多 surface 共用解码器问题（上游 #2033） | 特定场景花屏 | 原型只测单 surface 桌面，记录为已知限制 |

## 8. 产出物清单

1. IronRDP fork 分支（含 T2–T4 改动与单测）
2. Gatwy 原型分支（依赖替换、extension 接入、`rdpProxy.ts` 字节计数）
3. 基线与对比数据表（§5 全部指标 × 4 场景 × 2 路径）
4. 一页结论：Go / 有条件 Go / No-Go，附理由与下一步
