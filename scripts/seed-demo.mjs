// One-off demo-account seeder — for marketing screenshots (小红书 etc.).
//
// Creates (or reuses) a Supabase auth user and fills it with a coherent set of
// FABRICATED training data for a "破4 / ITRA 400" recreational runner persona.
// Idempotent: re-running wipes that user's workouts/races/coach_messages/
// daily_notes and re-seeds, so you can tweak and re-run freely.
//
// This bypasses RLS via the service_role key — NEVER commit that key, never put
// it in the frontend / .env.local. Pass it at run time only:
//
//   PowerShell:
//     $env:SUPABASE_SERVICE_ROLE_KEY="sb_secret_xxx"; node scripts/seed-demo.mjs
//
// Optional overrides (env vars):
//   SUPABASE_URL       default https://ihibmkfgfznqwzavaeiq.supabase.co
//   DEMO_EMAIL         default demo@ultreia.run
//   DEMO_PASSWORD      default demo-show-2026
//   DEMO_NAME          default Kai
//   DEMO_CITY          default 上海

import { createClient } from '@supabase/supabase-js';

// ── Config ────────────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ihibmkfgfznqwzavaeiq.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const EMAIL    = process.env.DEMO_EMAIL    || 'demo@ultreia.run';
const PASSWORD = process.env.DEMO_PASSWORD || 'demo-show-2026';
const NAME     = process.env.DEMO_NAME     || 'Kai';
const CITY     = process.env.DEMO_CITY     || '上海';
const LAT = 31.2304, LNG = 121.4737; // Shanghai

if (!SERVICE_KEY) {
  console.error(`
✗ Missing SUPABASE_SERVICE_ROLE_KEY.

Get it from Supabase Dashboard → Settings → API → service_role secret
(starts with "sb_secret_…" or the legacy long JWT). Then in PowerShell:

  $env:SUPABASE_SERVICE_ROLE_KEY="sb_secret_xxx"; node scripts/seed-demo.mjs

(The key is a one-shot env var — it is NOT saved anywhere.)
`);
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ── Date helpers (anchored to "now" so data is always recent) ───────────────
const NOW = new Date();
const DAY = 86400000;
function dateAt(daysAgo) {
  return new Date(NOW.getTime() - daysAgo * DAY);
}
function ymd(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
// ISO timestamp at a given local hour:min on a day-offset date.
function startedAt(daysAgo, hour, min = 0) {
  const d = dateAt(daysAgo);
  d.setHours(hour, min, 0, 0);
  return d.toISOString();
}

// ── Weather generator (plausible Shanghai snapshot for screenshots) ─────────
// Seasonal avg temp by month (°C), morning sessions run a few degrees cooler.
const MONTH_TEMP = [5, 7, 11, 17, 22, 26, 30, 30, 26, 20, 14, 8];
const SKYCONS = ['CLEAR_DAY', 'PARTLY_CLOUDY_DAY', 'CLOUDY', 'LIGHT_RAIN'];
function weatherFor(daysAgo, hour) {
  const d = dateAt(daysAgo);
  const base = MONTH_TEMP[d.getMonth()];
  const morningAdj = hour < 9 ? -3 : hour >= 18 ? -1 : 2;
  const jitter = ((daysAgo * 7) % 5) - 2; // deterministic -2..+2
  const tempC = base + morningAdj + jitter;
  const humidity = 0.55 + ((daysAgo * 3) % 30) / 100; // 0.55–0.84
  const apparentC = tempC >= 27 ? Math.round((tempC + (humidity * 100 - 40) / 10) * 10) / 10 : tempC;
  const skycon = SKYCONS[(daysAgo + hour) % SKYCONS.length];
  return {
    ts: startedAt(daysAgo, hour),
    type: 'historical',
    lng: LNG, lat: LAT,
    tempC: Math.round(tempC * 10) / 10,
    apparentC,
    humidity: Math.round(humidity * 100) / 100,
    skycon,
    windSpeed: 6 + (daysAgo % 10),
    windDirection: 90 + (daysAgo % 180),
    aqi: 40 + (daysAgo % 45),
    source: 'caiyun',
  };
}

// ── Workout templates ───────────────────────────────────────────────────────
// pace = round(durationSec / km). HR aligned to Karvonen zones for
// restingHR 48 / maxHR 188 (HRR 140): Easy<141, Aerobic ~148, Tempo ~160, Interval ~172.
function run(daysAgo, hour, type, sub, km, durSec, hr, maxHr, extra = {}) {
  const w = {
    user_id: null, // filled later
    date: ymd(dateAt(daysAgo)),
    type,
    sub_types: sub,
    distance: km,
    duration: durSec,
    pace: km > 0 ? Math.round(durSec / km) : 0,
    hr,
    max_hr: maxHr,
    cadence: extra.cadence ?? (type === 'Road Run' ? 174 + (daysAgo % 6) : null),
    aerobic_te: extra.aerobicTE ?? null,
    ascent: extra.ascent ?? null,
    gap: extra.gap ?? null,
    note: extra.note ?? '',
    rpe: extra.rpe ?? null,
    is_planned: extra.planned ?? false,
    tags: extra.tags ?? [],
    started_at: startedAt(daysAgo, hour),
    weather: ['Road Run', 'Trail Run', 'Hiking', 'HIIT'].includes(type) ? weatherFor(daysAgo, hour) : null,
    source: 'manual',
  };
  return w;
}
function strength(daysAgo, hour, sub, durSec, note = '') {
  return {
    user_id: null,
    date: ymd(dateAt(daysAgo)),
    type: 'Strength',
    sub_types: [sub],
    distance: null, duration: durSec, pace: 0, hr: null, max_hr: null,
    cadence: null, aerobic_te: null, ascent: null, gap: null,
    note, rpe: null, is_planned: false, tags: [],
    started_at: startedAt(daysAgo, hour), weather: null, source: 'manual',
  };
}

// Build ~11 weeks of history, oldest → newest. daysAgo decreasing.
const workouts = [];
// week index 0 = oldest (≈ 11 weeks ago). Long run ramps 16 → 22 km.
const longKm = [16, 17, 18, 16, 19, 20, 18, 21, 22, 19, 14]; // 14 = taper-ish last full week
for (let wk = 0; wk < 11; wk++) {
  const weekStart = (10 - wk) * 7; // daysAgo of this week's Monday-ish anchor
  // Tue easy 8k
  workouts.push(run(weekStart - 1, 7, 'Road Run', ['Easy Run'], 8, 8 * 376 + (wk % 3) * 20, 138 + (wk % 4), 152));
  // Wed strength (alternate lower / core)
  workouts.push(strength(weekStart - 2, 19, wk % 2 ? 'Core' : 'Lower Body', 50 * 60));
  // Thu — alternate aerobic 10k / interval 8k
  if (wk % 2 === 0) {
    workouts.push(run(weekStart - 3, 7, 'Road Run', ['Aerobic Run'], 10, 10 * 344, 149, 162, { aerobicTE: 3.4, gap: 340 }));
  } else {
    workouts.push(run(weekStart - 3, 19, 'Road Run', ['Interval Run'], 9, Math.round(9 * 300), 171, 184, { aerobicTE: 4.2, note: '6×800m', gap: 292 }));
  }
  // Sat long run
  const lk = longKm[wk];
  workouts.push(run(weekStart - 5, 6, 'Road Run', ['Easy Run'], lk, Math.round(lk * 388), 144 + (wk % 3), 158, { aerobicTE: 3.6, gap: 384, note: lk >= 20 ? '长距离，后半程略掉速' : '' }));
  // Sun easy recovery 6k OR (some weeks) trail/hiking
  if (wk === 3 || wk === 7) {
    workouts.push(run(weekStart - 6, 8, 'Trail Run', [], 14, Math.round(2.6 * 3600), 142, 165, { ascent: 760, note: '佘山越野练爬升' }));
  } else if (wk === 9) {
    workouts.push(run(weekStart - 6, 9, 'Hiking', [], 9, Math.round(2.2 * 3600), 118, 138, { ascent: 420 }));
  } else {
    workouts.push(run(weekStart - 6, 8, 'Road Run', ['Easy Run'], 6, 6 * 400, 134 + (wk % 3), 148));
  }
  // occasional HIIT mid-week
  if (wk % 3 === 1) {
    workouts.push(run(weekStart - 4, 18, 'HIIT', [], 0, 28 * 60, 158, 180, { note: 'Tabata + core' }));
  }
}

// A few future PLANNED sessions (next 7 days) so Calendar + coach "upcoming" populate.
workouts.push(run(-1, 7, 'Road Run', ['Aerobic Run'], 10, 10 * 342, null, null, { planned: true }));   // tomorrow
workouts.push(run(-3, 6, 'Road Run', ['Easy Run'], 22, 22 * 386, null, null, { planned: true, note: '周末长距离' }));
workouts.push(run(-5, 19, 'Road Run', ['Interval Run'], 9, 9 * 298, null, null, { planned: true, note: '5×1000m' }));

// ── Races ───────────────────────────────────────────────────────────────────
const races = [
  // history
  { is_target: false, priority: null, name: '上海马拉松', date: ymd(dateAt(180)), distance: 42.195, category: 'Marathon', subtype: '', ascent: null, itra_score: null, result_seconds: 3 * 3600 + 58 * 60 + 24, location_name: '上海', location_lat: LAT, location_lng: LNG },
  { is_target: false, priority: null, name: '环金鸡湖半程马拉松', date: ymd(dateAt(75)), distance: 21.0975, category: 'Half Marathon', subtype: '', ascent: null, itra_score: null, result_seconds: 1 * 3600 + 52 * 60 + 30, location_name: '苏州', location_lat: 31.3, location_lng: 120.6 },
  { is_target: false, priority: null, name: '滨江 10K 公开赛', date: ymd(dateAt(40)), distance: 10, category: '10K', subtype: '', ascent: null, itra_score: null, result_seconds: 48 * 60 + 40, location_name: '上海', location_lat: LAT, location_lng: LNG },
  { is_target: false, priority: null, name: '莫干山 50K 越野赛', date: ymd(dateAt(22)), distance: 50, category: 'Trail', subtype: '', ascent: 2400, itra_score: 400, result_seconds: 7 * 3600 + 45 * 60, location_name: '莫干山', location_lat: 30.6, location_lng: 119.9 },
  { is_target: false, priority: null, name: 'Spartan Beast 上海站', date: ymd(dateAt(55)), distance: 21, category: 'Spartan', subtype: 'Beast', ascent: 600, itra_score: null, result_seconds: 3 * 3600 + 12 * 60, location_name: '上海', location_lat: LAT, location_lng: LNG },
  // upcoming target
  { is_target: true, priority: 'A', name: '宁波山地马拉松 50K', date: ymd(dateAt(-100)), distance: 50, category: 'Trail', subtype: '', ascent: 2800, itra_score: null, result_seconds: null, location_name: '宁波', location_lat: 29.87, location_lng: 121.55 },
];

// ── Coach messages (realistic Chinese exchange) ─────────────────────────────
const chat = [
  { role: 'user', content: '这周练得怎么样？周六的长距离 22 公里我后半程掉速了，正常吗？' },
  { role: 'assistant', content: '从数据看这周节奏不错：周二 8K Easy、周四间歇、周六 22K 长距离，周量 45 公里左右，强度分布合理。\n\n长距离后半程掉速很正常，尤其 20K+ 时糖原开始吃紧。你这次平均心率 146、配速 6:28，后段掉到 6:40 左右，掉幅在 10 秒/公里以内，属于可接受范围。两点可以优化：\n1. 长距离前 1 小时补一次能量胶，30K 备赛阶段尤其需要练补给；\n2. 起跑配速再压一点，前 5K 别超过 6:30。\n\n要不要我帮你把下周长距离排到 24K？' },
  { role: 'user', content: '好，那下周长距离拉到 24K。另外我 9 月要跑宁波山地马 50K，现在该怎么准备爬升？' },
  { role: 'assistant', content: '距离 9 月还有 3 个多月，时间充裕。宁波山地马 50K 爬升约 2800 米，你目前路跑底子够，主要补两块：\n\n**爬升耐受**——每周加 1 次越野/爬坡，你最近佘山那两次（爬升 760 米）方向对，逐步加到单次 1200–1500 米。\n**下坡能力**——很多人忽视，下坡对股四头肌冲击大，赛前 6 周开始专门练下坡跑。\n\n力量这块你现在每周 1 次，建议加到 2 次，侧重单腿稳定（保加利亚分腿蹲、台阶）。要我把这些排进日历吗？' },
];
// spread timestamps over the last few days so ordering is natural
const chatBase = NOW.getTime() - 2 * DAY;
const chatRows = chat.map((m, i) => ({
  role: m.role,
  content: m.content,
  created_at: new Date(chatBase + i * 6 * 60 * 1000).toISOString(),
}));

// ── Daily notes (a few tags for the calendar) ───────────────────────────────
const dailyNotes = [
  { date: ymd(dateAt(2)),  tags: ['massage'], travel_dest: null },
  { date: ymd(dateAt(6)),  tags: ['poor_sleep'], travel_dest: null },
  { date: ymd(dateAt(12)), tags: ['stretching'], travel_dest: null },
  { date: ymd(dateAt(20)), tags: ['travel'], travel_dest: '杭州' },
];

// ── Run ─────────────────────────────────────────────────────────────────────
async function findOrCreateUser() {
  // Paginate through users to find an existing match by email.
  let page = 1;
  while (page <= 20) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = (data.users || []).find(u => (u.email || '').toLowerCase() === EMAIL.toLowerCase());
    if (hit) return { id: hit.id, created: false };
    if (!data.users || data.users.length < 200) break;
    page++;
  }
  const { data, error } = await db.auth.admin.createUser({
    email: EMAIL, password: PASSWORD, email_confirm: true,
  });
  if (error) throw error;
  return { id: data.user.id, created: true };
}

async function wipe(userId) {
  for (const table of ['workouts', 'races', 'coach_messages', 'daily_notes']) {
    const { error } = await db.from(table).delete().eq('user_id', userId);
    if (error) throw new Error(`wipe ${table}: ${error.message}`);
  }
}

async function insertAll(userId) {
  // profile (PK = id)
  let r = await db.from('profiles').upsert({
    id: userId,
    display_name: NAME,
    birth_date: '1992-05-20',
    gender: 'male',
    city: CITY,
    occupation: 'office',
    experience: '3-5y',
    race_types: ['road', 'trail', 'spartan'],
    recent_injuries: ['none'],
    injuries_note: '',
    equipment: ['gym', 'treadmill'],
    resting_hr: 48,
    max_hr: 188,
    hr_zone_method: 'karvonen-strict',
    notes: '目标：全马已破4（PB 3:58），下一步冲击 3:45；9 月备战宁波山地马 50K。',
    itra_pi: 400,
  });
  if (r.error) throw new Error(`profiles: ${r.error.message}`);

  // settings
  r = await db.from('user_settings').upsert({
    user_id: userId,
    lang: 'zh',
    api_provider: 'deepseek',
    push_enabled: false,
    default_lat: LAT,
    default_lng: LNG,
    default_location_name: CITY,
    coach_config: { style: 'balanced', outputLength: 'standard', intervention: 'standard', showCalendarButton: true },
  }, { onConflict: 'user_id' });
  if (r.error) throw new Error(`user_settings: ${r.error.message}`);

  // workouts
  const wRows = workouts.map(w => ({ ...w, user_id: userId }));
  r = await db.from('workouts').insert(wRows);
  if (r.error) throw new Error(`workouts: ${r.error.message}`);

  // races
  const rRows = races.map(x => ({ ...x, user_id: userId }));
  r = await db.from('races').insert(rRows);
  if (r.error) throw new Error(`races: ${r.error.message}`);

  // coach messages
  r = await db.from('coach_messages').insert(chatRows.map(m => ({ ...m, user_id: userId })));
  if (r.error) throw new Error(`coach_messages: ${r.error.message}`);

  // daily notes
  r = await db.from('daily_notes').insert(dailyNotes.map(n => ({ ...n, user_id: userId })));
  if (r.error) throw new Error(`daily_notes: ${r.error.message}`);
}

(async () => {
  console.log(`→ Supabase: ${SUPABASE_URL}`);
  console.log(`→ Demo account: ${EMAIL}`);
  const { id, created } = await findOrCreateUser();
  console.log(`→ User ${created ? 'CREATED' : 'reused'}: ${id}`);
  await wipe(id);
  console.log('→ Old demo data wiped.');
  await insertAll(id);
  console.log(`✓ Seeded: ${workouts.length} workouts, ${races.length} races, ${chatRows.length} coach messages, ${dailyNotes.length} daily notes.`);
  console.log(`\nLogin at https://ultreia.run/  →  ${EMAIL} / ${PASSWORD}`);
})().catch(err => {
  console.error('\n✗ Seed failed:', err.message || err);
  process.exit(1);
});
