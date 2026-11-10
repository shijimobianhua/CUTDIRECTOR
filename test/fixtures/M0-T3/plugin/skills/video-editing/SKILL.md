# video-editing（M0-T3 草案）

- 状态：M0-T3 最小草案，只用于联合小样；不是完整方法正文。
- 作用：读取视频工程现场，选择最小工具，提交一次改动，并核对结果。

## 何时使用

- 用户要求查看/继续当前视频工程，或需要读取当前 revision。
- 用户要求在当前工程里加一个片段，且没有指定复杂剪辑方法。
- 不适用于：完整口播粗剪、字幕纠正、渲染验收；这些在 M1/M2 再按需加载其他 Skill。

## 输入

- 当前 `projectId`。
- 调 `video_project_read` 得到的 `revision` 与片段列表。
- 用户明确要求加的文字内容。

## 步骤

1. 先调 `video_project_read`，记录 `projectId`、`revision`、`clipCount`。
2. 需要改动时，生成一个稳定的 `commandId`（同一次重试复用同一个）。
3. 调 `video_project_apply`，传 `text`、`baseRevision`（上一步读到的 revision）、`commandId`。
4. 再调 `video_project_read`，确认 revision 增加、片段存在。
5. 若返回 `REVISION_CONFLICT`，重新读取，不要沿用旧 baseRevision；不要绕过适配器直接改工程文件。

## 保护与边界

- 只经 `video_project_apply` 写入；不直接读写 FableCut 的 `project.json`。
- 不调 FableCut 的 MCP 或原生 UI 写工程。
- 不把“提交成功”当成“内容验收通过”；本草案只验证接线与版本。
- 失败时报告错误码与当前 revision，不静默重试。

## 输出

- 一次工具调用回执：`projectId`、`revision`、`commandId`、`clipId`。
- 一句结果说明；内容是否正确仍需人工看。
