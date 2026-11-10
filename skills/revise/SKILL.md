---
name: revise
description: Revise selected source ranges and caption instances while protecting unrelated accepted edits.
---

Read video_project_read before editing. Resolve scope from current selected stable segment IDs or explicit source half-open ranges; never substitute list positions or old chat coordinates. Combine multiple ranges only when authorized. Retain unrelated corrected captions and accepted edits. PROTECTED_CONTENT means the requested trim would hide a corrected instance: explain the conflict, do not bypass it.
Use video_project_apply for caption.correct {text}, segment.trim {inFrame,outFrame}, segment.reorder {segmentIds}, or atomic batch {commands:[{op,target,params}]}. Trim only shortens existing ranges; reorder supplies the exact instance permutation. Corrections retain source anchors and history. Preview only the captured job revision. Report actual diff and affectedIds, not intended changes.
On REVISION_CONFLICT reread and resolve scope before making a new command. Identical transport retries retain commandId/payload. revision.restore {revision} on projectId creates a new monotonic revision; it is not a destructive overwrite. Missing capabilities yield a bounded proposal/gap. If only a proposal was requested, do not apply.
