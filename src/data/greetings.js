// Splash greeting — a time-of-day line ("Good morning, Wilf") plus a sport
// one-liner underneath, shown on the boot/loading screen. Bilingual; the caller
// reads the saved language. Pure data + helpers, no React.

const BASE_GREETINGS = [
  { en: "Every kilometer counts.", zh: "每一公里都算数。" },
  { en: "Today's easy run is tomorrow's PR.", zh: "今天的轻松跑，明天的 PR。" },
  { en: "Lace up. The road's waiting.", zh: "系好鞋带，路在等你。" },
  { en: "Recovery is training too.", zh: "恢复也是训练。" },
  { en: "Trust the process, not the weather.", zh: "相信训练，别信天气。" },
  { en: "Slow is smooth, smooth is fast.", zh: "慢即稳，稳即快。" },
  { en: "Zone 2 today, podium someday.", zh: "今天 Z2，终有一天上领奖台。" },
  { en: "The hills don't get easier, you get stronger.", zh: "坡没变缓，是你变强了。" },
  { en: "Consistency beats intensity.", zh: "坚持胜过猛练。" },
  { en: "One more rep.", zh: "再来一组。" },
  { en: "Your only competition is yesterday.", zh: "唯一的对手是昨天的自己。" },
  { en: "Cadence up, worries down.", zh: "步频提上去，烦恼降下来。" },
  { en: "Rest hard, run harder.", zh: "认真休息，用力奔跑。" },
  { en: "The watch lies; your legs don't.", zh: "表会骗人，腿不会。" },
  { en: "Negative splits, positive vibes.", zh: "后程加速，全程好心情。" },
  { en: "Fuel, hydrate, repeat.", zh: "补给、补水、循环。" },
  { en: "Miles make the runner.", zh: "跑量造就跑者。" },
  { en: "Show up. That's half of it.", zh: "先出门，就成功了一半。" },
  { en: "Strong legs, calm mind.", zh: "腿要稳，心要静。" },
  { en: "The taper is working.", zh: "减量期在起效。" },
  { en: "Embrace the suck.", zh: "拥抱那点难受。" },
  { en: "Easy days easy, hard days hard.", zh: "轻松日要轻松，强度日要狠。" },
  { en: "Run your own race.", zh: "跑你自己的比赛。" },
  { en: "Mileage is money in the bank.", zh: "跑量是存进银行的钱。" },
  { en: "Sweat now, shine on race day.", zh: "平时流汗，赛日发光。" },
  { en: "Climb today, fly tomorrow.", zh: "今天爬坡，明天起飞。" },
  { en: "Breathe. Stride. Repeat.", zh: "呼吸、迈步、循环。" },
  { en: "Discipline outlasts motivation.", zh: "自律比热情更持久。" },
  { en: "Small steps, big distances.", zh: "小步子，大里程。" },
  { en: "The first kilometer is always a liar.", zh: "第一公里总在骗你。" },
  { en: "Train smart, race brave.", zh: "聪明地练，勇敢地赛。" },
  { en: "Your future self is watching.", zh: "未来的你在看着。" },
  { en: "Rest day? Earned it.", zh: "休息日？你配得上。" },
  { en: "Chase the sunrise.", zh: "去追日出。" },
  { en: "The finish line is a state of mind.", zh: "终点线是一种心态。" },
  { en: "Keep the streak alive.", zh: "别断了连胜。" },
  { en: "Trust your training.", zh: "相信你的训练。" },
  { en: "Stronger than yesterday.", zh: "比昨天更强。" },
  { en: "Swim, bike, run, repeat.", zh: "游、骑、跑，循环。" },
  { en: "Open water, open mind.", zh: "开放水域，开放心态。" },
  { en: "Spin those legs.", zh: "把腿转起来。" },
  { en: "Hills are speedwork in disguise.", zh: "爬坡是伪装的速度训练。" },
  { en: "Eat the elevation.", zh: "把爬升吃掉。" },
  { en: "Pace yourself, pass them later.", zh: "先控住，后超越。" },
  { en: "The long run builds champions.", zh: "长距离造就冠军。" },
  { en: "Find your rhythm.", zh: "找到你的节奏。" },
  { en: "Hard work compounds.", zh: "努力会复利。" },
  { en: "Suffer in training, smile in racing.", zh: "训练受苦，比赛微笑。" },
  { en: "Wake up. Work out. Repeat.", zh: "醒来、训练、循环。" },
  { en: "Comfort zones don't have podiums.", zh: "舒适区没有领奖台。" },
  { en: "Run when you can, walk if you must, never quit.", zh: "能跑就跑，该走就走，绝不放弃。" },
  { en: "Build the engine.", zh: "把发动机练大。" },
  { en: "Today is a gift — go earn it.", zh: "今天是份礼物，去赚到它。" },
  { en: "Strong core, strong finish.", zh: "核心稳，收尾强。" },
  { en: "Less ego, more endurance.", zh: "少点逞强，多点耐力。" },
  { en: "The grind is the glory.", zh: "苦练即荣耀。" },
  { en: "Light feet, heavy results.", zh: "脚步轻，成果重。" },
  { en: "Race the clock, not the crowd.", zh: "跟时间赛，别跟人群赛。" },
  { en: "Every sunrise is a starting line.", zh: "每个日出都是起跑线。" },
  { en: "Train like you race.", zh: "像比赛一样训练。" },
  { en: "Patience is a pace.", zh: "耐心也是一种配速。" },
  { en: "Your legs will thank you later.", zh: "你的腿以后会感谢你。" },
  { en: "Mind over mileage.", zh: "意志高于里程。" },
  { en: "Recover like a pro.", zh: "像职业选手那样恢复。" },
  { en: "Stack the good days.", zh: "把好状态一天天叠起来。" },
  { en: "The road remembers.", zh: "路会记得。" },
  { en: "Go long, go strong.", zh: "跑得久，跑得稳。" },
  { en: "Earn your endorphins.", zh: "挣来你的内啡肽。" },
];

const GREETING_ACTIONS = [
  { en: "Keep the easy effort", zh: "守住轻松强度" },
  { en: "Respect the warm-up", zh: "认真热身" },
  { en: "Start softer than you want", zh: "开头比想象中再轻一点" },
  { en: "Let cadence settle", zh: "让步频自己稳下来" },
  { en: "Check your shoulders", zh: "放松肩膀" },
  { en: "Leave one gear unused", zh: "留一档余力" },
  { en: "Build the aerobic engine", zh: "继续打磨有氧发动机" },
  { en: "Bank another honest session", zh: "存下一次扎实训练" },
  { en: "Protect the recovery", zh: "保护好恢复" },
  { en: "Drink before thirst", zh: "口渴前先补水" },
  { en: "Fuel before the fade", zh: "掉速前先补给" },
  { en: "Let the first kilometer pass", zh: "先让第一公里过去" },
  { en: "Keep the breathing quiet", zh: "把呼吸放轻" },
  { en: "Run tall", zh: "把身体跑高一点" },
  { en: "Save the sprint for later", zh: "把冲刺留到后面" },
  { en: "Make the easy day useful", zh: "把轻松日练得有用" },
  { en: "Make the hard day honest", zh: "把强度日练得诚实" },
  { en: "Listen to the legs", zh: "听听腿怎么说" },
  { en: "Check the ego at the door", zh: "把逞强留在门口" },
  { en: "Stack another calm rep", zh: "再叠一组稳定输出" },
  { en: "Smooth the downhill", zh: "把下坡跑顺" },
  { en: "Own the climb", zh: "把坡拿下来" },
  { en: "Hold the line", zh: "守住路线" },
  { en: "Keep the watch in context", zh: "别被手表带偏" },
  { en: "Let pace follow effort", zh: "让配速跟着体感走" },
  { en: "Make room for sleep", zh: "给睡眠留位置" },
  { en: "Train the quiet parts", zh: "把不起眼的部分练好" },
  { en: "Finish with form", zh: "带着动作质量收尾" },
  { en: "Keep one promise to yourself", zh: "兑现一个给自己的承诺" },
  { en: "Win the boring minutes", zh: "赢下那些无聊的分钟" },
  { en: "Respect the plan", zh: "尊重计划" },
  { en: "Adjust without drama", zh: "该调整就调整" },
  { en: "Use patience as pace", zh: "把耐心当配速" },
  { en: "Keep the stride light", zh: "让步子轻一点" },
  { en: "Make the route smaller", zh: "先把路跑近一点" },
  { en: "Let consistency do the work", zh: "让稳定发挥作用" },
  { en: "Sharpen the engine gently", zh: "温和地把状态磨亮" },
  { en: "Keep the long view", zh: "把眼光放长" },
  { en: "Do the next right thing", zh: "做好下一件对的事" },
  { en: "Close the loop", zh: "把今天这环扣上" },
];

const GREETING_CONTEXTS = [
  { en: "today", zh: "今天" },
  { en: "this morning", zh: "这个早晨" },
  { en: "before the day gets loud", zh: "在一天变吵之前" },
  { en: "one step at a time", zh: "一步一步来" },
  { en: "with calm legs", zh: "带着安静的腿" },
  { en: "without chasing numbers", zh: "先别追数字" },
  { en: "for tomorrow's body", zh: "为了明天的身体" },
  { en: "on purpose", zh: "有意识地做" },
];

const GENERATED_GREETINGS = GREETING_ACTIONS.flatMap(action =>
  GREETING_CONTEXTS.map(context => ({
    en: `${action.en} ${context.en}.`,
    zh: `${context.zh}，${action.zh}。`,
  }))
);

export const GREETINGS = [...BASE_GREETINGS, ...GENERATED_GREETINGS];

const STATE_GREETINGS = {
  plannedToday: [
    { en: "There's a plan on the calendar today.", zh: "今天日历上有训练安排。" },
    { en: "Today's plan is waiting. Keep it honest.", zh: "今天的计划在等你，稳稳完成。" },
    { en: "One planned session, one clear target.", zh: "一堂计划课，一个清楚目标。" },
    { en: "Check the plan, then trust the legs.", zh: "先看计划，再相信双腿。" },
  ],
  racedRecently: [
    { en: "Race effort lingers. Let recovery count.", zh: "比赛强度还在，恢复也要算数。" },
    { en: "The medal is done. The rebuild starts quietly.", zh: "奖牌已经拿下，重建从安静开始。" },
    { en: "Post-race legs deserve patience.", zh: "赛后的腿，值得一点耐心。" },
  ],
  trainedYesterday: [
    { en: "Yesterday is in the bank. Spend wisely today.", zh: "昨天已经存进账户，今天聪明使用。" },
    { en: "Let yesterday's work settle before adding more.", zh: "先让昨天的训练沉淀，再考虑加量。" },
    { en: "Back-to-back days work best with restraint.", zh: "连续训练日，克制最有用。" },
  ],
  restedLong: [
    { en: "A few quiet days are not a reset. Start small.", zh: "安静了几天不是归零，先从小一点开始。" },
    { en: "The first session back only needs to restart the rhythm.", zh: "回来的第一练，只需要把节奏接上。" },
    { en: "No need to pay back missed miles today.", zh: "今天不用一次还清漏掉的跑量。" },
  ],
  loadDanger: [
    { en: "Load is high. Fitness grows when recovery keeps up.", zh: "负荷偏高，恢复跟得上才会变强。" },
    { en: "The smart move today may be backing off.", zh: "今天聪明的选择，可能是收一收。" },
    { en: "Spike weeks ask for calm decisions.", zh: "负荷骤增的周，需要冷静决策。" },
  ],
  loadHigh: [
    { en: "Load is climbing. Keep the next step controlled.", zh: "负荷在上升，下一步要可控。" },
    { en: "You're building. Don't rush the adaptation.", zh: "你在积累，别催身体适应。" },
    { en: "Progress is here. Keep it measured.", zh: "进步已经在路上，继续量力推进。" },
  ],
  loadLow: [
    { en: "The load is light. A steady session can restart momentum.", zh: "最近负荷偏轻，一堂稳定训练就能接上势头。" },
    { en: "Low load is a chance to rebuild cleanly.", zh: "低负荷期，是干净重建的机会。" },
    { en: "Room to build, no need to force it.", zh: "还有加量空间，但不用硬顶。" },
  ],
  readinessLow: [
    { en: "Low readiness is data, not weakness.", zh: "状态偏低是数据，不是软弱。" },
    { en: "If the check-in says tired, make the plan listen.", zh: "如果今日状态说累，就让计划听见。" },
    { en: "Today may be about keeping the floor, not raising the ceiling.", zh: "今天也许是守住下限，不是抬高上限。" },
  ],
  readinessHigh: [
    { en: "Good readiness. Use it, don't waste it.", zh: "状态不错，好好使用，别浪费。" },
    { en: "The body says yes. Keep the execution clean.", zh: "身体说可以，执行就要干净。" },
    { en: "Green lights still need good pacing.", zh: "状态开绿灯，也要配速稳。" },
  ],
};

function dayOfYear(date) {
  const localDay = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const yearStart = Date.UTC(date.getFullYear(), 0, 1);
  return Math.floor((localDay - yearStart) / 86400000);
}

function pickFrom(lines, date, salt = 0) {
  return lines[(dayOfYear(date) + salt) % lines.length];
}

function daysSinceDateKey(dateKey, date = new Date()) {
  if (!dateKey) return null;
  const d = new Date(`${dateKey}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  const today = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const then = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round((today - then) / 86400000);
}

// Date-based instead of random: with 366+ lines this avoids repeats within a
// year, and the year offset keeps the same calendar day from always seeing the
// same line next year.
export function pickGreeting(date = new Date(), state = null) {
  if (state) {
    const r = state.readinessAvg;
    const racedWithinDays = state.recentRaceDate
      ? daysSinceDateKey(state.recentRaceDate, date)
      : state.racedWithinDays;
    const lastWorkoutDaysAgo = state.lastWorkoutDate
      ? daysSinceDateKey(state.lastWorkoutDate, date)
      : state.lastWorkoutDaysAgo;
    if (Number.isFinite(r) && r <= 1.4) return pickFrom(STATE_GREETINGS.readinessLow, date, 11);
    if (state.loadRamp === "danger") return pickFrom(STATE_GREETINGS.loadDanger, date, 17);
    if (state.loadRamp === "high") return pickFrom(STATE_GREETINGS.loadHigh, date, 23);
    if (racedWithinDays != null && racedWithinDays <= 3) return pickFrom(STATE_GREETINGS.racedRecently, date, 29);
    if (state.hasPlanToday) return pickFrom(STATE_GREETINGS.plannedToday, date, 31);
    if (lastWorkoutDaysAgo === 1) return pickFrom(STATE_GREETINGS.trainedYesterday, date, 37);
    if (lastWorkoutDaysAgo != null && lastWorkoutDaysAgo >= 4) return pickFrom(STATE_GREETINGS.restedLong, date, 41);
    if (state.loadRamp === "low") return pickFrom(STATE_GREETINGS.loadLow, date, 43);
    if (Number.isFinite(r) && r >= 2.6) return pickFrom(STATE_GREETINGS.readinessHigh, date, 47);
  }
  const yearOffset = date.getFullYear() * 37;
  return GREETINGS[(dayOfYear(date) + yearOffset) % GREETINGS.length];
}

// Time-of-day greeting from LOCAL device time. Buckets:
//   05–11 morning · 11–13 noon · 13–18 afternoon · 18–23 evening · else night
export function timeGreeting(lang, date = new Date()) {
  const h = date.getHours();
  const key =
    h < 5 ? "night" :
    h < 11 ? "morning" :
    h < 13 ? "noon" :
    h < 18 ? "afternoon" :
    h < 23 ? "evening" : "night";
  const M = {
    morning:   { en: "Good morning",   zh: "早上好" },
    noon:      { en: "Good afternoon", zh: "中午好" },
    afternoon: { en: "Good afternoon", zh: "下午好" },
    evening:   { en: "Good evening",   zh: "晚上好" },
    night:     { en: "Still up",       zh: "夜深了" },
  };
  return M[key][lang === "zh" ? "zh" : "en"];
}
