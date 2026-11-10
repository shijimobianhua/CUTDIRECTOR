# M1–M3 首版：Codex 总执行书

- 日期：2026-11-04
- 执行：Codex（`gpt-6.1-sol`，high reasoning）
- 验收：DSH（只看测试、diff 摘要、运行结果）
- 分支：`m1-m3-first`
- 依据：`Video-agent执行包/04_给DSH_后续波次生成规则.md`、`Video-agent-PRD.md`、`Video-agent技术执行手册.md`、`docs/adr/ADR-001..005`

## 1. 任务

在现有 M0 仓库上实现 **M1–M3 首版**：可运行、可测试、可重开的最小视频工作台，包含工程服务、时间/字幕、单写命令、页面/Agent 共同编辑、预览/导出、真实任务闭环和打包说明。

“首版完成”指：

- 代码在 `src/`、`contracts/`、`skills/`、`test/` 落地；
- `node --test` 全绿；
- 有可启动的 Host/Client 插件包与最小工作台；
- A-01 能走完“读取 → 改字 → 预览/导出 → 重开”；
- M1-T1—T7、M2-T1—T8、M3-T1—T5 的代码/自动化验收项有落点；
- 人工审片、真实 ASR 模型质量、视觉像素级验收可以标注待人工，但不能假装通过。

## 2. 硬规则

1. 不联网下载模型/依赖；Node 只用内置模块与仓库已有包。需要外部依赖时，先写 provider-not-ready，不阻塞主流程。
2. 私有媒体不出本机；不把 A-01、转写、密钥提交进 Git。
3. 一个工程一个权威 writer；页面与 Agent 都经命令服务，不直接改 `project.json`。
4. 不伪造测试/截图/成功；失败写 `blocked` 或 `provider-not-ready`。
5. 不删除 M0 证据；不改 M0 插件夹具，除非 M1 明确替代。
6. 每张卡或每个 milestone 提交一次；提交信息 `m1: ...` / `m2: ...` / `m3: ...`；不 push。
7. 先读 `04` 的卡定义，再实现；不要自己发明与 PRD 冲突的语义。
8. UI 用现有 DSH Client 插件方式（`window.__ModuleLoader__`、slot、locale），不启动独立浏览器。

## 3. 里程碑

### M1 最小共同编辑

- **T1 工程所有权/字段/原生映射**：`contracts/project.schema.json` 或 JS schema + 正反例；ProjectHead/Asset/Segment/Track/Transcript/Caption/Revision/Artifact/Feedback 字段与 ID。
- **T2 时间/媒体/字幕**：有理数 fps、半开区间、帧量化、VFR→CFR、字幕锚点；测试 30000/1001、非网格、非零起点、旋转、缺音轨、中文路径。
- **T3 命令服务**：projectId/baseRevision/commandId/op/target/params/错误码/幂等摘要；单写、原子提交、历史。
- **T4 revision/恢复/重开**：r3 恢复 r1 生成 r4；重开当前 revision。
- **T5 页面/Agent 共用入口**：Client 面板/片段列表/字幕编辑/选中/冲突态；Host 工具；最小主/revise Skill。
- **T6 manifest/job/预览导出**：renderManifest、缓存键、businessJob/attempt、r1 渲染中编辑到 r2 产物仍属 r1；半成品不发布。
- **T7 AC-01—AC-05 集成**：同一工程读取、人工后接续、旧基准冲突、幂等/回滚、重开。

验收命令（示例，按实际脚本调整）：

```bash
node --test
node tools/m1-acceptance/run.js
```

### M2 真实剪辑闭环

- **T1 中文 ASR**：`src/adapters/asr/**`；Transcript schema、时间精度、缺失/不确定、provider 就绪状态。没有本地模型时，实现 provider 接口 + 真实 fixture 回放，并明确 `provider-not-ready`，不要伪造真实转写。
- **T2 分段/关键帧/短预览**：ffmpeg 抽帧、短预览、来源范围读取、artifact range read。
- **T3 真实内容提案/roughcut**：来源可回查、保留项有证据、缺口明确；提案校验器/property tests。
- **T4 重排/裁剪/字幕实例保护**：AC-02/03/04 不退步。
- **T5 完整渲染/字幕/音频/缓存**：FFmpeg filtergraph、烧录/SRT、音频、缓存、r1/r2 不混。
- **T6 文件/内容检查/报告**：ffprobe、帧数、音轨、字幕、hash；文件层/内容层/人工层分开。
- **T7 任务可靠性/取消/重启/媒体边界**：同请求不重复启动、最多一条未结算 attempt、半成品不发布；VFR/30000/1001/旋转/缺音轨/中文路径/外部媒体丢失。
- **T8 AC-06—AC-09**：回归运行器/证据索引。

### M3 联合验收与发布

- **T1 五个 Skill 发布候选**：正文、description、依赖、hash、场景覆盖；可发现/加载/追溯/真实执行。
- **T2 第二专项夹具**：选择/范围组合/切换/缺能力；受保护内容/diff 实际检查。
- **T3 作品/工程入口/反馈/报告**：项目可重开、产物版本清楚、反馈关联正确。
- **T4 固定任务 + 保留任务回归**：AC-01—AC-10 逐项记录；限制清单。
- **T5 打包安装/回退**：干净安装/可复现；用户文档、已知问题、回退说明。

## 4. 建议目录

```text
src/core/          工程/命令/revision/事件
src/adapters/      fablecut、media、render、asr
src/host/          DSH Host 插件接线
src/client/        DSH Client 面板/工作台
skills/            video-editing / footage-intake / roughcut / render-qa / revise
contracts/         schema/错误码/ID 规则
test/              unit/integration/AC/夹具
tools/             CLI 验收/导出/回归
```

## 5. 每卡完成标准

- 代码 + 单测/集成测试；
- 至少一个正例、一个反例；
- 失败错误码可读；
- README/ADR 只更新必要部分；
- 提交信息明确；
- 最终报告写：完成卡、测试命令/结果、提交 hash、blocked/未验证项。

## 6. 不要停

遇到不确定：选择与 PRD/ADR 一致的最保守实现，写 TODO/blocker，继续下一卡；不要在聊天里等确认。  
如果时间/上下文不足：优先完成 M1-T1—T7，提交并报告；不要用假实现填满 M2/M3。

## 7. 最终报告格式

```text
完成：M1-T? ... / M2-T? ... / M3-T? ...
测试：命令 + 结果
提交：hash + 标题
可运行：启动命令 / 端口 / 页面
未完成/blocked：...
人工待验：...
```
