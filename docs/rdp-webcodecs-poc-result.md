# RDP EGFX + WebCodecs 原型：结论

> 计划见 [rdp-webcodecs-poc.md](rdp-webcodecs-poc.md) · 日期：2026-10-27 · 状态：**功能验证通过，性能未测量，§6 判定未执行**

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
5. **不可部署**：Gatwy 依赖是 `file:../../../IronRDP-poc/...`，Docker 镜像构建无法解析；开关只有 localStorage，没有设置界面。
6. **上游漂移**：fork 固定在一个 commit，EGFX 相关代码上游几乎每天变化，且 web 客户端架构可能被替换（上游 #790）。
7. **上游问题**：该 commit 上 `ironrdp-egfx` 单测无法编译（一处调用未跟随签名变更），fork 已修一行。

## 5. 后续方向（待决策）

| 方向 | 内容 | 前提 / 代价 |
|---|---|---|
| A. 补测量再定 | 只测 S4 视频（A/B 各 3 轮），跑 `scripts/rdp-poc-report.mjs` | 约半天；是唯一能回答"值不值"的路径 |
| B. 贡献上游 | 把 `AsyncH264Decoder` + web 端 EGFX 拆成 PR 提给 Devolutions/IronRDP，先在 #790 沟通 web 架构方向 | 降低长期 fork 维护成本；节奏受上游评审控制 |
| C. 产品化接入 Gatwy | fork 构建产物以 vendored tgz 或私有 registry 引入、修 Docker 构建、设置界面开关、默认关闭 | 需先有 A 的数据支撑；同时承担 §4.6 的维护成本 |
| D. 停止 | 保留分支与文档，跟进上游 | 无额外成本 |
