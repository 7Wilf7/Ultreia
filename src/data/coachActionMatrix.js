export const COACH_ACTION_MATRIX = [
  {
    id: "plan_deviation_rescue",
    phase: "Phase 6",
    rank: 1,
    status: "observing",
    title: {
      en: "Plan deviation adjustment",
      zh: "计划偏差调整",
    },
    trigger: {
      en: "Missed or partially completed planned sessions in the last 7-14 days.",
      zh: "最近 7-14 天出现漏练或部分完成的计划。",
    },
    suggestion: {
      en: "Prepare a short adjustment for the next 3-7 days, such as moving work, lowering load, or adding rest.",
      zh: "整理接下来 3-7 天的调整建议，例如挪训练、降负荷或补恢复日。",
    },
    boundary: {
      en: "Already live in first version. It does not auto-make up missed mileage or change the calendar without review.",
      zh: "第一版已上线观察；不会自动补跑，也不会在确认前改日历。",
    },
  },
  {
    id: "recovery_load_guard",
    phase: "Phase 6",
    rank: 2,
    status: "observing",
    title: {
      en: "Recovery and load guard",
      zh: "恢复风险 / 负荷守门",
    },
    trigger: {
      en: "ACWR high or danger, high RPE, poor readiness, or pain/fatigue notes.",
      zh: "ACWR high / danger、RPE 偏高、晨间状态差，或备注出现疼痛 / 疲劳。",
    },
    suggestion: {
      en: "Suggest a recovery day, lower intensity, or avoid stacking hard sessions.",
      zh: "建议恢复日、降强度，或避免继续叠加强度课。",
    },
    boundary: {
      en: "Live in first version. Training guidance only, not diagnosis. Any plan change still requires confirmation.",
      zh: "第一版已上线观察；只做训练安排建议，不做诊断；所有计划修改仍需确认。",
    },
  },
  {
    id: "weather_plan_adjustment",
    phase: "Phase 6",
    rank: 3,
    status: "planned",
    title: {
      en: "Weather-driven plan adjustment",
      zh: "天气驱动计划调整",
    },
    trigger: {
      en: "Upcoming long runs or quality sessions meet heat, humidity, strong wind, pollution, or heavy rain.",
      zh: "未来长距离或强度课遇到高温高湿、强风、污染或大雨。",
    },
    suggestion: {
      en: "Suggest a better date/time window, or keep the date but lower the target.",
      zh: "建议换到更合适的日期 / 时段，或保留日期但降低目标。",
    },
    boundary: {
      en: "Only future plans are considered. Completed workouts are never changed.",
      zh: "只调整未来计划，不影响已经完成的训练。",
    },
  },
  {
    id: "data_quality_completion",
    phase: "Phase 6",
    rank: 4,
    status: "planned",
    title: {
      en: "Data quality completion",
      zh: "数据质量补全助手",
    },
    trigger: {
      en: "Recent workouts miss RPE, notes, accurate type, or available weather snapshots.",
      zh: "最近训练缺 RPE、备注、准确类型，或有可补的天气快照。",
    },
    suggestion: {
      en: "Start as a lightweight checklist; later expand low-risk items into reviewable cards.",
      zh: "先做轻量 checklist；后续再把低风险项扩成可确认卡片。",
    },
    boundary: {
      en: "No database write happens before review. The flow should stay lightweight.",
      zh: "写入前必须确认，不为了补全数据制造复杂流程。",
    },
  },
  {
    id: "race_briefing_checklist",
    phase: "Phase 6",
    rank: 5,
    status: "planned",
    title: {
      en: "Race briefing and gear checklist",
      zh: "赛前简报 / 装备检查",
    },
    trigger: {
      en: "An A-race enters the 14-day window and race location or weather context is available.",
      zh: "A 级目标赛进入 14 天窗口，且地点或天气上下文可用。",
    },
    suggestion: {
      en: "Generate a race briefing and checklist; only suggest plan changes when needed.",
      zh: "生成赛前 briefing 和 checklist；必要时再提出计划调整。",
    },
    boundary: {
      en: "First version is report/checklist only, without automatic training changes.",
      zh: "第一版只做报告 / checklist，不自动修改训练。",
    },
  },
];
