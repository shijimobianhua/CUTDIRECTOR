# M0-T1 媒体基准目录

这里**只放元数据、说明与探测输出**，不放真实媒体。

## 规则

- 真实素材留在用户的原始路径，按 [素材清单](../../../docs/handoffs/M0-T1_素材清单.md) 登记；
- 本目录只提交：`README.md`、每段素材的 `.md` 说明、`ffprobe` 的文本/JSON 输出；
- 媒体文件（mp4/mov/mkv/wav/srt 等）已被根目录 `.gitignore` 排除；
- 不在本目录保存转写原文、密钥或含敏感信息的截图。

## 命名

```text
A-01.md            素材说明（路径、hash、用途、保留项）
A-01.probe.json    ffprobe 原始输出
A-01.probe.txt     ffprobe 可读摘要
```

`assetId` 一旦分配不复用；同一内容的不同转码/裁剪视为不同 assetId。

## 当前状态

- `A-01`：**已收到并探测**，见 [A-01.md](A-01.md) 与 [A-01.probe.json](A-01.probe.json)；竖屏 640×1280 / HEVC / 24fps / 单声道 / 57.6s
- `A-02`：待提供（教程/录屏）
- `A-03`：由 A-01 覆盖“竖屏/HEVC”；VFR/缺音轨/旋转仍未覆盖
- 探测工具：`ffmpeg 4.4.1` / `ffprobe 3.4.2`，在 `E:\Deepseek-product\Agent\tools\ffmpeg-4.4.1\`
- A-01 的内容语义（产品名/数字/否定/限制）未确认：未做 ASR，不能从画面推断

## 不放什么

- 不放真实视频、音频、字幕成品；
- 不放从网上下载的替代素材；
- 不把 `test/fixtures` 当作产品媒体库或缓存目录。
