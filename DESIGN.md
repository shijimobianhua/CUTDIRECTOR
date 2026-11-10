---
name: CUTDIRECTOR 创作工作台
description: 有序灵感库、创作首页与对话稿面共用的 DSH 视频制作界面
colors:
  ink: "#20252b"
  page: "#fafbfc"
  surface: "#ffffff"
  surface-soft: "#f2f4f6"
  muted: "#626c78"
  line: "#e2e6eb"
  blue: "#3669a8"
  success: "#277b61"
  danger: "#b6413c"
  dark-page: "#171b21"
  dark-surface: "#20252c"
  dark-ink: "#eef1f5"
typography:
  headline:
    fontFamily: "Segoe UI, Microsoft YaHei UI, Microsoft YaHei, system-ui, sans-serif"
    fontSize: "28px"
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: "-0.025em"
  title:
    fontSize: "18px"
    fontWeight: 600
    lineHeight: 1.5
  body:
    fontSize: "14px"
    lineHeight: 1.65
  label:
    fontSize: "13px"
    lineHeight: 1.65
rounded:
  sm: "8px"
  md: "12px"
  lg: "16px"
  panel: "24px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  base: "16px"
  lg: "24px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.surface}"
    rounded: "{rounded.md}"
    padding: "8px 14px"
    height: "40px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "8px 14px"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.lg}"
    padding: "20px"
  field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "10px 12px"
---
# Design System: CUTDIRECTOR
## Overview
以用户指定的自媒体工作台为界面参考，按后续反馈改为整齐的灵感库、独立制作首页，以及左侧对话与右侧稿面。剧本扩展使用同一套表面、字级和控件：场景目录、剧本稿面、相关分镜并列；关系画布只在作品内显式打开。普通助手独立于灵感；服务预设先于 DIY 参数。动画连接操作前后，不改变授权和数据含义。
**Creative North Star: "有序灵感与对话制作"**
**Key Characteristics:**
- 内容为主，墨色按钮标明下一步。
- 对话和作品分区，详细编辑按需展开。
- 页面、面板、卡片与弹窗使用连续的动效语言。
## Colors
近白工作面与墨色文字，蓝色用于链接和焦点，绿色用于连接状态。明暗外观遵从系统或用户切换，外观设置仅保存主题，不保存账号。
颜色的实现来源为 src/v3/web/workbench.css 的根变量；深色以 data-theme 或系统媒体查询覆盖。
## Typography
中文标题、操作和正文统一使用系统无衬线。页面标题28px，手机24px；灵感卡正文16px；聊天正文14px，长回复使用1.8行高。
11–12px元信息仅用于日期、模型提示和资料说明；主要操作与正文不得继续缩小。
## Layout
DSH 内嵌页面，不再提供独立产品入口。76px 顶栏，窄屏68px；内容左右40px、较窄24px、手机16px。
灵感库只用整齐的响应式 CSS Grid，搜索和筛选处于文档流；600px以下单列。删除无限画布、缩放和固定底栏。工作台独立提供新建、继续制作、待办和准备状态。作品制作页是320px对话栏与可伸展稿面，超宽时对话栏360px；760px以下切换成果和对话。
灵感详情为330px对话栏与资料区域；设置为190px分类导航与内容区域。镜头详情以弹窗查看，避免长期挤占稿面。
## Elevation & Depth
制作稿面用细边线划分；浮动导航使用轻阴影，弹窗与临时助手使用更高层级。两者各有明确职责，禁止无目的叠加描边和大阴影。
- 通用阴影：0 12px 40px rgb(28 39 54 / .10)。
- 面板阴影：0 24px 80px rgb(28 39 54 / .16)。
## Shapes
8px表单、12px按钮、16px内容卡、24px大面板。发送按钮与添加灵感按钮为圆形，带可读的无障碍名称。
## Components
导航选中块随当前页面移动；按钮提供悬停、按下、禁用、焦点反馈。灵感库展示真实记录，不填充示例到用户数据。鼠标点击输入框不显示厚描边，Tab 导航保留焦点提示。保存成功的通知约2.8秒后消失，错误提示可手动关闭。
对话区固定输入位置，模型状态可直接点开设置；模型、制作方法和资料授权展开后可选。消息区保留阅读位置，收到回复后仍可查看之前内容。
镜头卡先展示画面描述和已选图片，进入“调整这一镜”再编辑。保存、外发、费用、写入仍走既有接口。
动效：150ms反馈、280ms位置变化、360ms内容进入、420ms面板及页面衔接、520ms卡片重排；曲线 cubic-bezier(.22,1,.36,1)。取消无限画布；快速切换会取消旧过渡，卡片不从不可见的零坐标飞入。降低动态效果时直接呈现完成态。
## Do's and Don'ts
### Do:
- Do 保持清楚的下一步，先概览再编辑。
- Do 保留原始记录、对话历史、版本校验和授权说明。
- Do 在用户点开工具、切换面板与返回时提供一致反馈。
### Don't:
- Don't 用假作品、假进度或假模型回复装饰页面。
- Don't 为静态网页检查开放 DSH 专属页面或放宽鉴权。
- Don't 把全部制作参数重新堆到默认页面。
