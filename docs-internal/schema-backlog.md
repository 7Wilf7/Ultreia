# Supabase Schema Backlog

用于记录“现在还放在设备本地 / 前端状态里，但后续应该进 Supabase”的项目。这里只做排查和排序；真正建表时仍按项目规则先给 SQL，等 Dashboard 执行完成后再改 DAL 和前端。

## 已建表并接入

### 1. `coach_reports`

状态：

- 2026-06-21 已建表。
- AI 周复盘从账号读取，并在生成后写入 `coach_reports`。
- 本周 / 上周 tab 各自显示最新一份账号内报告。
- 旧设备 localStorage 周报会按用户 id 迁移一次到 `coach_reports`。

字段：

- `id uuid primary key`
- `user_id uuid not null`
- `period_start date not null`
- `period_end date not null`
- `next_start date`
- `next_end date`
- `range_mode text`
- `source text not null`：`manual` / `auto`
- `status text not null`：`running` / `ready` / `failed`
- `title text`
- `body markdown/text`
- `error text`
- `wallet_charge_cents integer`
- `model text`
- `created_at timestamptz`
- `updated_at timestamptz`
- `read_at timestamptz`

后续动作：

- `daily-coach-dispatch` 自动周报已接入 `coach_reports`，并在保存完整报告后发送短系统通知 / 收件箱提醒。
- 在 Supabase Dashboard 执行 `docs-internal/supabase-weekly-report-cron.sql` 后，正式启用每 30 分钟的服务端调度检查；当前生产环境已由 Wilf 执行过一次，如更换 `CRON_SECRET` 或重建项目再重跑。

## 已建表并接入

### 2. `agent_actions`

状态：

- 2026-06-23 已建表。
- 计划导入 Action Card、Memory 更新 Action Card 已开始写入 `agent_actions`。
- App 启动时会读取账号下的 `create_plans` 动作，用来恢复 AI Coach 消息下方的已提炼 / 已执行 / 已忽略状态。
- Calendar / Memory 数据与 action log 采用一致性门槛：两边都成功后才显示已保存。Calendar 计划带动作标记，日志保存失败后可只修复日志，避免重试时重复创建计划。

现状：

- 第一版仍保留本地 `planImportCache` 做离线/即时缓存，云端 `agent_actions` 是跨设备恢复和审计来源。
- 周报提炼计划复用 `create_plans`，来源通过 `source_ref_type/source_ref_id` 区分。

建议字段见 `docs-internal/agentization-roadmap.md` Phase 3。

建表 SQL：

- `docs-internal/supabase-agent-actions.sql`

后续动作：

- 最近教练建议已经提供轻量审计入口；继续保持面向用户的可读摘要，不扩成内部矩阵或调试页。
- 如要追踪停止/扣费/服务端完成状态，把任务结果写入 `result` / `error`。

## 已建表并接入

### 3. `coach_memory_facts`

现状：

- 长期记忆已切到 `coach_memory_facts` 事实卡片，AI Coach / 周报只读取 active facts。
- 旧 `coach_memory` / `coach_memory_zh` 字段仅作为历史兼容字段保留；Wilf 迁移完成后可用一次性 SQL 清空个人账号旧文本。
- 自动更新通过 Action Card 审核后启用事实，具备主题、来源、归档和恢复能力。

建议方向：

- 一条事实一行，字段包括 `category`、`content_en`、`content_zh`、`source`、`source_ref_type`、`source_ref_id`、`confidence`、`status`、`created_at`、`accepted_at`、`archived_at`。
- 第一版状态为 `proposed` / `active` / `rejected` / `archived`。
- 用于 Memory 面板查看、审核和归档；active facts 已作为长期记忆进入 prompt。

建表 SQL：

- `docs-internal/supabase-coach-memory-facts.sql`

## 暂不推进 / 已下调

### 1. `coach_report_notes` 或 `coach_annotations`

现状：

- 2026-06-26 已下调：周报正文选区注解入口移除，不再按当前方案建表。
- 周报下方保留简单追问输入，可以把问题和当前报告一起转发到 AI Coach，但不会保存“这段周报上的用户注解”。

如果未来重新证明有价值，再基于 `coach_reports` 评估：

- `report_id`
- `selected_text`
- `note`
- `created_at`
- 可作为下次周报或 AI Coach 的上下文。

## 可以继续本地缓存

- 天气实时 / 预报缓存：设备级性能缓存，已有训练天气快照会写入 `workouts.weather`。
- 图表时间范围、首次引导、提示是否看过、更新检查缓存、推送 debug log。
- 登录页记住账号密码：明确是当前设备便利功能，不应同步。
- 开屏问候最近使用队列：只是避免同设备重复文案，不需要跨设备。
