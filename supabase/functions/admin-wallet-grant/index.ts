// Admin-only manual wallet top-up.
//
// Intended for personal QR-code payments: the admin verifies a payment in
// WeChat, then grants balance to a user's wallet by email. This is not an
// automatic payment callback.
//
// Auth: caller must be logged in (verify JWT can stay ON). Deploy:
//   npx supabase functions deploy admin-wallet-grant
//
// Auto-injected secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "npm:@supabase/supabase-js@2";

const ADMIN_EMAIL = "wilf7wufan@gmail.com";
const CURRENCY = "CNY";
const MAX_GRANT_CENTS = 1_000_000; // ¥10,000 guardrail for manual input mistakes.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

function formatCny(cents: number): string {
  return `¥${(cents / 100).toFixed(2)}`;
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem.replace(/-----BEGIN PRIVATE KEY-----/, "").replace(/-----END PRIVATE KEY-----/, "").replace(/\s+/g, "");
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

function base64url(input: string | Uint8Array): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function getAccessToken(sa: { client_email: string; private_key: string; token_uri: string }): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: sa.token_uri,
    iat: now,
    exp: now + 3600,
  }));
  const signingInput = `${header}.${claims}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(sa.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(signingInput));
  const jwt = `${signingInput}.${base64url(new Uint8Array(sig))}`;
  const resp = await fetch(sa.token_uri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(`token exchange failed: ${JSON.stringify(data)}`);
  return data.access_token as string;
}

async function sendPush(projectId: string, accessToken: string, token: string, title: string, body: string) {
  const resp = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        token,
        notification: { title, body },
        android: { priority: "high", notification: { channel_id: "daily_coach" } },
      },
    }),
  });
  const respBody = await resp.json().catch(() => ({}));
  return { ok: resp.ok, status: resp.status, body: respBody };
}

async function findUserByEmail(admin: ReturnType<typeof createClient>, email: string) {
  let page = 1;
  const perPage = 1000;
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const users = data?.users || [];
    const hit = users.find(u => (u.email || "").toLowerCase() === email);
    if (hit || users.length < perPage) return hit || null;
    page += 1;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ error: "unauthorized" }, 401);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: { user }, error: whoErr } = await admin.auth.getUser(jwt);
  if (whoErr || !user) return json({ error: "unauthorized" }, 401);
  if ((user.email || "").toLowerCase() !== ADMIN_EMAIL.toLowerCase()) return json({ error: "forbidden" }, 403);

  let body: { email?: string; amount_cents?: number; note?: string; request_id?: string };
  try { body = await req.json(); } catch { return json({ error: "bad_input" }, 400); }

  const email = (body.email || "").trim().toLowerCase();
  const amountCents = Math.round(Number(body.amount_cents) || 0);
  const note = (body.note || "").trim().slice(0, 200);
  const clientRequestId = (body.request_id || "").trim().slice(0, 120);
  if (!EMAIL_RE.test(email) || amountCents <= 0 || amountCents > MAX_GRANT_CENTS) {
    return json({ error: "bad_input" }, 400);
  }

  const target = await findUserByEmail(admin, email).catch((e) => {
    console.error("listUsers failed:", e?.message || e);
    return null;
  });
  if (!target) return json({ error: "user_not_found" }, 404);

  const { error: ensureErr } = await admin.rpc("wallet_ensure", {
    p_user_id: target.id,
    p_initial_cents: 500,
  });
  if (ensureErr) return json({ error: "wallet_ensure_failed", detail: ensureErr.message }, 500);

  const { data: wallet, error: readErr } = await admin
    .from("wallets")
    .select("balance_cents, currency")
    .eq("user_id", target.id)
    .single();
  if (readErr) return json({ error: "wallet_read_failed", detail: readErr.message }, 500);

  const requestId = clientRequestId || `admin-grant:${target.id}:${crypto.randomUUID()}`;
  const { data: existingLedger, error: existingErr } = await admin
    .from("wallet_ledger")
    .select("request_id, amount_cents, balance_after_cents")
    .eq("user_id", target.id)
    .eq("request_id", requestId)
    .maybeSingle();
  if (existingErr) return json({ error: "ledger_read_failed", detail: existingErr.message }, 500);
  if (existingLedger) {
    return json({
      ok: true,
      duplicate: true,
      user: { id: target.id, email },
      wallet: { balance_cents: existingLedger.balance_after_cents, currency: wallet?.currency || CURRENCY },
      ledger: { request_id: existingLedger.request_id, amount_cents: existingLedger.amount_cents },
    });
  }

  const balanceBefore = Number(wallet?.balance_cents || 0);
  const balanceAfter = Number(wallet?.balance_cents || 0) + amountCents;
  const { error: updateErr } = await admin
    .from("wallets")
    .update({ balance_cents: balanceAfter, currency: wallet?.currency || CURRENCY })
    .eq("user_id", target.id);
  if (updateErr) return json({ error: "wallet_update_failed", detail: updateErr.message }, 500);

  const { error: ledgerErr } = await admin
    .from("wallet_ledger")
    .insert({
      user_id: target.id,
      kind: "welcome_grant",
      amount_cents: amountCents,
      balance_after_cents: balanceAfter,
      provider: "admin",
      request_id: requestId,
      metadata: {
        admin_email: user.email,
        target_email: email,
        note: note || null,
      },
    });
  if (ledgerErr) {
    await admin
      .from("wallets")
      .update({ balance_cents: balanceBefore, currency: wallet?.currency || CURRENCY })
      .eq("user_id", target.id);
    return json({ error: "ledger_insert_failed", detail: ledgerErr.message }, 500);
  }

  const notifyBody = `你的钱包已充值 ${formatCny(amountCents)}，当前余额 ${formatCny(balanceAfter)}。`;
  const { error: inboxErr } = await admin
    .from("push_inbox")
    .insert({
      user_id: target.id,
      title: "wallet_topup_done",
      body: notifyBody,
      read: false,
    });
  if (inboxErr) console.error("wallet top-up inbox insert failed:", inboxErr.message);

  let pushSent = 0;
  const fcmErrors: unknown[] = [];
  const saRaw = Deno.env.get("FCM_SERVICE_ACCOUNT");
  if (saRaw) {
    try {
      const sa = JSON.parse(saRaw);
      const { data: subs, error: subsErr } = await admin
        .from("push_subscriptions")
        .select("fcm_token")
        .eq("user_id", target.id);
      if (subsErr) throw subsErr;
      if (subs && subs.length > 0) {
        const accessToken = await getAccessToken(sa);
        for (const sub of subs) {
          const r = await sendPush(sa.project_id, accessToken, sub.fcm_token, "Ultreia 钱包充值完成", notifyBody);
          if (r.ok) pushSent += 1;
          else fcmErrors.push({ status: r.status, body: r.body });
        }
      }
    } catch (e) {
      fcmErrors.push(String(e));
    }
  }

  return json({
    ok: true,
    user: { id: target.id, email },
    wallet: { balance_cents: balanceAfter, currency: wallet?.currency || CURRENCY },
    ledger: { request_id: requestId, amount_cents: amountCents },
    notification: { inbox: !inboxErr, push_sent: pushSent, fcm_errors: fcmErrors },
  });
});
