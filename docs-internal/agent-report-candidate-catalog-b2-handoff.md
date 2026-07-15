# Ultreia Live Report Catalog 与 Aevum B2 Handoff

> 2026-07-15。Aevum ingress v8、Ultreia dispatch v8 与 producer B2 outbox
> constraints 已部署。只读 acceptance 10/10 PASS；16:30 Asia/Shanghai 正常
> `force:false` Cron 返回 HTTP 200、`processed:7`，七个独立槽位均已进入调度。

## 运行边界

```text
domain snapshot
-> deterministic feature extraction
-> detector registry
-> significance / novelty / recurrence judgment
-> local candidate catalog
-> privacy sanitizer
-> schema validation
-> independent live outbox
-> Aevum ingress
```

- 调度器遍历 catalog / detector registry，不包含某一训练信号的专用分支。
- 原始训练、GPS、训练笔记和健康文本只在 Ultreia 内存中参与确定性特征提取；
  candidate 只保留计数、比例、方向、窗口和有限枚举。
- 当前不调用模型。`allowed_minimized` 只是未来扩展点；即使启用，模型也只能看到已经最小化的 features，并只
  能返回 catalog key 与 significance / novelty / recurrence 判断；代码重新做
  schema、confidence、privacy 和 runtime gate。
- 七类均为 `runtime=live`，每类使用独立 outbox 行、lease、cadence 和失败状态。
  sensitive Report 被 Aevum `recorded + needs_user` 后即算成功投递。
- Report 是来源证据，不授予 Aevum memory write、Action、scope、permission 或
  retention 权限。

## 七类已上线类型

### `training_state_change / repeated_plan_deviation`

- 状态：`live`，Aevum B2 已登记，producer schema 与正常 Cron 已验收。
- schema：`training_state_change.v1`

```json
{
  "type": "training_state_change",
  "signal_kind": "repeated_plan_deviation",
  "schema_version": "training_state_change.v1",
  "window": { "start_date": "date", "end_date": "date", "lookback_days": 14 },
  "counts": {
    "planned": "integer",
    "done": "integer",
    "partial": "integer",
    "missed": "integer",
    "affected": "integer",
    "missed_key_sessions": "integer"
  },
  "affected_ratio": "number 0..1",
  "state": "active"
}
```

- 证据 / 阈值：过去 14 个完整本地日内，`affected >= 2` 或漏掉至少一节主课。
- 禁止外发：workout / plan 行、记录 UUID、距离、配速、心率、RPE、笔记、GPS、
  地点、天气、赛事名称、健康详情。
- policy：normal；confidence floor `0.90`；最大频率 `1/日`；retention ceiling
  `7 天`；模型 `forbidden`；正常自动上报。

计划依从不再是独立类型：14 日至少 4 条计划且偏移比例至少 50% 时，判断合并进
`repeated_plan_deviation` 的 significance；payload 仍严格使用 B1 schema，同一证据
窗口最多生成一份 Report。

### `training_load_change / rapid_training_load_change`

```json
{
  "type": "training_load_change",
  "signal_kind": "rapid_training_load_change",
  "schema_version": "training_load_change.v1",
  "window": { "start_date": "date", "end_date": "date", "comparison_days": 7 },
  "direction": "rapid_increase | rapid_decrease",
  "duration_change_ratio": "number",
  "session_counts": { "recent": "integer", "previous": "integer" }
}
```

- 阈值：两周各至少 2 次；前一周总时长至少 120 分钟；最近周相对前周 `>=1.5x`
  或 `<=0.5x`，且绝对差至少 120 分钟。
- 禁止字段：单次时长 / 距离 / 爬升 / RPE、workout UUID、GPS、笔记、地点。
- policy：normal；floor `0.85`；最多 `1/7 天`；retention `21 天`；模型
  `allowed_minimized`（当前未启用）；自动上报。

### `recovery_state_change / recovery_risk_trend`

```json
{
  "type": "recovery_state_change",
  "signal_kind": "recovery_risk_trend",
  "schema_version": "recovery_state_change.v1",
  "window": { "start_date": "date", "end_date": "date", "lookback_days": 7 },
  "risk_level": "elevated | high",
  "poor_readiness_days": "integer",
  "high_rpe_sessions": "integer",
  "sample_days": "integer"
}
```

- 阈值：最近 7 日至少 3 个 readiness 样本且至少 2 个低状态日；或相较前 7 日
  平均下降 `>=0.5`；或高 RPE 训练至少 2 次。
- 禁止字段：每日 sleep / legs / energy 值、疾病标签明细、RPE 数值对应训练、
  心率、HRV、Body Battery、笔记、诊断或医疗详情。
- `sample_days=0` 合法：仅连续高 RPE 也可构成风险证据。
- policy：sensitive；floor `0.90`；最多 `1/7 天`；retention `14 天`；模型
  `forbidden`；自动上报，Aevum 记录后 `needs_user`。

### `goal_context_change / target_race_context_change`

```json
{
  "type": "goal_context_change",
  "signal_kind": "target_race_context_change",
  "schema_version": "goal_context_change.v1",
  "change_window": "date",
  "target_count": "integer",
  "nearest_target_days": "integer | null",
  "priority_counts": { "A": "integer", "B": "integer", "C": "integer", "unset": "integer" }
}
```

- 阈值：前一个完整本地日内至少一个结构化赛事的 target 上下文新增、修改或取消。
- 禁止字段：赛事名、地点、报名信息、费用、race UUID、精确用户目标描述。
- policy：normal；floor `0.95`；最多 `1/日`；retention `90 天`；模型
  `allowed_minimized`（当前未启用）；自动上报。

### `training_preference_change / preference_context_invalidated`

```json
{
  "type": "training_preference_change",
  "signal_kind": "preference_context_invalidated",
  "schema_version": "training_preference_invalidation.v1",
  "change_window": "date",
  "change_count": "integer",
  "operations": { "updated": "integer", "removed": "integer" },
  "context_version": "64-char lowercase SHA-256"
}
```

- 阈值：前一个完整本地日内，至少一条已接受的训练偏好事实发生实质更新 / 归档；
  `change_count = updated + removed`。
- 当前 active 集合只用内部 id、updated_at 规范排序后在本地计算 SHA-256；内部元数据
  只进入 hash，不进入 payload。归档项计入 removed，但不进入 active context hash。
- 禁止字段：Memory 正文、来源对话、source UUID、日程详情、健康或家庭约束内容。
- policy：normal；floor `0.90`；最多 `1/7 天`；retention `180 天`；模型
  `allowed_minimized`（当前未启用）；自动上报。

### `training_progress_change / notable_progress_or_milestone`

```json
{
  "type": "training_progress_change",
  "signal_kind": "notable_progress_or_milestone",
  "schema_version": "training_progress_change.v1",
  "window": { "start_date": "date", "end_date": "date", "lookback_days": 7 },
  "metric": "distance | duration | ascent",
  "improvement_ratio": "number",
  "baseline_days": 90
}
```

- 阈值：90 日基线至少 4 次训练；最近 7 日的单次最大值比此前 rolling max 高
  `>=10%`，且最低门槛为 10 km / 60 min / 500 m ascent。
- 禁止字段：单次训练值、日期、路线、GPS、workout UUID、配速、心率和笔记。
- policy：normal；floor `0.90`；最多 `1/14 天`；retention `90 天`；模型
  `allowed_minimized`（当前未启用）；自动上报。

### `health_risk_change / recurring_injury_or_health_risk_pattern`

```json
{
  "type": "health_risk_change",
  "signal_kind": "recurring_injury_or_health_risk_pattern",
  "schema_version": "health_risk_change.v1",
  "window": { "start_date": "date", "end_date": "date", "lookback_days": 28 },
  "signal_days": "integer",
  "signal_sources": { "workout_text_days": "integer", "sick_tag_days": "integer" },
  "recurrence": "repeated_days"
}
```

- 阈值：28 日内至少 2 个不同日期命中本地健康关键词或 sick tag。关键词文本只在
  本地扫描，候选不保留内容。
- 禁止字段：症状 / 伤处原文、训练笔记、疾病标签日期、医疗判断、心率 / HRV、
  用药、诊断、GPS、workout UUID。
- policy：sensitive；floor `0.95`；最多 `1/14 天`；retention `14 天`；模型
  `forbidden`；自动上报，Aevum 记录后 `needs_user`。

## Aevum B2 已实现边界

- Aevum ingress v8 对七类 exact schema、sensitivity、confidence、TTL 和 standing
  policy 做接收端校验；未知 type / signal / 字段或未来 `occurred_at` 返回确定性 4xx。
- Aevum 不替 producer 限频，因此 Ultreia 必须根据每类最后成功投递时间执行 cadence。
- Report / derived memory / Action 保持三层分离：recorded Report 只提供证据；派生记忆
  由 Aevum policy 决定，训练 Action 必须回 Ultreia 重新做权限、最新状态、风险、冲突和幂等检查。
- Producer B2 migration 为 `supabase-agent-report-outbox-b2.sql`，只读验收为
  `supabase-agent-report-outbox-b2-acceptance.sql`；2026-07-15 验收 10/10 PASS。
- blocked envelope archive 仍未建表；任何迁移继续走 SQL gate。

## 当前 paused pending 的安全处理

当前生产 paused envelope 在 B2 constraint migration 前后整行摘要完全一致：

1. `paused_until` 到期前，Cron 不读取新候选、不发送、不修改 pending bundle。
2. 到期后只用原 report ID、payload、content hash 和 idempotency key 重试一次。
3. Aevum 对无效时间 envelope 返回 422 后，Ultreia 将状态置为 `blocked`，原 envelope
   继续保留，停止重试；同一类型停止新发现，其它六类继续独立运行。
4. 不直接清空 pending 字段，因为这会丢失生产事故证据并允许新任务占用同一槽位。

如要恢复该 live signal 的新 Report，建议做一次**另行批准的事务迁移**：先把整份失败
envelope、错误、attempt、时间和原 outbox 主键复制到 append-only failed-envelope 表，
校验副本 hash / report ID 后，再清空 active slot 并回到 `idle`。影响是新增一张仅
service-role 可访问、带 TTL 的审计表，并会解除该 signal 的发送阻塞；回滚是把归档
记录原样写回 active slot。执行前必须另给完整 SQL、RLS、TTL、验证查询和回滚 SQL，
由 Wilf 审核后在 Dashboard 执行。本次未创建表、未迁移、未修改生产 pending 数据。
