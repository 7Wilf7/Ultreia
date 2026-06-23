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

- `daily-coach-dispatch` 自动周报写入 `coach_reports`，再发系统通知 / 收件箱提醒。

## 已建表并接入

### 2. `agent_actions`

状态：

- 2026-06-23 已建表。
- 计划导入 Action Card、Memory 更新 Action Card 已开始写入 `agent_actions`。
- App 启动时会读取账号下的 `create_plans` 动作，用来恢复 AI Coach 消息下方的已提炼 / 已执行 / 已忽略状态。
- 写入 action log 是 best-effort；如果日志保存失败，不阻止计划导入或 Memory 保存。

现状：

- 第一版仍保留本地 `planImportCache` 做离线/即时缓存，云端 `agent_actions` 是跨设备恢复和审计来源。
- 周报提炼计划复用 `create_plans`，来源通过 `source_ref_type/source_ref_id` 区分。

建议字段见 `docs-internal/agentization-roadmap.md` Phase 3。

建表 SQL：

- `docs-internal/supabase-agent-actions.sql`

后续动作：

- 后续如需要更完整的审计页，再增加 action log 可视化入口。
- 如要追踪停止/扣费/服务端完成状态，把任务结果写入 `result` / `error`。

## 中期应建表

### 1. `coach_memory_facts`

现状：

- 长期记忆仍是一段分区文本，存在 profile/settings 字段里。
- 自动更新是覆盖式，缺少事实级时间戳、主题、来源和撤销能力。

建议方向：

- 一条事实一行，字段包括 category、body_en、body_zh、source、confidence、created_at、archived_at。
- prompt 按场景选择相关事实，而不是整段塞入。

### 2. `coach_report_notes` 或 `coach_annotations`

现状：

- 周报下方可以把回答和周报一起转发到 AI Coach，但没有保存“这段周报上的用户注解”。

基于 `coach_reports` 继续做：

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
