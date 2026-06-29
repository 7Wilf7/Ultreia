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
      en: "Repeated missed or partial planned sessions in the last 7-14 days, or a missed key session.",
      zh: "最近 7-14 天出现连续漏练 / 部分完成，或主课偏差。",
    },
    suggestion: {
      en: "Prepare a short adjustment for the next 3-7 days, such as moving work, lowering load, or adding rest.",
      zh: "整理接下来 3-7 天的调整建议，例如挪训练、降负荷或补恢复日。",
    },
    boundary: {
      en: "Already live in first version. One ordinary missed session does not auto-trigger it; repeated skips make similar suggestions quieter.",
      zh: "第一版已上线观察；一次普通漏练不会自动触发，连续跳过同类建议后会更安静。",
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
      en: "Clear recovery or load risk: ACWR high/danger, stacked signals, hard future sessions, or strong pain/fatigue/readiness evidence.",
      zh: "明确恢复 / 负荷风险：ACWR high / danger、多信号叠加、未来硬课，或疼痛 / 疲劳 / 晨间状态证据较强。",
    },
    suggestion: {
      en: "Suggest a recovery day, lower intensity, or avoid stacking hard sessions.",
      zh: "建议恢复日、降强度，或避免继续叠加强度课。",
    },
    boundary: {
      en: "Live in first version. Mild watch signals do not auto-trigger. Training guidance only, not diagnosis. Any plan change still requires confirmation.",
      zh: "第一版已上线观察；轻微信号不自动触发。只做训练安排建议，不做诊断；所有计划修改仍需确认。",
    },
  },
  {
    id: "race_briefing_checklist",
    phase: "Phase 6",
    rank: 3,
    status: "observing",
    title: {
      en: "Race briefing and gear checklist",
      zh: "赛前简报 / 装备检查",
    },
    trigger: {
      en: "A target race enters the 14-day window and race location or weather context is available.",
      zh: "目标赛进入 14 天窗口，且地点或天气上下文可用。",
    },
    suggestion: {
      en: "Generate a race briefing and checklist; only suggest plan changes when needed.",
      zh: "生成赛前 briefing 和 checklist；必要时再提出计划调整。",
    },
    boundary: {
      en: "Live in first version. It is report/checklist only and does not automatically change training.",
      zh: "第一版已上线观察；只做报告 / checklist，不自动修改训练。",
    },
  },
  {
    id: "weather_plan_adjustment",
    phase: "Phase 6",
    rank: 4,
    status: "deferred",
    title: {
      en: "Weather-driven plan adjustment",
      zh: "天气驱动计划调整（暂缓）",
    },
    trigger: {
      en: "Upcoming long runs or quality sessions meet severe weather. Deferred because forecasts can be too noisy for changing training plans.",
      zh: "未来长距离或强度课遇到极端天气。因天气预报误差较大，暂不作为改计划触发条件。",
    },
    suggestion: {
      en: "Keep it as a reminder or race-day checklist signal before considering any calendar change.",
      zh: "先只作为提醒或赛前 checklist 信号，不优先生成改日历建议。",
    },
    boundary: {
      en: "Do not disrupt the original plan based on ordinary forecasts. Only very high-confidence severe weather should be escalated later.",
      zh: "不因普通预报打乱原计划；后续只考虑高置信度的极端天气提醒。",
    },
  },
];
