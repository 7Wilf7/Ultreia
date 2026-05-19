export const STORAGE_KEY = "wilf_training_studio_v1";

// DeepSeek's Anthropic-compatible endpoint — fixed (no longer user-configurable).
// We standardized on DeepSeek for cost/access; the URL stays hidden from the UI.
export const DEFAULT_API_ENDPOINT = "https://api.deepseek.com/anthropic/v1/messages";
export const DEEPSEEK_SIGNUP_URL = "https://platform.deepseek.com/";

// Default model and supported presets — DeepSeek only.
export const DEFAULT_MODEL = "deepseek-v4-pro";
export const MODEL_PRESETS = [
  "deepseek-v4-pro",      // higher quality, reasoning-heavy
  "deepseek-v4-flash",    // faster + cheaper
];

export const TABS = ["Training", "Races", "PR", "AI Coach"];

// Activity types (stored in log.type)
export const ACTIVITY_TYPES = ["Road Run", "Trail Run", "Hiking", "Floor Climbing", "Strength", "HIIT"];

// Types that aggregate into the Run filter group (kept here so it's the single source of truth)
export const RUN_GROUP_TYPES = ["Road Run", "Trail Run", "Hiking", "Floor Climbing"];

// Running sub-types — split into two groups:
//   PACE: heart-rate-based classification (single-select per activity)
//   FLAG: independent flags that can co-exist with a pace type (e.g. Race)
export const RUN_PACE_TYPES = ["Easy Run", "Aerobic Run", "Tempo Run", "Interval Run"];
export const RUN_FLAGS = ["Race"];
export const RUN_SUBTYPES = [...RUN_PACE_TYPES, ...RUN_FLAGS]; // full list, used by CSV upload review dropdown

// Strength sub-types (formerly "Aerobic" — migrated)
export const STRENGTH_SUBS = ["Upper Body", "Lower Body", "Core"];

// Color tag per top-level type — palette matches the moss/stone/earth theme.
// All saturated low; uses var()-equivalent hex so styles.tag() still works inline.
export const TYPE_COLOR = {
  "Road Run":        "#141413",   /* ink-1: default black, road-running is "baseline" */
  "Trail Run":  "#4a5e3a",   /* moss: green for trail */
  "Hiking":         "#7a8d6a",   /* moss-light: lighter green */
  "Floor Climbing": "#8b6a3e",   /* earth: stair / indoor climb */
  "Strength":       "#57564f",   /* ink-2: stone gray */
  "HIIT":           "#b54e1a",   /* burnt orange: alert/intensity */
};

// Global-filter parent → child mapping (used by GlobalFilter UI + filter logic).
// `section` groups children visually inside the dropdown — children with the same
// section render under one divider/header. No section = main list.
export const FILTER_GROUPS = {
  run: {
    label: "Run",
    children: [
      { id: "Road Run", label: "Road Run" },
      { id: "Trail Run", label: "Trail Run" },
      { id: "Hiking", label: "Hiking", section: "other" },
      { id: "Floor Climbing", label: "Floor Climbing", section: "other" },
    ],
  },
  strength: {
    label: "Strength",
    children: [
      { id: "Upper Body", label: "Upper Body" },
      { id: "Lower Body", label: "Lower Body" },
      { id: "Core", label: "Core" },
    ],
  },
  hiit: {
    label: "HIIT",
    children: [], // no sub-types, plain toggle
  },
};

export const SORT_OPTIONS = [
  { id: "date_desc", label: "Date ↓" },
  { id: "date_asc", label: "Date ↑" },
  { id: "distance_desc", label: "Distance ↓" },
  { id: "distance_asc", label: "Distance ↑" },
  { id: "duration_desc", label: "Duration ↓" },
  { id: "duration_asc", label: "Duration ↑" },
  { id: "hr_desc", label: "HR ↓" },
  { id: "hr_asc", label: "HR ↑" },
];

export const RACE_PRIORITY = ["A", "B", "C"];

// Race categories — used for PR auto-aggregation and as a list-view tag
export const RACE_CATEGORIES = [
  "Half Marathon",
  "Marathon",
  "10K",
  "Trail",
  "Spartan",
  "Hyrox",
  "Other",
];

// Color per race category — muted, parchment / stone tints. Used as tag bg.
export const RACE_CATEGORY_COLOR = {
  "Half Marathon": "#e1dccc",   /* warm stone */
  "Marathon":      "#d6cfb8",   /* darker stone */
  "10K":           "#e0e4d5",   /* moss-bg */
  "Trail":         "#cdc4ad",   /* parchment-deep */
  "Spartan":       "#e8d4ce",   /* faded brick */
  "Hyrox":         "#ecdec0",   /* faded amber */
  "Other":         "#e1dfd6",   /* rule-soft */
};

// Fixed system prompt — not user-editable. Keep it short and principled.
// User-specific behavior shaping happens via Profile + Coach Config blocks
// (assembled in utils/profile.js) appended after this.
//
// English is the canonical version sent to the LLM (more stable instruction-following);
// Chinese version is for the in-app preview readability only.
export const FIXED_SYSTEM_PROMPT = `You are a suggestion-based AI endurance running coach.

Your role:
- Suggest training options. Do not issue commands.
- Interpret training data factually.
- Identify risk trends; flag them briefly (1–3 sentences).
- Propose alternatives. The user has final authority on every decision.

Tone:
- Data-driven, concise, direct.
- No parental or authoritarian language.
- Avoid "must", "you have to", "red line", "禁止", "必须".
- Don't lecture, don't repeat criticism, don't moralize about deviation from a plan.

Reply in the user's language (Chinese if the user writes in Chinese, English otherwise).`;

export const FIXED_SYSTEM_PROMPT_ZH = `你是一位以建议为导向的 AI 耐力跑教练。

你的角色：
- 提出训练选项，不下命令。
- 客观解读训练数据。
- 识别风险趋势，简短提示（1–3 句话）。
- 提供替代方案。最终决定权始终在用户手中。

语气：
- 数据驱动、简洁、直接。
- 不使用家长式或权威式语言。
- 避免使用"必须"、"你得"、"红线"、"禁止"等措辞。
- 不说教，不反复批评，不在用户偏离计划时进行道德评判。

用用户的语言回复（中文输入回中文，英文输入回英文）。`;

// Legacy: kept for backward-compat with old localStorage data, no longer shown to user
export const DEFAULT_SYSTEM_PROMPT = FIXED_SYSTEM_PROMPT;

// ===== Personal Profile =====
export const DEFAULT_PROFILE = {
  displayName: "",        // shown in page title; required at first-run setup
  birthDate: "",          // YYYY-MM-DD; age is computed from this
  gender: "",
  city: "",
  occupation: "",
  occupationOther: "",    // free-text when occupation === "other"
  experience: "",         // years of running training
  raceTypes: [],          // multi-select
  recentInjuries: [],     // multi-select; only injuries in the last 6 months
  injuriesNote: "",       // free-text — older history, severity notes, etc.
  equipment: [],          // multi-select
  equipmentOther: "",     // free-text additional equipment
  restingHR: "",          // bpm; optional — feeds HR-zone calc
  maxHR: "",              // bpm; optional — feeds HR-zone calc
  hrZoneMethod: "karvonen-strict", // which 5-zone split to use; see HR_ZONE_METHODS
  notes: "",              // free-form extra context
};

export const PROFILE_REQUIRED_FIELDS = ["displayName", "birthDate", "gender", "city", "experience"];

// Two common ways to split HRR into 5 zones. Both apply on top of the Karvonen
// formula: target HR = (MaxHR − RestHR) × intensity% + RestHR.
//   - karvonen-strict: tighter Z3/Z4 band, traditional Karvonen literature
//   - standard-5z:     even 10% bands, most consumer apps default
export const HR_ZONE_METHODS = [
  {
    id: "karvonen-strict",
    label: "Karvonen (严格分法)",
    note: "Z1 50–59 · Z2 59–74 · Z3 74–84 · Z4 84–88 · Z5 88–100 %HRR",
    zones: [
      { id: "Z1", low: 0.50, high: 0.59 },
      { id: "Z2", low: 0.59, high: 0.74 },
      { id: "Z3", low: 0.74, high: 0.84 },
      { id: "Z4", low: 0.84, high: 0.88 },
      { id: "Z5", low: 0.88, high: 1.00 },
    ],
  },
  {
    id: "standard-5z",
    label: "Standard 5-Zone (通用 5 区)",
    note: "Z1 50–60 · Z2 60–70 · Z3 70–80 · Z4 80–90 · Z5 90–100 %HRR",
    zones: [
      { id: "Z1", low: 0.50, high: 0.60 },
      { id: "Z2", low: 0.60, high: 0.70 },
      { id: "Z3", low: 0.70, high: 0.80 },
      { id: "Z4", low: 0.80, high: 0.90 },
      { id: "Z5", low: 0.90, high: 1.00 },
    ],
  },
];

// ===== UI language =====
export const DEFAULT_LANG = "en";

export const GENDERS = [
  { id: "male", label: "Male" },
  { id: "female", label: "Female" },
  { id: "other", label: "Other / Prefer not to say" },
];
export const OCCUPATIONS = [
  { id: "office", label: "Office / Sedentary" },
  { id: "high-cognitive", label: "High cognitive load" },
  { id: "physical", label: "Physical labor" },
  { id: "shift", label: "Shift work" },
  { id: "freelance", label: "Freelance" },
  { id: "student", label: "Student" },
  { id: "other", label: "Other" },
];

// Pure years-of-experience (orthogonal to event types — race types are separately captured)
export const RUN_EXPERIENCE = [
  { id: "<1y",   label: "< 1 year" },
  { id: "1-3y",  label: "1–3 years" },
  { id: "3-5y",  label: "3–5 years" },
  { id: "5-10y", label: "5–10 years" },
  { id: "10+y",  label: "10+ years" },
];

export const RACE_TYPES_DONE = [
  { id: "road", label: "Road races" },
  { id: "trail", label: "Trail / Ultra" },
  { id: "spartan", label: "Spartan / OCR" },
  { id: "hyrox", label: "Hyrox" },
  { id: "triathlon", label: "Triathlon" },
  { id: "none", label: "No race experience yet" },
];

export const INJURY_HISTORY = [
  { id: "itband", label: "IT Band" },
  { id: "knee", label: "Knee" },
  { id: "achilles", label: "Achilles" },
  { id: "plantar", label: "Plantar fasciitis" },
  { id: "back", label: "Lower back" },
  { id: "ankle", label: "Ankle" },
  { id: "hip", label: "Hip / Glute" },
  { id: "shin", label: "Shin splints" },
  { id: "none", label: "No recent injury" },
];

export const EQUIPMENT_AVAILABLE = [
  { id: "gym", label: "Full gym" },
  { id: "treadmill", label: "Treadmill" },
  { id: "dumbbells", label: "Dumbbells" },
  { id: "kettlebell", label: "Kettlebell" },
  { id: "pullupbar", label: "Pull-up bar" },
  { id: "bands", label: "Resistance bands" },
  { id: "none", label: "No equipment" },
];

// ===== Coach Config =====
// Three options per axis representing a soft → strict spectrum.
export const DEFAULT_COACH_CONFIG = {
  style: "balanced",
  outputLength: "standard",
  intervention: "standard",
};

export const COACH_STYLES = [
  { id: "soft",       label: "Soft & encouraging 温和鼓励" },
  { id: "balanced",   label: "Balanced & rational 平衡理性" },
  { id: "analytical", label: "Strict & data-driven 严格数据" },
];
export const OUTPUT_LENGTHS = [
  { id: "minimal",  label: "Minimal 极简" },
  { id: "standard", label: "Standard 标准" },
  { id: "detailed", label: "Detailed 详细" },
];
export const INTERVENTION_LEVELS = [
  { id: "light",    label: "Light 轻提醒" },
  { id: "standard", label: "Standard 标准" },
  { id: "strict",   label: "Strict 严格监督" },
];

export const DEFAULT_DAILY_TEMPLATE = `Today's check-in:
- How I feel: [fresh / tired / sore / motivated]
- Yesterday: [what you did, or "rest"]
- Available time today: [e.g. 60 min]

What should I do today?`;
