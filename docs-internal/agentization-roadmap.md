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
| Phase 1 | 已完成 | Action Card 雏形 | 日历计划和 Memory 更新已接入前端 Action Card |
| Phase 2 | 收尾观察 | AI 周复盘 Page | 已改为 Settings 全屏周报页，并接入账号内周报保存；文本注解、停止控制和 App 内自动生成设置已落地；真正后台定时后置 |
| Phase 3 | 下一步 | Agent Action Log | 需要 Supabase schema 变更；先把 AI 提议、用户决策、执行结果和失败原因变成可追溯记录 |
| Phase 4 | 待开始 | Memory Facts 结构化 | 暂不急，当前分区文本够用 |
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
agent_actions (
  id uuid primary key,
  user_id uuid not null,
  type text not null,
  status text not null,
  title text,
  reason text,
  payload jsonb,
  result jsonb,
  error text,
  created_at timestamptz default now(),
  decided_at timestamptz
)
```

状态流：

```text
proposed -> accepted -> executed
proposed -> rejected
accepted -> failed
```

注意：这一步需要 Supabase schema 变更，必须先给用户 SQL，用户在 Dashboard 跑完后再改前端和 DAL。

## Phase 4：Memory Facts 结构化

目标：让长期记忆从“分区文本”升级为“事实系统”。

当前状态：

- 已有分区文本。
- 自动更新会生成英文 + 中文。
- 正式发给 Coach 的主记忆是英文，中文用于审核和阅读。

暂不急着做的原因：

- 现在只有个人使用，Memory 规模不大。
- 分区文本已解决大部分可读性问题。
- 直接建表会增加 UI、迁移、prompt 选择逻辑复杂度。

未来触发条件：

- Memory 经常超过 500 字。
- 旧事实被覆盖。
- 用户需要按事实逐条编辑、归档、确认来源。

建议字段：

```text
category
content_en
content_zh
source
status
created_at
updated_at
last_used_at
archived_at
```

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

Phase 2 已进入收尾观察，下一步是 Phase 3：Agent Action Log。

已落地：

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

下一步：

1. Phase 3 第一件事是建 `agent_actions`：记录 AI 提议了什么、用户接受 / 忽略 / 修改了什么、系统执行结果如何、失败原因是什么。
2. 这一步需要 Supabase schema 变更，必须先给用户完整 SQL；用户在 Dashboard 跑完后，再改 `src/lib/db/*` 字段映射和前端 action 状态读写。
3. 第一版不要追求复杂自动化，只迁移现有本地 action 状态：`create_plans`、`memory_update`、周报提炼计划。目标是跨设备可追溯，而不是让 AI 自动执行。
4. 有了 action log 后，再决定是否把“停止后是否仍扣费 / 服务端是否完成”也纳入任务结果记录。
5. 如需要真正后台定时，再把 `daily-coach-dispatch` 的每周任务改为读取 `user_settings`，生成后写 `coach_reports`，再发系统通知 / 收件箱提醒；当前 App 内定时已够个人使用先验。

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
