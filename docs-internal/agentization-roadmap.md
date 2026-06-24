# Ultreia Agent 化推进 Roadmap

> 内部 living document。这里是推进 agent 化的当前计划和状态，实施过程中如果发现某项不必要、不准确或风险过高，直接修改或删除，不保留过期设想。背景分析见 `docs-internal/agentization-analysis.md`。

## 当前定位

Ultreia 当前状态已经从 **AI Coach Copilot** 进入 **早期可确认 AI Coach Agent**：

- 已有能力：训练上下文注入、AI Coach 对话、计划解析、Memory facts 审核、周复盘、服务端定时任务、Agent Action Log，以及多个需要用户确认的 Action Card。
- 主要短板：持续任务对象和统一工具层还不完整；主动循环仍以低风险、可确认动作优先，尚未进入自动执行阶段。

中期目标是推进到 **可确认动作的 AI Coach Agent**：

```text
观察训练状态 → 发现问题 → 提出动作 → 用户确认 / 修改 / 拒绝 → 执行 → 记录结果 → 下次复盘继续纠偏
```

## 不变原则

- 训练计划、健康风险、天气调整等动作默认必须用户确认。
- 不做黑箱自动改计划，不让 AI 在用户不知情时改日历、删计划或增加训练量。
- 先做可解释、可确认、可撤销的动作，再考虑更高自动化。
- 每个 agent 能力都要能说清楚：为什么建议、准备改什么、影响哪些数据、是否需要确认。
- 用户可见行为变化同步更新 `docs/` 和 `docs/changelog.md`；内部规划只更新 `docs-internal/`。

## 阶段状态

| 阶段 | 状态 | 目标 | 当前判断 |
|---|---|---|---|
| Phase 0 | 已完成 | 明确 agent 化方向和差距 | 已有 `agentization-analysis.md` |
| Phase 1 | 已完成 | Action Card 雏形 | 日历计划、单条未来计划修改和 Memory 更新已接入前端 Action Card |
| Phase 2 | 已完成（服务端 cron 待启用） | AI 周复盘 Page | 全屏周报页、账号保存、文本注解和停止控制已落地；服务端会按用户本地星期 / 时间生成并写入 `coach_reports`，待执行 cron SQL 正式启用 |
| Phase 3 | 已完成（观察中） | Agent Action Log | `agent_actions` 已建表；动作记录会恢复状态、即时刷新、记录执行结果、反哺 AI Coach / 周复盘上下文，并已有轻量 Recent Agent Actions 可视化入口；展开详情已改为用户可读摘要 |
| Phase 4 | 进行中 | Memory Facts 结构化 | 事实表已接入；Memory 面板改为 facts-only；AI Coach / 周报只读取 active facts；旧分区 Memory 已退出 prompt，清理 SQL 已准备；夜间记忆审核第一版已接入 |
| Phase 5 | 暂不推进 | 自动同步外部训练数据 | Strava API 因 AI 使用政策和数据完整性问题，不作为短期路线 |
| Phase 6 | 进行中 | 内部闭环 Action Cards | 计划偏差补救 Action Card 第一版已落地；下一梯队是恢复风险、天气调整、数据质量补全和赛前简报 |

## Phase 1：Action Card 雏形

目标：把 AI Coach 的建议从纯文本升级成“可确认动作”。

第一版只支持低到中风险动作：

- 创建未来训练计划。
- 修改未来训练计划。
- 更新 Memory。

建议实现：

1. 定义统一 action 数据结构：

```json
{
  "type": "create_plans",
  "title": "安排下周训练",
  "reason": "本周负荷偏低，距离目标赛还有 8 周，可以温和增加跑量。",
  "payload": {},
  "risk": "medium",
  "requiresConfirmation": true
}
```

2. 复用现有 AI 导入日历能力，但把 UI 从“Import to Calendar modal”逐步泛化为“Action Card review”。
3. AI 只提出结构化动作；应用负责校验、展示、执行。
4. 第一版先存在前端 state，不急着建新表。

完成标准：

- AI 回复后可以出现 Action Card。
- 用户能确认 / 修改 / 拒绝。
- 确认后能写入日历或 Memory。
- 已有未来计划可在能定位到目标计划时被单条替换，不再只能按日期整天覆盖。
- 执行失败时有明确错误。
- `npm run test` / `npm run lint` / `npm run build` 通过。

暂缓内容：

- 自动执行。
- 后台定时触发 Action Card。
- 新 Supabase 表。

## Phase 2：AI 周复盘 Page

目标：建立第一个稳定 agent loop。

建议形态：

- 每周或手动读取本周 / 上周训练、计划依从、训练负荷、下周计划。
- 生成一份完整周报页面，而不是短消息。
- 周报逐条点评每次训练，并给出接下来 7 天计划。
- 用户可从周报下方把计划提炼成 Action Card，审核后导入日历。

完成标准：

- 用户不需要在聊天里主动提问，也能从 Settings 进入并生成复盘。
- 能指出本周最重要的问题，而不是泛泛总结。
- 能详细点评每次训练，并提出下周计划调整建议。
- 计划调整仍需用户确认。

第一版决策：

- 先做 Settings 里的 AI 周复盘入口，支持本周 / 上周手动生成。
- 周报页使用完整页面，不再用弹窗；生成状态提升到 App 层，用户离开页面或切 App 后仍继续跑，完成后发本地系统通知。
- 周报写入 `coach_reports`，本周 / 上周两个 tab 各自显示账号内最新报告；旧设备 localStorage 周报会迁移一次。
- 周报下方先复用现有计划提炼 Action Card；多段文本注解第一版先作为本地确认动作，用户选中文本并写注解后一次性发给 Coach，不入库、不自动改数据。
- `daily-coach-dispatch` 的 `weekly_recap` 已升级为正式服务端周报任务：读取用户本地星期 / 时间、Current Memory facts 和 Recent Agent Actions，完整正文写入 `coach_reports`，通知 / inbox 只放短提示。
- 自动每周生成使用现有用户级开关、触发星期、触发时间和时区；前端不再自己到点执行，避免 App 与服务器重复生成。
- 2026-06-22 起，周报页改成选中文本附近浮出“加注解”动作，底部输入栏固定；AI Coach 聊天、周报分析、计划提炼都有前端停止入口。普通 AI Coach 回复注解入口因日常价值不高已移除，聊天保持直接输入发送。APK 非流式请求停止后只能立即结束等待并忽略旧结果，不能保证服务端调用已经取消。
- 低风险触发已落地：固定每周时间 / 开关由服务端 cron 执行；周日导入提示收敛为补漏，在已有周报早于新导入活动、或预定时间已过但报告仍缺失时提供手动分析兜底。

## Phase 3：Agent Action Log

目标：让 agent 行为可追溯。

触发条件：Phase 1 里 Action Card 确认有用，并且开始出现跨页面、后台或异步执行需求。

建议 Supabase 表：

```sql
-- Full SQL lives in docs-internal/supabase-agent-actions.sql
public.agent_actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id text not null,
  type text not null,
  status text not null,
  title text,
  reason text,
  risk text not null,
  requires_confirmation boolean not null,
  source text not null,
  source_ref_type text,
  source_ref_id text,
  payload jsonb not null,
  result jsonb not null,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  decided_at timestamptz,
  executed_at timestamptz
)
```

状态流：

```text
proposed -> accepted -> executed
proposed -> rejected
accepted -> failed
proposed -> cancelled
```

注意：这一步需要 Supabase schema 变更，必须先给用户 SQL，用户在 Dashboard 跑完后再改前端和 DAL。

第一版接入：

- `src/lib/db/agentActions.js` 负责读写 `agent_actions`。
- App 启动读取账号下的 `create_plans` 动作，恢复 AI Coach 消息下方的已提炼 / 已执行 / 已忽略状态。
- 计划提炼成功时写入 `proposed`；确认导入后写入 `executed`；忽略后写入 `rejected`。
- Memory 自动更新建议同样写入 `proposed`，接受 / 放弃后写入 `executed` / `rejected`。
- action log 写入是 best-effort，不阻止计划导入或 Memory 保存。

第二步接入：

- 用户点击计划导入 Action Card 的「接受并执行」后，先把动作标记为 `accepted`。
- `bulkAddLogs` 后台保存成功后，再把动作标记为 `executed`，并在 `result` 里记录创建的 workout id、创建数量和计划休息日期。
- 保存失败时把动作标记为 `failed`，并把错误信息写入 `error`，方便后续排查或重新提炼。
- Memory 更新接受后会在 `result` 里记录保存了哪些语言版本和字符数。

第三步接入：

- AI Coach 普通对话和 AI 周复盘会读取最近几条 `agent_actions`。
- Prompt 里只放轻量摘要：动作类型、状态、涉及日期、创建数量、计划休息日期、Memory 保存语言和错误摘要。
- 目的不是让 AI 自动执行，而是让 Coach 把用户的接受 / 忽略 / 失败当作反馈，避免反复提出不被采纳的方向。

第四步接入：

- AI Coach 设置里新增轻量 `Recent Agent Actions`。
- 最近 10 条动作只读展示：动作类型、状态、来源、涉及日期 / 数量、失败原因。
- 点击单条可展开查看可读动作摘要和执行结果；修改已有计划时显示 before / after 摘要，不再直接展示内部 JSON。
- 展开详情要按用户理解组织，而不是按 payload 原始字段组织：计划修改按日期聚合展示「原计划 / 新计划」，隐藏内部计划 id，执行结果用短摘要标签显示。
- action log 写库仍是 best-effort，但前端会先合并到当前列表，保证 PWA 不需要刷新就能看到最新提议 / 接受 / 执行 / 忽略状态。
- 用户可在 Recent Agent Actions 长按删除某条 action log，用于清理测试 Action Card；删除只清理 action 记录和消息按钮状态，不回滚已经执行的数据变更。
- 用户可从展开的 action log 直接带着动作摘要和执行结果追问 Coach，让 Coach 复盘这次动作是否合理、下一步继续还是调整；这只创建普通聊天消息，不自动执行新动作。
- 这一步只解决可审计性，不扩展新的 Action Card 类型。

第五步接入：

- 计划提炼时把当前未来计划的 `plan_id` 提供给结构化提炼器。
- 当 Coach 明确是在修改已有计划时，Action Card item 使用 `action="update"` + `targetPlanId`。
- 执行时只删除并替换该 planned row，不按日期清掉同一天其它计划；新增计划和明确休息日仍按日期替换。
- 这一步让“修改未来计划”从纯文本建议进入可确认动作链路，但仍保持用户审核后执行。

## Phase 4：Memory Facts 结构化

目标：让长期记忆从“分区文本”升级为“事实系统”。

当前状态：

- `coach_memory_facts` 已成为当前长期记忆主线；`status=active` 的事实进入 AI Coach / 周报 prompt，`archived` 不进入。
- 旧分区文本字段 `coach_memory` / `coach_memory_zh` 已退出 UI 和 prompt，仅作为历史兼容字段保留；Wilf 迁移完成后可用一次性 SQL 清空个人账号旧文本。
- 自动更新会基于当前 active facts + 最近对话生成英文 + 中文事实建议，并以 `memory_update` Action Card 审核后启用。
- `agent_actions` 只是 Memory 更新的审计日志，不是事实记忆的数据源；跨设备可见的长期记忆以 `coach_memory_facts` 为准。接受 Memory 更新时必须先确认 facts 写库成功，再把 `memory_update` 标记为 `executed`。
- 英文事实用于模型上下文，中文用于审核和阅读。
- Phase 3 的 `agent_actions` 已能记录 Memory 更新的提议、接受 / 忽略和结果，因此 Phase 4 可以接着做事实级记录。

推进判断：

- 不做黑箱迁移；旧文本是否清空由用户确认后通过一次性 SQL 执行。
- 事实系统已经从旁路升级为 prompt 主记忆：AI 从对话 / 周报 / Action Log 提炼“单条事实”，用户审核后保存、归档或忽略。
- 保存的 active fact 会作为 `[Memory Facts]` 进入 Coach / 周报上下文；旧 `[Long-term Memory]` 文本块不再发送。

第一版范围（Phase 4.1）：

1. 新建 `coach_memory_facts` 表，字段支持分类、英文 / 中文正文、来源、状态、置信类型和归档。
2. 新增 DAL：读取最近 active facts、创建 proposed fact、标记 accepted / archived / rejected。
3. Memory 自动更新时，基于当前 active facts 和最近对话提炼候选 facts，作为 Action Card 审核。
4. Memory 面板先增加一个轻量 facts 区域：支持 Current / Archived 筛选、归档确认和恢复，不做复杂搜索。
5. Prompt 侧已切到 facts-only：只插入 active facts，不再插入旧分区文本 Memory。

建议字段：

```text
category
content_en
content_zh
source
source_ref_type
source_ref_id
confidence
status
created_at
updated_at
accepted_at
last_used_at
archived_at
```

完成标准：

- 能从一次对话或周报中提炼出 1-3 条候选长期事实。
- 用户能逐条接受 / 忽略；接受后成为 active fact。
- 用户能归档已接受事实，归档后不再进入后续 prompt。
- 每条 fact 能看到来源类型和来源摘要。
- 旧的分区 Memory 不再进入 prompt；清空前不破坏原字段，清空后只保留事实卡片。
- `npm run test` / `npm run lint` / `npm run build` 通过。

暂缓内容：

- 不自动迁移旧 `coach_memory` 文本；用户确认迁移完成后，用一次性 SQL 清空个人账号旧字段。
- 不做复杂事实搜索 / 标签管理。
- 不让 AI 自动删除或覆盖事实。

## Phase 5：外部训练数据自动同步

目标：减少手动上传，让 agent 的感知更及时。

当前结论：

- 短期不做 Strava API 自动同步，也不把它作为 Agent 化主线。
- 原因不是“接不了”：Garmin / COROS 同步到 Strava、Strava Webhook / API 拉活动在技术上都成立。
- 真正 blocker 是两点：
  1. Strava API 政策明确限制把 API 数据用于 AI application、RAG、embedding、context window / working memory，以及未经授权的 agent / MCP 场景；这和 Ultreia AI Coach / 周报 / Memory / Action Card 的核心用法冲突。
  2. Strava 拿到的是活动摘要和部分 streams，不等于手表原始 FIT；Training Effect、RPE、完整原始记录等无法稳定获得，心率区间也只能在可拿到心率 stream 时近似重算。
- 因此，Strava 可以作为“用户个人在外部 AI 平台里授权官方 Strava MCP”的个人工作流，但不适合作为 Ultreia 后端写库后再喂给 AI Coach 的产品能力。

暂不碰：

- Strava API 自动同步（除非未来政策和可用数据范围明显变化，或仅做不进入 AI prompt 的只读展示）。
- App 内 GPS 记录。
- Garmin Health API 企业接入。
- 复杂多平台同步。

评估点：

- 是否存在更干净的第一方个人数据入口：例如设备厂商正式个人 API、用户授权导出包、或本地文件夹 / 云盘自动导入 FIT。
- 如果未来重新评估 Strava，只能先明确：同步数据是否进入 AI prompt；如果进入，必须先确认政策允许。
- 在没有干净自动同步前，继续把 FIT / ZIP 导入视为高质量数据入口；AI Agent 的下一步优先从 Ultreia 内部闭环推进，而不是外部平台同步。

## Phase 6：内部闭环 Action Cards

目标：在不引入外部自动同步、不做黑箱自动执行的前提下，把 Ultreia 已经掌握的数据继续转化成“观察 → 建议 → 用户确认 → 执行 → 记录”的局部闭环。

第一版已落地：

- **计划偏差补救 Action Card**：AI Coach 读取最近两周计划完成情况，发现漏练 / 部分完成后，在对话上方给出轻提醒；用户点击后生成调整接下来几天计划的 Action Card。
- 生成动作时会同时读取未来计划、天气、近期训练、目标赛事、Memory facts 和最近 Agent 动作反馈。
- 执行仍复用 `create_plans` Action Card：可新增计划、安排明确休息日，或在能定位到未来计划时修改单条计划。
- 状态会写入 Agent Action Log，来源标记为“计划偏差补救”，可在 Recent Agent Actions 中回看。

第一版边界：

- 不自动补跑，不把漏掉的量机械堆回未来几天。
- 不后台静默改日历，必须用户确认。
- 不把健康风险写成诊断，只给训练安排层面的解释和建议。
- 不新建 schema；复用已有 `agent_actions` 和计划导入执行链路。

下一阶段梯队：

| 梯队 | 能力 | 触发 | 动作 | 边界 |
|---|---|---|---|---|
| 1 | 计划偏差补救 | 最近 7–14 天漏练 / 部分完成 | 调整接下来 3–7 天计划 | 已落地第一版；继续观察真机效果 |
| 2 | 恢复风险 / 负荷守门 | ACWR high / danger、RPE 偏高、晨间状态差、疼痛 / 疲劳备注 | 建议恢复日、降强度或暂停叠加强度课 | 不诊断；所有改计划都确认后执行 |
| 3 | 天气驱动计划调整 | 未来 7 天强度 / 长距离遇到高温高湿、强风、污染或大雨 | 建议换日期 / 时段，或降低目标 | 只调整未来计划；不影响已完成训练 |
| 4 | 数据质量补全助手 | 缺 RPE、缺备注、导入类型不准、天气可补未补 | 先做 checklist；后续可扩成低风险 Action Card | 写库前确认；不为了补全制造复杂流程 |
| 5 | 赛前简报 / 装备检查 | A 级目标赛进入 14 天窗口，地点 / 天气可用 | 生成 briefing 和 checklist；必要时再提计划调整卡 | 第一版只报告 / checklist，不自动改训练 |

## 下一批可落地 Agent 化机会

Strava 下调后，短期最值得推进的不是外部同步，而是把 Ultreia 已经有的数据变成更多“观察 → 建议 → 用户确认 → 执行 → 记录”的闭环。

优先级建议：

1. **计划偏差补救 Action Card（第一版已落地，观察中）**
   - 触发：过去 7–14 天出现漏练 / 部分完成，尤其是目标赛临近或连续两次未完成。
   - 数据来源：`evaluatePlanOutcome` 已能判断计划完成 / 部分完成 / 漏掉；AI Coach prompt 也已经读取计划依从。
   - 动作：生成“调整接下来 3–7 天计划”的 `create_plans` / update Action Card，例如降载、挪长距离、补恢复日。
   - 边界：不自动补跑、不自动加量；必须解释原因并让用户确认。
   - 为什么优先：它直接承接现有 Action Card、Calendar 和 Agent Action Log，不需要新表。

2. **恢复风险 / 负荷守门 Action Card**
   - 触发：ACWR high / danger、RPE 覆盖足够、晨间状态差、备注出现疼痛 / 疲劳等信号。
   - 数据来源：`computeTrainingLoad`、readiness、最近训练备注、当前未来计划。
   - 动作：建议把某一天改成恢复跑 / 休息 / 低强度，或提醒不要叠加质量课。
   - 边界：健康风险只能建议和解释，不做诊断；所有计划变更都走确认。

3. **天气驱动的计划调整 Action Card**
   - 触发：未来 7 天已有长距离 / 强度训练，同时预报出现高温高湿、强风、空气质量差或大雨。
   - 数据来源：现有 `weatherCtx.forecastByDate` 和 planned sessions。
   - 动作：建议换到更合适日期 / 时段，或保留日期但降低目标。
   - 边界：只调整未来计划；不影响已完成训练。

4. **数据质量补全助手**
   - 触发：最近完成训练缺 RPE、导入活动有未知类型、天气可补但未补、重要训练缺备注。
   - 动作：先做非 AI 的轻量 checklist；需要写库时让用户确认。后续可把“补 RPE / 补备注 / 改类型”扩展成低风险 Action Card。
   - 为什么重要：ACWR、周报、Memory 的质量依赖 RPE / 备注 / 类型准确性，补数据比多接一个模型更实用。

5. **赛前简报 / 装备检查**
   - 触发：A 级目标赛进入 14 天窗口，且已填写地点 / 天气可用。
   - 动作：生成赛前 briefing（天气、补给、装备、减量重点、风险提醒），并可把“需要确认的准备事项”做成 checklist。
   - 边界：第一版只生成报告 / checklist，不自动改训练计划；如要调整减量计划，再走 Action Card。

暂不作为下一批：

- 全自动周期化计划重排：影响范围太大，必须等局部 Action Card 稳定后再说。
- 后台静默改日历：违反当前原则。
- 外部训练自动同步：Strava 下调，Garmin / 高驰直连暂无干净个人入口。

## 当前下一步

可以继续推进 Phase 6：内部闭环 Action Cards。当前计划偏差补救第一版已接入，下一步先观察它在真机上的触发频率、建议质量和执行记录，再决定是否进入恢复风险 / 负荷守门。

为什么现在可以推进：

1. `create_plans` Action Card 已稳定支持新增计划、明确休息日和单条未来计划修改。
2. `agent_actions` 已能记录动作提议、接受 / 忽略、执行结果和失败原因，并反哺 AI Coach / 周报上下文。
3. AI Coach 已能读取计划依从、未来计划、天气、训练负荷、晨间状态、目标赛事、Memory facts 和最近动作反馈。
4. 计划偏差补救不需要新 schema，也不需要扩大执行权限；它只是把已有观察信号变成一张新的可确认 Action Card。
5. Strava 自动同步短期下调后，内部闭环 Action Card 是更干净的 Agent 化推进路线。

下一步：

1. 观察“计划偏差补救 Action Card”在真机上的触发频率：提示不能太吵，也不能漏掉连续偏差。
2. 观察生成建议是否真的在“补救”而不是“补跑”：优先降载、挪动、恢复和现实可执行性。
3. 如果建议质量稳定，再进入第二梯队：恢复风险 / 负荷守门 Action Card。
4. 服务端定时周报、夜间记忆审核仍需要各自部署 Edge Function / cron SQL 才会真正后台触发；它们不阻塞 Phase 6 前端闭环继续推进。

相关 schema 排查和优先级见 `docs-internal/schema-backlog.md`。

## 变更记录

- 2026-06-19：创建 roadmap。当前决策：先做 Action Card，不做全自动改计划；Action Log 和 Memory Facts 后置。
- 2026-06-19：Phase 1 开始实施。第一版 `create_plans` Action Card 复用 AI Coach 计划导入链路，只做用户确认后的日历写入，不建 action log 表。
- 2026-06-19：`create_plans` Action Card 增加执行预览和覆盖提醒，明确展示将创建哪些计划、哪些日期的旧计划会被替换。
- 2026-06-19：`create_plans` 支持已提炼按钮状态、低 / 中风险解释，以及 `planned_rest` 计划休息状态；休息日覆盖旧计划但不写入训练统计。
- 2026-06-19：补齐 Action Card 本地状态流：`proposed` / `executed` / `rejected`。当前仍不建表，但为后续 Agent Action Log 保留同样的状态语义。
- 2026-06-19：`memory_update` 接入同一套 Action Card 语义：AI 自动更新 Memory 只生成建议，接受才保存，放弃不改动。
- 2026-06-19：Phase 1 标记完成，Phase 2 开始。`daily-coach-dispatch` 增加 `weekly_recap` 模式，先写入现有收件箱，不自动改计划。
- 2026-06-19：Phase 2.1 根据真机反馈调整：周复盘改为 Settings 入口的完整报告页面，支持本周 / 上周手动生成、查看本机最近报告，并从报告提炼计划导入 Calendar；文本注解和周报云同步后置。
- 2026-06-21：周复盘页面全屏化，生成任务提升到 App 层，完成后发本地系统通知。
- 2026-06-21：补充 `schema-backlog.md`，把 `coach_reports`、`agent_actions`、`coach_memory_facts`、周报注解等待建表项和本地缓存边界单独列出。
- 2026-06-21：`coach_reports` 建表并接入前端，周复盘从本机缓存迁到账号保存；自动周报的 blocker 转为用户级设置和调度链路。
- 2026-06-22：文本注解第一版落地：AI 周复盘支持选中多段文本、分别写注解、一次性发回 Coach 讨论。当前只生成确认后的对话消息，不保存到云端注解表。
- 2026-06-22：文本注解改为移动端友好的浮动“加注解”按钮和底部固定输入栏；AI Coach 聊天、周报分析、计划提炼加入停止入口；周日上传活动后先以本地确认弹窗触发手动周报。
- 2026-06-22：`user_settings` 周报自动生成字段接入前端；Settings 增加周复盘自动生成设置，支持开关、星期、时间和周日导入后询问开关。当前触发边界是 App 打开 / 回到前台检查，不做系统后台静默执行。
- 2026-06-22：Settings 里的 AI 周复盘收拢成二级入口（详情 / 设置）；自动生成时间选择改用应用内滚轮。普通 AI Coach 回复注解入口移除，保留直接聊天。
- 2026-06-24：Phase 5 外部训练自动同步下调为暂不推进。Strava 技术上可接 Garmin / COROS 同步后的活动，但 API 政策限制 AI application / agent / context 使用，且数据不等同 FIT 原始记录；短期继续以 FIT / ZIP 为高质量入口，Agent 化优先推进内部闭环。
- 2026-06-23：周复盘自动设置的星期也改为滚轮；日历计划状态去掉单独 `skipped` 展示，`planned_rest` 明确为“显式计划休息 / 覆盖旧计划”的语义，不自动套用到所有空白日。
- 2026-06-23：Phase 2 进入收尾观察；下一步确认进入 Phase 3 `agent_actions`，先做可追溯 action log，不做新的自动执行。
- 2026-06-23：补充 `agent_actions` 建表 SQL；第一版保留 `client_id` 承接现有前端 Action Card id，并用 `source_ref_type/source_ref_id` 关联 AI Coach 消息或周报来源。
- 2026-06-23：Phase 3 第一版接入前端：新增 `agentActions` DAL；计划导入和 Memory 更新动作会写入账号 action log；启动时读取 `create_plans` 动作恢复 AI Coach 按钮状态。
- 2026-06-23：Phase 3 第二步：计划导入 Action Card 接受后先记 `accepted`，后台保存成功再记 `executed/result`，失败记 `failed/error`；Memory 更新接受时记录保存结果摘要。
- 2026-06-23：Phase 3 第三步：AI Coach 对话和 AI 周复盘开始读取最近 Action Card 结果，把接受 / 忽略 / 失败作为后续建议的反馈上下文。
- 2026-06-23：Phase 3 第四步：AI Coach 设置新增 `Recent Agent Actions` 轻量只读入口，最近 10 条动作可展开查看 payload/result 摘要，先补可审计性，不新增动作类型。
- 2026-06-23：Recent Agent Actions 增加“带着这条动作问教练”入口，让 action log 从纯审计记录变成可继续讨论的 agent 上下文；仍不自动执行新动作。
- 2026-06-24：Recent Agent Actions 展开详情继续收敛成用户可读视图：修改计划按日期分组展示「原计划 / 新计划」，隐藏内部计划 id，执行结果改短标签；这一步确认 action log 的价值是可审计、可追问，而不是暴露数据库结构。
- 2026-06-24：Phase 3 标记为已完成（观察中）；可以推进 Phase 4。第一步先做 `coach_memory_facts` 旁路事实层，不静默迁移旧分区 Memory；后续已在 Phase 4.4 升级为 facts-only prompt。
- 2026-06-24：准备 Phase 4.1 建表 SQL：`docs-internal/supabase-coach-memory-facts.sql`。下一步必须先由用户在 Supabase Dashboard 跑 SQL，再接 `memoryFacts` DAL 和 Memory facts 审核界面。
- 2026-06-24：Phase 4.1 第一版接入前端：新增 `memoryFacts` DAL；接受 Memory 自动更新后，从最终保留条目拆出 active facts 保存到账户；Memory 面板增加 facts 区域，可查看 active/proposed facts，并支持归档 active facts、查看 archived facts、恢复误归档 facts。第一版 facts 不额外消耗 AI，后续已升级为 prompt 主记忆。
- 2026-06-24：Phase 4.2 夜间记忆审核第一版接入：借鉴 Claude dreaming 的“异步整理记忆、用户审核后生效”模式，但实现上继续使用 DeepSeek + Action Card。开关放在 AI Coach → Memory；后台 `daily-coach-dispatch` 新增 `memory_update` 模式，有当天新对话才生成 `memory_update` 待审核动作和 inbox 提醒，不直接写入 `coach_memory`。定时触发 SQL 单独放在 `docs-internal/supabase-nightly-memory-review-cron.sql`。
- 2026-06-24：Phase 4.3 把 active Memory facts 接入 AI Coach / 周报上下文：只读取 `status=active` 的事实，归档事实不进入 prompt；旧分区 Memory 暂保留为历史字段，不迁移删除。
- 2026-06-24：Phase 4.4 facts-only Memory 收尾：旧分区文本 Memory 从 AI Coach / 周报 prompt 和 UI 移除；Memory 面板只展示 Current / Archived facts；新增 `docs-internal/supabase-clear-legacy-coach-memory.sql` 供 Wilf 清空 `user_settings.coach_memory` / `coach_memory_zh`，不影响 facts、聊天、Action Log 或训练数据。
- 2026-06-24：修正 Memory 更新保存顺序：过去 `memory_update` action 可能先被标记为 executed，但 `coach_memory_facts` 写库失败只在控制台 warning，导致换设备看不到事实。现在接受审核后会等待 facts 写库成功，成功后才记录 executed；失败则保留审核卡并显示错误。新增 `docs-internal/supabase-check-memory-facts-and-actions.sql` 用于只读核对 facts 与 action log。
- 2026-06-24：Phase 2 服务端定时周报补齐：`weekly_recap` 按用户本地星期 / 半点时间运行，读取 Current Memory facts 和 Recent Agent Actions，完整报告写入 `coach_reports` 后发送短通知；前端到点触发已移除。周日导入提示收敛为补漏：已有周报早于新导入活动、或预定时间已过但报告仍缺失时提供手动分析兜底。
- 2026-06-24：Phase 6 第一版落地：AI Coach 会识别最近两周漏练 / 部分完成的计划，在对话上方提示生成“计划偏差补救” Action Card；用户确认前不改日历，执行结果写入 Agent Action Log。下一梯队按恢复风险、天气调整、数据质量补全、赛前简报推进。
