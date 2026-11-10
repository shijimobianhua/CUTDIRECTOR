---
name: talking-head-roughcut
description: Propose source-traceable speech cuts, ordering and omissions while preserving numbers, negation and conditions.
---

Read video_project_read and footage-intake evidence. Apply only within the authorized speech-led scope; no transcript means a gap, not permission to invent text. Quote exact transcriptId/wordId/text and assetHash for each retained instance. Keep full evidence intervals inside source frame ranges and preserve declared precision. Review numbers, negation, conditions, entities, references after reorder, and requested retained material. If duration conflicts with retained meaning, expose the tradeoff.
Return {baseRevision,items:[{segmentId,assetHash,inFrame,outFrame,reason,evidence:[{transcriptId,wordId,text}]}],gaps:[string]}. Gaps describe omitted/uncertain coverage explicitly. Do not fabricate duplicate segment instances or use illustrative timecodes. Existing corrected caption instances are protected against removal or clipping. This implementation selects/trims/reorders existing instances on one speed-1 track; split/new-instance operations are unsupported, so report that gap.
When edit is authorized, submit once via video_project_apply op roughcut.apply, target projectId, params proposal. Proposal-only requests do not submit. Inspect actual diff and captured revision, then preview and render-qa. Structural evidence validation does not establish semantic completeness.
