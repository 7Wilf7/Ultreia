// Provider catalog — each entry covers everything the chat client needs:
// the active endpoint URL, alternative endpoints (Claude has region-routed
// mirrors), recommended model presets (the user can OVERRIDE these with any
// custom model name), and the signup URL for new users without a key.
//
// `endpoints` is a list — the first entry is the default. Selection is per-
// device (localStorage), not per-account, so a phone on 4G can pick a
// different mirror than a desktop on home wifi.
//
// `models` is RECOMMENDED only — the UI always offers a free-text input so
// the user can paste any custom model ID without waiting for a code change.
export const API_PROVIDERS = {
  deepseek: {
    id: "deepseek",
    label: "DeepSeek",
    isThirdParty: false,
    consoleUrl: "https://platform.deepseek.com/",
    signupUrl: "https://platform.deepseek.com/",
    endpoints: [
      { id: "default", label: "默认线路", url: "https://api.deepseek.com/anthropic/v1/messages" },
    ],
    // Locked to the top model per provider. No UI to change. When a vendor
    // ships a new flagship, bump this here — single source of truth.
    defaultModel: "deepseek-v4-pro",
    // USD per 1 million tokens. Drives the cost-comparison line in the API
    // settings dialog and the Guide.
    pricing: { inputPerM: 0.435, outputPerM: 0.87 },
  },
  claude: {
    id: "claude",
    // The "Claude" surface in this app talks to a THIRD-PARTY relay at
    // claudeapi.com — not Anthropic directly. The label and console URL
    // reflect that so the user doesn't confuse it with an official Anthropic
    // account.
    label: "Claude API (第三方)",
    isThirdParty: true,
    consoleUrl: "https://console.claudeapi.com/",
    signupUrl: "https://console.claudeapi.com/",
    endpoints: [
      // Path is /v1/messages — the Anthropic-compatible standard. The relay
      // docs page sometimes shows it as "/messages" but the actual route is
      // /v1/messages, same as the official Anthropic API and DeepSeek's
      // compat surface.
      { id: "default", label: "默认线路",  url: "https://gw.claudeapi.com/v1/messages" },
      { id: "hk",      label: "香港线路",  url: "https://hk.claudeapi.com/v1/messages" },
      { id: "jp",      label: "日本线路",  url: "https://jp.claudeapi.com/v1/messages" },
      { id: "sg",      label: "新加坡线路", url: "https://sg.claudeapi.com/v1/messages" },
    ],
    defaultModel: "claude-opus-4-7",
    pricing: { inputPerM: 4, outputPerM: 20 },
  },
};

// Typical AI Coach turn (rough — used only for the relative-cost example):
//   - system prompt + profile + recent workouts + races + memory ≈ 3000 input tokens
//   - one assistant reply ≈ 800 output tokens
export const TYPICAL_INPUT_TOKENS = 3000;
export const TYPICAL_OUTPUT_TOKENS = 800;

// Per-message cost estimate for a provider, in USD. Returns
// { input, output, total }. Null if the provider has no pricing data.
export function estimateMessageCost(providerId) {
  const p = API_PROVIDERS[providerId];
  if (!p || !p.pricing) return null;
  const input  = (TYPICAL_INPUT_TOKENS  / 1_000_000) * p.pricing.inputPerM;
  const output = (TYPICAL_OUTPUT_TOKENS / 1_000_000) * p.pricing.outputPerM;
  return { input, output, total: input + output };
}

export const DEFAULT_API_PROVIDER = "deepseek";

// Resolve the endpoint URL to use for a given provider. `endpointId` comes
// from localStorage (per-device pick); falls back to the first entry when
// the saved id no longer matches a known endpoint.
export function getEndpointUrl(providerId, endpointId) {
  const p = API_PROVIDERS[providerId] || API_PROVIDERS[DEFAULT_API_PROVIDER];
  const match = p.endpoints.find(e => e.id === endpointId);
  return (match || p.endpoints[0]).url;
}

// Legacy exports kept for any imports that still reference them — sourced
// from the DeepSeek entry so behavior is unchanged for callers that haven't
// migrated to the provider-aware shape yet.
export const DEFAULT_API_ENDPOINT = API_PROVIDERS.deepseek.endpoints[0].url;
export const DEEPSEEK_SIGNUP_URL = API_PROVIDERS.deepseek.signupUrl;
export const DEFAULT_MODEL = API_PROVIDERS.deepseek.defaultModel;

// Top-level tabs. PR is absorbed into Races (PersonalRecordsBar sits at the
// top of the Races view). Calendar is a peer tab — its own month grid +
// click-to-edit panel — not nested under Training anymore.
export const TABS = ["Training", "Calendar", "Races", "AI Coach"];

// Activity types (stored in log.type). Recovery removed — active recovery is
// a day-level tag in the daily_notes table now, not a workout row.
export const ACTIVITY_TYPES = ["Road Run", "Trail Run", "Hiking", "Floor Climbing", "Strength", "HIIT"];

// Types that aggregate into the Run filter group (kept here so it's the single source of truth)
export const RUN_GROUP_TYPES = ["Road Run", "Trail Run", "Hiking", "Floor Climbing"];

// Types where weather actually matters — outdoor sessions where temp /
// humidity / AQI influence pace / HR / hydration. Indoor types (Strength
// gym workouts, Floor Climbing on a stair machine) get no weather chip;
// weather data still gets captured if you happen to be outside, but we
// don't surface it in the UI for those types.
export const WEATHER_RELEVANT_TYPES = ["Road Run", "Trail Run", "Hiking", "HIIT"];

// Day-level tags stored in daily_notes.tags[]. Surfaced on Calendar day
// cells and toggled via the day modal. Currently a single value ("massage")
// but kept as an array for future expansion without another schema change.
export const DAILY_TAGS = ["massage"];

// Running sub-types — split into two groups:
//   PACE: heart-rate-based classification (single-select per activity)
//   FLAG: independent flags that can co-exist with a pace type (e.g. Race)
export const RUN_PACE_TYPES = ["Easy Run", "Aerobic Run", "Tempo Run", "Interval Run"];
export const RUN_FLAGS = ["Race"];
export const RUN_SUBTYPES = [...RUN_PACE_TYPES, ...RUN_FLAGS]; // full list, used by CSV upload review dropdown

// Strength sub-types (formerly "Aerobic" — migrated)
export const STRENGTH_SUBS = ["Upper Body", "Lower Body", "Core"];

// Color tag per top-level type — low-sat earthy palette but spread across
// distinct hues so any two are clearly distinguishable on tags / chips /
// chart bars. Six hues: ink / moss / ochre / plum / slate / burnt-orange.
export const TYPE_COLOR = {
  "Road Run":        "#141413",   /* ink-1 black — baseline, most common */
  "Trail Run":       "#4a5e3a",   /* moss green */
  "Hiking":          "#b07a3e",   /* ochre / warm clay — split from Trail */
  "Floor Climbing":  "#5d4a78",   /* muted plum — split from Hiking ochre */
  "Strength":        "#3a5566",   /* slate blue — split from black */
  "HIIT":            "#b54e1a",   /* burnt orange — alert/intensity */
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

// Spartan event distance/difficulty tiers — Sprint shortest/easiest, Ultra
// longest/hardest. PR view ranks by this order (Ultra > Beast > Super > Sprint).
export const SPARTAN_SUBTYPES = ["Sprint", "Super", "Beast", "Ultra"];

// Race categories — used for PR auto-aggregation and as a list-view tag.
// Order matters: PR bar + form dropdowns iterate this array, so this is the
// canonical display order (10K shortest road → progressively bigger / more
// specialized, "Other" last as the catch-all).
export const RACE_CATEGORIES = [
  "10K",
  "Half Marathon",
  "Marathon",
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

Data sources (READ THIS BEFORE ANSWERING):
- The [Recent Activities] block below IS your full view of the user's recent training. It is fed live from the app's database each turn. Treat it as authoritative.
- DO NOT claim "I cannot access your latest data", "the system hasn't synced", or "I only see up to date X" without actually scanning the block first. Read the dates listed — that is your ground truth.
- The user can add a workout and immediately ask you about it. If they say "I just finished a run" and the top entry in [Recent Activities] is dated today, that IS the run they mean. Reference its specific numbers (distance, duration, HR) when responding.
- [Current Date] is the wall-clock now. Compare it against the top entry's date to judge freshness. "Today" means [Current Date]'s YYYY-MM-DD.
- If a metric isn't in the block (e.g. RPE, subjective feel), ask for it — but never invent missing data by claiming the system didn't sync it.

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

数据来源（回答前必看）：
- 下方的 [近期活动] 板块就是你对用户近期训练的完整视野，每一轮都从应用数据库实时拉取，视为权威。
- 不要在没扫一遍板块前就说"我无法获取你最新的数据"、"系统还没同步"或"我这里只保存到 X 日"。先看清楚里面列出的日期 —— 那就是事实。
- 用户可能刚加完一条训练就来问你。如果他们说"我刚跑完"，而 [近期活动] 的第一条日期就是今天，那条**就是**他们说的那次跑步，回复时要引用其具体数据（距离、时长、心率）。
- [当前时间] 是真实的当下时间。拿它和板块第一条的日期对比来判断新鲜度，"今天"就是 [当前时间] 的 YYYY-MM-DD 部分。
- 如果某项数据没在板块里（比如 RPE、主观感受），直接问用户；但**不要**编造说"系统没同步过来"。

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
  showCalendarButton: true,
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
