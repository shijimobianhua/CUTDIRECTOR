# M0-T5 A-01 export smoke

Run from Windows PowerShell 5.1 (no installation, network or product code required):

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\m0-export-smoke\run-smoke.ps1
```

Uses the existing FFmpeg 4.4.1 and ffprobe 3.4.2 executables in
`E:\Deepseek-product\Agent\tools\ffmpeg-4.4.1\`.
Resolves the first recursive `A-01original*.mp4` match under
`E:\Deepseek-product\Agent\video-agent-media\M0-T1` without interpreting its
spaces or Chinese filename as command syntax.

Outputs are in `test/fixtures/M0-T5/export-smoke/`:

- `a01.probe.json`: complete input streams and format metadata.
- `a01.proxy.mp4`: full-length H.264 preview, scale `360:-2`, veryfast,
  CRF 28, mono AAC 64 kb/s, faststart.
- `a01.clip5.mp4`: first five seconds with the same encoding settings.
- `a01.srt`: UTF-8 sidecar, one cue from 0 to 5 seconds, `M0-T5 导出 smoke`.
- `a01.clip5.burned.mp4`: subtitle burn attempt using a relative SRT path
  with the output directory as the native process working directory.
- Output probe JSON files and exact stdout/stderr logs for each invocation.
- `report.md`: exact PowerShell commands, working directory, exit codes,
  absolute paths, sizes, probe summaries, validation and subtitle burn result.
- `SHA256SUMS.txt`: SHA-256 of every produced file, including logs and report,
  excluding the checksum manifest itself (self-hashing is impossible).

Missing/empty required outputs, failed encoding/probing, missing video/audio,
unexpected codecs/resolution/channels, or durations outside 57.613 +/- 0.5 s
(proxy) and 5 +/- 0.2 s (clips) fail the script. Empty diagnostic streams are
valid. A subtitle-filter failure is reported separately with its exact error;
the sidecar survives and any failed partial burned MP4 is removed. It does
not turn a successful proxy/clip smoke into a failure or claim burn success.
Burn success is based on FFmpeg exit status and ffprobe validation, not visual
inspection. Reruns overwrite the same artifacts; use a dedicated output directory.
