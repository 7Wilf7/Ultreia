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
  { en: "One more clean rep.", zh: "再来一组，动作干净。" },
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
  { en: "Race-day confidence starts in quiet miles.", zh: "赛日的自信，从安静的跑量开始。" },
  { en: "Chase the sunrise.", zh: "去追日出。" },
  { en: "The finish line starts in today's easy minutes.", zh: "终点线从今天的轻松分钟开始。" },
  { en: "Trust your training.", zh: "相信你的训练。" },
  { en: "Stronger, one honest session at a time.", zh: "一次诚实训练，强一点。" },
  { en: "Swim, bike, run, repeat.", zh: "游、骑、跑，循环。" },
  { en: "Open water, open mind.", zh: "开放水域，开放心态。" },
  { en: "Spin those legs.", zh: "把腿转起来。" },
  { en: "Hills are speedwork in disguise.", zh: "爬坡是伪装的速度训练。" },
  { en: "Eat the elevation.", zh: "把爬升吃掉。" },
  { en: "Pace yourself, pass them later.", zh: "先控住，后超越。" },
  { en: "The long run builds champions.", zh: "长距离造就冠军。" },
  { en: "Find your rhythm.", zh: "找到你的节奏。" },
  { en: "Honest miles compound.", zh: "诚实的里程会复利。" },
  { en: "Suffer in training, smile in racing.", zh: "训练受苦，比赛微笑。" },
  { en: "Wake up. Move well. Repeat.", zh: "醒来、动好、循环。" },
  { en: "Podiums start with ordinary training days.", zh: "领奖台从普通训练日开始。" },
  { en: "Run what you can, hike what you must, keep moving.", zh: "能跑就跑，该徒步就徒步，继续向前。" },
  { en: "Build the engine.", zh: "把发动机练大。" },
  { en: "Earn the day with one honest session.", zh: "用一次诚实训练，把今天赚到。" },
  { en: "Strong core, strong finish.", zh: "核心稳，收尾强。" },
  { en: "Less ego, more endurance.", zh: "少点逞强，多点耐力。" },
  { en: "Quiet miles become race-day confidence.", zh: "安静的里程，会变成赛日的底气。" },
  { en: "Light feet, heavy results.", zh: "脚步轻，成果重。" },
  { en: "Race the clock, not the crowd.", zh: "跟时间赛，别跟人群赛。" },
  { en: "Every sunrise is a starting line.", zh: "每个日出都是起跑线。" },
  { en: "Train like you race.", zh: "像比赛一样训练。" },
  { en: "Patience is a pace.", zh: "耐心也是一种配速。" },
  { en: "Your legs will thank you later.", zh: "你的腿以后会感谢你。" },
  { en: "Effort first, mileage second.", zh: "先跑对强度，再谈里程。" },
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
  { en: "Strength comes from repeatable work.", zh: "力量来自能重复的训练。" },
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
  { en: "Build fitness your legs can trust.", zh: "练出一副腿能相信的能力。" },
  { en: "The horizon is not in a hurry.", zh: "地平线从不着急。" },
  { en: "Move with intent.", zh: "带着意图前进。" },
  { en: "Good work leaves tracks.", zh: "好的努力会留下轨迹。" },
  { en: "The route opens one step at a time.", zh: "路是一点点打开的。" },
  { en: "Make the hard thing familiar.", zh: "把困难练成熟人。" },
  { en: "There is power in staying steady.", zh: "稳定本身就有力量。" },
  { en: "Go further, quietly.", zh: "安静地，向更远处去。" },
  { en: "Keep the easy days truly easy.", zh: "让轻松日真的轻松。" },
  { en: "The best climb is the one you pace well.", zh: "最好的爬坡，是配速稳住的爬坡。" },
  { en: "Save the brave move for the right kilometer.", zh: "把勇敢留给该发力的那一公里。" },
  { en: "A clean recovery window protects the next quality session.", zh: "干净的恢复窗口，保护下一次高质量训练。" },
  { en: "Trail legs are built one careful descent at a time.", zh: "越野腿，是一次次认真下坡练出来的。" },
  { en: "Keep your form when the road tilts up.", zh: "路开始抬头时，动作更要稳。" },
  { en: "Long runs teach patience before they build fitness.", zh: "长距离先教耐心，再涨能力。" },
  { en: "Run the effort, not the ego.", zh: "跑体感，别跑面子。" },
  { en: "Let today's route add one quiet brick.", zh: "让今天的路线添上一块安静的砖。" },
  { en: "Strong weeks are made from controlled days.", zh: "强的一周，来自控得住的每一天。" },
  { en: "Leave enough in the tank to train again.", zh: "留点余力，明天还能继续练。" },
  { en: "Good pacing is quiet confidence.", zh: "好的配速，是安静的自信。" },
  { en: "The mountain respects steady feet.", zh: "山会尊重稳定的脚步。" },
  { en: "Make recovery part of the plan, not an apology.", zh: "把恢复当计划，不当补救。" },
  { en: "Build speed on top of durability.", zh: "先耐用，再谈速度。" },
  { en: "Every technical trail rewards attention.", zh: "每一段技术路，都奖励专注。" },
  { en: "The aerobic engine grows in ordinary minutes.", zh: "有氧发动机长在普通的分钟里。" },
  { en: "Choose rhythm before results.", zh: "先选节奏，再看结果。" },
  { en: "Climb with patience, descend with care.", zh: "上坡带耐心，下坡带小心。" },
  { en: "A steady week beats a heroic day.", zh: "稳定的一周，胜过逞英雄的一天。" },
  { en: "Let the workout fit the body you brought today.", zh: "让训练适配今天带来的身体。" },
  { en: "The trail is not rushed, only followed.", zh: "路不需要催，只需要跟上。" },
  { en: "Small choices become race-day legs.", zh: "小选择，会长成赛日的腿。" },
  { en: "Practice calm before you need it.", zh: "在需要冷静之前，先练会冷静。" },
  { en: "Keep the descent smooth and the breathing honest.", zh: "下坡跑顺，呼吸跑真。" },
  { en: "One honest controlled run can save the whole week.", zh: "一次诚实的可控跑，能救下一整周。" },
  { en: "Let the hills file the edges off.", zh: "让坡把棱角慢慢磨掉。" },
  { en: "Go further by staying usable.", zh: "保持耐用，才能去更远。" },
];

export const GREETINGS = BASE_GREETINGS;

const GREETING_POOL_VERSION = 5;

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
//   05–12 morning · 12–13 noon · 13–18 afternoon · 18–23 evening · else night
export function timeGreeting(lang, date = new Date()) {
  const h = date.getHours();
  const key =
    h < 5 ? "night" :
    h < 12 ? "morning" :
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
