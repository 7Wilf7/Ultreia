import { useState } from "react";
import { s } from "../styles";
import { useT } from "../i18n/LanguageContext";
import { useIsMobile } from "../hooks/useMediaQuery";
import { wallet } from "../lib/db";
import { formatWalletAmount } from "../lib/db/wallet";
import { ModalRoot } from "./ModalRoot";

export function AdminWalletGrantModal({ onClose, onGranted }) {
  const t = useT();
  const isMobile = useIsMobile();
  const [email, setEmail] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const amountNumber = Number(amount);
  const amountCents = Number.isFinite(amountNumber) ? Math.round(amountNumber * 100) : 0;
  const canSubmit = email.trim() && amountCents > 0 && !busy;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setMsg("");
    try {
      const res = await wallet.adminGrantWallet({
        email: email.trim(),
        amountCents,
        note: note.trim(),
      });
      setMsg(t("wallet.admin_grant_success", {
        email: res?.user?.email || email.trim(),
        amount: formatWalletAmount(amountCents, res?.wallet?.currency || "CNY"),
      }));
      setEmail("");
      setAmount("");
      setNote("");
      onGranted?.();
    } catch (e) {
      const key = e?.code === "user_not_found"
        ? "wallet.admin_grant_user_not_found"
        : e?.code === "forbidden"
          ? "wallet.admin_grant_forbidden"
          : "wallet.admin_grant_failed";
      setMsg(t(key, { msg: e?.message || String(e) }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalRoot onClose={onClose}>
      <div onClick={onClose} style={s.modalOverlay(isMobile, { float: true })}>
        <div onClick={(e) => e.stopPropagation()} style={s.modalCard(isMobile, { maxWidth: 480, float: true })}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
            <h2 style={{ fontSize: 19, fontWeight: 500, margin: 0 }}>{t("wallet.admin_grant_title")}</h2>
            <button onClick={onClose} style={s.modalCloseBtn} aria-label="Close">×</button>
          </div>
          <p style={{ ...s.muted, marginBottom: 16, lineHeight: 1.6, fontSize: 12 }}>
            {t("wallet.admin_grant_hint")}
          </p>

          <label style={{ display: "block", marginBottom: 12 }}>
            <div style={s.label}>{t("wallet.admin_grant_email")}</div>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="runner@example.com"
              style={s.input}
            />
          </label>

          <label style={{ display: "block", marginBottom: 12 }}>
            <div style={s.label}>{t("wallet.admin_grant_amount")}</div>
            <input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="10"
              style={{ ...s.input, fontFamily: "var(--font-mono)" }}
            />
          </label>

          <label style={{ display: "block", marginBottom: 14 }}>
            <div style={s.label}>{t("wallet.admin_grant_note")}</div>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t("wallet.admin_grant_note_placeholder")}
              style={s.input}
            />
          </label>

          {msg && (
            <div style={{
              color: msg.startsWith("✕") ? "var(--danger)" : "var(--moss-deep)",
              fontSize: 12,
              marginBottom: 12,
              lineHeight: 1.5,
            }}>
              {msg}
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button type="button" onClick={onClose} style={s.btnGhost}>{t("common.cancel")}</button>
            <button type="button" onClick={submit} disabled={!canSubmit} style={{ ...s.btn, opacity: canSubmit ? 1 : 0.5 }}>
              {busy ? t("wallet.admin_grant_working") : t("wallet.admin_grant_submit")}
            </button>
          </div>
        </div>
      </div>
    </ModalRoot>
  );
}
