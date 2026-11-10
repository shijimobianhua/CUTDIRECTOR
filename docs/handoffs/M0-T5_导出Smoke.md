# M0-T5 A-01 预览/导出 Smoke

- 日期：2026-11-04
- 状态：**通过（FFmpeg smoke）**
- 执行：Codex 订阅（本机 `codex-cli 0.166.0-alpha.6`，`gpt-6.1-sol`，本次 23,218 tokens）
- 独立验收：DSH（文件、ffprobe、SRT、烧录帧）
- 输入：A-01，640×1280 HEVC 24fps，57.613s，AAC 单声道 44.1kHz

## 1. 产物

输出目录（gitignore，不入库）：`test/fixtures/M0-T5/export-smoke/`

| 文件 | 大小 | ffprobe |
| --- | ---: | --- |
| `a01.proxy.mp4` | 2,469,932 B | 57.631s；H.264 360×720；AAC 单声道 44.1kHz |
| `a01.clip5.mp4` | 162,211 B | 5.000s；H.264 360×720；AAC 单声道 |
| `a01.clip5.burned.mp4` | 162,357 B | 5.016s；H.264 360×720；AAC 单声道 |
| `a01.srt` | 54 B | UTF-8；0–5s |
| `a01.probe.json` | 4,064 B | 输入探测 |
| `report.md` / `SHA256SUMS.txt` | 6,123 / 1,674 B | 命令、校验 |

脚本：

- `tools/m0-export-smoke/run-smoke.ps1`（PowerShell 5.1）
- `tools/m0-export-smoke/README.md`

## 2. 独立验收

DSH 另跑 ffprobe，不依赖 Codex 自述：

```text
a01.proxy.mp4: dur=57.631s video=h264 360x720 audio=aac ch=1 sr=44100
a01.clip5.mp4: dur=5.000s video=h264 360x720 audio=aac ch=1 sr=44100
a01.clip5.burned.mp4: dur=5.016s video=h264 360x720 audio=aac ch=1 sr=44100
```

字幕文件：

```srt
1
00:00:00,000 --> 00:00:05,000
M0-T5 导出 smoke
```

字幕烧录：Codex 报告 `SUCCESS`；DSH 从 burned MP4 第 1 秒抽帧，画面底部可见中文“M0-T5 导出 smoke”。

![导出帧](M0-T5_日志/export-frame.png)

## 3. 这证明了什么

- 本机 FFmpeg 4.4.1 能从 A-01 HEVC 生成 H.264 预览代理；
- 能生成 5 秒 H.264/AAC 导出片段；
- 能把 UTF-8 中文 SRT 烧进画面；
- 输出时长/分辨率/音频经 ffprobe 独立核对；
- 失败/半成品不会当成功：脚本在缺文件/零字节时失败，字幕失败会保留 sidecar 并报错。

## 4. 没证明什么

- 没有跑 FableCut 原生导出/浏览器 headless；
- 没有从完整工程 JSON 渲染，只做了单素材 smoke；
- 没有验证 HEVC 在原浏览器里的解码；预览代理是 H.264，不能替代原素材解码结论；
- 没有验证多轨/转场/字体/长字幕换行/音画偏移；
- 没有发布产物，只做 smoke。

## 5. 对 M0-T5 条件的影响

原条件 2“A-01 预览/导出 smoke”**已完成到 FFmpeg 范围**。  
仍保留：

- 面板按钮实际点击/视觉（条件 1）；
- FableCut 原生/完整工程导出（M1-T3 或 M1 首卡延伸）；
- HEVC 原素材浏览器播放结论。

## 6. 日志

- [完整 report](M0-T5_日志/export-smoke-report.md)
- [SHA256SUMS](M0-T5_日志/export-smoke-SHA256SUMS.txt)
- [输入 probe](M0-T5_日志/a01.probe.json)
- [SRT](M0-T5_日志/export-smoke.srt)
- [烧录帧](M0-T5_日志/export-frame.png)

**结论：M0-T5 的 A-01 FFmpeg 预览/导出 smoke 通过；M0 仍为“有条件通过”（面板点击未闭环、FableCut 原生/完整工程导出未做）。**
