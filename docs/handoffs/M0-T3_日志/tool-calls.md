# M0-T3 工具调用记录

- 日期：2026-11-04
- Agent：本会话 DSH Agent
- 工具：`video_project_read` / `video_project_apply`
- 项目：`P`

```text
1  read  -> project=P revision=0 clips=0
2  apply text="Agent clip M0-T3" base=0 command=agent-m0t3-1 -> revision=1 clip=c_agent_1793785248247_jymq88
3  read  -> revision=1 clips=1
4  apply text="Agent clip 2" base=1 command=agent-m0t3-2 -> revision=2
5  page route write (client=1) base=2 -> revision=3
6  read  -> revision=3 clips=3
7  apply text="Idempotent clip" base=3 command=agent-m0t3-3 -> revision=4 clip=c_agent_1793785314219_8fl0nr
8  apply same text/base/command -> revision=4 same clipId
9  apply same command different text -> Error: COMMAND_ID_CONFLICT
10 read  -> revision=4 clips=4
11 page route write (client=1) base=4 -> revision=5
12 read  -> revision=5 clips=5
13 page route media attach (client=1) base=5 -> revision=6 media=1 clips=6
14 read  -> revision=6 clips=6
15 page route write + SSE (client=1) base=6 -> revision=7
16 read  -> revision=7 clips=7
```

健康检查最终：

```text
panelGets=7 panelPuts=3 eventStreams=2
lastPanelRevision=7 lastPanelProjectId=P
lastGetRevision=7
```

说明：

- 第 7—9 项验证了工具层幂等：同 commandId 同内容返回同一 clip/版本；同 ID 异内容拒绝。
- 页面按钮本身未被 DSH 点击；第 5/11/13/15 项使用面板同一 `apiWrite` 路径（`/m0t3/project?client=1`）。
