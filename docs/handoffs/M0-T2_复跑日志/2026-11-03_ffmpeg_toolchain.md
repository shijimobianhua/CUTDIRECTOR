# FFmpeg 工具链验证（M0-T2 G0-3）

- 日期：2026-11-03
- 目的：确认本机有可用的 `ffmpeg`/`ffprobe`，能生成并探测 30000/1001 与无音轨片段
- 位置：`E:\Deepseek-product\Agent\tools\ffmpeg-4.4.1\`（工程仓外，不入 Git）

## 版本

```text
ffmpeg 4.4.1-essentials_build-www.gyan.dev
ffprobe 3.4.2
```

## 技术夹具

目录：`E:\Deepseek-product\Agent\video-agent-media\_technical\`

| 文件 | 探测结果 |
| --- | --- |
| `m0-t3-5s-2997.mp4` | video h264 1280×720，`r_frame_rate=30000/1001`，`nb_frames=150`，`duration=5.005000`；audio aac 48000 Hz 2ch |
| `m0-t3-3s-noaudio.mp4` | 仅 1 个 video stream（h264，30/1），无 audio |
| `*.probe.json` | ffprobe 原始输出 |

## 生成命令

```text
ffmpeg -y -f lavfi -i "testsrc2=size=1280x720:rate=30000/1001" \
  -f lavfi -i "sine=frequency=440:sample_rate=48000" -t 5 \
  -c:v libx264 -preset veryfast -pix_fmt yuv420p \
  -c:a aac -b:a 128k -ac 2 m0-t3-5s-2997.mp4

ffmpeg -y -f lavfi -i "testsrc2=size=1280x720:rate=30" -t 3 \
  -c:v libx264 -preset veryfast -pix_fmt yuv420p m0-t3-3s-noaudio.mp4
```

## 边界

- 这些是**技术夹具**，不是 M0-T1 的真实口播/教程素材，不用于内容验收。
- `ffprobe 3.4.2` 较旧，AV1/HEVC 10-bit 等新格式可能不支持；真实素材到时以实测为准，不支持就记录为边界。
- 本机工具来自已安装的第三方应用（D5 Render / hudun），仅复制到本地工具目录；来源与许可事实见 `tools\ffmpeg-4.4.1\SOURCE.md`。
