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
    tab: 0,
    title: { zh: "训练 Training", en: "Training" },
    body: {
      zh: "记录每一次训练 —— 路跑、越野、徒步、力量、HIIT。可手动添加，或从 Garmin 导出的 CSV 批量导入。顶部能切到图表看距离 / 强度 / 心率趋势。",
      en: "Log every session — road, trail, hiking, strength, HIIT. Add manually or bulk-import a Garmin CSV. Switch to the charts up top for distance / intensity / HR trends.",
    },
  },
  {
    tab: 1,
    title: { zh: "日历 Calendar", en: "Calendar" },
    body: {
      zh: "月历一眼看清每天练了什么、还安排了什么。点某天可以加训练或加计划；长按某条活动能改或删；上下滑动切换月份。",
      en: "A month grid of what you did and what's planned. Tap a day to add a workout or a plan; long-press an activity to edit or delete; swipe up/down to change month.",
    },
  },
  {
    tab: 2,
    title: { zh: "比赛 Races", en: "Races" },
    body: {
      zh: "管理目标比赛和历史成绩。给目标赛标 A/B/C 优先级，顶部 PR 栏会自动展示你每个项目（10K / 半马 / 全马 / 越野…）的最好成绩。",
      en: "Manage target races and past results. Tag goals A/B/C; the PR bar up top auto-shows your best result per event type (10K / Half / Marathon / Trail…).",
    },
  },
  {
    tab: 3,
    title: { zh: "AI 教练 AI Coach", en: "AI Coach" },
    body: {
      zh: "你的私人 AI 跑步教练。它能看到你的资料、近期训练和目标赛，给个性化建议，还能把训练计划一键放进日历。使用前先在设置里填好 AI 的 API key。",
      en: "Your personal AI running coach. It sees your profile, recent training and goal races, gives tailored advice, and can drop a plan straight into your calendar. Add an AI API key in Settings first.",
    },
  },
  {
    tab: 4,
    mobileOnly: true,
    title: { zh: "设置 Settings", en: "Settings" },
    body: {
      zh: "在这里填 AI 和天气的 API key、开关每日推送、修改个人资料和切换语言。",
      en: "Set your AI and weather API keys, toggle the daily push, edit your profile, and switch language here.",
    },
  },
];

export const TOUR_FLAG = "ts-tour-done-v1";

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
        <div key={i} className="ts-modal-in" style={{
          background: "var(--bg-elevated)",
          border: "1px solid var(--rule)",
          borderRadius: 10,
          boxShadow: "0 18px 50px rgba(0,0,0,0.28)",
          width: "100%", maxWidth: 380,
          padding: "20px 22px 18px",
          boxSizing: "border-box",
          fontFamily: "var(--font-sans)",
        }}>
          <div style={{
            fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-3)",
            letterSpacing: "0.06em", marginBottom: 8,
          }}>
            {i + 1} / {steps.length}
          </div>
          <h2 style={{ fontSize: 19, fontWeight: 600, margin: "0 0 8px", color: "var(--ink-1)" }}>
            {pick(step.title)}
          </h2>
          <p style={{ fontSize: 13.5, lineHeight: 1.65, color: "var(--ink-2)", margin: 0 }}>
            {pick(step.body)}
          </p>

          {/* Progress dots */}
          <div style={{ display: "flex", gap: 6, justifyContent: "center", margin: "16px 0 14px" }}>
            {steps.map((_, idx) => (
              <span key={idx} style={{
                width: idx === i ? 18 : 6, height: 6, borderRadius: 3,
                background: idx === i ? "var(--ink-1)" : "var(--rule)",
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
