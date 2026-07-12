# Design

## System

Ultreia 是 Aevum 家族里最成熟的移动产品实现。它的设计语言可以被 Aevum、Viatica、Sidera 参考，但参考范围是移动端结构、设置页纪律、开屏节奏、更新检查和克制的暗色产品 UI，不包括训练业务逻辑。

核心视觉是深色 graphite 底、半透明面板、精细 hairline、低饱和 moss / olive 训练强调色、轻微 cyan-green 能量痕迹、短状态动效和数据优先的移动布局。

## Family Roles

- **Aevum**：中性的银白系统层。
- **Ultreia**：深 moss / olive 的训练层，运动、成熟、数据优先。
- **Viatica**：graphite + muted ledger brass 的记账层。
- **Sidera**：cold star-blue / muted violet `#8C94C8` 的知识层。

家族统一来自结构、密度、节制和交互纪律，不来自复制同一个颜色或同一个业务模型。

## Colors

- Background：接近黑色的 graphite。
- Panel：低透明暗色面板，边界清晰但不厚重。
- Ink：高对比白灰文字。
- Muted ink：用于说明、meta、次级标签。
- Line：细而克制的 graphite / moss 边线。
- Accent：深 moss / olive，只用于主动作、选中态、训练状态重点、logo 和少量能量痕迹。
- Avoid：亮健身绿、浅米色纸感壳、整屏绿色主题、无意义紫蓝渐变。

## Typography

- 字体优先使用系统 sans-serif / Inter 风格。
- 移动端阅读优先，不使用随 viewport 缩放的字体。
- 训练数字、图表标签、日期和卡片标题要紧凑清楚。
- 分享海报可以有独立排版，但 app shell 仍保持产品工具感。

## Layout

- 移动端优先，桌面端只是给训练信息更多空间。
- 底部导航、设置页、指南/更新日志、账号入口和检查更新都保持稳定结构。
- 训练首页、日历、赛事、AI Coach、天气和设置应保持清楚的主次，不用营销 hero。
- 高风险或长期影响的 AI 动作以 Action Card 呈现，默认需要确认。

## Components

- 训练记录行优先显示类型、时间、距离/时长、强度和备注。
- 图表以解释训练趋势为目标，不堆装饰性指标。
- AI Coach 输出必须能解释依据：训练数据、天气、目标赛事或已审核 Aevum 记忆。
- Settings 使用紧凑列表结构；长内容进入二级页面。
- 更新检查沿用 Android / PWA 分支：APK 读 GitHub Release，Web/PWA 处理缓存刷新。

## Motion

使用 150-220ms 的短动效表达 hover、focus、保存、展开、选中和卡片确认。训练判断不能依赖动画。尊重 `prefers-reduced-motion`。

开屏从第 0 帧直接显示 `resources/brand/ultreia-original.png`，不对 Logo
做描线、组装、遮罩、缩放、模糊、闪光或淡入。Logo 统一使用
`min(33vmin, 158px)` 正方形舞台，Ultreia 艺术字统一使用
`min(12.5vmin, 52px)`、字重 400、行高 1。艺术字在 1200ms 内按
“开头快—中间慢—结尾快”从左到右显现，核心开屏时钟为 1800ms；加载
更久时只保持完成态，不重播动画。

## Anti-patterns

避免儿童化运动插画、模板化 SaaS 卡片、无数据意义的装饰渐变、亮绿色健身 app 气质、过度营销化首页、以及让 AI Coach 看起来像黑箱自动改计划的交互。
