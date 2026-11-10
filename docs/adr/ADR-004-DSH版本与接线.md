# ADR-004 DSH 精确版本与接线

- 状态：**初定（M0-T5）**
- 日期：2026-11-04
- 关联：[M0-T3 证据](../handoffs/M0-T3_证据.md)、[M0-T4 证据](../handoffs/M0-T4_证据.md)

## 1. 版本与环境

| 项 | 值 |
| --- | --- |
| DSH 核心 | `@deepseek-ai/dsh 0.2.1-rc.5` |
| 桌面壳 | `@deepseek-ai/dsh-desktop 0.2.1-rc.5` |
| DSH 运行时 Node | `24.21.0` |
| DSH 运行时 pnpm | `11.28.5` |
| 系统 Node | `24.18.0` |
| 系统 pnpm | 缺失；Codex 运行时 shim 11.25.0，未复现 |
| OS | Windows 11 26200 |
| GUI | `http://127.0.0.1:56624`（本轮） |

来源：`E:\Deepseek\resources\app.asar` 的 `@deepseek-ai/dsh/package.json`、`runtime/versions.json`；不写“最新版”。

## 2. 已验证的接线

| 机制 | 证据 |
| --- | --- |
| 插件装载 | `@local/video-m0t3` 0.1.0、`@local/video-m0t4-jobs` 0.1.0，`install_bundle` → `application=applied` |
| Host 工具 | `video_project_read/apply`、`video_job_*` 真实调用 |
| Client 面板 | `conversation.composer.dock` occupant `video-m0t3` active；`panelGets/lastPanelRevision` = 7 |
| Client 事件 | `GET /m0t3/events` SSE；`events.log` / `events-page.log` |
| Skill | 运行时 provider `runtime`；`video-editing` 被发现并加载；SKILL.md hash `070546...` |
| Jobs | 业务 job 映射 DSH runtime `bash-*`；成功/失败/取消/模拟重启 |

插件包位置：

- `test/fixtures/M0-T3/plugin/`
- `test/fixtures/M0-T4/plugin/`

## 3. 未验证

- 真实页面按钮点击/视觉布局（无浏览器控制）；
- 插件在 **新进程重启** 后自动重连/重新装载（本轮用 remove/install 与 simulate_restart）；
- Client HMR/打包分发、插件卸载后的 UI 清理；
- DSH 版本升级兼容性；
- 多 Agent/多会话下 owner 隔离（jobs owner 用 `exec.agent.id` 已跑通单会话）。

## 4. 后果

- M1 必须以 `0.2.1-rc.5` 为基线；升级 DSH 需重新跑 M0-T3/M0-T4 最小证据。
- 插件安装会改 profile，用户需知道如何禁用/卸载；M1 需提供安装说明与回退。
- 完整 FableCut 原生写入口不依赖 DSH 版本，但 M1 的 Host/Client 接线依赖本 ADR。
