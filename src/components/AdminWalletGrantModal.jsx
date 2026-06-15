import { useCallback, useEffect, useState } from "react";
import { s } from "../styles";
import { useT } from "../i18n/LanguageContext";
import { useIsMobile } from "../hooks/useMediaQuery";
import { pushInbox, wallet } from "../lib/db";
import { formatWalletAmount } from "../lib/db/wallet";
import { ModalRoot } from "./ModalRoot";

const PAYMENT_REQUEST_TITLE = "wallet_payment_request";

function parsePaymentRequest(item) {
  if (item?.title !== PAYMENT_REQUEST_TITLE) return null;
  try {
    const payload = JSON.parse(item.body || "{}");
    const amountCents = Math.round(Number(payload.amount_cents) || 0);
    const email = String(payload.email || "").trim();
    if (!email || amountCents <= 0) return null;
    return {
      id: item.id,
      email,
      amountCents,
      createdAt: item.createdAt,
    };
  } catch {
    return null;
  }
}

function formatRequestTime(iso) {
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

export function AdminWalletGrantModal({ onClose, onGranted }) {
  const t = useT();
  const isMobile = useIsMobile();
  const [email, setEmail] = useState("");
  const [amount, setAmount] = useState("");
  const [requests, setRequests] = useState([]);
  const [selectedRequestId, setSelectedRequestId] = useState("");
  const [manualRequestId, setManualRequestId] = useState(() => crypto.randomUUID?.() || `${Date.now()}`);
  const [busy, setBusy] = useState(false);
  const [loadingRequests, setLoadingRequests] = useState(true);
  const [msg, setMsg] = useState("");

  const amountNumber = Number(amount);
  const amountCents = Number.isFinite(amountNumber) ? Math.round(amountNumber * 100) : 0;
  const canSubmit = email.trim() && amountCents > 0 && !busy;
  const selectedRequest = requests.find(req => req.id === selectedRequestId) || null;

  const loadRequests = useCallback(async () => {
    setLoadingRequests(true);
    try {
      const rows = await pushInbox.listMine(100);
      setRequests(rows.map(parsePaymentRequest).filter(Boolean));
    } catch {
      setRequests([]);
    } finally {
      setLoadingRequests(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    pushInbox.listMine(100)
      .then(rows => {
        if (!cancelled) setRequests(rows.map(parsePaymentRequest).filter(Boolean));
      })
      .catch(() => {
        if (!cancelled) setRequests([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingRequests(false);
      });
    return () => { cancelled = true; };
  }, []);

  function fillRequest(req) {
    setSelectedRequestId(req.id);
    setEmail(req.email);
    setAmount((req.amountCents / 100).toFixed(2).replace(/\.00$/, ""));
    setMsg("");
  }

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setMsg("");
    try {
      const res = await wallet.adminGrantWallet({
        email: email.trim(),
        amountCents,
        requestId: selectedRequestId ? `payment-reminder:${selectedRequestId}` : `manual:${manualRequestId}`,
      });
      if (selectedRequestId) {
        await pushInbox.deleteOne(selectedRequestId).catch(() => {});
      }
      setMsg(t("wallet.admin_grant_success", {
        email: res?.user?.email || email.trim(),
        amount: formatWalletAmount(amountCents, res?.wallet?.currency || "CNY"),
      }));
      setEmail("");
      setAmount("");
      setSelectedRequestId("");
      setManualRequestId(crypto.randomUUID?.() || `${Date.now()}`);
      loadRequests();
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

  async function dismissSelectedRequest() {
    if (!selectedRequestId || busy) return;
    setBusy(true);
    setMsg("");
    try {
      await pushInbox.deleteOne(selectedRequestId);
      setSelectedRequestId("");
      setEmail("");
      setAmount("");
      setMsg(t("wallet.admin_payment_dismissed"));
      loadRequests();
    } catch (e) {
      setMsg(t("wallet.admin_payment_dismiss_failed", { msg: e?.message || String(e) }));
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

          <div style={{
            border: "1px solid var(--rule)",
            borderRadius: 8,
            background: "var(--bg-sunken)",
            overflow: "hidden",
            marginBottom: 14,
          }}>
            <div style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              padding: "10px 12px",
              borderBottom: requests.length ? "1px solid var(--rule)" : "none",
            }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--ink-1)" }}>
                {t("wallet.admin_payment_requests")}
              </div>
              <button
                type="button"
                onClick={loadRequests}
                disabled={loadingRequests}
                style={{ ...s.btnGhost, minHeight: 0, padding: "4px 8px", fontSize: 11, opacity: loadingRequests ? 0.65 : 1 }}
              >
                {t("wallet.admin_payment_refresh")}
              </button>
            </div>
            {requests.length === 0 ? (
              <div style={{ padding: "10px 12px", ...s.muted, fontSize: 12 }}>
                {loadingRequests ? t("wallet.admin_payment_loading") : t("wallet.admin_payment_empty")}
              </div>
            ) : requests.map((req, idx) => (
              <button
                key={req.id}
                type="button"
                onClick={() => fillRequest(req)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  width: "100%",
                  minHeight: 0,
                  padding: "10px 12px",
                  border: "none",
                  borderBottom: idx === requests.length - 1 ? "none" : "1px solid var(--rule)",
                  background: selectedRequestId === req.id ? "var(--bg-elevated)" : "transparent",
                  textAlign: "left",
                }}
              >
                <span style={{ minWidth: 0 }}>
                  <span style={{
                    display: "block",
                    fontSize: 13,
                    fontWeight: 700,
                    color: "var(--ink-1)",
                    overflow: "hidden",
                    whiteSpace: "nowrap",
                    textOverflow: "ellipsis",
                  }}>
                    {req.email}
                  </span>
                  <span style={{ display: "block", ...s.muted, fontSize: 11, marginTop: 2 }}>
                    {formatRequestTime(req.createdAt)}
                  </span>
                </span>
                <span style={{ flexShrink: 0, fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 700, color: "var(--moss-deep)" }}>
                  {formatWalletAmount(req.amountCents, "CNY")}
                </span>
              </button>
            ))}
          </div>

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

          {selectedRequest && (
            <button
              type="button"
              onClick={dismissSelectedRequest}
              disabled={busy}
              style={{ ...s.btnGhost, width: "100%", marginBottom: 12, opacity: busy ? 0.65 : 1 }}
            >
              {t("wallet.admin_payment_dismiss")}
            </button>
          )}

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
