---
name: footage-intake
description: Inspect imported source segments, transcript precision and media evidence before editorial selection.
---

Read video_project_read. Existing asset hashes and source CFR half-open frame coordinates identify evidence; original media stays read-only. Missing/VFR/rotated/nonzero-origin media require local import/normalization with recorded working-media mapping, not guessed timing.
If speech evidence is needed call video_transcribe with assetId, baseRevision and commandId. PROVIDER_NOT_READY is a capability gap and produces no transcript. VIDEO_ASR_FIXTURE explicitly enables hash-bound fixture replay with realTranscription:false; preserve provenance, fixture hash, missing and uncertain entries and never call it recognition quality. Sentence precision is not word alignment. Corrections are separate caption instances, not changes to transcript words.
Call video_inspect with revision/requestId, poll video_job_read, then video_artifact_read for segments.json. Read only useful previews/keyframes at returned URLs. Summaries quote timed source entries; absent transcript is unknown content. Return asset/hash/ranges, observations and explicit missing coverage, not a time-line edit. Missing audio does not imply speech.

For authorized subtitle creation, video_project_apply op captions.generate on projectId takes {transcriptId,segmentIds}. It creates source-anchored instances only for complete timed entries inside selected clips, skips overlaps, and preserves existing corrections. Fixture provenance remains attached; generated text is not human-verified.
