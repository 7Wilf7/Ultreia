// Splash greeting — a time-of-day line ("Good morning, Wilf") plus a sport
// one-liner underneath, shown on the boot/loading screen. Bilingual; the caller
// reads the saved language. Pure data + helpers, no React.

const BASE_GREETINGS = [
  { en: "Every kilometer counts.", zh: "每一公里都算数。" },
  { en: "Lace up. The road's waiting.", zh: "系好鞋带，路在等你。" },
  { en: "Recovery is training too.", zh: "恢复也是训练。" },
  { en: "Trust the process, not the weather.", zh: "相信训练，别信天气。" },
  { en: "Slow is smooth, smooth is fast.", zh: "慢即稳，稳即快。" },
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
  { en: "Embrace the suck.", zh: "拥抱那点难受。" },
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
  { en: "Chase the sunrise.", zh: "去追日出。" },
  { en: "The finish line is a state of mind.", zh: "终点线是一种心态。" },
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
  { en: "Forward is a direction, not a speed.", zh: "向前是一种方向，不是一种速度。" },
  { en: "Keep moving toward the mountain.", zh: "继续向山的方向走。" },
  { en: "Endurance is built in quiet minutes.", zh: "耐力长在安静的分钟里。" },
  { en: "Let the route teach you.", zh: "让路线教你。" },
  { en: "Leave a clean line behind you.", zh: "在身后留下一条干净的线。" },
  { en: "The work knows your name.", zh: "努力记得你的名字。" },
  { en: "Keep the compass steady.", zh: "把指南针稳住。" },
  { en: "Quiet effort travels far.", zh: "安静的努力走得很远。" },
  { en: "The next step is enough.", zh: "下一步就够了。" },
  { en: "Make the mountain smaller by moving.", zh: "动起来，山就会变小。" },
  { en: "Strength likes repetition.", zh: "力量喜欢重复。" },
  { en: "Carry the calm into the climb.", zh: "带着平静上坡。" },
  { en: "Find the line and follow it.", zh: "找到那条线，然后跟上它。" },
  { en: "Durability beats drama.", zh: "耐用胜过戏剧性。" },
  { en: "The trail rewards patience.", zh: "路会奖励耐心。" },
  { en: "Make effort look simple.", zh: "把努力练到看起来简单。" },
  { en: "Keep the engine honest.", zh: "让发动机保持诚实。" },
  { en: "Precision is a kind of courage.", zh: "精准也是一种勇气。" },
  { en: "Let the body learn the way.", zh: "让身体记住路。" },
  { en: "Small discipline, long horizon.", zh: "小小纪律，长长远方。" },
  { en: "The climb starts inside.", zh: "爬升从心里开始。" },
  { en: "Stay patient. Stay pointed.", zh: "保持耐心，保持方向。" },
  { en: "Build something your legs can trust.", zh: "练出一副腿能相信的身体。" },
  { en: "The horizon is not in a hurry.", zh: "地平线从不着急。" },
  { en: "Move with intent.", zh: "带着意图前进。" },
  { en: "Good work leaves tracks.", zh: "好的努力会留下轨迹。" },
  { en: "The route opens one step at a time.", zh: "路是一点点打开的。" },
  { en: "Make the hard thing familiar.", zh: "把困难练成熟人。" },
  { en: "There is power in staying steady.", zh: "稳定本身就有力量。" },
  { en: "Go further, quietly.", zh: "安静地，向更远处去。" },
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
  { en: "Adjust without drama", zh: "该调整就调整" },
  { en: "Use patience as pace", zh: "把耐心当配速" },
  { en: "Keep the stride light", zh: "让步子轻一点" },
  { en: "Make the route smaller", zh: "先把路跑近一点" },
  { en: "Let consistency do the work", zh: "让稳定发挥作用" },
  { en: "Sharpen the engine gently", zh: "温和地把状态磨亮" },
  { en: "Keep the long view", zh: "把眼光放长" },
  { en: "Do the next right thing", zh: "做好下一件对的事" },
  { en: "Close the loop", zh: "把今天这环扣上" },
  { en: "Carry the quiet effort", zh: "带着安静的努力" },
  { en: "Hold your direction", zh: "守住方向" },
  { en: "Let the mountain wait", zh: "让山在前面等着" },
  { en: "Make the next step clean", zh: "把下一步走干净" },
  { en: "Keep the engine warm", zh: "让发动机保持温度" },
  { en: "Leave the noise behind", zh: "把噪音留在身后" },
  { en: "Choose the steady line", zh: "选择稳定的线" },
  { en: "Practice the durable version", zh: "练那个更耐用的自己" },
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

const GREETING_POOL_VERSION = 2;

function dayOfYear(date) {
  const localDay = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const yearStart = Date.UTC(date.getFullYear(), 0, 1);
  return Math.floor((localDay - yearStart) / 86400000);
}

function randomIndex(max) {
  if (max <= 1) return 0;
  try {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return buf[0] % max;
  } catch {
    return Math.floor(Math.random() * max);
  }
}

function shuffleIndices(length) {
  const arr = Array.from({ length }, (_, idx) => idx);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function cleanDeck(deck) {
  if (!Array.isArray(deck)) return [];
  const seen = new Set();
  return deck.filter(idx => {
    if (!Number.isInteger(idx)) return false;
    if (idx < 0 || idx >= GREETINGS.length) return false;
    if (seen.has(idx)) return false;
    seen.add(idx);
    return true;
  });
}

export function pickGreeting(date = new Date(), scope = "default") {
  const safeScope = scope || "default";
  const deckKey = `ultreia.greetingDeck.v${GREETING_POOL_VERSION}.${safeScope}`;
  const lastKey = `ultreia.lastGreeting.v${GREETING_POOL_VERSION}.${safeScope}`;
  try {
    let deck = cleanDeck(JSON.parse(localStorage.getItem(deckKey) || "[]"));
    const lastIdx = Number(localStorage.getItem(lastKey));
    if (!deck.length) {
      deck = shuffleIndices(GREETINGS.length);
      if (deck.length > 1 && deck[0] === lastIdx) {
        [deck[0], deck[1]] = [deck[1], deck[0]];
      }
    }
    const idx = deck.shift();
    localStorage.setItem(deckKey, JSON.stringify(deck));
    localStorage.setItem(lastKey, String(idx));
    return GREETINGS[idx];
  } catch {
    const yearOffset = date.getFullYear() * 37;
    return GREETINGS[(dayOfYear(date) + yearOffset + date.getHours()) % GREETINGS.length];
  }
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
