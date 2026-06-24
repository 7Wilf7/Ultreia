# Ultreia Agent 化推进 Roadmap

> 内部 living document。这里是推进 agent 化的当前计划和状态，实施过程中如果发现某项不必要、不准确或风险过高，直接修改或删除，不保留过期设想。背景分析见 `docs-internal/agentization-analysis.md`。

## 当前定位

Ultreia 当前状态是 **AI Coach Copilot**：

- 强项：训练上下文注入、AI Coach 对话、计划解析、Memory 审核、每日提醒。
- 短板：没有持续任务对象、没有统一工具层、没有 agent action log、主动循环还很弱。

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
| Phase 2 | 已完成（后台 cron 后置） | AI 周复盘 Page | 已改为 Settings 全屏周报页，并接入账号内周报保存；文本注解、停止控制、App 内自动生成设置和周日导入后询问已落地；真正后台定时后置 |
| Phase 3 | 已完成（观察中） | Agent Action Log | `agent_actions` 已建表；动作记录会恢复状态、即时刷新、记录执行结果、反哺 AI Coach / 周复盘上下文，并已有轻量 Recent Agent Actions 可视化入口；展开详情已改为用户可读摘要 |
| Phase 4 | 可开始 | Memory Facts 结构化 | 第一版只做旁路事实表和审核流，不迁移旧 Memory、不替代现有分区文本 |
| Phase 5 | 待评估 | 自动同步外部训练数据 | Strava API 是优先候选 |

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
- `daily-coach-dispatch` 的 `weekly_recap` 模式保留，但后续接自动定时时要写入 `coach_reports` / 周报页面，而不是只进 inbox。
- 自动每周生成现在已有正式云端周报落点，用户级开关、触发星期和触发时间已接入 `user_settings`；当前是 App 内触发，只在打开 App 或回到前台时检查，真正系统后台 / 服务端定时后置。
- 2026-06-22 起，周报页改成选中文本附近浮出“加注解”动作，底部输入栏固定；AI Coach 聊天、周报分析、计划提炼都有前端停止入口。普通 AI Coach 回复注解入口因日常价值不高已移除，聊天保持直接输入发送。APK 非流式请求停止后只能立即结束等待并忽略旧结果，不能保证服务端调用已经取消。
- 低风险触发已落地：周日上传活动保存成功后，可按设置询问是否现在生成本周周报；固定每周时间 / 开关已接前端。服务端 cron 版本仍需后续决定是否值得做。

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

- 已有分区文本，存在 `coach_memory` / `coach_memory_zh`，仍是当前主线。
- 自动更新会生成英文 + 中文，并以 `memory_update` Action Card 审核后保存。
- 正式发给 Coach 的主记忆是英文，中文用于审核和阅读。
- Phase 3 的 `agent_actions` 已能记录 Memory 更新的提议、接受 / 忽略和结果，因此 Phase 4 可以接着做事实级记录。

推进判断：

- 可以开始，但不做大迁移。
- 旧分区 Memory 继续保留为可读总览和 prompt fallback。
- 第一版只建立旁路事实系统：AI 从对话 / 周报 / Action Log 提炼“单条事实”，用户审核后保存、归档或忽略。
- 保存的 fact 暂时只用于 Memory 面板查看和后续 prompt 试验，不立刻替代 `[Long-term Memory]`。

第一版范围（Phase 4.1）：

1. 新建 `coach_memory_facts` 表，字段支持分类、英文 / 中文正文、来源、状态、置信类型和归档。
2. 新增 DAL：读取最近 active facts、创建 proposed fact、标记 accepted / archived / rejected。
3. Memory 自动更新时，除继续生成整段分区 Memory 外，可以额外提炼候选 facts，作为 Action Card 审核。
4. Memory 面板先增加一个轻量 facts 区域：只显示 active / proposed，不做复杂搜索。
5. Prompt 侧先不强依赖 facts；等事实质量稳定后，再把 active facts 摘要插入 Coach prompt。

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
- 旧的分区 Memory 不被破坏，仍可手动编辑和作为 prompt fallback。
- `npm run test` / `npm run lint` / `npm run build` 通过。

暂缓内容：

- 不迁移旧 `coach_memory` 文本。
- 不做复杂事实搜索 / 标签管理。
- 不让 AI 自动删除或覆盖事实。
- 不把 facts 作为 Coach prompt 唯一记忆来源。

## Phase 5：外部训练数据自动同步

目标：减少手动上传，让 agent 的感知更及时。

优先候选：

- Strava API 自动同步。

暂不碰：

- App 内 GPS 记录。
- Garmin Health API 企业接入。
- 复杂多平台同步。

评估点：

- 国内 Garmin / 高驰同步到 Strava 是否稳定。
- Strava 免费 API 配额是否够个人使用。
- 同步过来的数据是否缺心率区间、天气、RPE，需要怎么降级。

## 当前下一步

可以推进 Phase 4，但先做 Phase 4.1：Memory Facts 旁路事实层。

为什么现在可以推进：

1. `Import to Calendar` 的计划提炼结果已经包装成 `create_plans` 类型的前端 `agentAction`。
2. 弹窗从单纯导入审核改为 Action Card 审核：先显示建议动作、风险等级、确认说明和「将执行」清单，再逐条编辑计划。
3. `create_plans` 会提前提示哪些日期已有计划将被替换；已完成训练不受影响。
4. 同一条 AI 回复提炼过后，按钮会显示为已提炼状态，再点直接打开缓存结果，不重复提炼。
5. 明确的“无计划休息 / 不跑 / 休息日”会作为 `planned_rest` 日历状态执行：覆盖同日旧计划训练，但不创建 workout row、不污染统计；普通空白日不自动打这个标签。
6. 风险等级从固定中风险改为按影响范围判断：少量新增为低风险，批量改动或覆盖旧计划为中风险。
7. Action Card 已有本地生命周期状态：`proposed` / `executed` / `rejected`。接受后按钮显示已执行，忽略后显示已忽略；关闭弹窗不改变状态。
8. Memory 自动更新已包装成 `memory_update` Action Card：AI 只提出建议，用户审核条目后接受才写入长期记忆，放弃则不改动。
9. Phase 1 第一版仍只存在前端 state / localStorage 缓存，不建新表，不做自动执行。
10. Phase 2 第一版开始：`daily-coach-dispatch` 增加 `weekly_recap` 模式，读取本周训练、当周 / 下周计划、每日状态和目标赛，生成 AI 周复盘。
11. Phase 2.1 调整方向：周复盘不再当作收件箱短消息，而是 Settings 里的完整报告页面；先支持本周 / 上周手动生成、查看账号内最近周报，并可从报告提炼接下来计划。
12. `coach_reports` 已建表并接入前端；新周报写入账号，旧本机周报会迁移一次。
13. `agent_actions` 已建表并接入前端，计划导入 / Memory 更新 / 周报提炼动作能记录状态、执行结果和失败原因。
14. AI Coach 和周报 prompt 已能读取最近 action 反馈，Recent Agent Actions 也能即时刷新、长按删除、展开查看可读详情，并把单条动作带回 Coach 追问。

下一步：

1. 先准备 `coach_memory_facts` 的 Supabase SQL；用户在 Dashboard 跑完后再改 DAL / 前端。
2. 接 `src/lib/db/memoryFacts.js`，只做读取、创建、接受、忽略、归档。
3. 在 Memory 自动更新流里提炼候选 facts，复用 Action Card 审核，不破坏现有整段 Memory 更新。
4. Memory 面板增加轻量 facts 区域，先服务查看和手动归档。
5. 稳定后再决定是否把 active facts 摘要插入 AI Coach / 周报 prompt。
6. 如需要真正后台定时，再把 `daily-coach-dispatch` 的每周任务改为读取 `user_settings`，生成后写 `coach_reports`，再发系统通知 / 收件箱提醒；当前 App 内定时已够个人使用先验。

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
- 2026-06-23：周复盘自动设置的星期也改为滚轮；日历计划状态去掉单独 `skipped` 展示，`planned_rest` 明确为“显式计划休息 / 覆盖旧计划”的语义，不自动套用到所有空白日。
- 2026-06-23：Phase 2 进入收尾观察；下一步确认进入 Phase 3 `agent_actions`，先做可追溯 action log，不做新的自动执行。
- 2026-06-23：补充 `agent_actions` 建表 SQL；第一版保留 `client_id` 承接现有前端 Action Card id，并用 `source_ref_type/source_ref_id` 关联 AI Coach 消息或周报来源。
- 2026-06-23：Phase 3 第一版接入前端：新增 `agentActions` DAL；计划导入和 Memory 更新动作会写入账号 action log；启动时读取 `create_plans` 动作恢复 AI Coach 按钮状态。
- 2026-06-23：Phase 3 第二步：计划导入 Action Card 接受后先记 `accepted`，后台保存成功再记 `executed/result`，失败记 `failed/error`；Memory 更新接受时记录保存结果摘要。
- 2026-06-23：Phase 3 第三步：AI Coach 对话和 AI 周复盘开始读取最近 Action Card 结果，把接受 / 忽略 / 失败作为后续建议的反馈上下文。
- 2026-06-23：Phase 3 第四步：AI Coach 设置新增 `Recent Agent Actions` 轻量只读入口，最近 10 条动作可展开查看 payload/result 摘要，先补可审计性，不新增动作类型。
- 2026-06-23：Recent Agent Actions 增加“带着这条动作问教练”入口，让 action log 从纯审计记录变成可继续讨论的 agent 上下文；仍不自动执行新动作。
- 2026-06-24：Recent Agent Actions 展开详情继续收敛成用户可读视图：修改计划按日期分组展示「原计划 / 新计划」，隐藏内部计划 id，执行结果改短标签；这一步确认 action log 的价值是可审计、可追问，而不是暴露数据库结构。
- 2026-06-24：Phase 3 标记为已完成（观察中）；可以推进 Phase 4，但第一步只做 `coach_memory_facts` 旁路事实层，不迁移旧分区 Memory，也不让 facts 立刻替代 Coach prompt 的主记忆。
