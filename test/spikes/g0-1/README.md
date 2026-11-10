# G0-1 写入口适配器 spike

> **不是产品代码。** 这是 M0-T2/G0-1 的证据用最小服务，用来验证“唯一 writer + baseRevision + commandId 幂等 + 单实例 + 事件”能否成立。它不改 FableCut 源码，只调用 FableCut 的 `/api/project`。

## 文件

- `writer-adapter.js`：唯一 writer 适配器（Node 标准库，无依赖）。
- `preflight.js`：T01/T02/T04/T05/T06/T07 用例。
- 结果记录见 [M0-05](../../../docs/handoffs/M0-05_第二轮验收.md) §4。

## 运行

先启动 FableCut（示例端口 7790，临时数据目录）：

```text
set FABLECUT_DATA_DIR=%TEMP%\g0-data
set FABLECUT_NO_FS_WATCH=1
set PORT=7790
node server.js
```

再启动适配器（同一数据目录、端口 7792）：

```text
set DATA_DIR=%TEMP%\g0-data
set PROJECT_ID=P
set FABLECUT_BASE_URL=http://127.0.0.1:7790
set ADAPTER_PORT=7792
node test/spikes/g0-1/writer-adapter.js
```

跑预检：

```text
node test/spikes/g0-1/preflight.js
```

## 契约

```text
GET  /health
GET  /project
PUT  /project  { projectId, baseRevision, commandId, project }
GET  /events   (SSE)
```

- `baseRevision` 必填，必须等于当前 revision；
- 客户端自报 `project.revision` 不被信任，由适配器分配 `current+1`；
- `commandId` + 规范化摘要做持久账本：同 ID 同内容返回原结果，同 ID 异内容 409；
- `force` 一律 400；
- 校验 `name`/`clips`/`media`；
- lock 文件拒绝第二个适配器；
- 提交后发 SSE。

## 结果（2026-11-04）

| 用例 | 结果 |
| --- | --- |
| T01 并发同基准 | 一个 200，一个 409 |
| T02 旧基准 | 409 |
| T02 伪造高版本 | 忽略客户端 revision，分配 current+1 |
| T02 缺字段 | 400 |
| T04 同 ID 同内容 | 200，replayed，revision 不变 |
| T05 同 ID 异内容 | 409 |
| T06 force | 400 |
| T07 事件 | 带 eventId/projectId/newRevision/commandId/affectedIds |
| T12 第二适配器 | 拒绝启动 |

## 边界

- FableCut 原生 HTTP/MCP/UI/项目切换/历史/启动恢复仍可绕过适配器直写；本 spike 未修改 FableCut。
- 账本是本地 JSON，未做 fsync/原子写；崩溃一致性未测。
- 只支持单项目 `P`；未接项目切换/新建/删除/历史恢复。
- 没有 DSH 插件/Client/Skill；这些是 M0-T3。
- 不适用于生产；M0-T3 只按“适配器唯一 writer、FableCut HTTP 仅引擎、不启动 MCP、不使用原生 UI 写工程”的窄口径使用。
