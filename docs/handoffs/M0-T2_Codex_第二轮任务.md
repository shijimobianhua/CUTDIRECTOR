# Codex 第二轮任务：FableCut 写入口收敛的只读设计与证据补全

- 任务卡：M0-T2 第二轮
- 主责：Codex（只读代码审计与可复现证据）
- 验收人：DSH
- 时间盒：60—90 分钟（硬上限 2 小时）
- 状态：待分发
- 依据：[02 任务书](../../Video-agent执行包/02_给Codex_M0-T2_候选底座只读预研.md)、[M0-02 验收](M0-02_产物验收.md) §3、[M0-T2 卡](../tasks/M0-T2.md) §8.1

## 1. 目标

DSH 已实测 FableCut `579b08e` 可启动、可 HTTP 读写、旧基准 409、重启重开。现在要解决 **G0-1**：

> 把 FableCut 的 HTTP `/api/project`、MCP `fablecut_set_project` / `fablecut_patch_project`、历史恢复、项目切换等所有写路径，收敛成“同一时刻只有一个权威提交入口”；在不深 fork 的前提下，给出可实施的改造方案与验证计划。

本轮**只做设计与证据**，不写生产代码、不改候选源码、不替 DSH 选型。

## 2. 依赖

| 依赖 | 状态 |
| --- | --- |
| FableCut 固定 commit | `579b08ec1a789baec5cbf06d7430373460508d09` |
| 第一轮证据 | `E:\Deepseek-product\Agent\video-agent-evidence\2026-11-03-M0\M0-T2_Codex_证据\` |
| 第一轮结论 | 仅 1 条候选；D1/D2/D11 均为“部分”；G0-1 未过 |
| DSH 环境 | `@deepseek-ai/dsh 0.2.1-rc.5`；Node 24.21.0（DSH 运行时）/ 24.18.0（系统）；FFmpeg 见环境记录 |
| M0-T1 真实素材 | 仍缺失；本轮不依赖真实素材 |

## 3. 冻结契约

1. 候选固定 `579b08e`；不得换分支、不得升级依赖。
2. 只读候选源码；可在 `%TEMP%` clone，不得改候选文件。
3. 不得修改 `E:\Deepseek-product\Agent\Video-agent` 产品仓。
4. 不得写生产代码、插件、Client、Skill、DSH 适配器。
5. 输出只允许写在 `回收\第二轮\Codex\`。
6. 结论只用“满足/部分/不满足/未验证/阻断”，不用 1—5 分或百分比。
7. 不得把“设计可行”写成“已实现/已验证”。

## 4. 必须回答

### 4.1 写入口清单

枚举 FableCut 中所有会改变 `project.json` / 当前工程状态的路径，至少覆盖：

- HTTP `PUT /api/project`（`server.js`）；
- MCP `fablecut_set_project`、`fablecut_patch_project`（`mcp-server.js`）；
- 历史恢复 `history.restore`；
- 项目打开/切换/新建（`projects.js`、`server.js` 相关路由）；
- 导入媒体、创建/删除项目等会连带写工程的操作；
- SSE / 文件 watcher 是否只读，是否有回写。

每条写路径给：`文件:行号`、触发者（页面/MCP/CLI）、是否校验 revision、是否可绕过（如 `force=1`）、写入方式（tmp+rename/直接写）、是否原子、是否能与另一写者并发。

### 4.2 并发与一致性分析

- 两个写者同时基于 rN 提交，实际会发生什么？给出代码级推演，不要求复现；
- `?force=1`、可选 `baseRevision`、MCP 的 3 次重试分别带来什么风险；
- tmp+rename 能保证什么、不能保证什么；
- 是否存在“页面先改内存、再 PUT”的窗口；MCP 是否有相同的读-改-写窗口；
- 哪些风险属于 FableCut 代码，哪些属于 DSH 适配层可以补。

### 4.3 收敛方案（2—3 个）

至少比较：

| 方案 | 思路 | 改动面 | 风险 | 是否深 fork |
| --- | --- | --- | --- | --- |
| A. HTTP 唯一写入口 | MCP 不再直写，改为调用 HTTP；页面只走 HTTP | 改 MCP 的写函数 | 需要处理 MCP 无 HTTP 时的降级 | 低 |
| B. 单写守护/锁 | 文件锁 + 串行队列；所有写者先取锁 | 加锁层/守护进程 | 崩溃恢复、跨进程锁、Windows 行为 | 中 |
| C. 适配层持有状态 | DSH 适配器拥有工程状态，FableCut 只做 UI/引擎 | 适配层较大 | 两套状态风险 | 高 |

给出推荐方案与理由；明确“最小可行改造”要改哪些函数、是否需要在 MCP 进程外再包一层、是否能用 HTTP 作为唯一 writer。

### 4.4 G0-1 验证计划

设计一组能区分“真收敛”与“只是看起来收敛”的测试：

1. 两个并发 PUT，同一 baseRevision，最多一个 200；
2. 页面保存与 MCP patch 同时发生，最终 revision 单调、无丢失更新；
3. 同 commandId 同内容重试 → 返回原结果；同 ID 异内容 → 拒绝；
4. `force=1` 被禁用或只允许显式维护模式；
5. 写入后事件携带 projectId/newRevision/affectedIds；
6. 崩溃/重启后工程与 revision 可恢复；
7. 失败注入：半写、进程被杀、锁未释放。

每条给：前置条件、命令/操作、期望、失败判据、证据形式。不要现在执行，只设计。

### 4.5 证据补全

1. **`app.js`**：补完整文件，或补带 SHA256 的固定摘录（至少覆盖 `saveNow`、`runExportJob`、`reportExportJob`、`syncFromServer` 的写/读路径），并写明取自 `579b08e`。
2. **pnpm**：给出 `pnpm` 的实际路径/来源；若只是 Codex 运行时特有，写“DSH shell 未复现”，不要写成 DSH 环境事实。
3. **`product_integrity` 范围**：明确第一轮只覆盖方案文档目录，不覆盖工程仓；本轮补一次工程仓 `git status` / `git diff --stat` 的证据（只读）。
4. **源码路径**：给出本轮 clone 的绝对路径、`git rev-parse HEAD`、`git status --porcelain`。

## 5. 允许修改

- 只写 `回收\第二轮\Codex\` 下的 Markdown 与证据文件；
- 可在 `%TEMP%` clone/复制候选源码；
- 可运行只读命令（git、grep、node --check、测试子集）。

## 6. 只读

- FableCut 源码；
- 三份方案文档；
- 第一轮证据目录；
- 产品仓（只读 git 状态，不写）。

## 7. 禁止

- 不改产品仓、不改候选源码、不写生产代码/插件/Client/Skill；
- 不安装到产品环境、不全局安装、不用私有凭据；
- 不 fork 候选、不为“跑起来”改核心代码；
- 不把“设计可行”写成“已验证”；
- 不替 DSH 做最终选型；
- 不推荐第二条路线（本轮只服务 FableCut 的 G0-1）。

## 8. 输出

```text
E:\Deepseek-product\Agent\Video-agent\回收\第二轮\Codex\
├─ M0-T2_Codex_第二轮_写入口收敛设计.md
└─ M0-T2_Codex_第二轮_证据\
   ├─ env.txt
   ├─ commands.md
   ├─ app.js 或 FableCut_app_excerpt.md（含 SHA256）
   ├─ writer-inventory.md
   ├─ source-paths.json
   └─ repo-integrity.txt
```

`写入口收敛设计.md` 结构：

```markdown
# FableCut 写入口收敛设计（只读）
## 1. 结论摘要
## 2. 写入口清单（表）
## 3. 并发/一致性分析
## 4. 方案 A/B/C 比较
## 5. 推荐方案与最小改动
## 6. G0-1 验证计划
## 7. 证据补全与未验证项
## 8. 需 DSH 决定的问题（≤5）
```

## 9. 验收

- [ ] 写入口清单覆盖 HTTP/MCP/历史/项目切换/导入等，均有文件:行号；
- [ ] 明确指出所有可绕过 revision 的路径（`force`、可选 baseRevision、重试）；
- [ ] 至少 2 个收敛方案，含改动面、风险、是否深 fork；
- [ ] 推荐方案能回答“HTTP 是否可作为唯一 writer”；
- [ ] G0-1 验证计划能区分“真收敛”与“表面收敛”；
- [ ] `app.js` 或 hash-pinned 摘录已补；
- [ ] pnpm、product_integrity 范围说明已补；
- [ ] 没有改产品仓/候选源码，没有写生产代码；
- [ ] 未验证项诚实列出。

## 10. 交接

- 完成后只回复：文件路径、推荐方案（A/B/C）、最大风险、需 DSH 决定的问题（≤3）。
- DSH 复核后决定是否把方案写进 ADR-001 的“改造路径”，再决定是否开 M0-T3。

---

## 11. 复制给 Codex 的提示词

```text
请阅读以下文件，缺一不可：
1. 02_给Codex_M0-T2_候选底座只读预研.md
2. Video-agent总览.md
3. Video-agent-PRD.md
4. Video-agent技术执行手册.md
5. M0-T2_Codex_候选比较.md（第一轮）
6. M0-T2_Codex_推荐.md（第一轮）
7. M0-T2_Codex_第二轮_写入口收敛设计任务.md（本任务）

只做 FableCut 579b08e 的“写入口收敛”只读设计与证据补全：
- 不改产品仓库、不写生产代码、不改候选源码、不 fork、不安装到产品环境；
- 枚举所有会写 project.json 的路径（HTTP /api/project、MCP set_project / patch_project、history.restore、项目切换、导入等），给文件:行号；
- 分析 ?force=1、可选 baseRevision、MCP 重试、tmp+rename 的并发风险；
- 比较 A（HTTP 唯一写入口）/ B（单写守护+锁）/ C（适配层持有状态），推荐一个，说明是否深 fork；
- 设计 G0-1 验证计划：两个并发写、旧基准、同 commandId 同/异内容、force 禁用、事件、崩溃重开；
- 补 app.js 或带 SHA256 的固定摘录、pnpm 路径说明、product_integrity 范围说明、工程仓 git 只读状态。

输出到：
E:\Deepseek-product\Agent\Video-agent\回收\第二轮\Codex\
- M0-T2_Codex_第二轮_写入口收敛设计.md
- M0-T2_Codex_第二轮_证据\

不要声称已验证或已实现；不要推荐第二条路线；不要替 DSH 做最终选型。
完成后只回复：
1. 文件路径
2. 推荐方案（A/B/C）与一句话理由
3. 最大风险
4. 需要 DSH 决定的问题（最多 3 条）
```

## 12. 回复模板（Codex 应回）

```text
已完成：<两个路径>
推荐方案：<A/B/C>，理由：<一句话>
最大风险：<一句话>
需要 DSH 决定：<≤3 条>
```
