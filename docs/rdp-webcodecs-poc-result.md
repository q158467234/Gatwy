# RDP EGFX + WebCodecs 原型：结论

> 计划见 [rdp-webcodecs-poc.md](rdp-webcodecs-poc.md) · 日期：2026-10-27 · 状态：**功能验证通过，性能未测量，§6 判定未执行；已按方向 C 接入自用部署（见 §6）**

## 1. 结论

- **可行性：成立。** 浏览器端 RDP 可以走 EGFX，并由 WebCodecs 解码 H.264（AVC420），在 Windows 主机上协商成功并出图。
- **是否值得做：未知。** 按决定跳过了 T1 基线与 T5 对比测量，§6 的带宽 / CPU / 延迟门槛均无数据，不能给出 Go / No-Go。
- **最大的未验证风险：解码器缓帧。** 实现一次只送一帧（见 §3），如果硬件解码器要等下一帧才输出当前帧，会触发 200 ms 看门狗 → flush → 等下一个 IDR，表现为画面周期性卡住。这在测试 GPU 上是否发生，只有 `stalls` 计数能回答，目前没有采集。

## 2. 已验证 / 未验证

| 项 | 状态 | 依据 |
|---|---|---|
| IronRDP master 替换 npm 0.7.0，现有 RDP 功能无回归 | ✅ 已验证 | T0 人工验证 |
| web 端 EGFX 协商（无 H.264） | ✅ 已验证 | T2：控制台 `Graphics pipeline (EGFX) capabilities confirmed` |
| EGFX + WebCodecs H.264 协商与出图 | ✅ 已验证 | T4：人工确认协商成功 |
| 异步解码下命令顺序与同步路径一致 | ✅ 单测保证 | T3：8 个等价性测试，去掉排队逻辑后 5 个失败 |
| 硬件解码是否实际生效（`hardware`、像素格式） | ❓ 未采集 | 需 `window.__gatwyRdpMetrics.windows.at(-1).extra` |
| 解码卡顿（`stalls`）、解码错误（`errors`） | ❓ 未采集 | 同上 |
| 带宽、客户端 CPU、帧率、延迟相对 RFX | ❓ 未测量 | 计划 §5–§6 |
| 长时间稳定性（30 分钟）、resize、回落 | ❓ 未确认 | 计划 §6 功能门槛 |

## 3. 实现概要

| 位置 | 内容 |
|---|---|
| `ironrdp-egfx`（fork） | `AsyncH264Decoder`；`GraphicsPipelineClient` 在一帧 AVC420 未返回前按序缓存后续全部命令（含 EndFrame / FrameAcknowledge），回填后重放；一次只有一帧在途；不声明 AVC444 |
| `ironrdp-session`（fork） | `ActiveStage::complete_h264_decode`：回填、合成、编码回复 |
| `ironrdp-web`（fork） | `enable_egfx` / `h264_decoder` 扩展；`Send` 的排队解码器 + JS 桥 + 会话主循环的结果分支；canvas 跟随帧缓冲尺寸 |
| `iron-remote-desktop-rdp`（fork） | `WebCodecsH264Decoder`：Annex B / 长度前缀、SPS 推导 codec、关键帧门控、I420 / NV12 读回、卡顿看门狗、统计 |
| Gatwy | 依赖指向本地 fork 构建；`gatwy.rdpEgfx` / `gatwy.rdpH264` 开关；`rdpProxy` 字节计数与客户端渲染埋点；测量汇总脚本 |

fork：`/home/ljz/Documents/LWL/IronRDP-poc`，基于 Devolutions/IronRDP@3ca12ee，未推送。

## 4. 已知限制

1. **只有 AVC420**：彩色文字边缘会发糊；AVC444 需要两路流合成色度，未做。
2. **一次一帧在途**：解码器缓帧时会卡（见 §1）；高帧率下 WebCodecs 往返延迟直接限制帧率。
3. **读回 + CPU 合成**：解码在 GPU，但 `copyTo` 读回、YUV→RGB、合成、`putImageData` 仍在 CPU（方案 A 的固有代价）。
4. **无 wasm-opt**：构建环境下载不到 binaryen，wasm 体积 8.1 MB、未做二进制优化。
5. ~~不可部署~~：已解决，见 §6。
6. **上游漂移**：fork 固定在一个 commit，EGFX 相关代码上游几乎每天变化，且 web 客户端架构可能被替换（上游 #790）。
7. **上游问题**：该 commit 上 `ironrdp-egfx` 单测无法编译（一处调用未跟随签名变更），fork 已修一行。

## 5. 后续方向（待决策）

| 方向 | 内容 | 前提 / 代价 |
|---|---|---|
| A. 补测量再定 | 只测 S4 视频（A/B 各 3 轮），跑 `scripts/rdp-poc-report.mjs` | 约半天；是唯一能回答"值不值"的路径 |
| B. 贡献上游 | 把 `AsyncH264Decoder` + web 端 EGFX 拆成 PR 提给 Devolutions/IronRDP，先在 #790 沟通 web 架构方向 | 降低长期 fork 维护成本；节奏受上游评审控制 |
| C. 产品化接入 Gatwy | fork 构建产物以 vendored tgz 或私有 registry 引入、修 Docker 构建、设置界面开关、默认关闭 | 需先有 A 的数据支撑；同时承担 §4.6 的维护成本 |
| D. 停止 | 保留分支与文档，跟进上游 | 无额外成本 |

## 6. 自用部署（方向 C）

**决定**：只在自己的服务器上使用，不提交上游、不对外发布；接受 §1 的未测量风险与 §4 的限制。

| 项 | 做法 |
|---|---|
| IronRDP 依赖 | fork 构建产物打成 tgz 放在 `vendor/`（说明与更新步骤见 `vendor/README.md`），`packages/client` 以 `file:` 依赖引用；lockfile 带完整性哈希 |
| Docker | 构建阶段 `COPY vendor/ vendor/`；生产阶段只装服务端依赖，不需要也不包含该 tgz |
| 开关 | 服务端环境变量 `GATWY_RDP_H264=1`（`1`/`true`/`yes`）使所有 RDP 会话默认走 EGFX + WebCodecs H.264；随登录响应下发为 `features.rdpH264` |
| 单浏览器覆盖 | localStorage `gatwy.rdpH264` = `0`/`1` 关闭/开启 H.264；`gatwy.rdpEgfx` = `1` 只开 EGFX、`0` 两者都关 |
| 回落 | 浏览器无 WebCodecs H.264 时自动只用 EGFX 的其他编码；关闭开关即回到原 RFX 路径 |

启用：在 `docker-compose.yml` 的 `environment` 中加入 `GATWY_RDP_H264=1` 后重建镜像。

**出问题时**：先在该浏览器执行 `localStorage.setItem('gatwy.rdpH264', '0')` 重开会话确认是否与 H.264 有关；
控制台的 `[WebCodecsH264]` 告警与 `window.__gatwyRdpMetrics`（需 `gatwy.rdpMetrics=1`）中的 `stalls`/`errors` 是首要线索。
画面周期性卡住且 `stalls` 增长，即 §1 所述的解码器缓帧问题，此时应关闭该开关。
