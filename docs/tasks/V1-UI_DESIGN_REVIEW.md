# 独立视频工作室 UI 交付记录

日期：2026-11-04

暖纸色背景、黑色正文、朱红强调、细边框与杂志式留白；使用系统字体，无外部字体、依赖或联网资源。

左侧提供品牌、工程列表、新建/导入和章节导航。顶部显示工程名称、revision、保存状态和渲染操作。概览卡片显示素材数、片段数、时长和字幕数，并链接转写入口。编辑区保留工作媒体播放器、素材/片段选择、时间线、裁剪/排序、转写/字幕修正、历史、任务产物与审阅反馈。

760px 以下改为纵向布局，播放器优先，表单与卡片可收缩，时间线在自身容器内滚动；长工程名及路径可换行。包含跳至工作区链接、可见键盘焦点、减少动态效果适配、加载/空/错误/冲突状态。导入错误在对话框内可见，未保存编辑显示提示。

路由与命令保持原样；工程修改继续通过 `/command` 发送 baseRevision、commandId，不直接写 project.json。新建工程通过导入首个本地视频完成。保留 SRT 文件/粘贴导入和真实 VIDEO_ASR_CMD 状态；未配置时明确显示 PROVIDER_NOT_READY。

验证结果：

- `VIDEO_ACCEPTANCE_DATA=.design-data/acceptance node tools/m3-acceptance/run.cjs`：24/24。PowerShell 实际使用 `$env:VIDEO_ACCEPTANCE_DATA='.design-data/acceptance'` 设置变量，避免写入 `.m3-data`。
- `node --test test/workbench-client.test.cjs test/workbench.test.cjs test/srt.test.cjs test/asr/*.test.cjs`：10/10。
- `node --check src/web/workbench.js`、`git diff --check`：通过。
- `GET http://127.0.0.1:7803/`：200。
- 客户端新增测试使用 Node 内置 VM 和 DOM 替身，检查初始化、provider 提示、空工程禁用和修订冲突输入保留；不替代真实浏览器布局检查。

启动（PowerShell）：

```powershell
$env:PORT='7803'
$env:VIDEO_DATA='.design-data'
node src/server.cjs
```

现有 7793 writer 未停止或重启。临时 `.design-data/` 已忽略，不提交媒体与运行数据。未修改 DSH client/plugin、profiles、M0 证据或 `.m3-data` release。

视觉验证阻塞：浏览器连接不可用；Windows computer-use 随后因无法可靠识别浏览器当前 URL 而中止，未取得浏览器截图。

人工待验：在全宽和 420px 视口检查无页面横向溢出，遍历键盘焦点，检查长工程名/路径、导入等待/失败、真实视频播放、裁剪排序、SRT 修正、并发冲突提示、渲染取消/重试与成片下载；配置真实 VIDEO_ASR_CMD 后做听读核对。本次未进行真实音视频或审美验收。
