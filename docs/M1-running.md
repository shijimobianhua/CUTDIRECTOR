# CUTDIRECTOR ? M1 local workbench

Node >=24, no install step. Set the existing executable paths in PowerShell:

```powershell
$env:FFMPEG='E:\Deepseek-product\Agent\tools\ffmpeg-4.4.1\ffmpeg.exe'
$env:FFPROBE='E:\Deepseek-product\Agent\tools\ffmpeg-4.4.1\ffprobe.exe'
node tools/import-media.cjs 'C:\local\video.mp4' P --normalize
node src/server.cjs
```

Writer binds **127.0.0.1:7793** (`PORT` override). Data defaults to ignored `.m1-data` (`VIDEO_DATA` override). Import runs once with the writer stopped; it preserves original media and creates one full-length segment with no transcript. Alternatively `node src/server.cjs --import <project.json>` creates a validated v1 project. Stop gracefully with Ctrl+C before reopening. After a crash, verify the PID in `.writer.lock` is stopped, reconcile the project, then manually remove that lock. Never run native FableCut writers against this directory.

Build the DSH plugin with `node tools/package-plugin.cjs`. The self-contained bundle is `.m1-data/plugin`; install that bundle using the existing DSH plugin installation flow (baseline 0.2.1-rc.5). Source `src/host` is a build template, not the install directory. Configure adapterUrl `http://127.0.0.1:7793`, projectId `P`. The DSH integration now uses a custom main page with native conversation plus workbench; see [SINGLE-PAGE.md](SINGLE-PAGE.md). Disable the old M0 dock plugins if they obscure the panel; their fixtures/data remain untouched. Disable/remove `@local/video-agent` to roll back the UI; keep the data directory. Actual DSH installation has not been verified in this run.

Select segment checkboxes; correct captions; shorten a segment's opening; inspect actual diff. Agent tools use the same writer. On conflict, read/refresh and review the intended change before submitting again. Agent sees selection via video_project_read. Preview/export produces an H.264/AAC MP4, external UTF-8 SRT and file report. Artifact labels retain their captured revision even if the current project changes. Browser codec playback, Chinese glyphs, keyboard usability and audiovisual quality require human inspection.

```powershell
node tools/m1-acceptance/run.cjs
node tools/m1-acceptance/a01-smoke.cjs 'test/fixtures/M0-T3/data/media/A-01.mp4'
```

The runner names test files explicitly, applies 60s per-test and 180s process timeouts, and discovers only the existing sibling FFmpeg installation when environment variables are unset. Standalone render/import commands require FFmpeg on PATH or the environment variables above. Smoke writes only ignored local evidence and media. Its test caption is explicitly not a transcript.

M1 supports contiguous single-track speed-1 video, per-segment source-anchored caption instances, trims, reorder, atomic batches, restore, media relocation by hash and archive. Normalize VFR, rotated and nonzero-origin sources before rendering. Multitrack/gaps are rejected. ASR and semantic roughcut are unavailable; no transcript is fabricated. Burned captions, cache reuse, DSH runtime job mapping, killed-process recovery and packaged live desktop installation are deferred. File decode checks do not imply content or human QA has passed.
