---
name: video-editing
description: Coordinate a video task, choose intake, roughcut, local revision or output QA from the current project.
---

Read video_project_read and video_capabilities. Resolve the requested scope from current selection and stable source frame ranges. Route new/missing evidence to footage-intake, speech-led restructuring to talking-head-roughcut, local feedback to revise, and published output to render-qa. Do not impose speech editing on a visual montage. When methods switch, retain accepted edits and protected content.
All edits use video_project_apply with observed baseRevision, stable commandId, actor supplied by Host, and actual before/after diff. Never write project.json or invoke another writer. If asked for a proposal only, stop before applying. Reuse a command ID only for identical transport retries; on REVISION_CONFLICT read again and reconsider scope. Core tradeoffs that discard requested content require a user decision.
For delivery call video_render_start with revision, requestId and preview/export type, poll video_job_read, then route to render-qa. Cancellation/retry use video_job_cancel/video_job_retry; one unsettled attempt per job. Report provider gaps, captured revision and human-only checks. New media/project creation is the local import CLI documented in docs/M1-running.md, with writer stopped; no tool silently creates or downloads media.
