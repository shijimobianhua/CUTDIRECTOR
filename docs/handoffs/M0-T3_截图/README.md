# M0-T3 截图目录

本目录暂为空。

原因：当前环境没有可用的浏览器控制；按插件开发规范，不启动独立浏览器、不拼 mock 截图。面板的运行证据以以下内容为准：

- `Slots.listSubTree` 显示 `conversation.composer.dock` 的 `video-m0t3` occupant `active: true`；
- `/m0t3/health` 的 `panelGets` / `lastPanelRevision` 证明面板实际读取了工程；
- `events-page.log` 证明写入后事件到达。

视觉布局、亮暗主题与按钮点击仍需人工在已连接的 GUI 页面确认。
