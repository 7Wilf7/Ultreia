// Splash greeting — a time-of-day line ("Good morning, Wilf") plus a random
// sport one-liner underneath, shown on the boot/loading screen. Bilingual; the
// caller reads the saved language. Pure data + helpers, no React.

export const GREETINGS = [
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

// One random line. Called once per launch so it stays stable across the boot.
export function pickGreeting() {
  return GREETINGS[Math.floor(Math.random() * GREETINGS.length)];
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
