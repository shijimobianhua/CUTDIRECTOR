# CUTDIRECTOR

AI 剪辑导演。

M1 implementation is on `m1-m3-first`; see [startup and limitations](docs/M1-running.md) and [per-card evidence](docs/tasks/M1-progress.md). Run `node tools/m1-acceptance/run.cjs` (explicit test files with timeouts). Historical M0 evidence follows unchanged.

- 当前阶段：**M0-T5 阶段门（有条件通过）**（2026-11-04）
- 状态：证据阶段；**未进入 M1 实现，未写产品代码**；M0 有条件通过，M1 卡骨架已交付
- 工程仓库（暂定）：`E:\Deepseek-product\Agent\Video-agent`
- 方案基线（只读引用，不复制进本仓库）：`E:\AI-Projects\My products\Agent\video-agent`
- 执行包：`Video-agent执行包/`（现在发 `03`；`01` 给 WorkBuddy；`02` 给 Codex；`04` 门后再用）

## 1. 现在做到哪里

| 项 | 状态 | 位置 |
| --- | --- | --- |
| Git 仓库与任务卡目录 | 已初始化 | 本仓库 `main` 分支 |
| M0-T1 任务卡 | 进行中；WorkBuddy v2 已入库；A-01 已探测；A-02 与 T-A 保留项待补 | [M0-T1](docs/tasks/M0-T1.md) |
| M0-T1 素材清单 / 任务登记 | A-01 已填；A-02 缺；T-C 由 A-01 覆盖竖屏/HEVC | [素材清单](docs/handoffs/M0-T1_素材清单.md) / [任务登记](docs/handoffs/M0-T1_任务登记.md) |
| M0-T2 任务卡 / 评审口径 | G0-1 窄口径通过（适配器唯一 writer）；FableCut 单路线；M0-T3 已过 | [M0-T2](docs/tasks/M0-T2.md) / [评审口径](docs/handoffs/M0-T2_评审口径.md) |
| 第一轮验收 | WorkBuddy/Codex 第一轮验收结论 | [M0-02 产物验收](docs/handoffs/M0-02_产物验收.md) |
| 第二轮验收 | WorkBuddy v2、Codex 设计、G0-1 适配器预检 | [M0-05 第二轮验收](docs/handoffs/M0-05_第二轮验收.md) |
| M0-T3 任务卡 | **有条件通过**：插件/工具/面板读取/事件/Skill 已实测；按钮点击待人工 | [M0-T3](docs/tasks/M0-T3.md) |
| M0-T3 证据 | 安装、工具调用、面板计数、事件、Skill、A-01 媒体 | [M0-T3 证据](docs/handoffs/M0-T3_证据.md) |
| M0-T3 插件 | `@local/video-m0t3` 0.1.0（已安装到 desktop profile） | [plugin](test/fixtures/M0-T3/plugin/) |
| M0-T4 任务卡 | **通过（模拟重启）**：成功/失败/取消/重启核对 | [M0-T4](docs/tasks/M0-T4.md) |
| M0-T4 证据 | 业务 job ↔ DSH runtime job 映射与日志 | [M0-T4 证据](docs/handoffs/M0-T4_证据.md) |
| M0-T4 插件 | `@local/video-m0t4-jobs` 0.1.0（已安装） | [plugin](test/fixtures/M0-T4/plugin/) |
| M0-T5 阶段门 | **有条件通过**；A-01 FFmpeg smoke 已过；面板按钮待人工 | [M0-T5 阶段门](docs/handoffs/M0-T5_阶段门.md) |
| A-01 导出 Smoke | **通过（FFmpeg）**：预览代理、5s 导出、中文字幕烧录 | [M0-T5 导出 Smoke](docs/handoffs/M0-T5_导出Smoke.md) |
| ADR-001/002/004 | 主编辑底座初定；预览/导出路线；DSH 版本与接线 | [ADR-001](docs/adr/ADR-001-主编辑底座.md) / [ADR-002](docs/adr/ADR-002-预览导出与媒体.md) / [ADR-004](docs/adr/ADR-004-DSH版本与接线.md) |
| ADR-003/005 | 中文 ASR 计划；存储/原子提交计划 | [ADR-003](docs/adr/ADR-003-中文ASR计划.md) / [ADR-005](docs/adr/ADR-005-存储与原子提交计划.md) |
| M1 卡骨架 | M1-T1 项目服务；M1-T2 最小工作台 | [M1-T1](docs/tasks/M1-T1.md) / [M1-T2](docs/tasks/M1-T2.md) |
| 用户待办与默认决定 | 已替你处理的事项；只剩 A-02 与 T-A 保留项 | [M0-03](docs/handoffs/M0-03_用户待办与默认决定.md) |
| 环境与工具 | FFmpeg 4.4.1 / ffprobe 3.4.2；DSH 0.2.1-rc.5；适配器 spike | [开工基线](docs/handoffs/M0-00_开工基线.md) |
| 第二轮分发话术 | 已使用；结果见 M0-05 | [M0-04 分发话术](docs/handoffs/M0-04_第二轮分发话术.md) |
| 产品代码 | 未开始（按 `03` §10） | — |

## 2. 目录

```text
Video-agent/
├─ README.md
├─ .gitignore
├─ Video-agent执行包/          M0 分发与总控文件（只读输入）
├─ 回收/                      第二轮接收区（gitignore；第一轮证据已移出）
├─ docs/
│  ├─ tasks/                   M0-T1、M0-T2 任务卡
│  ├─ handoffs/                素材、验收、默认决定、第二轮任务、复跑日志
│  └─ adr/                     ADR-001 草案
└─ test/
   ├─ fixtures/M0-T1/         只放元数据/说明，不放真实媒体
   └─ spikes/g0-1/            G0-1 写入口适配器 spike（非产品代码）
```

第一轮证据在工程仓外：`E:\Deepseek-product\Agent\video-agent-evidence\2026-11-03-M0\`；真实媒体在 `E:\Deepseek-product\Agent\video-agent-media\M0-T1\`。

`src/`、`skills/`、`contracts/` 等目录在 M0-T5 通过前不建立：M0 不写产品代码。

## 3. 本仓库现在不做

- 不做 M1 生产实现、完整工作台、五个 Skill 正文；
- 不接真实 ASR、不做完整渲染管线；
- 不把真实素材、转写、密钥提交进 Git 或发到云端上下文；
- 不猜 DSH API；精确版本与接线在 M0-T3 记录（ADR-004）。

## 4. 下一步

1. 你只差 **A-02 教程素材** 与 **T-A 四类保留项**（产品名/数字/否定/限制）；A-01 已收到；
2. 第二轮已完成：WorkBuddy v2 已入库，Codex 设计已验收；不需要再发给它们；
3. M0-T3 有条件通过：插件/工具/面板/事件/Skill 已实测；**请点一次面板“加测试片段”**完成按钮人工确认；
4. M0-T4 已通过（模拟重启）：业务 job 映射 DSH runtime job，覆盖成功/失败/取消/重启核对；
5. M0-T5 **有条件通过**：ADR-001/002/003/004/005 与 M1-T1/T2 骨架已交付；A-01 FFmpeg 预览/导出 smoke 已过；面板按钮仍未确认；
6. 不把 M0-T5 写成“全部通过”；M1-T1 可做内部服务，M1-T2 前仍需面板确认与完整工程导出。

## 5. 文档基线

三份方案文档与执行包的路径、SHA256、环境信息记录在 [M0-00 开工基线](docs/handoffs/M0-00_开工基线.md)。

## M2/M3 first-version update

See [offline release and rollback](docs/M3-running.md), [M2 evidence](docs/tasks/M2-progress.md), and [M3 evidence](docs/tasks/M3-progress.md) for current capability boundaries. Run `node tools/m3-acceptance/run.cjs` for explicit-file regression with timeouts. Earlier M0/M1 records below are historical; real ASR, live DSH/LLM acceptance and human review remain unverified.
