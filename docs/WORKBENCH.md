# CUTDIRECTOR · 本地工作室

无需安装依赖或前端构建。PowerShell：

```powershell
$env:PORT='7803'
$env:VIDEO_DATA='.ui-data'
# ffmpeg / ffprobe 不在 PATH 时，设置 FFMPEG / FFPROBE 为本机已有可执行文件路径
node src/server.cjs
```

打开 http://127.0.0.1:7803/ 。导入对服务器可见的本地视频路径，创建工程并生成 H.264 工作媒体。所有工程修改经 `/command`，携带 `baseRevision`、唯一 `commandId`；冲突时保留输入，重新读取后人工核对。单轨连续排列的 start 根据裁剪与顺序计算。既有修正字幕受裁剪保护。当前版本不支持切分、新增片段实例、多轨或变速。

页面与 DSH Agent 使用同一 writer 的工程、选择、修订与任务；`/project/open` 切换共享当前工程。现有 dock 保留。页面检测其他写入后提示重新读取，避免覆盖输入。预览/导出绑定捕获的 revision；处理中显示真实阶段，不提供虚构百分比。完整产物发布后才可播放或下载。

SRT 支持 UTF-8 文件或粘贴；时间使用源媒体起点，毫秒精度。BOM、CRLF、多行支持；拒绝重叠、倒置、空内容及超出媒体时长。`POST /transcript/srt {srt}` 仅校验，无写入；通过 `/command` 的 `transcript.srt`（target 为 assetId，params 为 `{srt,language?}`）原子生成转写和不覆盖已有字幕的字幕实例。来源始终为 `srt-import`。跨片段边界的条目保留在 transcript，只有完整落入片段的条目生成字幕。

## 外部 ASR

默认 `/asr/status` 返回 `PROVIDER_NOT_READY`，没有模拟转写。可设置 `VIDEO_ASR_CMD` 为可执行文件路径，或 JSON argv 数组（支持空格路径与固定参数，不经过 shell）：

```powershell
$env:VIDEO_ASR_CMD='["C:\\local\\python.exe","C:\\local\\my_asr.py"]'
$env:VIDEO_ASR_TIMEOUT_MS='120000'
```

writer 使用本机 ffmpeg 提取 16kHz 单声道 WAV；临时音频绝对路径作为 argv 最后一项。provider 必须离线工作，自备已有模型；writer 不安装、不下载。stdout 只能输出以下 JSON transcript，日志写 stderr。每个子命令有超时，stdout 上限 2MB，退出/超时/格式错误明确返回错误；临时文件在结束后清理。

```json
{"id":"T_unique","assetId":"A1","model":"your-local-model","language":"zh","precision":"sentence","timeUnit":"microseconds","timeReference":"asset-origin","words":[{"id":"W1","startUs":0,"endUs":1000000,"text":"实际识别文本","confidence":null}],"missing":[],"uncertain":[]}
```

provider 可读取环境变量 `VIDEO_ASR_ASSET_ID`、`VIDEO_ASR_ASSET_HASH`、`VIDEO_ASR_DURATION_US` 获取当前素材身份及源时长。输出 `assetId` 必须对应此身份；时间整数微秒，按源素材起点，条目不重叠且不超时长。precision 可为 word/sentence/segment，不猜测词级对齐。空识别必须用 missing 给出范围与原因。provider 输出来源标记为 `external-provider` / `external-command`；这表示外部识别请求，不构成识别质量验证。显式 `VIDEO_ASR_FIXTURE` 保留原 fixture replay 行为，CMD 优先。

网页调用 `/command` 的 `transcript.asr`，参数 `{}`，target 为 assetId；重试相同 commandId 复用已提交结果。原 `/asr` API 继续兼容 DSH。ASR 完成后可按所选片段生成字幕。

## 验证

```powershell
node --test test/srt.test.cjs test/workbench.test.cjs test/asr/command.test.cjs
$env:VIDEO_ACCEPTANCE_DATA='.ui-data/acceptance'
node tools/m3-acceptance/run.cjs
```

`VIDEO_ACCEPTANCE_DATA` 仅重定向验收报告输出，避免改写已有 `.m3-data` 证据。实际 ASR 模型质量、真实视频画面/声音与 DSH 交互需人工验收。不要提交 `.ui-data` 或媒体产物。
