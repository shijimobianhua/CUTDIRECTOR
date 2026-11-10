# CUTDIRECTOR

基于 DSH 插件基座的视频创作集成工作台。当前快照：0.3.0-preview.7（2026-11-10），仅提供 DSH 嵌套工作台。

## 当前能力

独立助手与多轮聊天、灵感管理、分集剧本、分镜与角色场景、关系画布、图片/视频 API、RunningHub/ComfyUI 工作流、DIY HTTP/MCP/DSH 工具标准、候选素材与授权任务、剪映草稿交付。

## 文档

- [V3 PRD](docs/product/CUTDIRECTOR-V3-PRD.md)
- [技术执行手册](docs/product/CUTDIRECTOR-V3-技术执行手册.md)
- [工具接入标准](docs/v3/创作扩展与工具接入-v2.md)
- [当前助手修复交付](docs/product/CUTDIRECTOR-V3-助手对话修复-r4.md)
- [历史运行说明](README-legacy.md)

## 开发与打包

需要 Node.js 24+。运行 npm ci，npm run build:studio。DSH 插件打包入口为 tools/package-v3.cjs；个人预览包配置入口为 tools/create-v3-preview.cjs，安装工具为 tools/install-v3.cjs。配置文件中的 dataRoot、FFprobe、Python、剪映等路径需要按自己的电脑调整。安装器会备份原工程与插件路径。源码同时保留历史 M0–M4 接口。

## 当前限制

Codex 原生出图在开发机仍未通过隔离检查；WSL2 后端尚待验证。真实付费模型/供应商调用、25分钟及多轨真实导出、最终新手试用没有被标记为通过。设计通用门禁仍有 iframe 容器识别限制，详细交付记录说明了本地验证范围。此仓库不包含用户工程、账号、API Key、依赖目录、浏览器缓存、本机发行包和第三方模型权重。

## 第三方组件

保留现有第三方许可证声明。React/React Flow 等许可证在源码及构建产物声明中；Easy Jianying 由打包工具从固定版本取得，遵循 PolyForm Noncommercial；H3 与各服务遵守其上游许可。没有为整个项目擅自添加开源许可，公开源码不代表已授予商业再分发授权。
