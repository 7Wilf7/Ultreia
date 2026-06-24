import { useMemo, useState } from "react";
import { s } from "../styles";
import { RACE_CATEGORIES, RACE_CATEGORY_COLOR, SPARTAN_SUBTYPES } from "../constants";
import { useT } from "../i18n/LanguageContext";
import { useClickOutside } from "../utils/useClickOutside";
import { useAppDialog } from "./AppDialogContext";

function resultSeconds(r) {
  const h = parseInt(r.resultH) || 0;
  const m = parseInt(r.resultM) || 0;
  const sec = parseInt(r.resultS) || 0;
  const total = h * 3600 + m * 60 + sec;
  return total > 0 ? total : Infinity;
}

// Trail varies in length, so the headline metric is the longest distance.
// Spartan ranks by tier difficulty (Ultra > Beast > Super > Sprint) — distance
// isn't a clean signal for it. Other categories (Half Marathon / Marathon /
// 10K / Hyrox) all run a fixed distance, so fastest time is the right rep.
const DISTANCE_RANKED_CATEGORIES = new Set(["Trail"]);
const DIFFICULTY_RANKED_CATEGORIES = new Set(["Spartan"]);

const SPARTAN_RANK = SPARTAN_SUBTYPES.reduce((acc, name, i) => {
  acc[name] = i + 1;   // Sprint=1, Super=2, Beast=3, Ultra=4
  return acc;
}, {});

function formatHMS(sec) {
  if (!isFinite(sec)) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const ss = Math.round(sec % 60);
  return `${String(h).padStart(1, "0")}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

export function PersonalRecordsTab({ races, itraPI, setItraPI }) {
  const t = useT();
  const appDialog = useAppDialog();
  const [itraDraft, setItraDraft] = useState(itraPI ?? "");
  // Card mode while a value is saved; switches to edit form on click. First-time
  // fill (no value yet) shows the form immediately so the user has something to do.
  const [itraEditing, setItraEditing] = useState(!itraPI);

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
        // Longest distance wins. Null/0 distance sorts last.
        sorted = [...group].sort((a, b) => (b.distance || 0) - (a.distance || 0));
        best = (sorted[0]?.distance || 0) > 0 ? sorted[0] : null;
      } else if (metric === "difficulty") {
        // Highest Spartan tier wins (Ultra=4 > Beast=3 > Super=2 > Sprint=1).
        // Unknown / missing subtype sorts last.
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

  function saveItra() {
    const v = itraDraft.trim();
    setItraPI(v);
    // Drop back to card view once a value is saved
    if (v) setItraEditing(false);
  }

  function startEditItra() {
    setItraDraft(itraPI ?? "");
    setItraEditing(true);
  }

  function cancelEditItra() {
    setItraDraft(itraPI ?? "");
    setItraEditing(false);
  }

  // Click-outside collapses the ITRA edit form back to its card. Only active
  // when there's already a saved value (first-time fill has no card to fall
  // back to, so we never auto-dismiss the initial entry).
  const itraDirty = () => (itraDraft.trim() !== (itraPI ?? ""));
  const itraEditRef = useClickOutside(async () => {
    if (!itraDirty() || await appDialog.confirm(t("form.discard_confirm"))) cancelEditItra();
  }, itraEditing && !!itraPI);

  return (
    <div>
      <div style={s.section}>{t("pr.title")}</div>

      {records.length === 0 ? (
        <div style={{ ...s.cardDark, textAlign: "center", color: "var(--ink-3)", padding: "32px 16px", fontSize: 14, lineHeight: 1.6 }}>
          {t("pr.empty")}
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 0, marginBottom: 24, border: "1px solid var(--rule)", background: "var(--bg-elevated)" }}>
          {records.map((rec, i) => (
            <div key={rec.category} style={{
              padding: "18px 22px 20px",
              borderRight: (i + 1) % 4 === 0 ? "none" : "1px solid var(--rule)",
              borderBottom: "1px solid var(--rule)",
              borderTop: "3px solid " + (RACE_CATEGORY_COLOR[rec.category] || "var(--rule)"),
              position: "relative",
            }}>
              <div style={{ fontSize: 13, color: "var(--ink-2)", marginBottom: 6, fontWeight: 500, display: "flex", alignItems: "baseline", gap: 8 }}>
                <span>{t(`enum.race_cat.${rec.category}`)}</span>
                {(rec.metric === "distance" || rec.metric === "difficulty") && (
                  <span style={{ fontSize: 10, color: "var(--ink-3)", fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 400 }}>
                    {rec.metric === "distance" ? t("pr.longest") : t("pr.toughest")}
                  </span>
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
                <div style={{ ...s.muted, marginTop: 4 }}>{t("pr.no_times", { n: rec.all.length })}</div>
              )}
              {rec.all.length > 1 && (
                <details style={{ marginTop: 10 }}>
                  <summary style={{ ...s.muted, cursor: "pointer", fontSize: 12 }}>
                    + {t("pr.other_finishes", { n: rec.all.length - 1, plural: rec.all.length > 2 ? "es" : "" })}
                  </summary>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 8 }}>
                    {rec.all.slice(1).map(r => (
                      <div key={r.id} style={{ ...s.dataNum, fontSize: 12, color: "var(--ink-2)" }}>
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
          ))}
        </div>
      )}

      {itraEditing ? (
        <div ref={itraEditRef} style={{ ...s.cardDark, marginBottom: 14 }}>
          <div style={s.section}>{t("pr.itra_title")}</div>
          <div style={{ ...s.muted, marginBottom: 8, lineHeight: 1.6 }}>{t("pr.itra_desc")}</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input
              type="number"
              placeholder={t("pr.itra_placeholder")}
              value={itraDraft}
              onChange={e => setItraDraft(e.target.value)}
              style={{ ...s.input, maxWidth: 120 }}
            />
            <button onClick={saveItra}
              disabled={itraDraft === (itraPI ?? "")}
              style={{ ...s.btn, opacity: itraDraft === (itraPI ?? "") ? 0.5 : 1 }}>{t("common.save")}</button>
            {itraPI && (
              <button onClick={cancelEditItra} style={s.btnGhost}>{t("common.cancel")}</button>
            )}
          </div>
        </div>
      ) : (
        <div onClick={startEditItra} style={{ ...s.card, cursor: "pointer", marginBottom: 14, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", borderLeft: "3px solid var(--moss)" }}>
          <div>
            <div style={{ fontSize: 13, color: "var(--ink-2)", marginBottom: 4, fontWeight: 500 }}>{t("pr.itra_title")}</div>
            <div style={{ ...s.metricVal, fontSize: 30, display: "flex", alignItems: "baseline", gap: 8 }}>
              <span>{itraPI}</span>
              <span style={{ fontSize: 12, color: "var(--ink-3)", fontWeight: 400, fontFamily: "var(--font-mono)" }}>ITRA</span>
            </div>
          </div>
          <span style={{ fontSize: 12, color: "var(--ink-3)" }}>{t("pr.itra_edit_hint")} →</span>
        </div>
      )}
    </div>
  );
}
