# Training Studio 训练工作室

一个面向耐力跑者的个人训练工作台 —— 备赛、日常打卡、AI 教练，集成在同一个单页应用里。

## 是什么

基于 React 19 + Vite 的单页应用，数据存在 Supabase。每位用户的数据互相隔离（邮箱魔法链接登录），所有记录（训练、赛事、教练对话、个人资料）都通过 RLS 按 `auth.uid()` 自动过滤。

## 能做什么

- **记录训练** —— 手动录入或批量导入 Garmin CSV。支持 Road Run / Trail Run / Hiking / Floor Climbing / Strength / HIIT 六类。
- **自动分类路跑强度** —— 按平均心率把路跑分成 Easy / Aerobic / Tempo / Interval。
- **管理赛事** —— 目标赛事带 A/B/C 优先级，历史赛事记录成绩，顶部 PR bar 按类别自动聚合最佳成绩（每类一条）。
- **可视化趋势** —— 周/月/年跑步距离曲线、路跑强度分布、心率区间时长分布。
- **跟 AI 教练对话** —— 教练能看到你的资料、近期训练、目标赛事和长期记忆，给的建议是个性化的；还能把建议一键导入到 Calendar。
- **日历视图** —— 月历模式同时显示已完成训练和计划训练（计划项是虚线框，没标记完成前不计入统计）。

## 应用结构

四个顶层 tab：

1. **Training** —— 训练记录列表 + 图表子视图。
2. **Calendar** —— 月历，点某一天编辑或加计划。
3. **Races** —— 目标赛事、历史赛事、PR bar。
4. **AI Coach** —— 对话、记忆、Prompt 预览。

## 技术栈

- Vite 8 + React 19（JSX，不用 TypeScript）
- Supabase 负责认证 + 数据（表：`profiles`、`user_settings`、`workouts`、`races`、`coach_messages`、`daily_notes`）
- AI 教练用 DeepSeek 的 Anthropic 兼容接口
- ESLint 10，暂无测试框架

## 从哪开始看

- 新用户：先看 [训练记录](training-log.md) 理解 activity 类型。
- 想批量导 Garmin 数据：看 [数据导入](data-import.md)。
- 想配 AI 教练：看 [AI 教练](ai-coach.md)。
