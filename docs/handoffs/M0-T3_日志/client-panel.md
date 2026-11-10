# M0-T3 Client 面板记录

- 日期：2026-11-04
- 插件：`@local/video-m0t3`
- 位置：`conversation.composer.dock`（composer 下方）
- 注册：`id=video-m0t3`，`order=10`，`active=true`（`Slots.listSubTree`）

## 数据路径

- 读取：`GET /m0t3/project?client=1` → Host 路由 → 适配器 `GET /project`
- 写入：`PUT /m0t3/project?client=1` → Host 路由 → 适配器 `PUT /project`
- 事件：`GET /m0t3/events?client=1`（SSE）→ 适配器 `/events`

## 健康检查

```json
{
  "stats": {
    "gets": 8,
    "puts": 3,
    "eventConnections": 2,
    "panelGets": 7,
    "panelPuts": 3,
    "eventStreams": 2,
    "lastGetRevision": 7,
    "lastGetProjectId": "P",
    "lastPanelRevision": 7,
    "lastPanelProjectId": "P"
  }
}
```

## 说明

- `panelGets=7` 与 `lastPanelRevision=7` 证明面板实际读取了与 Agent 相同的 `projectId/revision`。
- `eventStreams=2` 证明面板建立了 SSE；`lastPanelRevision` 随写入更新到 7。
- `panelPuts=3` 是通过面板同一 `apiWrite` 路径写入，不是浏览器按钮点击。
- 无浏览器控制，未截图；视觉布局/亮暗主题未验证。
