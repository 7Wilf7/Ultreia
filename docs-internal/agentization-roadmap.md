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
| Phase 2 | 进行中 | AI 周复盘 Page | 已改为 Settings 全屏周报页；下一步补云端周报落点和自动生成设置 |
| Phase 3 | 待开始 | Agent Action Log | 周报自动化 / 跨页面动作稳定后再建表 |
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
- 周报历史先保存在当前设备 localStorage，按用户 id 隔离；暂不新增 Supabase 表，避免卡 schema 变更。
- 周报下方先复用现有计划提炼 Action Card；多段文本注解、周报多设备同步、自动定时推送后置。
- `daily-coach-dispatch` 的 `weekly_recap` 模式保留，但 prompt 改成详细周报风格；后续如果接自动定时，需要改成写入周报表 / 周报页面，而不是只进 inbox。
- 自动每周生成不做前端假开关：它需要一个正式云端周报落点和用户级开关，否则后台生成结果不能跨设备可靠展示。

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

Phase 2 正在推进。

已落地：

1. `Import to Calendar` 的计划提炼结果已经包装成 `create_plans` 类型的前端 `agentAction`。
2. 弹窗从单纯导入审核改为 Action Card 审核：先显示建议动作、风险等级、确认说明和「将执行」清单，再逐条编辑计划。
3. `create_plans` 会提前提示哪些日期已有计划将被替换；已完成训练不受影响。
4. 同一条 AI 回复提炼过后，按钮会显示为已提炼状态，再点直接打开缓存结果，不重复提炼。
5. 明确的“无计划休息 / 不跑 / 休息日”会作为 `planned_rest` 日历状态执行：覆盖同日旧计划训练，但不创建 workout row、不污染统计。
6. 风险等级从固定中风险改为按影响范围判断：少量新增为低风险，批量改动或覆盖旧计划为中风险。
7. Action Card 已有本地生命周期状态：`proposed` / `executed` / `rejected`。接受后按钮显示已执行，忽略后显示已忽略；关闭弹窗不改变状态。
8. Memory 自动更新已包装成 `memory_update` Action Card：AI 只提出建议，用户审核条目后接受才写入长期记忆，放弃则不改动。
9. Phase 1 第一版仍只存在前端 state / localStorage 缓存，不建新表，不做自动执行。
10. Phase 2 第一版开始：`daily-coach-dispatch` 增加 `weekly_recap` 模式，读取本周训练、当周 / 下周计划、每日状态和目标赛，生成 AI 周复盘。
11. Phase 2.1 调整方向：周复盘不再当作收件箱短消息，而是 Settings 里的完整报告页面；先支持本周 / 上周手动生成、查看本机最近周报，并可从报告提炼接下来计划。

下一步：

1. 设计并新增 `coach_reports` 表：保存周报正文、范围、生成状态、错误、是否已读、来源（手动 / 自动），让周报历史跨设备同步。
2. 在 `user_settings` 增加每周自动周报开关、触发日和触发时间；`daily-coach-dispatch` 生成后写 `coach_reports`，再发系统通知 / 收件箱提醒。
3. 设计文本注解能力：周报和 AI Coach 回复都可选中文本、保存多条注解、一次性发给教练讨论。
4. 自动周报和文本注解稳定后，进入 Phase 3：把本地 action 状态迁移成 Supabase `agent_actions` 表。

## 变更记录

- 2026-06-19：创建 roadmap。当前决策：先做 Action Card，不做全自动改计划；Action Log 和 Memory Facts 后置。
- 2026-06-19：Phase 1 开始实施。第一版 `create_plans` Action Card 复用 AI Coach 计划导入链路，只做用户确认后的日历写入，不建 action log 表。
- 2026-06-19：`create_plans` Action Card 增加执行预览和覆盖提醒，明确展示将创建哪些计划、哪些日期的旧计划会被替换。
- 2026-06-19：`create_plans` 支持已提炼按钮状态、低 / 中风险解释，以及 `planned_rest` 计划休息状态；休息日覆盖旧计划但不写入训练统计。
- 2026-06-19：补齐 Action Card 本地状态流：`proposed` / `executed` / `rejected`。当前仍不建表，但为后续 Agent Action Log 保留同样的状态语义。
- 2026-06-19：`memory_update` 接入同一套 Action Card 语义：AI 自动更新 Memory 只生成建议，接受才保存，放弃不改动。
- 2026-06-19：Phase 1 标记完成，Phase 2 开始。`daily-coach-dispatch` 增加 `weekly_recap` 模式，先写入现有收件箱，不自动改计划。
- 2026-06-19：Phase 2.1 根据真机反馈调整：周复盘改为 Settings 入口的完整报告页面，支持本周 / 上周手动生成、查看本机最近报告，并从报告提炼计划导入 Calendar；文本注解和周报云同步后置。
- 2026-06-21：周复盘页面全屏化，生成任务提升到 App 层，完成后发本地系统通知。当前仍手动生成；下一步优先做 `coach_reports` 云端落点，再接每周自动生成设置。
