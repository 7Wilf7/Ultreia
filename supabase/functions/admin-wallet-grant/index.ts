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

  let body: { email?: string; amount_cents?: number; note?: string };
  try { body = await req.json(); } catch { return json({ error: "bad_input" }, 400); }

  const email = (body.email || "").trim().toLowerCase();
  const amountCents = Math.round(Number(body.amount_cents) || 0);
  const note = (body.note || "").trim().slice(0, 200);
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

  const balanceAfter = Number(wallet?.balance_cents || 0) + amountCents;
  const { error: updateErr } = await admin
    .from("wallets")
    .update({ balance_cents: balanceAfter, currency: wallet?.currency || CURRENCY })
    .eq("user_id", target.id);
  if (updateErr) return json({ error: "wallet_update_failed", detail: updateErr.message }, 500);

  const requestId = `admin-grant:${target.id}:${crypto.randomUUID()}`;
  const { error: ledgerErr } = await admin
    .from("wallet_ledger")
    .insert({
      user_id: target.id,
      kind: "admin_grant",
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
  if (ledgerErr) return json({ error: "ledger_insert_failed", detail: ledgerErr.message }, 500);

  return json({
    ok: true,
    user: { id: target.id, email },
    wallet: { balance_cents: balanceAfter, currency: wallet?.currency || CURRENCY },
    ledger: { request_id: requestId, amount_cents: amountCents },
  });
});
