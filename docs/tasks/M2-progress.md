# M2-T1 ASR provider boundary

Read 04 section 4.1 and ADR-003 before implementation. Frozen: existing Transcript identity/asset/model/language/precision/words/missing/uncertain extension; integer microseconds relative to asset origin; provider precision is preserved, no invented word alignment. Allowed adapter `src/adapters/asr/`, `test/asr/`, evidence docs. No external dependencies or downloads.

Implemented explicit UnavailableProvider (`provider-not-ready` / `PROVIDER_NOT_READY`) and asset-hash-bound FixtureProvider. Replay requires caller-supplied JSON path and provenance; status is always `fixture-replay`, `realTranscription:false`. Missing media, changed hashes, absent audio, invalid timestamps, precision, uncertainty refs and missing-coverage metadata reject explicitly.

Fixture envelope: `{fixtureVersion:1, assetHash, provenance:{kind:'recorded-provider-output',source:'local recording reference'}, transcript}`. Unit tests use explicitly labeled `synthetic-test` records and bytes; they validate transport/contract preservation of Chinese entities, numbers and negation, **not recognition accuracy**. Runtime usage: `transcribe(asset,{provider:new FixtureProvider('/absolute/local/recording.json')})`. Without a configured provider, `transcribe(asset)` rejects and returns no transcript. No network requests are made.

Validation: explicit contracts/time/commands/recovery/bridge/render/acceptance/asr-provider file run with `node --test --test-timeout=60000`: 13 passed, exit 0. Existing local FFMPEG/FFPROBE environment paths used. ASR-only: `node --test --test-timeout=20000 test/asr/provider.test.cjs`.

No ASR model or authentic recorded transcript was available. A-01/A-02 recognition quality, actual fixture recording, GPU/runtime readiness, UI/footage-intake integration and timestamp accuracy remain blocked/unverified. Do not call M2-T1 real-ASR acceptance passed. M2-T2 onward and M3 are deferred.

## M2-T2
Frozen: source CFR half-open frames, hash-bound media, read-only inspection as an immutable revision job. `video_inspect` uses the shared job/artifact service; summaries quote timed transcript entries only and explicitly mark absent content as unknown. Actual FFmpeg JPEG and <=5s MP4 extraction; existing artifact HTTP byte ranges apply. No ASR quality claim.
Validation: explicit inspect + bridge tests, 60s test timeout: 2/2 pass. Chinese path, real preview probe, missing transcript and changed-hash negative covered. Visual usefulness and real transcript summaries require human/provider verification.

## M2-T3 / M2-T4
Frozen proposal: `{baseRevision,items:[{segmentId,assetHash,inFrame,outFrame,reason,evidence:[{transcriptId,wordId,text}]}],gaps:[string]}`. Agent makes editorial choices from inspected evidence; validator rejects forged text/hash, repeated instances, invalid ranges and stale revision. Apply only through `roughcut.apply` at the existing shared command entry, persisting proposal/gaps in requirements and actual diff/history. No heuristic is presented as real Agent or ASR quality.
Human-corrected caption instances cannot be removed/trimmed out; reorder retains IDs and source anchors. Final project schema validated before atomic commit. Explicit roughcut/commands/bridge tests (20s): 4/4 pass, including 30 generated trim/reorder cases and atomic rejection. Semantic completeness, actual Agent choices and content quality remain human/live-runtime checks.

## M2-T5 / M2-T6 / M2-T7
Full render now supports `outputSpec.subtitles='burn'` (external UTF8 SRT always retained), source audio or silence, fractional CFR, H264/AAC, explicit frame count, private intermediate cleanup, decode/probe validation and verified cache reuse. Cache identity includes revision/snapshot/renderer; cache input and artifact hashes are rechecked. Real 30000/1001 test exposed a concat rounding extra frame: final CFR encode is now explicitly frame-bounded.
QA report binds project/revision/manifest, file and subtitle hashes, expected/actual frame count, FPS, dimensions, audio, duration and full decode. File checks can pass while content and human remain explicitly unverified. Content evidence/caption instances and human review checklist are separate.
Cancellation uses AbortSignal for the direct FFmpeg child (no shell or descendant processes launched); queued cancellation cannot launch FFmpeg. Failure/cancellation removes private partials. Explicit retry appends one attempt to a terminal job; concurrent retry rejects. Restart marks unsettled attempts interrupted without silently duplicating work. `/job/cancel` and `/job/retry` exposed through shared facade. Process hard-kill stale writer-lock reconciliation remains operator controlled.
Validation: explicit m2-render + render tests (60s): 5/5 pass. Real burned-caption/audio fractional render, counted frames, cache hit/changed-input invalidation; real FFmpeg running cancellation; durable interruption/retry; generated VFR and rotation normalization, Chinese paths, missing source and silent input. Content accuracy, subtitle glyph/placement and perceptual audio review remain unverified.

## M2-T8
`node tools/m2-acceptance/run.cjs`: 20/20 pass, exit 0. Explicit 12 files, 60s per-test / 240s process timeout. Evidence index `.m2-data/regression.json` maps AC-06..09 to tests and separately records real Agent/ASR/human checks as unverified. HTTP artifact range/corruption tests included. M0 fixtures and evidence unchanged. This is automated engineering acceptance, not a declaration of real-ASR/content quality acceptance.
