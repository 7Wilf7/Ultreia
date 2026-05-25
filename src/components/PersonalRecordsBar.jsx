import { useMemo, useRef, useEffect, useState } from "react";
import { s } from "../styles";
import { RACE_CATEGORIES, RACE_CATEGORY_COLOR, SPARTAN_SUBTYPES } from "../constants";
import { useT } from "../i18n/LanguageContext";
import { useIsMobile } from "../hooks/useMediaQuery";

// ─────────────────────────────────────────────────────────────────────────
// PersonalRecordsBar — the compact PR row that lives at the top of the
// Races tab. Replaces the old standalone PR tab. Differences vs. that old
// tab:
//   • Vertical dividers are computed per row (we measure actual layout, so
//     auto-fit wrapping doesn't leave a missing line between e.g. Spartan
//     and Hyrox — the old bug from the modulo-4 hack).
//   • ITRA isn't a separate big card any more — it sits as a tiny corner
//     badge on the Trail card (click to edit).
// ─────────────────────────────────────────────────────────────────────────

function resultSeconds(r) {
  const h = parseInt(r.resultH) || 0;
  const m = parseInt(r.resultM) || 0;
  const sec = parseInt(r.resultS) || 0;
  const total = h * 3600 + m * 60 + sec;
  return total > 0 ? total : Infinity;
}

const DISTANCE_RANKED_CATEGORIES = new Set(["Trail"]);
const DIFFICULTY_RANKED_CATEGORIES = new Set(["Spartan"]);

const SPARTAN_RANK = SPARTAN_SUBTYPES.reduce((acc, name, i) => {
  acc[name] = i + 1;
  return acc;
}, {});

function formatHMS(sec) {
  if (!isFinite(sec)) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const ss = Math.round(sec % 60);
  return `${String(h).padStart(1, "0")}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

export function PersonalRecordsBar({ races, itraPI, setItraPI }) {
  const t = useT();
  const isMobile = useIsMobile();

  const records = useMemo(() => {
    const history = races.filter(r => !r.isTarget);
    const byCategory = {};
    for (const r of history) {
      const cat = r.category || "Uncategorized";
      if (!byCategory[cat]) byCategory[cat] = [];
      byCategory[cat].push(r);
    }
    const out = [];
    const allCats = [...RACE_CATEGORIES, "Uncategorized"];
    for (const cat of allCats) {
      const group = byCategory[cat];
      if (!group || group.length === 0) continue;
      const metric = DISTANCE_RANKED_CATEGORIES.has(cat) ? "distance"
        : DIFFICULTY_RANKED_CATEGORIES.has(cat) ? "difficulty"
        : "time";
      let sorted, best;
      if (metric === "distance") {
        sorted = [...group].sort((a, b) => (b.distance || 0) - (a.distance || 0));
        best = (sorted[0]?.distance || 0) > 0 ? sorted[0] : null;
      } else if (metric === "difficulty") {
        sorted = [...group].sort((a, b) => (SPARTAN_RANK[b.subtype] || 0) - (SPARTAN_RANK[a.subtype] || 0));
        best = SPARTAN_RANK[sorted[0]?.subtype] ? sorted[0] : null;
      } else {
        sorted = [...group].sort((a, b) => resultSeconds(a) - resultSeconds(b));
        const bestSec = resultSeconds(sorted[0]);
        best = isFinite(bestSec) ? sorted[0] : null;
      }
      out.push({
        category: cat,
        metric,
        best,
        bestSeconds: best ? resultSeconds(best) : Infinity,
        all: sorted,
      });
    }
    return out;
  }, [races]);

  // Vertical-divider strategy: render every card with a left border, AND a
  // left border on the container — the leftmost card's border doubles up
  // against the container border (still looks like 1px due to overlap).
  // This avoids the old "(i+1)%4 === 0 → no right border" trick which broke
  // when the grid auto-fitted to 5 columns and dropped the Spartan/Hyrox
  // divider. The CSS Grid + per-cell left-border approach works for any
  // wrap count.
  if (records.length === 0) {
    return (
      <div style={{ ...s.cardDark, textAlign: "center", color: "var(--ink-3)", padding: "24px 16px", fontSize: 13, marginBottom: 22 }}>
        {t("pr.empty")}
      </div>
    );
  }

  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{ ...s.section, marginBottom: 8 }}>{t("pr.title")}</div>
      {/* gap:1px + container bg = --rule draws clean divider lines between
          every cell, no matter the wrap count. Each cell paints its own
          bg-elevated so the gap shows through as a 1px rule. Works for the
          desktop auto-fit grid AND the mobile fixed-2-col grid. */}
      <div style={{
        display: "grid",
        gridTemplateColumns: isMobile
          ? "repeat(2, minmax(0, 1fr))"
          : "repeat(auto-fit, minmax(200px, 1fr))",
        gap: 1,
        border: "1px solid var(--rule)",
        background: "var(--rule)",
      }}>
        {records.map((rec) => (
          <PRCell
            key={rec.category}
            rec={rec}
            itraPI={itraPI}
            setItraPI={setItraPI}
            t={t}
            isMobile={isMobile}
          />
        ))}
      </div>
    </div>
  );
}

// One PR cell. Self-contained so the Trail card can host its own inline
// ITRA editor without leaking state up.
function PRCell({ rec, itraPI, setItraPI, t, isMobile }) {
  const isTrail = rec.category === "Trail";
  const [itraEditing, setItraEditing] = useState(false);
  const [itraDraft, setItraDraft] = useState(itraPI ?? "");
  const inputRef = useRef(null);

  useEffect(() => {
    if (itraEditing && inputRef.current) inputRef.current.focus();
  }, [itraEditing]);

  function startItra(e) {
    e.stopPropagation();
    setItraDraft(itraPI ?? "");
    setItraEditing(true);
  }
  function commitItra() {
    setItraPI(itraDraft.trim());
    setItraEditing(false);
  }
  function cancelItra() {
    setItraDraft(itraPI ?? "");
    setItraEditing(false);
  }

  return (
    <div style={{
      position: "relative",
      padding: isMobile ? "12px 14px 14px" : "18px 22px 20px",
      background: "var(--bg-elevated)",
      borderTop: "3px solid " + (RACE_CATEGORY_COLOR[rec.category] || "var(--rule)"),
    }}>
      {/* ITRA badge — Trail card only. Tiny chip in the top-right corner. */}
      {isTrail && (
        <div style={{ position: "absolute", top: 8, right: 10 }}>
          {itraEditing ? (
            <div style={{ display: "flex", gap: 4, alignItems: "center" }} onClick={e => e.stopPropagation()}>
              <input ref={inputRef} type="number" value={itraDraft}
                placeholder={t("pr.itra_placeholder")}
                onChange={e => setItraDraft(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter") commitItra();
                  if (e.key === "Escape") cancelItra();
                }}
                style={{ ...s.input, width: 70, padding: "2px 6px", fontSize: 11, height: 24 }} />
              <button onClick={commitItra} style={{
                ...s.btnGhost, fontSize: 10, padding: "2px 7px", lineHeight: 1.4,
              }}>{t("common.save")}</button>
            </div>
          ) : (
            <button onClick={startItra} title={t("pr.itra_title")}
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10, fontWeight: 600,
                padding: "2px 7px",
                border: "1px solid var(--moss)",
                background: "var(--moss-bg)",
                color: "var(--moss-deep)",
                cursor: "pointer",
                letterSpacing: "0.04em",
                textTransform: "uppercase",
              }}>
              ITRA {itraPI || "+"}
            </button>
          )}
        </div>
      )}

      <div style={{
        fontSize: isMobile ? 12 : 13, color: "var(--ink-2)",
        marginBottom: isMobile ? 4 : 6, fontWeight: 500,
        display: "flex", alignItems: "baseline", gap: 6,
        flexWrap: "wrap",
        paddingRight: isTrail ? (isMobile ? 52 : 70) : 0,
      }}>
        <span>{t(`enum.race_cat.${rec.category}`)}</span>
        {(rec.metric === "distance" || rec.metric === "difficulty") && (
          <span style={{
            fontSize: isMobile ? 9 : 10, color: "var(--ink-3)", fontFamily: "var(--font-mono)",
            textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 400,
          }}>
            {rec.metric === "distance" ? t("pr.longest") : t("pr.toughest")}
          </span>
        )}
      </div>
      {rec.best ? (
        <>
          <div style={{ ...s.metricVal, fontSize: isMobile ? 18 : 24, display: "flex", alignItems: "baseline", gap: 6 }}>
            {rec.metric === "distance" ? (
              <>
                <span>{rec.best.distance}</span>
                <span style={{ fontSize: isMobile ? 11 : 13, color: "var(--ink-3)", fontWeight: 400, fontFamily: "var(--font-mono)" }}>km</span>
              </>
            ) : rec.metric === "difficulty" ? (
              <span>{rec.best.subtype}</span>
            ) : (
              <span>{formatHMS(rec.bestSeconds)}</span>
            )}
          </div>
          <div style={{
            fontSize: isMobile ? 12 : 13, color: "var(--ink-2)",
            marginTop: isMobile ? 6 : 10, lineHeight: 1.4,
            overflow: "hidden", textOverflow: "ellipsis",
            display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
          }}>
            {rec.best.name}
          </div>
          <div style={{ ...s.dataNum, fontSize: isMobile ? 11 : 12, color: "var(--ink-3)", marginTop: 3 }}>
            {rec.best.date}
          </div>
        </>
      ) : (
        <div style={{ ...s.muted, marginTop: 4, fontSize: isMobile ? 12 : 13 }}>{t("pr.no_times", { n: rec.all.length })}</div>
      )}
      {rec.all.length > 1 && (
        <details style={{ marginTop: isMobile ? 6 : 10 }}>
          <summary style={{ ...s.muted, cursor: "pointer", fontSize: isMobile ? 11 : 12 }}>
            + {t("pr.other_finishes", { n: rec.all.length - 1, plural: rec.all.length > 2 ? "es" : "" })}
          </summary>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 8 }}>
            {rec.all.slice(1).map(r => (
              <div key={r.id} style={{ ...s.dataNum, fontSize: isMobile ? 11 : 12, color: "var(--ink-2)" }}>
                {rec.metric === "distance" ? (r.distance > 0 ? `${r.distance}km` : "—")
                  : rec.metric === "difficulty" ? (r.subtype || "—")
                  : formatHMS(resultSeconds(r))}
                {" · "}<span style={{ fontFamily: "var(--font-sans)" }}>{r.name}</span> · <span style={{ color: "var(--ink-3)" }}>{r.date}</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
