# M0-T5 A-01 export smoke

Status: PASS
Generated: 2026-11-04T18:16:24.8531639+08:00
Output directory: E:\Deepseek-product\Agent\Video-agent\test\fixtures\M0-T5\export-smoke
Input: E:\Deepseek-product\Agent\video-agent-media\M0-T1\A-01original.     口播产品讲解.mp4

## Verification

Proxy duration tolerance: 57.613 +/- 0.5 seconds; clip: 5 +/- 0.2 seconds.
Required exports: nonzero H.264 360x720 video plus mono AAC audio.

a01 : duration=57.613333s; bytes=4187884; video=hevc 640x1280 fps=24/1; audio=aac channels=1 layout=mono sample_rate=44100 bitrate=46787
a01.proxy : duration=57.631000s; bytes=2469932; video=h264 360x720 fps=24/1; audio=aac channels=1 layout=mono sample_rate=44100 bitrate=64397
a01.clip5 : duration=5.000000s; bytes=162211; video=h264 360x720 fps=24/1; audio=aac channels=1 layout=mono sample_rate=44100 bitrate=64516
a01.clip5.burned : duration=5.016000s; bytes=162357; video=h264 360x720 fps=24/1; audio=aac channels=1 layout=mono sample_rate=44100 bitrate=64676

## Subtitle burn

SUCCESS: subtitles filter completed; burned MP4 passed ffprobe validation. Sidecar retained.

## Failure



## Exact PowerShell commands

Working directory for every command: E:\Deepseek-product\Agent\Video-agent\test\fixtures\M0-T5\export-smoke

```powershell
& 'E:\Deepseek-product\Agent\tools\ffmpeg-4.4.1\ffprobe.exe' '-v' 'error' '-show_format' '-show_streams' '-of' 'json' 'E:\Deepseek-product\Agent\video-agent-media\M0-T1\A-01original.     口播产品讲解.mp4'
Exit code: 0; stdout: a01.probe.json; stderr: a01.probe.stderr.log
& 'E:\Deepseek-product\Agent\tools\ffmpeg-4.4.1\ffmpeg.exe' '-hide_banner' '-nostdin' '-y' '-i' 'E:\Deepseek-product\Agent\video-agent-media\M0-T1\A-01original.     口播产品讲解.mp4' '-map' '0:v:0' '-map' '0:a:0' '-vf' 'scale=360:-2' '-c:v' 'libx264' '-preset' 'veryfast' '-crf' '28' '-pix_fmt' 'yuv420p' '-c:a' 'aac' '-b:a' '64k' '-ac' '1' '-movflags' '+faststart' 'a01.proxy.mp4'
Exit code: 0; stdout: a01.proxy.stdout.log; stderr: a01.proxy.stderr.log
& 'E:\Deepseek-product\Agent\tools\ffmpeg-4.4.1\ffprobe.exe' '-v' 'error' '-show_format' '-show_streams' '-of' 'json' 'E:\Deepseek-product\Agent\Video-agent\test\fixtures\M0-T5\export-smoke\a01.proxy.mp4'
Exit code: 0; stdout: a01.proxy.probe.json; stderr: a01.proxy.probe.stderr.log
& 'E:\Deepseek-product\Agent\tools\ffmpeg-4.4.1\ffmpeg.exe' '-hide_banner' '-nostdin' '-y' '-i' 'E:\Deepseek-product\Agent\video-agent-media\M0-T1\A-01original.     口播产品讲解.mp4' '-ss' '0' '-t' '5' '-map' '0:v:0' '-map' '0:a:0' '-vf' 'scale=360:-2' '-c:v' 'libx264' '-preset' 'veryfast' '-crf' '28' '-pix_fmt' 'yuv420p' '-c:a' 'aac' '-b:a' '64k' '-ac' '1' '-movflags' '+faststart' 'a01.clip5.mp4'
Exit code: 0; stdout: a01.clip5.stdout.log; stderr: a01.clip5.stderr.log
& 'E:\Deepseek-product\Agent\tools\ffmpeg-4.4.1\ffprobe.exe' '-v' 'error' '-show_format' '-show_streams' '-of' 'json' 'E:\Deepseek-product\Agent\Video-agent\test\fixtures\M0-T5\export-smoke\a01.clip5.mp4'
Exit code: 0; stdout: a01.clip5.probe.json; stderr: a01.clip5.probe.stderr.log
& 'E:\Deepseek-product\Agent\tools\ffmpeg-4.4.1\ffmpeg.exe' '-hide_banner' '-nostdin' '-y' '-i' 'a01.clip5.mp4' '-map' '0:v:0' '-map' '0:a:0' '-vf' 'subtitles=filename=a01.srt:charenc=UTF-8' '-c:v' 'libx264' '-preset' 'veryfast' '-crf' '28' '-pix_fmt' 'yuv420p' '-c:a' 'aac' '-b:a' '64k' '-ac' '1' '-movflags' '+faststart' 'a01.clip5.burned.mp4'
Exit code: 0; stdout: a01.clip5.burned.stdout.log; stderr: a01.clip5.burned.stderr.log
& 'E:\Deepseek-product\Agent\tools\ffmpeg-4.4.1\ffprobe.exe' '-v' 'error' '-show_format' '-show_streams' '-of' 'json' 'E:\Deepseek-product\Agent\Video-agent\test\fixtures\M0-T5\export-smoke\a01.clip5.burned.mp4'
Exit code: 0; stdout: a01.clip5.burned.probe.json; stderr: a01.clip5.burned.probe.stderr.log
```

## Output inventory

SHA256SUMS.txt covers all produced files (including this report and diagnostic logs), except the manifest itself, which cannot hash itself. Empty stdout/stderr logs are normal; required media, subtitle and probe outputs must be nonzero.

| Absolute path | Bytes |
| --- | ---: |
| E:\Deepseek-product\Agent\Video-agent\test\fixtures\M0-T5\export-smoke\a01.clip5.burned.mp4 | 162357 |
| E:\Deepseek-product\Agent\Video-agent\test\fixtures\M0-T5\export-smoke\a01.clip5.burned.probe.json | 3996 |
| E:\Deepseek-product\Agent\Video-agent\test\fixtures\M0-T5\export-smoke\a01.clip5.burned.probe.stderr.log | 0 |
| E:\Deepseek-product\Agent\Video-agent\test\fixtures\M0-T5\export-smoke\a01.clip5.burned.stderr.log | 4781 |
| E:\Deepseek-product\Agent\Video-agent\test\fixtures\M0-T5\export-smoke\a01.clip5.burned.stdout.log | 0 |
| E:\Deepseek-product\Agent\Video-agent\test\fixtures\M0-T5\export-smoke\a01.clip5.mp4 | 162211 |
| E:\Deepseek-product\Agent\Video-agent\test\fixtures\M0-T5\export-smoke\a01.clip5.probe.json | 3989 |
| E:\Deepseek-product\Agent\Video-agent\test\fixtures\M0-T5\export-smoke\a01.clip5.probe.stderr.log | 0 |
| E:\Deepseek-product\Agent\Video-agent\test\fixtures\M0-T5\export-smoke\a01.clip5.stderr.log | 4478 |
| E:\Deepseek-product\Agent\Video-agent\test\fixtures\M0-T5\export-smoke\a01.clip5.stdout.log | 0 |
| E:\Deepseek-product\Agent\Video-agent\test\fixtures\M0-T5\export-smoke\a01.probe.json | 4064 |
| E:\Deepseek-product\Agent\Video-agent\test\fixtures\M0-T5\export-smoke\a01.probe.stderr.log | 0 |
| E:\Deepseek-product\Agent\Video-agent\test\fixtures\M0-T5\export-smoke\a01.proxy.mp4 | 2469932 |
| E:\Deepseek-product\Agent\Video-agent\test\fixtures\M0-T5\export-smoke\a01.proxy.probe.json | 3997 |
| E:\Deepseek-product\Agent\Video-agent\test\fixtures\M0-T5\export-smoke\a01.proxy.probe.stderr.log | 0 |
| E:\Deepseek-product\Agent\Video-agent\test\fixtures\M0-T5\export-smoke\a01.proxy.stderr.log | 4678 |
| E:\Deepseek-product\Agent\Video-agent\test\fixtures\M0-T5\export-smoke\a01.proxy.stdout.log | 0 |
| E:\Deepseek-product\Agent\Video-agent\test\fixtures\M0-T5\export-smoke\a01.srt | 54 |
| E:\Deepseek-product\Agent\Video-agent\test\fixtures\M0-T5\export-smoke\report.md | 6123 |
