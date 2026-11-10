# 最终版工作台 UI：Codex 执行书

- 日期：2026-11-04
- 执行：Codex `gpt-6.1-sol` high reasoning
- 验收：DSH 只跑测试/看启动/看关键路由
- 分支：`m1-m3-first`
- 目标：把当前“composer 下方小面板”升级成**完整本地工作台**，不依赖 DSH dock 也能用

## 1. 为什么改

当前 UI 是 dock 小卡片：空间小、工程列表/片段/字幕/渲染挤在一起，用户觉得不方便。最终版要一个全页工作台：

```text
┌ 顶部：工程选择 / 导入 / 保存状态 / 渲染按钮 ┐
├ 左：素材、片段、轨道                  ├ 右：转写/字幕编辑
├ 中：播放器 + 时间线                  ├ 底：任务/产物/反馈
└────────────────────────────────────┘
```

## 2. 必须做

1. **全页本地 UI**
   - `GET /` 返回完整 HTML，静态资源放 `public/` 或 `src/web/`；
   - 不引入前端框架/构建步骤，原生 HTML/CSS/JS；
   - 中文界面、空/加载/错误/冲突状态、键盘可达；
   - 保留现有 DSH Client 面板，但不再作为唯一入口。

2. **工程与素材**
   - 工程列表/打开/当前 projectId/revision；
   - 导入本地视频（文件选择 + 上传或本地路径），复用 import/normalize 逻辑；
   - 播放器读取工作媒体（H.264 proxy），显示时长/分辨率/音轨；
   - 片段列表、单选/多选、选中上下文传给 Agent/命令。

3. **时间线与编辑**
   - 片段 trim（入点/出点/start）；
   - 单轨 reorder；
   - 字幕/文本编辑，保留修正实例；
   - 所有写入走 `/command`（baseRevision + commandId），冲突提示重读，不直接改 project.json。

4. **转写/字幕入口**
   - `POST /transcript/srt`（或等价）导入 UTF-8 SRT，生成/合并 transcript + captions；
   - 文件选择 + 粘贴 SRT 两种入口；
   - 明确区分“真实 ASR”“外部 provider”“SRT 导入”“fixture”；
   - 没有 provider 时显示 `PROVIDER_NOT_READY`，不伪造转写。

5. **ASR provider 接口**
   - 支持可选 `VIDEO_ASR_CMD`：本地命令接收音频路径，返回 JSON transcript；不下载模型、不联网；
   - 默认 provider-not-ready；
   - 失败/超时/格式错误明确报错。

6. **渲染/任务/产物**
   - 生成预览/导出按钮，job 进度、取消、重试；
   - 产物列表、播放/下载、版本绑定（revision/manifest）；
   - 失败/半成品不发布。

7. **回归**
   - 现有 `node tools/m3-acceptance/run.cjs` 必须保持 **24/24**；
   - 新增 SRT parser/transcript/UI route 测试；
   - 用独立 `PORT=7803`、临时 `VIDEO_DATA` 启动，不杀现有 writer 7793；
   - 不修改 M0/M1/M2/M3 证据与 `.m3-data` release。

## 3. 硬规则

- 不联网下载依赖/模型；Node 内置 + 现有代码；
- 不安装/启用 DSH profile 插件；不碰 `~/.dsh/profiles`；
- 不提交媒体/运行数据；
- 失败就写 blocked，不填假数据；
- 每完成一块提交，提交信息 `ui:` / `srt:` / `asr:`；
- 不 push。

## 4. 验收命令

```powershell
node tools/m3-acceptance/run.cjs
$env:PORT='7803'; $env:VIDEO_DATA='.ui-data'; node src/server.cjs
# 另开：GET http://127.0.0.1:7803/
```

## 5. 最终报告

```text
完成：
测试：
提交：
启动/端口：
UI 路由：
未完成/blocked：
人工待验：
```
