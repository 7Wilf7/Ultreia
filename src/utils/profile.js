import {
  FIXED_SYSTEM_PROMPT, FIXED_SYSTEM_PROMPT_ZH, PROFILE_REQUIRED_FIELDS,
  GENDERS, OCCUPATIONS, RUN_EXPERIENCE, RACE_TYPES_DONE,
  INJURY_HISTORY, EQUIPMENT_AVAILABLE,
  COACH_STYLES, OUTPUT_LENGTHS, INTERVENTION_LEVELS,
  TRAINING_PREFERENCE_OPTIONS,
  HR_ZONE_METHODS,
} from "../constants";

const TRAINING_PREFERENCE_DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const TRAINING_PREFERENCE_SLOTS = ["am", "pm"];

export function calculateAge(birthDate, today = new Date()) {
  if (!birthDate) return null;
  const d = new Date(birthDate);
  if (isNaN(d.getTime())) return null;
  let age = today.getFullYear() - d.getFullYear();
  const m = today.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < d.getDate())) age--;
  return age >= 0 && age < 150 ? age : null;
}

export function isProfileComplete(profile) {
  if (!profile) return false;
  return PROFILE_REQUIRED_FIELDS.every(f => {
    const v = profile[f];
    return Array.isArray(v) ? v.length > 0 : !!v;
  });
}

function labelFor(opts, id) {
  return opts.find(o => o.id === id)?.label || id;
}

function labelsFor(opts, ids) {
  return (ids || []).map(id => opts.find(o => o.id === id)?.label || id);
}

/**
 * Karvonen-formula zone calculation.
 * Returns null if either HR value is missing or the math doesn't make sense
 * (e.g. resting >= max). Otherwise returns an array of { id, low, high } in bpm.
 */
export function computeHRZones(restingHR, maxHR, methodId) {
  const rest = parseInt(restingHR);
  const max = parseInt(maxHR);
  if (!rest || !max || rest >= max) return null;
  const method = HR_ZONE_METHODS.find(m => m.id === methodId) || HR_ZONE_METHODS[0];
  const hrr = max - rest;
  return method.zones.map(z => ({
    id: z.id,
    low: Math.round(hrr * z.low + rest),
    high: Math.round(hrr * z.high + rest),
  }));
}

// Per-language label dictionary used when assembling the system prompt blocks.
// The CANONICAL prompt sent to the LLM uses the English ("en") labels — these
// are stable across model versions. The Chinese set is for the in-app preview
// only, so a Chinese user can read what their coach is being told.
const L = {
  en: {
    profileTitle: "[User Profile]",
    age: "Age",
    gender: "Gender",
    dayJob: "Day job",
    otherPrefix: "Other —",
    yearsTraining: "Years of running training",
    raceTypesDone: "Race types done",
    recentInjuries: "Recent injuries (last 6 months)",
    injuryNotes: "Injury notes (older history / context, do not over-weight)",
    availableEquip: "Available equipment",
    otherEquip: "Other equipment",
    restHR: "Resting HR",
    maxHR: "Max HR",
    hrZonesHead: (m) => `HR zones (${m}, Karvonen formula on HRR = MaxHR − RestHR):`,
    hrZonesNote: (m) => `When suggesting intensity, reference these zones by ID (e.g. "Z2 base run") and bpm range. Use the user's selected ${m} split — do not re-derive zones from age formulas.`,
    hrPartial: (rest, max) => `HR data partially filled (Resting=${rest || "—"}, Max=${max || "—"}). Skip zone-based recommendations until both are set.`,
    extraNotes: "Extra notes",

    coachTitle: "[Coach Config]",
    style: "Style",
    outputLen: "Output length",
    riskReminders: "Risk reminders",
    trainingPrefTitle: "[Weekly Training Preferences]",
    trainingPrefHint: "Use these as default planning anchors when the user gives no newer conflict. They are not hard constraints; if the user says they are unavailable, or recovery/race/weather context requires a change, adjust and explain why.",
    trainingPrefDays: {
      0: "Sunday",
      1: "Monday",
      2: "Tuesday",
      3: "Wednesday",
      4: "Thursday",
      5: "Friday",
      6: "Saturday",
    },
    trainingPrefSlots: { am: "AM", pm: "PM" },

    memoryTitle: "[Long-term Memory]",
    memoryHint: "Durable facts about this user accumulated over time. Treat these as ground truth unless the user corrects them.",
  },
  zh: {
    profileTitle: "[用户资料]",
    age: "年龄",
    gender: "性别",
    dayJob: "日常工作",
    otherPrefix: "其他 ——",
    yearsTraining: "跑步训练年限",
    raceTypesDone: "已完成的比赛类型",
    recentInjuries: "近期伤病（过去 6 个月）",
    injuryNotes: "伤病备注（更早的病史 / 背景，不要过度参考）",
    availableEquip: "可用器材",
    otherEquip: "其他器材",
    restHR: "静息心率",
    maxHR: "最大心率",
    hrZonesHead: (m) => `心率区间（${m}，Karvonen 公式基于 HRR = MaxHR − RestHR）：`,
    hrZonesNote: (m) => `建议训练强度时，请用区间 ID（例如「Z2 基础跑」）和 bpm 范围引用。沿用用户选择的 ${m} 划分，不要用基于年龄的公式重新推导。`,
    hrPartial: (rest, max) => `心率信息只填了一半（静息=${rest || "—"}，最大=${max || "—"}）。两者都填好之前不要给基于区间的建议。`,
    extraNotes: "其他备注",

    coachTitle: "[教练配置]",
    style: "风格",
    outputLen: "输出长度",
    riskReminders: "风险提醒",
    trainingPrefTitle: "[每周训练偏好]",
    trainingPrefHint: "没有新的冲突信息时，把这些作为默认排课锚点；这不是硬约束。用户说某天不方便，或恢复 / 比赛 / 天气上下文要求调整时，可以改动并说明原因。",
    trainingPrefDays: {
      0: "周日",
      1: "周一",
      2: "周二",
      3: "周三",
      4: "周四",
      5: "周五",
      6: "周六",
    },
    trainingPrefSlots: { am: "上午", pm: "下午" },

    memoryTitle: "[长期记忆]",
    memoryHint: "在多次对话中积累的、关于用户的稳定事实。视为基础真相，除非用户主动更正。",
  },
};

function trainingPreferenceLines(trainingPreferences, L_) {
  const template = trainingPreferences?.weeklyTemplate && typeof trainingPreferences.weeklyTemplate === "object"
    ? trainingPreferences.weeklyTemplate
    : {};
  const lines = [];
  for (const day of TRAINING_PREFERENCE_DAY_ORDER) {
    const dayPrefs = template[String(day)] || template[day] || {};
    for (const slot of TRAINING_PREFERENCE_SLOTS) {
      const text = String(dayPrefs?.[slot] || "").trim();
      if (text) lines.push(`${L_.trainingPrefDays[day]} ${L_.trainingPrefSlots[slot]}: ${labelFor(TRAINING_PREFERENCE_OPTIONS, text)}`);
    }
  }
  return lines;
}

/**
 * Profile block — short, structured, NOT a wall of text.
 * `lang` selects label language ('en' = canonical LLM-facing, 'zh' = preview-only).
 */
export function profileBlock(profile, lang = "en") {
  if (!profile) return "";
  const L_ = L[lang] || L.en;
  const lines = [];
  const age = calculateAge(profile.birthDate);
  if (age != null) lines.push(`${L_.age}: ${age}`);
  if (profile.gender) lines.push(`${L_.gender}: ${labelFor(GENDERS, profile.gender)}`);
  if (profile.occupation) {
    const occLabel = profile.occupation === "other" && profile.occupationOther
      ? `${L_.otherPrefix} ${profile.occupationOther.trim()}`
      : labelFor(OCCUPATIONS, profile.occupation);
    lines.push(`${L_.dayJob}: ${occLabel}`);
  }
  if (profile.experience) lines.push(`${L_.yearsTraining}: ${labelFor(RUN_EXPERIENCE, profile.experience)}`);
  const raceTypes = labelsFor(RACE_TYPES_DONE, profile.raceTypes);
  if (raceTypes.length) lines.push(`${L_.raceTypesDone}: ${raceTypes.join(", ")}`);
  const recent = labelsFor(INJURY_HISTORY, profile.recentInjuries);
  if (recent.length) lines.push(`${L_.recentInjuries}: ${recent.join(", ")}`);
  if (profile.injuriesNote && profile.injuriesNote.trim()) {
    lines.push(`${L_.injuryNotes}: ${profile.injuriesNote.trim()}`);
  }
  const equip = labelsFor(EQUIPMENT_AVAILABLE, profile.equipment);
  if (equip.length) lines.push(`${L_.availableEquip}: ${equip.join(", ")}`);
  if (profile.equipmentOther && profile.equipmentOther.trim()) {
    lines.push(`${L_.otherEquip}: ${profile.equipmentOther.trim()}`);
  }

  // Heart rate + Karvonen-derived zones
  const zones = computeHRZones(profile.restingHR, profile.maxHR, profile.hrZoneMethod);
  if (zones) {
    const method = HR_ZONE_METHODS.find(m => m.id === profile.hrZoneMethod) || HR_ZONE_METHODS[0];
    lines.push(`${L_.restHR}: ${profile.restingHR} bpm · ${L_.maxHR}: ${profile.maxHR} bpm`);
    lines.push(L_.hrZonesHead(method.label));
    zones.forEach(z => lines.push(`  ${z.id}: ${z.low}–${z.high} bpm`));
    lines.push(L_.hrZonesNote(method.label));
  } else if (profile.restingHR || profile.maxHR) {
    lines.push(L_.hrPartial(profile.restingHR, profile.maxHR));
  }

  if (profile.notes && profile.notes.trim()) lines.push(`${L_.extraNotes}: ${profile.notes.trim()}`);
  if (!lines.length) return "";
  return `${L_.profileTitle}\n${lines.join("\n")}`;
}

export function coachConfigBlock(cfg, lang = "en") {
  if (!cfg) return "";
  const L_ = L[lang] || L.en;
  const styleLabel = labelFor(COACH_STYLES, cfg.style);
  const lengthLabel = labelFor(OUTPUT_LENGTHS, cfg.outputLength);
  const interventionLabel = labelFor(INTERVENTION_LEVELS, cfg.intervention);
  const lines = [
    L_.coachTitle,
    `${L_.style}: ${styleLabel}`,
    `${L_.outputLen}: ${lengthLabel}`,
    `${L_.riskReminders}: ${interventionLabel}`,
  ];
  const prefLines = trainingPreferenceLines(cfg.trainingPreferences, L_);
  if (prefLines.length) {
    lines.push("", L_.trainingPrefTitle, L_.trainingPrefHint, ...prefLines);
  }
  return lines.join("\n");
}

export function coachPreferenceContextBlock(coachConfig, lang = "en") {
  return coachConfigBlock(coachConfig, lang);
}

/**
 * Assemble the full system prompt. `lang` controls the language of the static
 * scaffold (labels + fixed instructions). The dynamic `dataBlock` is built by
 * the caller and passed in as-is. Long-term memory now lives in the structured
 * Memory facts section inside `dataBlock`; legacy free-text memory is ignored.
 */
export function buildSystemPrompt({ profile, coachConfig, dataBlock, lang = "en" }) {
  const fixed = lang === "zh" ? FIXED_SYSTEM_PROMPT_ZH : FIXED_SYSTEM_PROMPT;
  return [
    fixed,
    profileBlock(profile, lang),
    coachConfigBlock(coachConfig, lang),
    dataBlock || "",
  ].filter(Boolean).join("\n\n");
}
