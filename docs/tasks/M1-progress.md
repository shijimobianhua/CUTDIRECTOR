# M1 implementation evidence

M1-T1 remains commit 0d10a9d, unchanged.

## M1-T2
Frozen contract: integer CFR source frames, half-open intervals, nearest ties upward, coverage outward; source timestamps retain origin. Caption instances anchor to segment IDs. Normalization records mapping and hash. Allowed: core captions/time, media adapter, tests and this evidence.

`node --test --test-timeout=20000 test/contracts.test.cjs test/time.test.cjs`: 3 passed, exit 0. Fractional fps, off-grid, nonzero origin, rotation and no-audio metadata, source-anchored trimmed captions covered. Real normalization is exercised by the render integration in T6; browser playback and visual synchronization require human verification.

## M1-T3
Frozen commands and errors follow contracts/README.md; allowed core store, tests, evidence. One root lock (stricter than one project lock); complete project/history/ledger envelope is fsynced and renamed. Failed batches do not consume IDs. Explicit contracts/time/commands test run: 4 passed, exit 0. Single-writer contention, concurrent stale bases, changed-ID rejection, durable replay and batch rollback covered.

## M1-T4
Frozen restore creates a new monotonic revision; history snapshots remain immutable. Allowed core store, recovery tests, evidence. Explicit contracts/time/commands/recovery run: 6 passed, exit 0. r3 -> restore r1 -> r4 and reopen verified; injected failure before rename retains old project/history/ledger. Real power loss and killed-process lock reconciliation remain operator checks.

## M1-T5
Frozen UI props: project/selection/status/error/diff; events: onCommand/onSelect/onRefresh. Status: loading/ready/busy/conflict/error. Allowed server, host/client, runtime skills, bridge tests, evidence. Actual M0 tools/webServer/skills/slots/locale APIs reused. Explicit tests through bridge: 7 passed, exit 0. HTTP page facade -> human caption correction -> Agent trim, selection, revision conflict verified. DSH live installation, layout, keyboard and screenshots remain unverified; no separate browser launched.

## M1-T6
Frozen manifest captures projectId/revision, input hashes, output spec, immutable snapshot, renderer version and canonical cache key. Queued/running/succeeded/failed/cancelled/interrupted jobs retain request digest and attempt ID; only validated outputs are atomically renamed to published directory. Allowed render adapter, jobs/routes, Host/Client preview wiring, tests. Explicit six test files with 60s per-test timeout: 9 passed, exit 0, including actual FFmpeg Chinese-path silent-media normalization, two-segment H264/AAC decode, external Chinese SRT, hash and duration/dimension validation. Injected r1-in-flight/r2-edit and partial-output failure pass. Cache key is generated but output reuse is deferred. DSH runtime job-ID mapping is not yet wired; business jobs run in local writer process. Noncontiguous/multitrack/non-normalized media explicitly rejected.

## M1-T7
Frozen AC definitions follow PRD section 11.1. Allowed acceptance tests/tools, startup/package docs, integration hardening. `node tools/m1-acceptance/run.cjs`: 11 passed, exit 0 (explicit seven files, 60s test/180s process timeout). `node tools/m1-acceptance/startup-smoke.cjs`: startup/health passed, exit 0 on ephemeral loopback 60220; default port is 7793. `node tools/package-plugin.cjs`: self-contained ignored bundle built; bundle Host/skills and Client slot registration are covered by test. `node --check src/client/client.js` and `git diff --check`: exit 0.

Real source smoke: with existing FFMPEG/FFPROBE environment paths, `node tools/m1-acceptance/a01-smoke.cjs test/fixtures/M0-T3/data/media/A-01.mp4`: succeeded, exit 0, H264/AAC 360x720 first-second MP4 + explicitly non-transcript test caption SRT + file QA report, engineering snapshot reopened. Local evidence root `.m1-data/a01-1793789264251`; source SHA256 77849adb27faf0f26cc166219d4072ff9f67216c0a82d9caac67c67fa843df77; video SHA256 be3a5f1502206e5f3e5b67fe39ac552acb5a98a9ee7c925402ca387b2fa62010. No media/generated data committed.

AC-01..05 automated architecture checks pass. Live DSH/real Agent invocation, UI screenshots, browser playback, keyboard/visual/audio review and disk-power-loss remain unverified; these are not declared passed. M0 fixtures untouched. M2/M3 not included in this M1 milestone.
