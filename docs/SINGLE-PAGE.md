> M4 当前入口见 [M4-running.md](M4-running.md)。下文保留 V2 原生会话方案及其验收记录。

# V2 full-page CUTDIRECTOR

CUTDIRECTOR owns the complete DSH main area. The same-origin `/video-agent/` iframe contains the app rail, overview, large player, clip thumbnails, editable subtitle text and exports. There is no chat/workbench grid or permanent chat column. Source: `src/client/client.js`, `src/web/`.

“和 Agent 对话” sends an origin- and source-checked message to the parent. The parent opens a closable right sheet (full width on narrow screens); Escape and “返回视频” close it and restore app focus. Its persistent `video-agent.conversation` child has `session-maybe` scope and calls the actual DSH `renderFactorySlot('conversation.content', {variant:'embedded', phase:'active', hero:false})`. Native session, composer, transport, streaming and tool cards remain DSH-owned. The factory stays mounted when hidden to retain conversation state. “展开会话” expands the real factory across the app. An error boundary and a permanently available “在 DSH 原生会话中继续” button provide a real fallback using `ctx.layout.selectPanel('conversation')`; the native CUTDIRECTOR sidebar entry returns to the app. No echo, simulated response, custom chat backend or invented chat endpoint.

API evidence remains in ignored `.ui-data/dsh-api-evidence`: installed conversation factory registration and embedded body, renderer scope inheritance, and layout keyed main selection. See `tools/inspect-dsh-api.cjs` for read-only extraction. Runtime drawer mounting is not claimed as visually verified.

Upload uses a file picker or drop zone and streams binary bytes through the authenticated DSH facade to `/upload`. It generates the project identity and local source path, imports/normalizes through the existing authoritative writer, then activates and plays the new video. No client path or project field is needed. Invalid input removes the uploaded source and leaves the prior active video intact; max size is 2 GB. Original source copies remain local for reopen/render. The existing synchronous import can take longer for large videos.

Advanced / debug holds project/revision, media identity and format, frame trim/reorder, local path import, SRT import, ASR configuration/status, provenance, history, command differences, raw export diagnostics and all artifact links. Default UI shows human-readable duration, text, saving/export status, video/subtitle downloads. Existing command envelopes, revision conflicts, selection and render APIs remain intact. Polling adopts Agent changes every 3 seconds, retaining unsaved caption/trim edits until explicit refresh. Recognition requires an existing configured provider; missing configuration is explained without a mock transcript.

## Isolated test runtime

Final test release: `.m3-data/release-v2-fullpage-final-20261104`, integrity verified by `tools/package-release.cjs --verify`.

The running writer uses `.ui-data/v2-test`, port 7794, and the existing FFmpeg/FFprobe executables. DSH runs ONLY `test-video` on 7801 under a separate `DSH_HOME=.ui-data/v2-dsh-home`; its local package junction points to the final test release. This avoids modifying either existing profile or the older release linked by desktop. No dependencies installed, no external network/provider calls, no push.

Open the authenticated URL printed by the test-video launch, choose a workspace/session, then click **CUTDIRECTOR**. Upload a video, open **和 Agent 对话**, ask for an edit, close the sheet and preview/export. A direct writer page is a standalone UI with an honest DSH-only chat notice, not a substitute chat implementation.

To restart from repository PowerShell:

```powershell
$env:PORT='7794'
$env:VIDEO_DATA="$PWD/.ui-data/v2-test"
$env:FFMPEG='E:/Deepseek-product/Agent/tools/ffmpeg-4.4.1/ffmpeg.exe'
$env:FFPROBE='E:/Deepseek-product/Agent/tools/ffmpeg-4.4.1/ffprobe.exe'
node .m3-data/release-v2-fullpage-final-20261104/src/server.cjs
# In a separate PowerShell, from this repository:
$env:DSH_HOME="$PWD/.ui-data/v2-dsh-home"
& E:/Deepseek/resources/runtime/cli/bin/dsh.cmd --profile test-video --no-open --port 7801
```

## Verification and remaining acceptance

- `node tools/m3-acceptance/run.cjs`: 24/24.
- `node --test test/single-page.test.cjs test/workbench-client.test.cjs test/workbench.test.cjs test/bridge.test.cjs test/srt.test.cjs test/asr/provider.test.cjs test/upload.test.cjs`: 13/13.
- Component tests cover default hidden real-chat sheet, trusted message boundary, open/close, full-page expansion, real native fallback, captions/durations, hidden technical controls, file/drop upload entry, command conflicts and preserved edits.
- Upload integration test streams a real synthetic video through the Host bridge, creates/activates it in under 30 seconds, reads playable media ranges, renders/downloads real MP4 and verifies invalid-upload cleanup.
- HTTP smoke on the actual isolated 7801 DSH instance confirms the V2 app and boot client bundle (including native factory) are served. This is not a visual browser test.
- Browser access host reports `The browser access host is unavailable`; native Edge state capture reports its window is minimized. Therefore screenshots, narrow viewport visual inspection, A-01 upload timing, native drawer composer mount, real Chinese Agent edit/streaming/tool cards and subjective playback review remain unverified. No provider call was attempted. Use the explicit native-conversation fallback if the embedded factory cannot render; do not interpret component/HTTP coverage as live chat acceptance.
