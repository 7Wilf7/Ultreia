# Supabase Schema Backlog

用于记录“现在还放在设备本地 / 前端状态里，但后续应该进 Supabase”的项目。这里只做排查和排序；真正建表时仍按项目规则先给 SQL，等 Dashboard 执行完成后再改 DAL 和前端。

## 2026-07-13 生产 Schema 审计

结论：当前功能依赖的生产表和字段已齐全，没有发现“功能已使用但生产环境尚未建表”的缺口；训练偏好不需要新表。

- AI Coach 训练偏好属于账号级配置，已保存在 `user_settings.coach_config.trainingPreferences`，并由现有账号设置读写链路同步；不需要单独建立训练偏好表。
- 普通 AI Coach 消息和手动周报的持久后台执行复用现有 `ai_jobs` 任务队列；完成结果分别落入现有 `coach_messages` 和 `coach_reports`，不需要新增后台任务表。
- 权限审查曾发现 `claim_ai_job` 与 `expire_stale_ai_jobs` 对 `PUBLIC` / `anon` / `authenticated` 开放。2026-07-13 已执行 `docs-internal/supabase-ai-jobs.sql` 中的 revoke / grant 修复，并核实只有 `service_role` 保留执行权。
- 后续功能如确实需要新表、列、约束或权限，仍必须重新执行 SQL gate，不能把本次“现有生产 Schema 齐全”当作未来改动的预授权。

## 已建表并接入

### 4. `agent_report_outbox`

状态：

- 2026-07-12 已建表并通过 7 项权限、唯一键与空表验收。
- 只由 service-role 后台 Reporter 读写；浏览器角色无权限、无 RLS policy。
- 每个用户与 Report 信号只保留一行水位和最多一个持久化 pending envelope。
- 记录源指纹、成功 content hash、固定 report ID、重试次数、下次尝试、暂停和
  短租约；不复用 `push_log`、`agent_actions`、`coach_reports` 或 `ai_jobs`。

运行时：

- `agent-report-dispatch` 只服务已配置的 Wilf 用户；配置缺失 fail closed。
- 2026-07-13 真实 canary 成功写入一个确定性 envelope，Aevum 返回
  `recorded`；outbox 以成功 receipt 推进交付水位并清空 pending bundle。
- source 不变、未达阈值、或内容已成功投递三种情况均 quiet skip。
- 只有网络错误 / 5xx 按 30 分钟、2 小时、6 小时重试同一 envelope；三次后暂停
  24 小时，并严格等待 `paused_until`。所有确定性 4xx（包括 422、429）阻断并
  保留原 report ID、payload、content hash 和 idempotency key，不盲目重试。
- 2026-07-15 Aevum B2 七类 catalog 已上线；现有唯一键让每个 `report_type +
  signal_kind` 使用独立 outbox 行、租约、频率和失败状态，无需新增表或改变 RLS。
  当前 paused B1 pending 原样保留；若未来要归档失败 envelope 或迁移 active slot，
  仍须另给 SQL、回滚和数据影响，Wilf 执行前代码不得假设相关结构已存在。

建表 SQL 已在 2026-07-12 人工评审并执行；后续任何字段或约束变化仍需重新走
SQL gate。

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
- 2026-07-13 已在生产环境刷新动作状态约束，完整支持 `proposed / accepted / executing / executed / rejected / failed / cancelled`；重复执行建表 SQL 会重建该约束，避免保留旧定义。
- 计划导入 Action Card、Memory 更新 Action Card 已开始写入 `agent_actions`。
- App 启动时会读取账号下的 `create_plans` 动作，用来恢复 AI Coach 消息下方的已提炼 / 已执行 / 已忽略状态。
- Calendar / Memory 数据与 action log 采用一致性门槛：两边都成功后才显示已保存。Calendar 计划带动作标记，日志保存失败后可只修复日志，避免重试时重复创建计划。

现状：

- 第一版仍保留本地 `planImportCache` 做离线/即时缓存，云端 `agent_actions` 是跨设备恢复和审计来源。
- 周报提炼计划复用 `create_plans`，来源通过 `source_ref_type/source_ref_id` 区分。
- Calendar 建议的日期后执行观察复用现有 `result` JSON 的 `outcome` 子对象，不需要新增列；写入时保留原执行审计字段。

当前字段、边界和后续接入顺序见 `docs-internal/agentization-roadmap.md`。

建表 SQL：

- `docs-internal/supabase-agent-actions.sql`

后续动作：

- 最近教练建议已经提供轻量审计入口；继续保持面向用户的可读摘要，不扩成内部矩阵或调试页。
- 如要追踪停止/扣费/服务端完成状态，把任务结果写入 `result` / `error`。
- 未来自动执行需要记录 `auto` / `guarded` / `requires_user`、policy 版本、
  风险级别、执行基线、幂等键、冲突原因和撤销/补偿信息。Aevum Phase A
  已给出 canonical contract 和存储 baseline；Ultreia 接入前仍需逐项映射
  本地 `agent_actions` 字段并评审必要的 schema 变化，不得单独发明一套
  不兼容的全局动作协议。

## 已建表并接入

### 3. `coach_memory_facts`

现状：

- 长期记忆已切到 `coach_memory_facts` 事实卡片，AI Coach / 周报只读取 active facts。
- 旧 `coach_memory` / `coach_memory_zh` 字段仅作为历史兼容字段保留；Wilf 迁移完成后可用一次性 SQL 清空个人账号旧文本。
- 自动更新通过 Action Card 审核后启用事实，具备主题、来源、归档和恢复能力。
- `coach_memory_facts` 是 Ultreia 训练域长期记忆，不是 Aevum 的全局短期/
  长期记忆库。向 Aevum 上报时只发送隐私裁剪后的 Report 和来源引用，
  不复制整张事实表。

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
