# M0-T2 复跑日志

- 日期：2026-11-03 / 2026-11-04
- 目的：不只信 Codex 的结论，对最终候选至少复跑一个关键命令（03 §5.3）
- 候选：FableCut `579b08ec1a789baec5cbf06d7430373460508d09`
- 方式：`%TEMP%\dsd-m0t2-audit\FableCut_sparse` 的 sparse clone（同一 commit），未修改候选源码
- 环境：Windows 11 26200、Node 24.18.0、无 FFmpeg/ffprobe

## 1. `2026-11-03_FableCut_mcp-tools_test.log`

命令（在 clone 根目录）：

```text
node --test test/mcp-tools.test.js
```

结果：`exit 0`；22 tests / 16 pass / 6 skip / 0 fail；2.24s。
跳过的 6 项均因 `ffmpeg / ffprobe not installed`。
覆盖：`fablecut_patch_project` 批次原子性、旧 `baseRevision` 拒绝、`set_project` 冲突拒绝、导入媒体、轨道/主控设置。

## 2. `2026-11-03_FableCut_start_server.out.log`

命令（临时数据目录、端口 7788）：

```text
set FABLECUT_DATA_DIR=%TEMP%\dsd-m0t2-audit\fablecut-data
set PORT=7788
set FABLECUT_NO_FS_WATCH=1
node server.js
```

结果：进程存活；`GET /` → HTTP 200（56,041 B）；`GET /api/project` → HTTP 200，revision 0、0 clips、`Untitled Project`。
`stderr` 为空。

## 3. `2026-11-03_FableCut_write_reopen.log`

通过 HTTP 写入一个 text clip，验证版本、旧基准与重开：

```text
READ_BEFORE revision=0 clips=0
PUT_REV1 200 {"ok":true,"revision":1}
READ_AFTER revision=1 clips=1 text=M0-T2 probe
PUT_STALE 409 (expected)
REOPEN revision=1 clips=1 text=M0-T2 probe
```

## 4. 边界

- 这不是完整 536 项测试的复跑；sparse clone 未含 `library/`。完整测试仍以 Codex 的 `FableCut_test.log` 为参考。
- 没有打开真实浏览器，没有人工编辑 UI，没有 DSH Agent 调用；这些属于 M0-T3。
- 导出未验证：本机无 FFmpeg（后续已装，见下）。
- 没有把候选源码或临时项目写入产品仓库。

## 5. FFmpeg 工具链

另见 [2026-11-03_ffmpeg_toolchain.md](2026-11-03_ffmpeg_toolchain.md)：ffmpeg 4.4.1 / ffprobe 3.4.2，已生成并探测 30000/1001 与无音轨技术夹具。

## 6. G0-1 预检（2026-11-04）

### 6.1 FableCut 现状

- [2026-11-04_G0-1_preflight.log](2026-11-04_G0-1_preflight.log)：T01 并发 200/409；旧基准 409；伪造高版本 200；`force=1` 200；缺字段 200。
- [2026-11-04_G0-1_twoserver.log](2026-11-04_G0-1_twoserver.log)：两个 server 共用同一 data dir 都能写。

结论：FableCut 原生写入口未收敛，G0-1 未通过。

### 6.2 写入口适配器 spike

代码：[test/spikes/g0-1/](../../../test/spikes/g0-1/README.md)

- [2026-11-04_G0-1_adapter_preflight.log](2026-11-04_G0-1_adapter_preflight.log)：T01/T02/T06/T07 通过。
- [2026-11-04_G0-1_adapter_replay.log](2026-11-04_G0-1_adapter_replay.log)：T04 同 ID 同内容重放返回原结果；T05 同 ID 异内容 409。
- [2026-11-04_G0-1_adapter2.err.log](2026-11-04_G0-1_adapter2.err.log)：第二个适配器被拒绝启动。

结论：适配器窄口径通过；完整 FableCut 收敛留 M1。详见 [M0-05 第二轮验收](../M0-05_第二轮验收.md) §4。
