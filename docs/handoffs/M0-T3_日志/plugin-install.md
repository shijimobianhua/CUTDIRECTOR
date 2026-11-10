# M0-T3 插件安装记录

- 日期：2026-11-04
- 插件：`@local/video-m0t3` 0.1.0
- 路径：`E:\Deepseek-product\Agent\Video-agent\test\fixtures\M0-T3\plugin`
- 安装方式：`plugin_manager install_bundle`（本地目录）

## 首次安装失败（已修复）

```text
video-m0t3 (@local/video-m0t3): JsonSchemaError: unsupported JSON schema:
schema.properties.projectId.required is not supported on type "string"
...
```

原因：`output.schema` 使用了逐字段 `required: true`；DSH 的工具输出 schema 要求对象级 `required: [...]`。

修复：改为 `required: ["projectId","revision","clipCount","clips"]`，并同步 apply 工具。

## 最终安装

```text
stage=enable
target=@local/video-m0t3
application=applied
bundle=@local/video-m0t3
version=0.1.0
warnings=[]
```

安装后：

- `video_project_read`、`video_project_apply` 出现在工具列表；
- `video-editing` 出现在 Skill 目录；
- `conversation.composer.dock` 的 occupant `video-m0t3`（order 10，active true）。

## 重装说明

修改 Host/Client 代码后，用 `remove_bundle` → `install_bundle` 让 profile 重新加载；Client 新 bundle 生效后，面板开始以 `?client=1` 请求，健康检查能读到 `panelGets`/`lastPanelRevision`。
