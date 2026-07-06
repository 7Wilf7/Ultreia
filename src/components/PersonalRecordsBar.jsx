import { useMemo, useRef, useEffect, useState } from "react";
import { s } from "../styles";
import { RACE_CATEGORIES, RACE_CATEGORY_COLOR, SPARTAN_SUBTYPES } from "../constants";
import { useT } from "../i18n/LanguageContext";
import { useIsMobile } from "../hooks/useMediaQuery";
import { useInstantPress } from "../hooks/useInstantPress";

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
      let best;
      if (metric === "distance") {
        const byDist = [...group].sort((a, b) => (b.distance || 0) - (a.distance || 0));
        best = (byDist[0]?.distance || 0) > 0 ? byDist[0] : null;
      } else if (metric === "difficulty") {
        const byDiff = [...group].sort((a, b) => (SPARTAN_RANK[b.subtype] || 0) - (SPARTAN_RANK[a.subtype] || 0));
        best = SPARTAN_RANK[byDiff[0]?.subtype] ? byDiff[0] : null;
      } else {
        const byTime = [...group].sort((a, b) => resultSeconds(a) - resultSeconds(b));
        best = isFinite(resultSeconds(byTime[0])) ? byTime[0] : null;
      }
      // "Other finishes": everything except the headline PR. Trail + Spartan
      // list these chronologically (recent first) — distance/difficulty already
      // define the headline card, so a date order reads better than re-sorting
      // by the same metric. Time categories keep fastest-first (a PR ladder).
      const byDateDesc = (a, b) => (b.date || "").localeCompare(a.date || "");
      const others = metric === "time"
        ? [...group].sort((a, b) => resultSeconds(a) - resultSeconds(b)).filter(r => r !== best)
        : group.filter(r => r !== best).sort(byDateDesc);
      out.push({
        category: cat,
        metric,
        best,
        bestSeconds: best ? resultSeconds(best) : Infinity,
        others,
        total: group.length,
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
          ? "1fr"
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

  const categoryColor = RACE_CATEGORY_COLOR[rec.category] || "var(--rule)";

  // Mobile layout: a thin horizontal strip with a 4px color stripe on the
  // left, two text rows (category+metric / name+date), and the optional
  // collapsible details. Much shorter than the desktop card.
  if (isMobile) {
    return (
      <div style={{
        position: "relative",
        background: "var(--bg-elevated)",
        borderLeft: "4px solid " + categoryColor,
        padding: "10px 12px 10px 14px",
      }}>
        {/* Row 1: category (left) + metric value (right) */}
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
          <div style={{
            display: "flex", alignItems: "baseline", gap: 6, minWidth: 0, flexWrap: "wrap",
          }}>
            <span style={{ fontSize: 15, color: "var(--ink-1)", fontWeight: 600 }}>
              {t(`enum.race_cat.${rec.category}`)}
            </span>
            {(rec.metric === "distance" || rec.metric === "difficulty") && (
              <span style={{
                fontSize: 9, color: "var(--ink-3)", fontFamily: "var(--font-mono)",
                textTransform: "uppercase", letterSpacing: "0.05em",
              }}>
                {rec.metric === "distance" ? t("pr.longest") : t("pr.toughest")}
              </span>
            )}
            {isTrail && (
              <ITRABadge
                itraEditing={itraEditing} itraDraft={itraDraft} setItraDraft={setItraDraft}
                inputRef={inputRef} commitItra={commitItra} cancelItra={cancelItra}
                startItra={startItra} itraPI={itraPI} t={t}
              />
            )}
          </div>
          {rec.best && (
            <div style={{
              ...s.metricVal, fontSize: 16, lineHeight: 1.1, marginTop: 0,
              display: "flex", alignItems: "baseline", gap: 4, flexShrink: 0,
            }}>
              {rec.metric === "distance" ? (
                <>
                  <span>{rec.best.distance}</span>
                  <span style={{ fontSize: 10, color: "var(--ink-3)", fontWeight: 400, fontFamily: "var(--font-mono)" }}>km</span>
                </>
              ) : rec.metric === "difficulty" ? (
                <span>{rec.best.subtype}</span>
              ) : (
                <span>{formatHMS(rec.bestSeconds)}</span>
              )}
            </div>
          )}
        </div>

        {/* Row 2: race name (left, truncated) + date (right) — OR empty state */}
        {rec.best ? (
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, marginTop: 4 }}>
            <div style={{
              fontSize: 12, color: "var(--ink-2)", minWidth: 0, flex: 1,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {rec.best.name}
            </div>
            <div style={{ ...s.dataNum, fontSize: 11, color: "var(--ink-3)", flexShrink: 0 }}>
              {rec.best.date}
            </div>
          </div>
        ) : (
          <div style={{ ...s.muted, fontSize: 12, marginTop: 4 }}>
            {t("pr.no_times", { n: rec.total })}
          </div>
        )}

        {/* Bottom row: "+N other finishes" on the left, ITRA pinned to the
            bottom-right corner. align-items:flex-start keeps ITRA next to the
            summary line when the details list is expanded. */}
        {rec.others.length > 0 && (
          <details style={{ marginTop: 6 }}>
            <summary style={{ ...s.muted, cursor: "pointer", fontSize: 11 }}>
              + {t("pr.other_finishes", { n: rec.others.length, plural: rec.others.length > 1 ? "es" : "" })}
            </summary>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
              {rec.others.map(r => (
                <div key={r.id} style={{ ...s.dataNum, fontSize: 11, color: "var(--ink-2)", display: "flex", alignItems: "baseline", gap: 5, whiteSpace: "nowrap" }}>
                  <span style={{ flexShrink: 0 }}>
                    {rec.metric === "distance" ? (r.distance > 0 ? `${r.distance}km` : "—")
                      : rec.metric === "difficulty" ? (r.subtype || "—")
                      : formatHMS(resultSeconds(r))}
                  </span>
                  <span style={{ fontFamily: "var(--font-sans)", overflow: "hidden", textOverflow: "ellipsis", flex: 1, minWidth: 0 }}>{r.name}</span>
                  <span style={{ color: "var(--ink-3)", flexShrink: 0 }}>{r.date}</span>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>
    );
  }

  // Desktop layout: taller card with a 3px top color rule.
  return (
    <div style={{
      position: "relative",
      padding: "18px 22px 20px",
      background: "var(--bg-elevated)",
      borderTop: "3px solid " + categoryColor,
    }}>
      <div style={{
        fontSize: 16, color: "var(--ink-1)", marginBottom: 6, fontWeight: 600,
        display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap",
      }}>
        <span>{t(`enum.race_cat.${rec.category}`)}</span>
        {(rec.metric === "distance" || rec.metric === "difficulty") && (
          <span style={{
            fontSize: 10, color: "var(--ink-3)", fontFamily: "var(--font-mono)",
            textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 400,
          }}>
            {rec.metric === "distance" ? t("pr.longest") : t("pr.toughest")}
          </span>
        )}
        {isTrail && (
          <ITRABadge
            itraEditing={itraEditing} itraDraft={itraDraft} setItraDraft={setItraDraft}
            inputRef={inputRef} commitItra={commitItra} cancelItra={cancelItra}
            startItra={startItra} itraPI={itraPI} t={t}
          />
        )}
      </div>
      {rec.best ? (
        <>
          <div style={{ ...s.metricVal, fontSize: 24, display: "flex", alignItems: "baseline", gap: 6 }}>
            {rec.metric === "distance" ? (
              <>
                <span>{rec.best.distance}</span>
                <span style={{ fontSize: 13, color: "var(--ink-3)", fontWeight: 400, fontFamily: "var(--font-mono)" }}>km</span>
              </>
            ) : rec.metric === "difficulty" ? (
              <span>{rec.best.subtype}</span>
            ) : (
              <span>{formatHMS(rec.bestSeconds)}</span>
            )}
          </div>
          <div style={{ fontSize: 13, color: "var(--ink-2)", marginTop: 10, lineHeight: 1.45 }}>
            {rec.best.name}
            <div style={{ ...s.dataNum, fontSize: 12, color: "var(--ink-3)", marginTop: 3 }}>{rec.best.date}</div>
          </div>
        </>
      ) : (
        <div style={{ ...s.muted, marginTop: 4 }}>{t("pr.no_times", { n: rec.total })}</div>
      )}
      {rec.others.length > 0 && (
        <details style={{ marginTop: 10 }}>
          <summary style={{ ...s.muted, cursor: "pointer", fontSize: 12 }}>
            + {t("pr.other_finishes", { n: rec.others.length, plural: rec.others.length > 1 ? "es" : "" })}
          </summary>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 8 }}>
            {rec.others.map(r => (
              <div key={r.id} style={{ ...s.dataNum, fontSize: 12, color: "var(--ink-2)", display: "flex", alignItems: "baseline", gap: 6, whiteSpace: "nowrap" }}>
                <span style={{ flexShrink: 0 }}>
                  {rec.metric === "distance" ? (r.distance > 0 ? `${r.distance}km` : "—")
                    : rec.metric === "difficulty" ? (r.subtype || "—")
                    : formatHMS(resultSeconds(r))}
                </span>
                <span style={{ fontFamily: "var(--font-sans)", overflow: "hidden", textOverflow: "ellipsis", flex: 1, minWidth: 0 }}>{r.name}</span>
                <span style={{ color: "var(--ink-3)", flexShrink: 0 }}>{r.date}</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

// ITRA chip — Trail card only. Same visual on desktop and mobile; the
// inline editor (click chip → input + Save) lives in the same corner.
function ITRABadge({
  itraEditing, itraDraft, setItraDraft,
  inputRef, commitItra, cancelItra, startItra,
  itraPI, t,
}) {
  const instantPress = useInstantPress();
  return (
    <div style={{ flexShrink: 0 }}>
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
        <button
          {...instantPress("itra-start-edit", startItra)}
          title={t("pr.itra_title")}
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10, fontWeight: 600,
            padding: "2px 7px",
            // minHeight:0 overrides the global mobile button min-height:40px so
            // the badge stays short — otherwise the Trail PR card is taller than
            // every other category's card.
            minHeight: 0, lineHeight: 1.5,
            border: "1px solid var(--moss)",
            touchAction: "manipulation",
            WebkitTapHighlightColor: "transparent",
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
  );
}
