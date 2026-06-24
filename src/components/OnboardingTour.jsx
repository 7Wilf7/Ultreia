import { useEffect, useState } from "react";
import { s } from "../styles";
import { useT, useLanguage } from "../i18n/LanguageContext";
import { ModalRoot } from "./ModalRoot";

// First-run guided tour. Shown once (localStorage-gated) right after a new user
// finishes profile setup. Walks through each tab: it drives the real `tab` state
// via onChangeTab so the actual page shows behind a light dim, while a card
// explains what that page does. Mobile gets the extra Settings step (tab 4);
// desktop has no Settings tab so it's omitted there.
const STEPS = [
  {
    title: { zh: "产品理念", en: "Product philosophy" },
    lead: {
      zh: "Ultreia 来自圣地亚哥朝圣之路上的一句古老问候，意思接近「继续向前」「向更远处去」。",
      en: "Ultreia comes from an old Camino de Santiago greeting, close to: keep going, go further.",
    },
    bullets: [
      { zh: "这个工具不是普通打卡本。记录是原材料，复盘、计划和 AI 教练建议才是闭环。", en: "This is not just a logbook. Logs are raw material; review, planning and AI coaching close the loop." },
      { zh: "logo 的山线、等高线和绿色短线，都来自路线、地形和「下一段路」这个设计思路。", en: "The mountain mark, contour lines and small green stroke come from routes, terrain and the next section of road." },
      { zh: "详细由来在设置里的「使用手册 → 总览」。下面 5 步先带你看主要功能。", en: "The full story lives in Settings → Guide → Overview. The next 5 steps cover the main features." },
    ],
  },
  {
    tab: 0,
    title: { zh: "训练 Training", en: "Training" },
    lead: { zh: "记录每一次训练 —— 数据越全，AI 教练越懂你。", en: "Log every session — the more data, the better the AI coach knows you." },
    bullets: [
      { zh: "支持路跑、越野、徒步、骑行、游泳、爬楼、力量、HIIT 等活动", en: "Supports road, trail, hiking, cycling, swimming, stair-climb, strength, HIIT and more." },
      { zh: "手动添加，或上传 FIT / ZIP / Garmin CSV 批量导入", en: "Add manually, or bulk-import FIT / ZIP / Garmin CSV files." },
      { zh: "每条可记距离、时长、心率、RPE、备注；户外训练自动配上当时天气", en: "Each entry: distance, duration, HR, RPE, notes; outdoor sessions auto-tag the weather." },
      { zh: "顶部切到「图表」看周/月距离、强度分布、心率区间趋势", en: "Switch to Charts for weekly/monthly distance, intensity split, HR-zone trends." },
    ],
  },
  {
    tab: 1,
    title: { zh: "日历 Calendar", en: "Calendar" },
    lead: { zh: "一眼看清练了什么、还安排了什么。", en: "See what you've done and what's planned at a glance." },
    bullets: [
      { zh: "月历同时显示已完成训练和未来计划（虚线 = 计划）", en: "Month grid shows completed sessions + future plans (dashed = planned)." },
      { zh: "点某天加训练或加计划；长按某条能改 / 删", en: "Tap a day to add a workout or plan; long-press one to edit / delete." },
      { zh: "上下滑动日历切换月份", en: "Swipe the calendar up/down to change month." },
      { zh: "下方 7 天天气卡，帮你挑合适的训练日", en: "A 7-day weather strip below helps you pick the right day to train." },
    ],
  },
  {
    tab: 2,
    title: { zh: "比赛 Races", en: "Races" },
    lead: { zh: "管理目标赛和历史成绩。", en: "Manage target races and past results." },
    bullets: [
      { zh: "给目标赛标 A/B/C 优先级，自动显示倒计时", en: "Tag goal races A/B/C; a countdown shows automatically." },
      { zh: "顶部 PR 栏自动列出每个项目（10K / 半马 / 全马 / 越野 / 斯巴达 / Hyrox）的最好成绩", en: "The PR bar lists your best per event type (10K / Half / Marathon / Trail / Spartan / Hyrox)." },
      { zh: "填了地点的赛事会带上比赛日天气", en: "Add a location and the race shows its race-day weather." },
      { zh: "这些都会喂给 AI 教练，围绕你的目标赛来规划", en: "All of this feeds the AI coach so it plans around your goal race." },
    ],
  },
  {
    tab: 3,
    emphasis: true,
    title: { zh: "AI 教练 AI Coach", en: "AI Coach" },
    lead: {
      zh: "这是 Ultreia 的核心 —— 一个真正「懂你」的 AI 跑步教练，不是泛泛而谈的聊天机器人。",
      en: "This is the heart of Ultreia — an AI running coach that actually knows YOU, not a generic chatbot.",
    },
    bullets: [
      { zh: "它实时看到你的资料、近期训练、目标赛、长期记忆，给出**个性化**建议", en: "It sees your profile, recent training, goal races and long-term memory — and gives personalized advice." },
      { zh: "直接问它：今天该怎么练？这周量合理吗？赛前怎么调整？", en: "Just ask: what should I run today? Is this week's load OK? How do I taper?" },
      { zh: "把它给的训练建议先审核成动作卡片，再**导入到日历**", en: "Review its suggested plan as an action card, then import it into your calendar." },
      { zh: "长期记忆：它会记住你的持久偏好，越聊越懂你", en: "Long-term memory: it remembers your durable preferences and gets to know you over time." },
      { zh: "信息填得越全（资料 / 训练 / 目标赛），回复越定制", en: "The more you fill in (profile / training / goal races), the more tailored the replies." },
      { zh: "AI Coach 直接使用内置 DeepSeek，不用自己申请第三方密钥", en: "AI Coach uses the built-in DeepSeek setup. No third-party key setup is needed." },
    ],
  },
  {
    tab: 4,
    mobileOnly: true,
    title: { zh: "设置 Settings", en: "Settings" },
    lead: { zh: "账号和各种开关都在这里。", en: "Account settings and all the switches live here." },
    bullets: [
      { zh: "开关每日推送和天气自动更新", en: "Toggle daily push and automatic weather updates." },
      { zh: "修改个人资料、切换中 / 英", en: "Edit your profile and switch 中 / EN." },
      { zh: "删除账号、查看使用手册也在这里", en: "Account deletion and the user guide are here too." },
    ],
  },
];

// Render **bold** spans inside the tour copy (no full markdown needed).
function renderRich(text) {
  return String(text).split(/\*\*/).map((seg, idx) =>
    idx % 2 === 1
      ? <strong key={idx} style={{ color: "var(--ink-1)", fontWeight: 700 }}>{seg}</strong>
      : <span key={idx}>{seg}</span>
  );
}

export const TOUR_FLAG = "ultreia.tourDone.v1";

export function OnboardingTour({ isMobile, onChangeTab, onClose }) {
  const t = useT();
  const { lang } = useLanguage();
  const pick = (o) => (lang === "en" ? o.en : o.zh);

  const steps = STEPS.filter((st) => !st.mobileOnly || isMobile);
  const [i, setI] = useState(0);
  const step = steps[i];
  const last = i === steps.length - 1;

  // Drive the real tab so the page being described is actually showing behind.
  useEffect(() => {
    if (typeof step.tab !== "number") return;
    onChangeTab(step.tab);
  }, [i, step.tab, onChangeTab]);

  function finish() {
    try { localStorage.setItem(TOUR_FLAG, "1"); } catch { /* private mode */ }
    onChangeTab(0);
    onClose();
  }

  return (
    <ModalRoot onClose={finish}>
      <div style={{
        position: "fixed", inset: 0,
        background: "rgba(20,20,19,0.34)",
        display: "flex",
        alignItems: isMobile ? "flex-end" : "center",
        justifyContent: "center",
        zIndex: 9998,
        padding: 16,
        paddingBottom: isMobile ? "calc(86px + env(safe-area-inset-bottom))" : 16,
        overscrollBehavior: "contain",
      }}>
        <div key={i} className="ultreia-modal-in" style={{
          background: "var(--bg-elevated)",
          border: "1px solid var(--rule)",
          borderRadius: 10,
          boxShadow: "0 18px 50px rgba(0,0,0,0.28)",
          width: "100%", maxWidth: 380,
          maxHeight: isMobile ? "calc(100dvh - 86px - env(safe-area-inset-bottom) - 32px)" : "calc(100dvh - 32px)",
          overflowY: "auto",
          padding: "20px 22px 18px",
          boxSizing: "border-box",
          fontFamily: "var(--font-sans)",
        }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-3)",
            letterSpacing: "0.06em", marginBottom: 8,
          }}>
            <span>{i + 1} / {steps.length}</span>
            {step.emphasis && (
              <span style={{
                fontFamily: "var(--font-sans)", fontSize: 10, fontWeight: 700,
                letterSpacing: "0.04em", color: "var(--ink-inv)", background: "var(--moss)",
                padding: "2px 7px", borderRadius: 10,
              }}>{lang === "en" ? "CORE" : "核心功能"}</span>
            )}
          </div>
          <h2 style={{ fontSize: 19, fontWeight: 600, margin: "0 0 8px", color: step.emphasis ? "var(--moss-deep)" : "var(--ink-1)" }}>
            {pick(step.title)}
          </h2>
          {step.lead && (
            <p style={{ fontSize: 13.5, lineHeight: 1.6, color: "var(--ink-1)", margin: "0 0 10px", fontWeight: step.emphasis ? 600 : 400 }}>
              {renderRich(pick(step.lead))}
            </p>
          )}
          <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 7 }}>
            {step.bullets.map((b, bi) => (
              <li key={bi} style={{ fontSize: 13, lineHeight: 1.55, color: "var(--ink-2)" }}>
                {renderRich(pick(b))}
              </li>
            ))}
          </ul>

          {/* Progress dots */}
          <div style={{ display: "flex", gap: 6, justifyContent: "center", margin: "16px 0 14px" }}>
            {steps.map((_, idx) => (
              <span key={idx} style={{
                width: idx === i ? 18 : 6, height: 6, borderRadius: 3,
                background: idx === i ? "var(--accent)" : "var(--rule)",
                transition: "width 200ms, background 200ms",
              }} />
            ))}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button onClick={finish} style={{ ...s.btnGhost, fontSize: 13 }}>
              {t("tour.skip")}
            </button>
            <div style={{ flex: 1 }} />
            {i > 0 && (
              <button onClick={() => setI(i - 1)} style={{ ...s.btnGhost, fontSize: 13 }}>
                {t("tour.back")}
              </button>
            )}
            <button onClick={() => (last ? finish() : setI(i + 1))} style={{ ...s.btn, fontSize: 13 }}>
              {last ? t("common.done") : t("tour.next")}
            </button>
          </div>
        </div>
      </div>
    </ModalRoot>
  );
}
