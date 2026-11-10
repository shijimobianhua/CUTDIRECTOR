# CUTDIRECTOR offline release

Requires Node >=24 and existing FFmpeg/FFprobe executables. No npm install, network downloads or ASR model are bundled.

```powershell
$env:FFMPEG='E:\Deepseek-product\Agent\tools\ffmpeg-4.4.1\ffmpeg.exe'
$env:FFPROBE='E:\Deepseek-product\Agent\tools\ffmpeg-4.4.1\ffprobe.exe'
node tools/package-release.cjs .m3-data/release-01
node tools/package-release.cjs --verify .m3-data/release-01
cd .m3-data/release-01
$env:VIDEO_DATA='E:\Video-agent-data'
node tools/import-media.cjs 'C:\local\video.mp4' P --normalize
node src/server.cjs
```

Choose an empty package destination. Keep VIDEO_DATA outside release directories so rollback does not replace projects. Import with writer stopped; it retains original source and records normalized working-media mapping. Default writer is http://127.0.0.1:7793, PORT overrides it. `/health` is the startup check; the user page is the DSH dock, not a standalone HTML page.

Install the release's `plugin/` through the existing DSH bundle installation flow (baseline 0.2.1-rc.5); adapterUrl points to the writer, projectId defaults to P. This is an offline, self-contained Host/Client/skills bundle; actual desktop installation and visual behavior still need verification. The automated clean-directory smoke loads this bundle, imports/normalizes generated media, starts the copied writer and produces a decoded revision-bound video/report. It does not count as live DSH acceptance.

Open a project in the dock or through video_project_open. Page and Agent share commands and current project within that Host instance. For independent sessions use separate configured instances. Inspect source via video_inspect, read segments.json, create a traceable proposal, apply through video_project_apply, and preview/export. Only existing segment instances on one contiguous speed-1 track are supported; split/new instances and multitrack operations explicitly remain unavailable.

Local ASR is absent by default: video_transcribe returns PROVIDER_NOT_READY. Set VIDEO_ASR_FIXTURE to an explicit local hash-bound fixture only to replay recorded or clearly labeled synthetic output. Its provenance and realTranscription:false are retained. This does not establish real ASR quality. captions.generate creates source-anchored subtitles from complete timed entries without replacing existing captions. Set outputSpec.subtitles to `burn` in the imported project to burn subtitles; UTF8 SRT is always delivered. Subtitle mode changes through a live editing command are not implemented.

Job request IDs are durable and revision bound. Poll video_job_read, cancel/retry using the job tools. Failed/cancelled/interrupted jobs publish no partials. Cache reuse verifies inputs and artifact hashes. Delivery/report links identify captured project/revision; feedback can reference the reviewed revision. File QA is separate from content and human review: check speech entities, numbers, negation, cut rhythm, audio sync, glyphs and placement manually. Real ASR, live LLM routing, live DSH UI/keyboard behavior, runtime job-ID mapping, power-loss durability and multi-session ownership remain unverified.

Rollback: stop writer gracefully with Ctrl+C, disable/remove @local/video-agent in DSH, preserve the entire external VIDEO_DATA directory including history/ledger/jobs and original media, and start the previous release with its prior configuration. Back up that directory with the writer stopped before upgrading; restore the full backup if an older release cannot understand newer commands. Do not selectively overwrite project.json or rewrite history. M0 fixtures/plugins are independent and are not modified by packaging. After a crash, confirm the PID in .writer.lock has stopped before manually removing that lock; restart marks running jobs interrupted, and retry is explicit. Do not steal a live writer lock.

Regression from source: `node tools/m3-acceptance/run.cjs`. Reports/media are written only under ignored data roots or OS temporary directories. Automated status never substitutes for human acceptance.
