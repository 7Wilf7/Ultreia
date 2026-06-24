import { useEffect, useState } from "react";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { useT } from "../i18n/LanguageContext";
import { formatWalletAmount, notifyAdminPayment } from "../lib/db/wallet";
import { useIsMobile } from "../hooks/useMediaQuery";
import { ModalRoot } from "./ModalRoot";
import { Spinner } from "./Spinner";
import { s } from "../styles";

const WALLET_INFO_SEEN_KEY = "ultreia.wallet.pricingInfoSeen";
const PAYMENT_QR_URL = "/ultreia-payment.jpg";
const PosterSaver = registerPlugin("PosterSaver");

const LEDGER_PERIODS = [
  { id: "all", days: null, labelKey: "wallet.period_all" },
  { id: "7d", days: 7, labelKey: "wallet.period_7d" },
  { id: "30d", days: 30, labelKey: "wallet.period_30d" },
  { id: "90d", days: 90, labelKey: "wallet.period_90d" },
];

function ledgerLabel(t, kind) {
  return t(`wallet.ledger_${kind || "unknown"}`);
}

function walletLedgerLabel(t, row) {
  if (row?.kind === "welcome_grant" && String(row.provider || row.metadata?.provider || "").toLowerCase() === "admin") {
    return t("wallet.ledger_admin_grant");
  }
  return ledgerLabel(t, row?.kind);
}

function ledgerProviderLabel(row) {
  if (row?.kind !== "ai_charge") return "";
  const provider = String(row.provider || row.metadata?.provider || "").toLowerCase();
  if (provider === "claude") return "Claude";
  if (provider === "deepseek") return "DeepSeek";
  return "";
}

function formatTime(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function filterLedgerByPeriod(ledger, periodId) {
  const period = LEDGER_PERIODS.find(p => p.id === periodId) || LEDGER_PERIODS[0];
  if (!period.days) return ledger;
  const cutoff = Date.now() - period.days * 86400000;
  return ledger.filter((row) => {
    const ts = row?.createdAt ? new Date(row.createdAt).getTime() : NaN;
    return Number.isFinite(ts) && ts >= cutoff;
  });
}

function PricingInfo() {
  const t = useT();
  const rows = [
    { title: t("wallet.pricing_deepseek_title"), body: t("wallet.pricing_deepseek_body") },
    { title: t("wallet.pricing_weather_title"), body: t("wallet.pricing_weather_body") },
  ];
  return (
    <div style={{
      border: "1px solid var(--rule)",
      borderRadius: 8,
      padding: "11px 12px",
      background: "var(--bg-elevated)",
      marginBottom: 14,
      fontSize: 12,
      lineHeight: 1.55,
      color: "var(--ink-2)",
    }}>
      <div style={{ fontWeight: 700, color: "var(--ink-1)", marginBottom: 8 }}>
        {t("wallet.pricing_title")}
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        {rows.map((row) => (
          <div key={row.title}>
            <div style={{ fontWeight: 700, color: "var(--ink-1)", marginBottom: 2 }}>{row.title}</div>
            <div>{row.body}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

async function imageUrlToPngDataUrl(url) {
  const blob = await fetch(url).then((res) => {
    if (!res.ok) throw new Error("image_fetch_failed");
    return res.blob();
  });
  const bitmapUrl = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = "async";
    const loaded = new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
    });
    img.src = bitmapUrl;
    await loaded;
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas_unavailable");
    ctx.drawImage(img, 0, 0);
    return canvas.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(bitmapUrl);
  }
}

function TopUpModal({ userEmail, onClose }) {
  const t = useT();
  const isMobile = useIsMobile();
  const [amount, setAmount] = useState("");
  const [notifyFormOpen, setNotifyFormOpen] = useState(false);
  const [notifySent, setNotifySent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notifying, setNotifying] = useState(false);
  const [msg, setMsg] = useState("");
  const amountNumber = Number(amount);
  const amountCents = Number.isFinite(amountNumber) ? Math.round(amountNumber * 100) : 0;
  const canNotify = amountCents > 0 && !notifying;

  async function saveQr() {
    if (saving) return;
    setSaving(true);
    setMsg("");
    try {
      const dataUrl = await imageUrlToPngDataUrl(PAYMENT_QR_URL);
      if (Capacitor.isNativePlatform?.() === true) {
        await PosterSaver.savePng({ fileName: "ultreia-payment.png", data: dataUrl });
      } else {
        const a = document.createElement("a");
        a.href = dataUrl;
        a.download = "ultreia-payment.png";
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
      setMsg(t("wallet.topup_save_success"));
    } catch (e) {
      setMsg(t("wallet.topup_save_failed", { msg: e?.message || String(e) }));
    } finally {
      setSaving(false);
    }
  }

  async function notifyAdmin() {
    if (!canNotify) return;
    setNotifying(true);
    setMsg("");
    try {
      const res = await notifyAdminPayment({ amountCents });
      setNotifySent(true);
      if (Number(res?.sent || 0) <= 0) {
        const hasToken = Number(res?.subscription_count || 0) > 0;
        const key = hasToken
          ? "wallet.topup_notify_push_failed"
          : "wallet.topup_notify_push_no_device";
        setMsg(t(key));
      }
      setAmount("");
    } catch (e) {
      setMsg(t("wallet.topup_notify_failed", { msg: e?.message || String(e) }));
    } finally {
      setNotifying(false);
    }
  }

  return (
    <ModalRoot onClose={onClose}>
      <div onClick={onClose} style={s.modalOverlay(isMobile, { float: true })}>
        <div onClick={(e) => e.stopPropagation()} style={s.modalCard(isMobile, { maxWidth: 440, float: true })}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, marginBottom: 10 }}>
            <h2 style={{ fontSize: 19, fontWeight: 600, margin: 0, color: "var(--ink-1)" }}>
              {notifySent ? t("wallet.topup_notify_sent_title") : t("wallet.topup_title")}
            </h2>
            <button onClick={onClose} style={s.modalCloseBtn} aria-label="Close">×</button>
          </div>

          {notifySent ? (
            <>
              <div style={{
                border: "1px solid var(--rule)",
                borderRadius: 8,
                padding: "14px 14px",
                background: "var(--bg-sunken)",
                marginBottom: 14,
                lineHeight: 1.65,
                fontSize: 13,
                color: "var(--ink-2)",
              }}>
                <div style={{ fontWeight: 700, color: "var(--ink-1)", marginBottom: 6 }}>
                  {t("wallet.topup_notify_sent_heading")}
                </div>
                <div>{t("wallet.topup_notify_sent_body")}</div>
                {msg && (
                  <div style={{
                    marginTop: 10,
                    padding: "8px 10px",
                    borderRadius: 6,
                    background: "rgba(181,78,26,0.07)",
                    border: "1px solid rgba(181,78,26,0.22)",
                    color: "var(--ink-2)",
                  }}>
                    {msg}
                  </div>
                )}
              </div>
              <button type="button" onClick={onClose} style={{ ...s.btn, width: "100%" }}>
                {t("common.done")}
              </button>
            </>
          ) : (
            <>
          <div style={{
            border: "1px solid var(--rule)",
            borderRadius: 8,
            padding: 10,
            background: "var(--bg-sunken)",
            marginBottom: 12,
          }}>
            <img
              src={PAYMENT_QR_URL}
              alt={t("wallet.topup_qr_alt")}
              style={{ display: "block", width: "100%", maxHeight: "48vh", objectFit: "contain", borderRadius: 6 }}
            />
          </div>

          <p style={{ ...s.muted, lineHeight: 1.65, fontSize: 12, margin: "0 0 12px" }}>
            {t("wallet.topup_instruction", { email: userEmail || t("wallet.topup_email_unknown") })}
          </p>
          <div style={{
            background: "rgba(181,78,26,0.07)",
            color: "var(--ink-2)",
            border: "1px solid rgba(181,78,26,0.22)",
            borderRadius: 6,
            padding: "9px 11px",
            fontSize: 12,
            lineHeight: 1.55,
            marginBottom: 12,
          }}>
            {t("wallet.topup_manual_notice")}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
            <button type="button" onClick={saveQr} disabled={saving} style={{ ...s.btnGhost, minHeight: 40, opacity: saving ? 0.65 : 1 }}>
              {saving ? t("wallet.topup_saving") : t("wallet.topup_save_qr")}
            </button>
            <button
              type="button"
              onClick={() => {
                setNotifyFormOpen(true);
                setMsg(t("wallet.topup_enter_amount"));
              }}
              style={{ ...s.btn, minHeight: 40 }}
            >
              {t("wallet.topup_notify_admin")}
            </button>
          </div>

          {notifyFormOpen && (
            <>
              <label style={{ display: "block", marginBottom: 10 }}>
                <div style={s.label}>{t("wallet.topup_amount")}</div>
                <input
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="10"
                  style={{ ...s.input, fontFamily: "var(--font-mono)" }}
                />
              </label>

              <button
                type="button"
                onClick={notifyAdmin}
                disabled={!canNotify}
                style={{ ...s.btn, width: "100%", opacity: canNotify ? 1 : 0.5 }}
              >
                {notifying ? t("wallet.topup_notifying") : t("wallet.topup_submit_notify")}
              </button>
            </>
          )}

          {msg && (
            <div style={{
              color: msg.startsWith("✕") ? "var(--danger)" : "var(--moss-deep)",
              fontSize: 12,
              lineHeight: 1.5,
              marginTop: 10,
            }}>
              {msg}
            </div>
          )}
            </>
          )}
        </div>
      </div>
    </ModalRoot>
  );
}

export function WalletPanel({ wallet, onRefresh, userEmail }) {
  const t = useT();
  const [refreshing, setRefreshing] = useState(false);
  const [period, setPeriod] = useState("all");
  const [showInfo, setShowInfo] = useState(() => {
    try {
      return localStorage.getItem(WALLET_INFO_SEEN_KEY) !== "1";
    } catch {
      return true;
    }
  });
  const [showTopUp, setShowTopUp] = useState(false);
  const currency = wallet?.currency || "CNY";
  const ledger = Array.isArray(wallet?.ledger) ? wallet.ledger : [];
  const visibleLedger = filterLedgerByPeriod(ledger, period).slice(0, 10);

  useEffect(() => {
    if (!showInfo) {
      try { localStorage.setItem(WALLET_INFO_SEEN_KEY, "1"); } catch { /* ignore */ }
    }
  }, [showInfo]);

  async function refresh() {
    if (!onRefresh || refreshing) return;
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  }

  function topUp() {
    setShowTopUp(true);
  }

  return (
    <div>
      <div style={{
        border: "1px solid var(--rule)",
        borderRadius: 8,
        padding: "14px 14px",
        background: "var(--bg-sunken)",
        marginBottom: 14,
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <div style={{ ...s.muted, fontSize: 12 }}>{t("wallet.balance")}</div>
          <button
            type="button"
            onClick={() => setShowInfo(v => !v)}
            aria-label={t("wallet.info_toggle")}
            title={t("wallet.info_toggle")}
            style={{
              width: 24,
              height: 24,
              minHeight: 0,
              borderRadius: 999,
              border: "1px solid var(--rule)",
              background: showInfo ? "var(--accent)" : "var(--bg-elevated)",
              color: showInfo ? "var(--bg-deep)" : "var(--ink-2)",
              fontFamily: "var(--font-mono)",
              fontSize: 13,
              fontWeight: 700,
              lineHeight: 1,
            }}
          >
            !
          </button>
        </div>
        <div style={{
          fontFamily: "var(--font-sans)",
          fontSize: 28,
          lineHeight: 1.1,
          fontWeight: 700,
          color: "var(--ink-1)",
          marginTop: 4,
        }}>
          {formatWalletAmount(wallet?.balanceCents || 0, currency)}
        </div>
      </div>

      {showInfo && <PricingInfo />}

      <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
        <button type="button" onClick={topUp} style={{ ...s.btn, flex: 1 }}>
          {t("wallet.topup")}
        </button>
        <button type="button" onClick={refresh} disabled={refreshing} style={{ ...s.btnGhost, minWidth: 96, opacity: refreshing ? 0.65 : 1 }}>
          {refreshing ? <Spinner /> : t("wallet.refresh")}
        </button>
      </div>

      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
        marginBottom: 8,
      }}>
        <div style={{ ...s.section, marginBottom: 0 }}>{t("wallet.ledger")}</div>
        <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
          {LEDGER_PERIODS.map((p) => {
            const active = period === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setPeriod(p.id)}
                style={{
                  ...s.btnGhost,
                  minHeight: 0,
                  padding: "4px 8px",
                  fontSize: 11,
                  borderColor: active ? "var(--ink-1)" : "var(--rule)",
                  color: active ? "var(--ink-1)" : "var(--ink-3)",
                  background: active ? "var(--bg-sunken)" : "transparent",
                }}
              >
                {t(p.labelKey)}
              </button>
            );
          })}
        </div>
      </div>

      <div style={{
        border: "1px solid var(--rule)",
        borderRadius: 8,
        overflow: "hidden",
        background: "var(--bg-elevated)",
      }}>
        {visibleLedger.length === 0 ? (
          <div style={{ padding: 14, ...s.muted }}>{t("wallet.ledger_empty")}</div>
        ) : visibleLedger.map((row, idx) => {
          const amount = Number(row.amountCents || 0);
          const positive = amount > 0;
          const providerLabel = ledgerProviderLabel(row);
          return (
            <div key={row.id || `${row.createdAt}-${amount}-${idx}`} style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              padding: "10px 12px",
              borderBottom: idx === visibleLedger.length - 1 ? "none" : "1px solid var(--rule)",
            }}>
              <div style={{ minWidth: 0 }}>
                <div style={{
                  fontFamily: "var(--font-sans)",
                  fontSize: 13,
                  fontWeight: 600,
                  color: "var(--ink-1)",
                  overflow: "hidden",
                  whiteSpace: "nowrap",
                  textOverflow: "ellipsis",
                }}>
                  {providerLabel ? `${walletLedgerLabel(t, row)} · ${providerLabel}` : walletLedgerLabel(t, row)}
                </div>
                <div style={{ ...s.muted, fontSize: 11, marginTop: 2 }}>{formatTime(row.createdAt)}</div>
              </div>
              <div style={{
                fontFamily: "var(--font-mono)",
                fontSize: 13,
                fontWeight: 700,
                color: positive ? "var(--moss)" : "var(--ink-2)",
                flexShrink: 0,
              }}>
                {positive ? "+" : "-"}{formatWalletAmount(Math.abs(amount), currency)}
              </div>
            </div>
          );
        })}
      </div>
      {filterLedgerByPeriod(ledger, period).length > 10 && (
        <div style={{ ...s.muted, fontSize: 11, marginTop: 8 }}>
          {t("wallet.ledger_recent_limit")}
        </div>
      )}
      {showTopUp && (
        <TopUpModal
          userEmail={userEmail}
          onClose={() => setShowTopUp(false)}
        />
      )}
    </div>
  );
}

export function WalletModal({ wallet, onClose, onRefresh, userEmail }) {
  const t = useT();
  const isMobile = useIsMobile();

  return (
    <ModalRoot onClose={onClose}>
      <div onClick={onClose} style={s.modalOverlay(isMobile, { float: true })}>
        <div onClick={(e) => e.stopPropagation()} style={s.modalCard(isMobile, { maxWidth: 520, float: true })}>
          <div style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: 12,
            marginBottom: 4,
          }}>
            <h2 style={{ fontSize: 19, fontWeight: 600, margin: 0, color: "var(--ink-1)" }}>
              {t("wallet.title")}
            </h2>
            <button onClick={onClose} style={s.modalCloseBtn} aria-label="Close">×</button>
          </div>
          <WalletPanel wallet={wallet} onRefresh={onRefresh} userEmail={userEmail} />
        </div>
      </div>
    </ModalRoot>
  );
}
