# Ultreia Agent 化推进 Roadmap

> 内部 living document。只保留当前事实、边界、衡量方式和下一步；历史背景见 `agentization-analysis.md`，数据库现状见 `schema-backlog.md`。

## 当前定位

Ultreia 当前运行时处于“可确认动作的 AI Coach Agent”阶段，已经有 Action
Card、Action Log、Memory facts 和结果评估：

```text
读取最新训练上下文 → 发现问题 → 提出动作 → 用户确认 / 修改 / 拒绝
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

- AI Coach 对话、周复盘、每日推送、夜间 Memory 审核。
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
- AI 负责判断与结构化建议；应用负责数据校验、权限/例外 UI、写入和审计。
- 普通聊天可以在部分数据刷新失败时继续；会生成或执行动作的路径必须拿到完整新鲜上下文，否则暂停并提示重试。
- Ultreia 只处理训练域。跨产品 policy、Report/Query/Action 契约、全局派生
  记忆和异常队列属于 Aevum。
- 用户可见变化同步 `docs/` 与 `docs/changelog.md`。

## 当前状态

| 能力 | 状态 | 当前事实 |
|---|---|---|
| Action Card | 已上线 | 创建 / 修改计划、计划休息和 Memory 更新均先审核后执行 |
| Agent Action Log | 已上线 | 动作与数据都成功落盘后才显示已保存；失败可安全重试 |
| Memory facts | 已上线 | 只把 active facts 注入 AI Coach / 周复盘；夜间任务只生成待审核建议 |
| AI 周复盘 | 已上线 | 手动与服务端自动路径统一读取 sleep / legs / energy；生产 cron 已执行 |
| 主动训练调整 | 观察中 | 计划偏差、恢复风险可生成一份合并建议；仍需确认 |
| 赛前简报 | 观察中 | 目标赛进入 14 天窗口后可生成只读简报 |
| Calendar 建议结果评估 | 已上线观察 | 仅评估已执行且影响日期均已过去的 `create_plans`；结果幂等写入 `result.outcome` |
| Calendar 执行冲突守卫 | 已上线 | `create_plans` 在 payload 保存版本化审核基线；独立安全门返回机器可读冲突，stale 旧动作零训练数据写入，部分写入可幂等重试 |
| Aevum Phase A 自治底座 | 已完成并验收 | `agent_report.v1`、策略、派生记忆、Action 安全逻辑和数据库基础已建立；2026-07-12 数据库检查 68/68 PASS、本地 UI 边界 PASS；尚无 ingress、adapter、scheduler 或 Action executor |
| Aevum Query / Report | 未开始 | Query 与主动 Report 分开；Report 不直接写 Aevum Memory |
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
- Calendar / Memory 数据写入与动作日志必须一致；技术失败不能被当成用户拒绝。
- 结果评估只陈述观察结果，不把一次训练表现归因于某条建议。
- 结果评估幂等，重复刷新不能产生重复记录或覆盖原执行审计。

## 观察指标

- 建议确认率、跳过率、技术失败率。
- Calendar 建议的完成 / 部分完成 / 未完成 / 被修改或删除数量。
- 已完成训练中的高 RPE 信号。
- 主动建议是否在短时间内重复或互相冲突。
- 普通聊天与动作门禁的刷新失败频率。
- 自动执行成功率、异常升级率、冲突后自动重算成功率、撤销/补偿率和
  熔断次数。

## 下一步

1. Aevum 先实现可信的 Report ingress：冻结 HMAC 请求与幂等 receipt、显式
   JS → SQL mapping、窄 standing policy，以及事务内原子写入 Report decision
   和 append-only Journal。本阶段不接 Cron、Query、Action 或派生记忆实体化。
2. ingress 稳定后，Ultreia 新建独立 Reporter，只实现
   `training_state_change / repeated_plan_deviation`：复用确定性计划匹配，发送
   14 个完整自然日的最小聚合，不带训练明细、健康字段、备注或身份信息，
   不调用 LLM。
3. 用 shadow mode 验证签名、policy、去重、重试、duplicate receipt 和失败
   回滚。只允许写 Ultreia 投递状态及 Aevum Report / Journal 控制面，不执行
   产品数据写入。
4. shadow 数据稳定后再实体化 working / short / long 派生记忆并启用生命周期；
   窄范围 Query 可独立推进，但不阻塞主动 Report。
5. 自动 `guarded` Calendar Action 继续后置；启用前先用事务型 RPC 或等价的
   乐观并发约束关闭客户端预检后的 TOCTOU 窗口。
6. 不增加新 Agent 类型，不继续扩张设置页或解释型矩阵 UI。
