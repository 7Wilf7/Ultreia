import { useState } from "react";
import { useT } from "../i18n/LanguageContext";
import { formatWalletAmount } from "../lib/db/wallet";
import { ModalRoot } from "./ModalRoot";
import { Spinner } from "./Spinner";
import { s } from "../styles";

function ledgerLabel(t, kind) {
  return t(`wallet.ledger_${kind || "unknown"}`);
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

export function WalletModal({ wallet, onClose, onRefresh }) {
  const t = useT();
  const [refreshing, setRefreshing] = useState(false);
  const currency = wallet?.currency || "CNY";
  const ledger = Array.isArray(wallet?.ledger) ? wallet.ledger : [];

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
    window.alert(t("wallet.topup_hint"));
  }

  return (
    <ModalRoot onClose={onClose}>
      <div style={{ ...s.modalCard, maxWidth: 520 }}>
        <button onClick={onClose} style={s.modalX}>×</button>
        <div style={{ ...s.modalTitle, marginBottom: 4 }}>{t("wallet.title")}</div>
        <div style={{ ...s.muted, marginBottom: 18 }}>{t("wallet.desc")}</div>

        <div style={{
          border: "1px solid var(--rule)",
          borderRadius: 8,
          padding: "14px 14px",
          background: "var(--bg-sunken)",
          marginBottom: 14,
        }}>
          <div style={{ ...s.muted, fontSize: 12 }}>{t("wallet.balance")}</div>
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

        <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
          <button type="button" onClick={topUp} style={{ ...s.btnPrimary, flex: 1 }}>
            {t("wallet.topup")}
          </button>
          <button type="button" onClick={refresh} disabled={refreshing} style={{ ...s.btnGhost, minWidth: 96 }}>
            {refreshing ? <Spinner /> : t("wallet.refresh")}
          </button>
        </div>

        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 8,
        }}>
          <div style={{ ...s.sectionTitle, margin: 0 }}>{t("wallet.ledger")}</div>
        </div>

        <div style={{
          border: "1px solid var(--rule)",
          borderRadius: 8,
          overflow: "hidden",
          background: "var(--bg-elevated)",
          maxHeight: "42vh",
          overflowY: "auto",
        }}>
          {ledger.length === 0 ? (
            <div style={{ padding: 14, ...s.muted }}>{t("wallet.ledger_empty")}</div>
          ) : ledger.map((row) => {
            const amount = Number(row.amountCents || 0);
            const positive = amount > 0;
            return (
              <div key={row.id || `${row.createdAt}-${amount}`} style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                padding: "10px 12px",
                borderBottom: "1px solid var(--rule)",
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
                    {ledgerLabel(t, row.kind)}
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
      </div>
    </ModalRoot>
  );
}
