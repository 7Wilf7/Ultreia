# Supabase Schema Backlog

用于记录“现在还放在设备本地 / 前端状态里，但后续应该进 Supabase”的项目。这里只做排查和排序；真正建表时仍按项目规则先给 SQL，等 Dashboard 执行完成后再改 DAL 和前端。

## 应该尽快建表

### 1. `coach_reports`

现状：

- AI 周复盘只保存在设备 localStorage。
- 本周 / 上周各保留最新一份，换设备不可见。
- 自动每周生成不适合继续做，因为生成结果没有稳定云端落点。

建议字段：

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

- 新增 `src/lib/db/coachReports.js`。
- 周报页从 Supabase 读取并 upsert 最新报告。
- `daily-coach-dispatch` 自动周报写入 `coach_reports`，再发系统通知 / 收件箱提醒。

### 2. `agent_actions`

现状：

- AI Coach 的计划导入 Action Card 状态保存在前端 state / localStorage。
- 换设备看不到某条建议动作是否已执行 / 已忽略。
- 后台任务或跨页面任务变多后，缺少统一审计记录。

建议字段见 `docs-internal/agentization-roadmap.md` Phase 3。

后续动作：

- 保存计划导入、Memory 更新、周报导入等动作的 `proposed / executed / rejected / failed` 状态。
- AI Coach 消息下的 Action Card 从云端状态恢复。

## 中期应建表

### 3. `coach_memory_facts`

现状：

- 长期记忆仍是一段分区文本，存在 profile/settings 字段里。
- 自动更新是覆盖式，缺少事实级时间戳、主题、来源和撤销能力。

建议方向：

- 一条事实一行，字段包括 category、body_en、body_zh、source、confidence、created_at、archived_at。
- prompt 按场景选择相关事实，而不是整段塞入。

### 4. `coach_report_notes` 或 `coach_annotations`

现状：

- 周报下方可以把回答和周报一起转发到 AI Coach，但没有保存“这段周报上的用户注解”。

适合等 `coach_reports` 建好后再做：

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

