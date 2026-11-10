# CUTDIRECTOR 自有 Agent 运行指南

## 图形化启动和模型设置

Windows 包内双击「打开 CUTDIRECTOR.exe」。新安装的工程目录为当前用户本地应用数据下的 CUTDIRECTOR/projects。与 DSH Desktop 共用既有工程时，部署时将既有绝对工程路径写入当前用户本地应用数据下的 CUTDIRECTOR/data-dir.txt。启动器会复用端口 7793 上兼容的 writer。

打开「和 Agent 对话 → 添加或管理模型」。选择厂商，粘贴 Key，获取模型列表或手动输入 ID，然后测试并保存。DeepSeek 只需 Key，其他兼容服务需填写接口地址。测试会发一个简短的模型请求，保存后立即可选。Windows 凭据保护限定在保存 Key 的用户下解密。

DSH 入口优先显示 DSH 宿主提供的模型目录，也可选择本地配置。所有对话、提案和工具执行仍由 CUTDIRECTOR 管理。独立入口使用本地模型。DSH 直连首版传递文本上下文，关键帧仍可选用声明支持图像的本地配置模型。

开发和自动化也可继续使用下文的环境变量配置。
使用现有离线包或源码。模型适配器使用 OpenAI 兼容聊天接口。PowerShell 示例中的 URL 和模型名需替换为自己的配置。

```powershell
$env:VIDEO_AGENT_MODELS='[{"id":"local","model":"editing-model","endpoint":"http://127.0.0.1:11434/v1/chat/completions"},{"id":"studio","model":"studio-model","endpoint":"https://your-provider.example/v1/chat/completions","keyEnv":"CUTDIRECTOR_STUDIO_KEY","vision":true}]'
$env:VIDEO_DATA='E:\Video-agent-data'
node src/server.cjs
```

凭据通过 `keyEnv` 指定的后端环境变量提供。连接远程模型会向配置端点提交任务文本和必要的转写证据。视觉模型只有在本次勾选授权后才会收到从当前 revision 的检查任务获取的关键帧。模型端点变更在重启 writer 后生效。

- 独立使用时打开 `http://127.0.0.1:7793/`。上传或打开项目，点击 **和 Agent 对话**，选择模型并发送剪辑要求。仅查看方案时勾选 **仅提案**。要执行，请发起允许确认的新请求并核对动作细节。可以提出连贯的剪辑、预览和导出请求，每个实际操作都有独立的确认。
- DSH 中使用同一发布包的插件。插件嵌入上述工作台；聊天入口无需选择 DSH Session。writer 已运行时通过现有 adapterUrl 连接到它。
- 先保存已接受、明确确认的人工反馈，再在 Agent 对话的 **学习与偏好** 中启用。使用 SRT 或既有本地 ASR 获得真实转写。预览和导出后请人工检查节奏、语义、同步和字幕。
- 旧项目无需迁移。回退先停止 writer，保留整个外部数据目录，再恢复旧发布。需要继续 M4 会话时保留 `_agent`，需要隔离测试时使用独立数据目录。

## 可选 DSH 原生分析

默认关闭。只在专门验证过权限隔离的 DSH profile 启用。writer 与该 Host 使用相同的 `VIDEO_DSH_ANALYSIS_PORT`、`VIDEO_DSH_ANALYSIS_TOKEN` 和 `VIDEO_DSH_ANALYSIS_ISOLATED=1`。令牌至少 32 字符。Host 另配置 `VIDEO_DSH_ANALYSIS_PROVIDER` 和 `VIDEO_DSH_ANALYSIS_MODEL`。委派由 CUTDIRECTOR 会话的单次勾选授权；发送有界证据页并使用独立的原生 Session。桥只监听回环地址，禁止该 Session 执行工具，并限制模型步数。应先在目标版本实测拒绝路径；配置不可用时仅委派降级，主流程继续。

## 剪辑策略对照评测

```powershell
node tools/agent-eval.cjs 'E:\approved-samples\samples.json' local
```

评测输入是 JSON 数组。每项含 `id`、相对路径 `project`（revision 0 的 Project 对象）、`request`，可选 `intent`、`preferences` 和 `expect`（`mustKeep`、`targetSec`）。样片可在隔离目录导入后准备。评测只写临时工程，对模型输出先检查无未授权改动，再在临时副本确认可执行的编辑。报告包含策略版本组、调用量、保留项、时长误差和人工审阅标记。正式对比还需由人工记录返工次数。请只使用允许发给所选模型的真实转写。

