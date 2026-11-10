# CUTDIRECTOR 创作扩展与工具接入 v2

本轮沿用 DSH 内嵌工作台及既有视觉体系。数据结构从 32 升至 33。独立工作台不恢复。

## 用户入口

- 右上角「助手」：自由聊天、历史、新对话、搜索、改名；保存灵感或建立作品由用户点击。
- 「剧本」：按作品、分集、场景写作，导入原文，编辑动作、对白、旁白、内心独白和音效。
- 项目中的「剧本与分镜」：与剧本导航访问同一份记录；「用于图片、试拍与交付」会明确发布这一集到制作。
- 「角色与场景」：固定人物、场景、道具、概念图及声音描述。
- 「关系画布」：共享剧本与分镜数据；布局另存。关系连线不会启动生成任务。
- 「制作素材」：选择服务、目标内容、制作方法和有序参考素材，先准备再授权。
- 「画面与声音」：在已确认主画面上添加反应画面，保留对白，安排音效、配乐、淡入淡出和音量关键点。
- 设置 → 图片与视频：常用预设、密钥保护、检查、修改、移除和配置导入导出。
- 设置 → 工具与能力：开发基线、示例，以及已有 DSH 扩展和只读 Agent 委派。
- 设置 → 制作方法：原有 Skill 导入导出继续保留。

单集/单次交付上限 25 分钟；分镜按集保存并分页显示。旧工程首次进入时建立默认第一集，已有镜头 ID 和素材不变。编辑其他集不会自动替换正在制作的分镜。

## 创作数据

studio_documents 统一保存 episode、source、character、location、prop、concept、shot、clip、canvas。
每次内容保存增加 version，历史保存在 studio_revisions。source 为不可变原文；编辑在剧本中进行。
所有内容操作带 commandId、expectedVersion。批量操作先检查所有版本和内容，在一笔数据库事务中保存。
归档写入新版本；历史恢复也写入新版本，不回写旧记录。

episode 包含稳定 ID 的 scenes 和 blocks。台词类型为 dialogue、inner、narration，动作 action，音效 sound。
shot 保存 episodeId、sceneId、sourceBlockIds、scriptVersion、durationUs，以及画面、首尾图、所选素材。
clip 的 shotIds 支持一份生成片段覆盖多镜；秒数、提示词和引用单独记录。
canvas 只保存节点位置和手动关联；包含关系与素材使用关系从内容计算。
原文导入支持 UTF-8、GB18030、UTF-16LE 文本，以及提取 DOCX 中的正文；不执行宏、脚本或 XML 外部实体。
单次导入文件最多 12 MB，提取正文最多 400 万字。导入剧本的区间需显式选择；模型单次原文片段最多 32000 字。
原文件以 SHA-256 命名保存在 studio-originals；目录未暴露为任意文件访问接口。

## 会话边界

assistant_chats / assistant_turns 与旧项目聊天、灵感聊天分别保存。
general 会话默认不读取项目；附上作品后只发送已选工程文字和素材元信息。
episode 会话记录剧本/分镜提案；模型只提供建议，采用时再次核对内容版本。
模型由 DSH 的 ctx.llm 提供。运行中固定 provider、model，更新选择不改变已经开始的任务。
失败或中断保留输入；重新发送是显式动作。
普通聊天不要求 JSON；创作建议使用结构化 documents。无法解析为提案时作为回复展示，不直接写入。

## 工具标准 v2

清单字段：

| 字段 | 含义 |
|---|---|
| schemaVersion | 固定 2 |
| id、version、title | 命名空间身份、语义版本、用户能读懂的名称 |
| hostRange | 当前宿主主版本 3 |
| transport | openai-image、ark-image、ark-video、runninghub、comfyui、http、mcp-http、mcp-stdio、dsh、codex |
| capabilities | 能力列表，允许提供者命名空间 |
| permissions | project-read、media-read、media-upload、network-read、paid-generation、local-execution |
| inputSchema、outputSchema | JSON Schema，禁止远程 schema 引用 |
| limits | images/audio/video 数量、maxSeconds、ratios |
| cost | free、paid、unknown |
| lifecycle | submit、poll、cancel、idempotent |
| source、license、dependencies | 来源、许可、依赖说明 |

权限说明不等于授权。普通安装、检查、执行、素材发送和收费分开。
新工具须先检查，准备任务时保存 manifest 和连接版本。修改连接后旧的未提交任务需重新准备。
MCP 工具的 annotations 仅作为提示，不当作可信的权限依据。
本地 stdio 程序使用绝对路径和参数数组启动，不经过 shell；用户必须明确确认信任。
DSH 插件在 DSH 权限内执行，CUTDIRECTOR 不承诺隔离恶意插件本身。
工程写入仍走 CUTDIRECTOR 的版本和提案门禁；外部工具结果作为建议或素材，不能自行审批。

SDK：插件导出 @local/video-agent/tool-sdk 的 defineTool。
校验：node tools/validate-tool.cjs <tool.json>。校验不启动程序、不调用服务。
示例在 examples/tool-v2。配置文件可通过 GUI 导入。
现有 v1 DSH 扩展仍通过原入口运行；不强制把已安装工具改成 v2。

### HTTP 映射

连接 config.http：

- probe：只读路径，可省略；省略时只检查配置，并注明尚未验证真实调用。
- submit：path、method、body。
- taskIdPath：异步提交返回的任务编号路径。
- status：查询 path（可包含 {id}）、method、body。
- statusPath、doneValues、failedValues：状态归一化。
- artifactsPath：产物数组的位置；artifactMapping 可把厂商响应映射为统一产物。
- textPath 或 dataMapping：文字/结构化结果映射。
- body 中 {$value:"input.prompt"} 引用任务输入；references.0.dataUrl 引用已授权的素材。
- artifactMapping 中 {$value:"item.inlineData.data"} 可取得每项内嵌图片。
- 映射不执行代码。需要签名计算或其他逻辑的工具，使用 SDK、MCP 或 DSH 适配器。

API Key 只填独立密钥栏，使用 Windows CurrentUser DPAPI 加密。设置响应只返回 keyConfigured。
导出不含密钥。禁止将密钥放进通用配置、工作流参数或浏览器持久存储。
请求错误不回显厂商响应正文，避免把账号信息带进日志或界面。
产物下载使用独立请求，不携带服务 API Key。跨域结果下载需用户登记允许的域名。
不要把下载域名当作图片生成厂商的身份认证；它只限制这次取回的数据来源。

## 媒体任务与恢复

studio_jobs 保存固定输入、工具版本、模型、Skill 摘要、素材摘要、内容版本与稳定命令 ID。
状态：awaiting_approval → submitting → queued / collecting → complete。
另有 failed、unknown、collect_failed、cancelled。
提交后取得 external_id 就立即保存。重新批准同一任务不会重新提交。
进程重启把可能已提交的任务标成 unknown；有外部编号则查询，没有则请用户核对服务端并关联编号。
查询和 collect_failed 重取回不会调用生成接口。同步图片先落本地缓存再导入媒体。
网络中断无法证明服务端未处理，所以不能自动重投。
取消运行中的任务通常只能确认停止等待，不能保证退款；没有回执时保持 unknown。
结果作为候选保存，明确采用才关联到角色、概念图或镜头。内容版本变化后提示重新核对。
参考图片、音频、视频数量由能力声明控制。每份本地参考最多 32 MB，单次读取参考合计最多 64 MB。
图片与视频通过既有媒体检查导入；音频支持 WAV、MP3、M4A、OGG，使用 FFprobe 核对类型和时长。

## H3 短剧模板

提供 10 秒新手试做与完整一集两条起点。
流程：剧本 → 人物/场景/道具 → 分镜及生成片段 → 关键段 5 秒试拍 → 选择结果 → 局部补拍 → 剪辑交付。
固定画风、角色形象、服装、场景光线、人物站位与声音描述。
区分对白、内心独白、画外音；视频素材不强制烧入字幕或各自附带背景音乐。
H3 模式和参数由已接入工作流决定；不宣称每个厂商支持相同模式。
素材槽位按实际顺序发送，未使用槽位必须在工具工作流中关闭。
RunningHub 需要当前用户可用的工作流 ID。检查读取 API 格式并建议参数映射。
ComfyUI 的界面版 nodes/links JSON 不直接提交为 API prompt；需导出 API 格式。
检查只读取工作流和节点信息，不自动安装自定义节点或模型权重。
本地 ComfyUI 使用 /prompt、/object_info、/history 等正式接口；不全局中断其他人的运行任务。
随机种子保存到每次请求；换一版需新任务与新授权，结果不明时先查原任务。
费用以实际服务端为准，不固化文章中的 2 毛/27 元等样例价格。

文章及包来源：
https://x.com/TuyetloanP81840/status/2119326884505043274
https://miliagent.com/library/
作者包未发现完整再分发许可，产品支持用户自行导入，不将其所有内容原样捆绑。
H3 模型及官方提示词资料有独立许可；不会标成 MIT。
React Flow 采用 MIT，随本地构建产物保留许可。Easy Jianying 原有 PolyForm Noncommercial 许可继续保留。

## Codex 原生出图

支持本机程序路径选择、登录、分阶段诊断，以及 Windows MXC / 受限账户 / WSL2 运行环境。
自动模式尝试 Windows 后端；每个后端均需通过输入可读、产出可写、工程外不可读写的探针。
Windows elevated 若要求 :root read，与当前隔离目标不兼容，保持不可用。
WSL2 必须已安装发行版及其 Codex、Python；独立登录，不自动复制 Windows 凭据。
登录通过 account/login/start，账号状态通过 account/read。浏览器只看到官方登录入口与状态。
模型使用原生 imageGeneration 事件；限一次出图；工程只读、输出目录可写，应用、网页、shell 等额外能力关闭。
没有真实图片产物时不会标为生成成功。API 图片提供者单独显示名称。
系统修复只运行 DISM / SFC，不更改 PowerShell 执行策略，不自动重启。修复后仍需重跑隔离探针。
原生出图与账号可用性须实际验证；代码接通、环境检查通过、真实生成通过分别记录。

## 新增 API

所有外部入口仍位于 /video-agent/v3，继承 DSH 嵌入会话验证。后端 worker 路径去掉此前缀。

- GET /studio/index
- GET /studio/standard、/studio/presets
- GET/POST /studio/connections
- POST /studio/connections/:id/probe、/remove；GET /export
- GET /studio/dsh-tools
- POST /studio/codex-diagnostics、/studio/codex-login
- GET /studio/codex-login/:id
- GET/POST /studio/assistant/chats
- GET/POST /studio/assistant/chats/:id
- GET/POST /studio/assistant/chats/:id/turns
- POST /studio/assistant/chats/:id/turns/:turnId/{apply,convert,cancel}
- GET /studio/projects/:projectId
- GET/POST /studio/projects/:projectId/documents
- POST /studio/projects/:projectId/documents/batch
- GET /studio/projects/:projectId/documents/:id/versions[/:version]
- POST /studio/projects/:projectId/documents/:id/{restore,archive,publish}
- POST /studio/projects/:projectId/import、/audio（受限二进制上传）
- GET /studio/projects/:projectId/context?episodeId=...
- GET/POST /studio/projects/:projectId/jobs
- GET /studio/projects/:projectId/jobs/:id
- POST /studio/projects/:projectId/jobs/:id/{approve,check,cancel,reconcile}

worker 的 finish、claim、external-finish 等控制接口不开放为通用插件外部写入入口。
页面草稿通过既有 /views，增加 assistant、assistant-draft:chatId、studio-draft:documentId 作用域。
脚本内容、画布内容与页面状态分别保存，页面地址失败不会再提示“文字丢失”。

## 验证与发布

只做变更相关边界检查和实际浏览器交互检查，不重复运行全部旧回归。
本地测试使用独立目录和确定性模型；这些模型不会写入真实 DSH profile。
付费出图、视频、配音、搜索及视听模型验证等预算未获批准前保持未实测。
发布备份 .v3-data、.m1-data 和 desktop profile；旧发布包保留。
回退必须恢复匹配数据库备份，旧版本不能直接读取 schema 33。
