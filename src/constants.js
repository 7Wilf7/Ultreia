export const STORAGE_KEY = "wilf_training_studio_v1";

// Default Anthropic API endpoint. Overridable in AI Coach settings (for third-party relays).
export const DEFAULT_API_ENDPOINT = "https://api.anthropic.com/v1/messages";

// Default model. Anthropic-official names work on api.anthropic.com.
// Third-party relays often use custom aliases (e.g. "claude-opus-4-7"); set via AI Coach settings.
export const DEFAULT_MODEL = "claude-sonnet-4-20250514";

// Common model names — shown as quick-select chips inside API Settings
export const MODEL_PRESETS = [
  "claude-sonnet-4-20250514",          // Anthropic official Sonnet 4
  "claude-opus-4-20250514",            // Anthropic official Opus 4
  "deepseek-v4-pro",                   // DeepSeek (Anthropic-compatible endpoint)
  "deepseek-v4-flash",                 // DeepSeek lighter model
  "claude-opus-4-7",                   // Common third-party relay alias
];

/**
 * One-click presets that fill endpoint + model together. API key is NOT touched
 * (different providers issue different keys, user always pastes their own).
 */
export const API_PRESETS = [
  {
    id: "anthropic-official",
    label: "Anthropic 官方",
    endpoint: "https://api.anthropic.com/v1/messages",
    model: "claude-sonnet-4-20250514",
    note: "Official; needs USD-billed Anthropic Console key",
  },
  {
    id: "deepseek-official",
    label: "DeepSeek (Anthropic-compatible)",
    endpoint: "https://api.deepseek.com/anthropic/v1/messages",
    model: "deepseek-v4-pro",
    note: "国内可充值；走 DeepSeek 的 Anthropic 兼容接口",
  },
];

export const TABS = ["Training", "Races", "PR", "AI Coach"];

// Activity types (stored in log.type)
export const ACTIVITY_TYPES = ["Running", "Trail Running", "Hiking", "Floor Climbing", "Strength", "HIIT"];

// Types that aggregate into the Run filter group (kept here so it's the single source of truth)
export const RUN_GROUP_TYPES = ["Running", "Trail Running", "Hiking", "Floor Climbing"];

// Running sub-types — split into two groups:
//   PACE: heart-rate-based classification (single-select per activity)
//   FLAG: independent flags that can co-exist with a pace type (e.g. Race)
export const RUN_PACE_TYPES = ["Easy Run", "Aerobic Run", "Tempo Run", "Interval Run"];
export const RUN_FLAGS = ["Race"];
export const RUN_SUBTYPES = [...RUN_PACE_TYPES, ...RUN_FLAGS]; // full list, used by CSV upload review dropdown

// Strength sub-types (formerly "Aerobic" — migrated)
export const STRENGTH_SUBS = ["Upper Body", "Lower Body", "Core"];

// Color tag per top-level type
export const TYPE_COLOR = {
  "Running": "#222",
  "Trail Running": "#555",
  "Hiking": "#4a7c4a",
  "Floor Climbing": "#7a5a00",
  "Strength": "#888",
  "HIIT": "#b35900",
};

// Global-filter parent → child mapping (used by GlobalFilter UI + filter logic).
// `section` groups children visually inside the dropdown — children with the same
// section render under one divider/header. No section = main list.
export const FILTER_GROUPS = {
  run: {
    label: "Run",
    children: [
      { id: "Running", label: "Running" },
      { id: "Trail Running", label: "Trail Run" },
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

// Color per category (subtle bg + dark text)
export const RACE_CATEGORY_COLOR = {
  "Half Marathon": "#e8f1ff",
  "Marathon":      "#dde6ff",
  "10K":           "#eef5e8",
  "Trail":         "#efe6d4",
  "Spartan":       "#fde4e1",
  "Hyrox":         "#fff2d6",
  "Other":         "#f0f0f0",
};

// Fixed system prompt — not user-editable. Keep it short and principled.
// User-specific behavior shaping happens via Profile + Coach Config blocks
// (assembled in utils/profile.js) appended after this.
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
