# Ultreia Agent 化推进 Roadmap

> 内部 living document。只保留当前事实、边界、衡量方式和下一步；历史背景见 `agentization-analysis.md`，数据库现状见 `schema-backlog.md`。

## 当前定位

Ultreia 当前运行时处于“可确认动作的 AI Coach Agent”阶段，已经有 Action
Card、Action Log、Memory facts 和结果评估：

```text
读取最新训练上下文 → 发现问题 → 提出动作 → 按权限自动执行或请求确认
→ 执行并记录 → 在日期过去后评估结果 → 后续复盘参考
```

2026-07-12 确定的下一目标不是继续要求 Wilf 逐条批准，而是推进为
“预授权 + 例外升级”的训练域 Agent：

```text
Wilf 设置长期权限与风险边界
→ Action 标记 auto / guarded / requires_user
→ 通过最新状态、冲突、风险和幂等检查后自动执行授权内动作
→ 记录执行回执和结果
→ 只有越权、高风险、不可逆或无法消解的冲突才找 Wilf
```

Action Card 是结构化动作信封和审计记录，不天然等于人工审批卡。现有
确认式 UI 保持当前真实行为，直到 policy runtime 和自动执行守卫真正上线。

当前已覆盖：

- AI Coach 对话、周复盘、每日推送、夜间自主 Memory 生命周期。
- `create_plans`、`memory_update`、`race_briefing` 三种既有动作；不新增动作类型。
- 计划偏差补救、恢复 / 负荷守门、赛前简报。
- `agent_actions` 跨设备恢复、执行状态与最近建议记录。
- Desktop Codex 优先、DeepSeek fallback；图片对话仅走 Codex。

## 不变边界

- 不在后台黑箱修改 Calendar，不因用户未回应就自动增加训练量。
- 增加训练负荷、修改主课或目标赛、健康风险和医疗判断、不可逆动作以及
  无法消解的旧状态冲突仍需用户或更严格的硬规则。
- 已明确授权、低风险、可逆的训练动作可在最新状态、冲突和频率守卫通过
  后自动执行；用户审批的是策略，不是每一条动作。
- AI 负责意义、用途和重复性判断；应用负责类别白名单、保留期限、来源边界、写入和审计。
- Memory 只保存训练域派生上下文，不复制或改写训练记录、晨间状态、赛事和日历等原始数据。五个类别固定为伤病健康、目标策略、训练偏好、教练风格和长期模式。
- 短期 Memory 必须带 3–45 天有效期，到期立即退出 Agent 上下文并归档，30 天恢复窗口后永久清理；当前长期 Memory 只有明确纠正或撤回才可归档，不能因为一次夜间未提到而删除。
- 夜间 Memory 允许在低风险 standing policy 下自动新增、实质更新、归档或忽略，不创建用户审核卡；重复内容、一次性事实、普通建议和纯措辞变化必须静默忽略。
- 普通聊天可以在部分数据刷新失败时继续；会生成或执行动作的路径必须拿到完整新鲜上下文，否则暂停并提示重试。
- Ultreia 只处理训练域。跨产品 policy、Report/Query/Action 契约、全局派生
  记忆和异常队列属于 Aevum。
- 用户可见变化同步 `docs/` 与 `docs/changelog.md`。

## 当前状态

| 能力 | 状态 | 当前事实 |
|---|---|---|
| Action Card | 已上线 | 创建 / 修改计划和计划休息仍先审核后执行；Memory 生命周期不再占用审核卡 |
| Agent Action Log | 已上线 | 动作与数据都成功落盘后才显示已保存；失败可安全重试 |
| Memory facts | 已上线 | active facts 注入 AI Coach / 周复盘；夜间任务按五分类自动执行差量决策，短期 facts 到期归档 |
| AI 周复盘 | 已上线 | 手动与服务端自动路径统一读取 sleep / legs / energy；生产 cron 已执行 |
| 主动训练调整 | 观察中 | 计划偏差、恢复风险可生成一份合并建议；仍需确认 |
| 赛前简报 | 观察中 | 目标赛进入 14 天窗口后可生成只读简报 |
| Calendar 建议结果评估 | 已上线观察 | 仅评估已执行且影响日期均已过去的 `create_plans`；结果幂等写入 `result.outcome` |
| Calendar 执行冲突守卫 | 已上线 | `create_plans` 在 payload 保存版本化审核基线；独立安全门返回机器可读冲突，stale 旧动作零训练数据写入，部分写入可幂等重试 |
| Aevum Phase A 自治底座 | 已完成并验收 | `agent_report.v1`、策略、派生记忆、Action 安全逻辑和数据库基础已建立；2026-07-12 数据库检查 68/68 PASS、本地 UI 边界 PASS |
| Aevum B2 Report catalog | 已部署并验收 | Aevum ingress v8 已登记七类；Ultreia dispatch v8 与 producer B2 constraints 已部署，acceptance 10/10 PASS，正常 Cron HTTP 200 并处理七个独立槽位 |
| Ultreia autonomous candidate discovery | 已上线 | domain snapshot → deterministic features → detector registry → 意义 / 新颖性 / 复发判断 → registered type → privacy / schema gate → independent outbox 已实现并通过正常 Cron；当前完全使用确定性代码，不调用付费模型 |
| Aevum Query | 未开始 | Query 与主动 Report 分开推进 |
| 天气自动改计划 | 暂缓 | 继续作为建议证据，不单独增加动作类型 |
| 外部训练自动同步 | 暂不推进 | 不以 Strava API 作为短期路线 |

## 质量门槛

- 同日多计划使用一对一匹配：一条实际训练最多完成一条计划。
- 生成和执行动作前刷新 workouts、races、daily notes、Memory facts、agent actions。
- 旧状态冲突必须零训练数据写入。自动来源可刷新状态、废弃旧动作、重新
  生成并再过策略；只有仍不能安全消解时才升级给用户。
- Calendar 基线构建、执行请求、冲突比较、stale / superseded 标记和写入
  放行逻辑不依赖 Action Card UI；当前人工来源仍由 UI 确认，未来预授权
  执行器可以复用同一安全门并在重生成后重新通过权限策略。
- Calendar 数据写入与动作日志必须一致；Memory 自动维护只有在事实写入成功后才记录完成，技术失败必须保持可重试。
- Memory 自动维护每天最多一次、最多处理 20 个决策；代码拒绝未知类别、无依据写入、无明确纠正的归档、重复新增和纯措辞更新。
- 结果评估只陈述观察结果，不把一次训练表现归因于某条建议。
- 结果评估幂等，重复刷新不能产生重复记录或覆盖原执行审计。

## 观察指标

- Calendar 建议确认率、跳过率、技术失败率。
- Memory 每晚新增 / 实质更新 / 自动归档 / 忽略数量，以及重复或纯措辞更新拦截数量。
- Calendar 建议的完成 / 部分完成 / 未完成 / 被修改或删除数量。
- 已完成训练中的高 RPE 信号。
- 主动建议是否在短时间内重复或互相冲突。
- 普通聊天与动作门禁的刷新失败频率。
- 自动执行成功率、异常升级率、冲突后自动重算成功率、撤销/补偿率和
  熔断次数。

## 下一步

1. 观察七类 Report 的命中率、频率跳过、重复率、敏感隔离和
   隐私边界；确定性 4xx 必须 blocked，不能用新候选覆盖失败 envelope。
2. 若未来启用 `allowed_minimized` 模型扩展，先证明它只看到最小化 feature，且失败时
   确定性 detector 仍可独立运行；不得扩大 type、字段、scope、sensitivity 或 retention。
3. 窄范围 Query 可独立推进，但不阻塞主动 Report；Report 派生为 memory 仍完全由
   Aevum standing policy 决定。
4. 自动 `guarded` Calendar Action 继续后置；启用前先用事务型 RPC 或等价的
   乐观并发约束关闭客户端预检后的 TOCTOU 窗口。
5. 不增加新 Agent 类型，不继续扩张设置页或解释型矩阵 UI。
