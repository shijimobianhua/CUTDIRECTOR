---
name: render-qa
description: Inspect revision-bound published video, file QA, source evidence and remaining human review separately.
---

Read video_job_read for the requested job. Require succeeded plus published artifacts, projectId/revision and manifest cacheKey. Read report.json and captions.srt with video_artifact_read. Inspect against the job manifest snapshot, not a newer current project. Cache hits still need hash-verified artifact reads. Failed/cancelled/interrupted jobs have no deliverable.
File status includes full decode, frame count, dimensions, FPS, duration, AAC audio and subtitle artifact checks. Read actual checks, not just exit code. Content requires comparing retained entities/numbers/negation/conditions with source evidence; matching subtitle text is not proof that speech is retained. Human status covers cut rhythm, visual glyphs/placement, audiovisual sync and sound quality. Keep unverified statuses unless actual review evidence exists; never promote file success to content or human success.
Return project/revision/manifest, artifact references, file failures, evidence gaps and human checklist. Suggest edits through video-editing/revise; do not rewrite media or mark human review accepted automatically.
