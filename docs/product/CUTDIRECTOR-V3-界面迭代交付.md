# CUTDIRECTOR V3 界面迭代交付
日期：2026-11-08。已安装到当前 DSH Desktop 的 desktop profile，版本 **0.3.0-preview.4**。

## 现在怎么用
打开 DSH 侧栏的 CUTDIRECTOR。首页先记想法，或点“我有视频，开始制作”；进入“作品”可继续已有项目、新建作品。
灵感墙可切换信息流、搜索筛选、拖动空白处、缩放。点开真实灵感，左侧与导演聊，右侧查看想法、附件来源与项目用途。
作品页左边讨论，右边看主题和镜头。需要修改时展开“调整这一镜”；模型、方法与本次发送资料可在对话区展开。费用和工程写入仍需原有确认。
设置分为对话模型、图片视频、剪映、制作方法、扩展工具、关于与旧工程。手机宽度也可在设置页切换外观。

## 已完成的设计与实现
使用用户指定的 design-taste-frontend 和 impeccable 技能，研究自媒体工作台源码和实际截图。参考固定提交 fc237f3388d048f51c3145cfd411dbb80ba2b388。
重做导航、工作台、灵感、灵感详情、作品列表、项目工作区、对话、任务与设置；其余制作页共用新的控件、布局、颜色和动效。
页面转场、导航指示块、卡片布局、阻尼画布、助手、内容切换和弹窗退出使用统一节奏；支持明暗外观与降低动态效果。
保留所有既有素材、对话、工具入口、版本校验、费用及外发确认。未导入上游演示作品、素材或标识；MIT 许可随插件保留。
当前 V3 数据没有灵感和作品，所以实际首页显示空状态；旧工程保留在“作品 → 找回以前的剪辑工程”。没有为展示效果填充假作品。

## 验证边界
- 12项隔离浏览器交互检查通过：实际 Host 鉴权、灵感墙/信息流/筛选/缩放、灵感会话和新对话、原始记录、资料页签、新建作品、镜头与未保存输入、全部制作入口、设置、任务/旧工程、助手、响应式和减少动画。
- 320、390、768、1024、1440宽度无文档横向溢出；无浏览器脚本异常。
- 2项收尾修正另验通过：助手收起重开保留未发送输入；320/390宽度可从设置切换明暗外观。独立收尾审查对这两项给出 ship。
- test/v3-desktop-origin.test.cjs 通过。
- 实际 DSH Desktop 已加载新版：新页面和两份新增脚本正常、样式正常、无 OPEN_FROM_DSH、无横向溢出。截图在下方链接。
- **没有运行新一轮全量回归，没有调用任何付费模型。**
- **GATE: FAIL 27 (round 1 of 3)**：design-taste-frontend 的静态营销站点门禁脱离 DSH Host 后，不能加载服务别名与认证 API，并要求营销 hero、.wrap 和整屏章节。它不是本次交互验收的通过项；未修改技能脚本、放松鉴权或伪造通过。
- Impeccable 的 context 引擎下载未完成，按其回退规则直接读取源码与项目文档；没有宣称引擎成功。设计记录和规范已生成。
- Codex 图片生成仍因原 MXC 环境故障停用；按用户要求，没有执行系统修复。

## 设计与截图
- [设计规范](E:/Deepseek-product/Agent/Video-agent/DESIGN.md)
- [机器可读设计记录](E:/Deepseek-product/Agent/Video-agent/.impeccable/design.json)
- [源码验收说明](E:/Deepseek-product/Agent/Video-agent/docs/v3/前端重设计验收.md)
- [实际 DSH 页面](E:/Deepseek-product/Agent/Video-agent/.impeccable/review/desktop-installed.png)
- [带隔离测试灵感的工作台](E:/Deepseek-product/Agent/Video-agent/.impeccable/review/desktop.png)
- [灵感对话](E:/Deepseek-product/Agent/Video-agent/.impeccable/review/idea-detail.png)
- [作品工作区](E:/Deepseek-product/Agent/Video-agent/.impeccable/review/project.png)
- [手机布局](E:/Deepseek-product/Agent/Video-agent/.impeccable/review/mobile.png)

## 安装与回退
实际源码：E:/Deepseek-product/Agent/Video-agent/src/v3/web。
当前发布：E:/Deepseek-product/Agent/Video-agent/.m3-data/release-cd-v3-personal-20261108-r7/plugin。
旧发布 r6 完整保留。安装工具已备份 desktop 配置、.v3-data 与 .m1-data。
回执：E:/Deepseek-product/Agent/Video-agent/.m3-data/v3-ui-redesign-backup-20261108-r7/install-receipt.json。
需要回退时先退出 DSH，再从源码仓库运行：
`node tools/install-v3.cjs rollback .m3-data/v3-ui-redesign-backup-20261108-r7/install-receipt.json`
回退插件不覆盖之后新增的工程数据。
