# 02 给 Codex：M0-T2 候选编辑底座只读预研

- 任务卡：M0-T2
- 主责：DSH（最终选型）
- 你的角色：只读代码审计与可复现证据
- 产出：比较表 + 证据目录 + 最多两条推荐
- 不允许：改产品仓库、写生产代码、替 DSH 做最终决定

## 1. 先确认你拿到了什么

开始前必须拿到：

1. 本文件；
2. `Video-agent总览.md`；
3. `Video-agent-PRD.md`；
4. `Video-agent技术执行手册.md`。

缺任意一份就停下来，回复缺什么。不要用 README 或记忆代替三份文档。

## 2. 你的任务

在以下候选里做首轮只读审计，最后**最多推荐两条**进入 M0-T3 正式小样：

| 候选 | 仓库 | 角色 |
| --- | --- | --- |
| OpenChatCut | https://github.com/0xsline/OpenChatCut | 主候选 |
| FableCut | https://github.com/ronak-create/FableCut | 主候选 |
| Timeline Studio | https://github.com/MartinDelophy/ai-video-editor | 主候选 |
| Timeline Studio DSH 插件 | https://github.com/MartinDelophy/dsh-timeline-studio-plugin | 参考桥接，不单独作为完整工作台 |
| Diffusion Studio Editor | https://github.com/diffusionstudio/editor | 仅作工程/编辑衔接参考，不默认进入主候选 |
| OpenFilm | https://github.com/openfilm/openfilm | 仅作工程/动效参考，不默认进入主候选 |

硬规则：

- **最多两条**进入正式比较；
- 先做 90—120 分钟广度审计，再对最多两条深入；
- 任何一条候选在 30 分钟内无法完成基本安装/启动，标记“阻断/未验证”，不要死磕；
- 不因 star 数、README 宣传、演示视频下结论。

## 3. 先读这些章节

- 技术手册 §3.1（主编辑底座比较）、§3.2（目录建议）、§14.1（参考项目）；
- 技术手册 §10.2（M0-T2）；
- 总览 §3.1（工程所有权）、§6.1（M0 任务）；
- PRD §4（产品组成）、§12（非功能要求）。

你要回答的核心不是“这个项目好不好”，而是：

> 它能不能成为 Video-agent 的权威编辑底座，或者至少成为两条候选之一，让 DSH 在 M0-T3 用真实页面和 Agent 验证共同编辑？

## 4. 工作方式

### 4.1 隔离

- 在临时目录克隆，例如 `%TEMP%\video-agent-m0t2\`；
- 不修改产品仓库；
- 不把候选仓库装进产品目录；
- 不全局安装依赖，不要求管理员权限；
- 不使用任何私有凭据、token、账号；
- 构建产物只留在临时目录。

### 4.2 每个候选必须记录

```text
candidate:
repo:
commit:
commit date:
license files:
package manager:
runtime requirements:
OS tested:
install command:
build command:
test command:
run command:
result:
time spent:
blockers:
```

### 4.3 证据优先级

从高到低：

1. 实际运行过的命令 + 输出；
2. 源码中的写入口、事务、版本、通知实现；
3. 测试/示例；
4. 官方文档；
5. README；
6. 二手文章/star 数（只能作为线索，不能作为结论）。

## 5. 比较维度

每个维度用：**满足 / 部分 / 不满足 / 未验证 / 阻断**，并附证据路径。

| 维度 | 要拿到的证据 |
| --- | --- |
| 共同读写 | 页面和外部 Agent 是否能读写同一工程；写入口在哪 |
| 事务与版本 | 是否有 command/transaction、baseRevision、冲突拒绝、幂等 |
| 工程能力 | 片段、轨道、字幕、基础音频、重开、稳定对象、历史 |
| 预览与导出 | 预览与导出是否共用语义；实际成片能否解码 |
| 字幕 | 字幕数据模型；纠正是否与原始转写分离；重排/裁剪后能否映射 |
| 时间 | 帧率、有理数 fps、半开区间、VFR、旋转、音画偏移 |
| DSH 接入 | 页面装载、Host/Client 通信、工具调用、事件、Skill |
| Windows | 安装、路径、字体、FFmpeg、原生依赖、CPU/GPU/内存 |
| 复用条件 | 许可证、依赖、模型权重、分发限制、维护成本 |
| 测试 | 是否有可运行的测试；覆盖哪些行为 |
| 可改造性 | 写入口是否可控；能否加统一命令层；会不会需要 fork 很深 |

### 5.1 必须特别检查

- 有没有**两个可独立修改的权威工程**；
- 页面是否绕过统一服务直接写状态；
- 是否有可观测的 change event；
- 是否有稳定的 segment/caption ID；
- 是否能拒绝旧 baseRevision；
- 是否有撤销/恢复，以及恢复是否生成新版本；
- 导出是否能用同一 manifest 复现；
- 许可证是否允许你的使用/分发方式（只记录事实，不给法律结论）。

## 6. 运行与验证

至少对一条候选做到：

1. 克隆并记录 commit；
2. 安装依赖；
3. 启动/构建；
4. 找到工程文件或项目存储位置；
5. 找到页面写入入口；
6. 找到外部 Agent/CLI/API 写入入口；
7. 尝试读同一工程；
8. 尝试写入一个最小修改；
9. 观察是否有版本/通知/冲突机制；
10. 尝试导出或预览一个最小片段（如果条件允许）。

做不到的项标“未验证”，写清原因。不要用“应该可以”替代。

### 6.1 建议记录的命令

不用照抄，按实际项目调整，但必须留下：

```text
git clone <repo> <dir>
git rev-parse HEAD
git log -1 --format="%H%n%ci%n%s"
Get-ChildItem
Get-Content package.json
Get-Content LICENSE
Get-Content README.md
<install command>
<build command>
<test command>
<run command>
```

Windows 环境额外记录：

```text
node -v
pnpm -v
npm -v
ffmpeg -version
ffprobe -version
```

如果项目不用 Node，记录实际运行时和版本。

## 7. 输出文件

只输出这三个：

```text
M0-T2_Codex_候选比较.md
M0-T2_Codex_推荐.md
M0-T2_Codex_证据/
```

### 7.1 `M0-T2_Codex_候选比较.md`

结构：

```markdown
# M0-T2 候选编辑底座比较

- 审计日期：
- 环境：
- 候选数量：
- 进入深入的候选：

## 1. 总表
| 候选 | commit | 许可证 | Windows | 共同读写 | 事务/版本 | 字幕 | 预览/导出 | DSH 接入 | 结论 |
...

## 2. 候选 A
### 2.1 基本信息
### 2.2 工程与写入口
### 2.3 事务/版本/历史
### 2.4 字幕与时间
### 2.5 预览/导出
### 2.6 DSH 接入
### 2.7 Windows/依赖/许可证
### 2.8 实际命令与结果
### 2.9 证据路径
### 2.10 未验证/阻断

## 3. 候选 B
（同上）

## 4. 横向结论
- 哪些能力是“有代码证据”
- 哪些只是“文档声称”
- 哪些是阻断项
- 哪些必须在 M0-T3 验证
```

### 7.2 `M0-T2_Codex_推荐.md`

最多两条，结构：

```markdown
# M0-T2 推荐进入正式小样的路线

## 推荐 1：<名称>
- 推荐理由（最多 5 条，每条带证据）
- 最大风险（最多 3 条）
- M0-T3 必须验证什么（3—5 项）
- 不能假设什么
- 若失败，备选是什么

## 推荐 2：<名称>
（同上）

## 不推荐进入正式小样的候选
- 名称 + 理由 + 证据

## 需要 DSH 决定的问题
- 最多 5 条
```

### 7.3 `M0-T2_Codex_证据/`

至少包含：

```text
env.txt
commands.md
<候选A>_install.log
<候选A>_build.log
<候选A>_test.log
<候选A>_run.log
<候选B>_...
```

没有日志的结论，标“未验证”。

## 8. 绝对不要做的事

- 不要修改产品仓库；
- 不要写生产代码、插件、Client、Skill；
- 不要替 DSH 决定最终底座；
- 不要推荐超过两条；
- 不要用 README/star 数/演示视频当核心证据；
- 不要安装到全局环境或要求管理员权限；
- 不要使用私有凭据；
- 不要为了让候选“跑起来”而改它的核心代码；只允许在临时目录做最小构建适配，并记录；
- 不要把“能启动”写成“支持共同编辑”；
- 不要给法律结论，只记录许可证事实。

## 9. 时间盒

- 首轮广度：90—120 分钟；
- 每个候选深入：最多 45 分钟；
- 总共不超过半天；
- 到时间仍无结论，输出“已排除原因 + 下一次验证假设”，不要无限重试。

## 10. 完成后怎么回复用户

只回复：

```text
已完成：<三个输出路径>
最多两条推荐：<名称 1>、<名称 2>
最大风险：<一句话>
需要 DSH 决定：<最多 3 条>
```

不要把整篇比较表粘贴回聊天；文件才是交付。
