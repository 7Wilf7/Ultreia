// Wallet status endpoint.
//
// Auth: caller must be logged in (verify JWT can stay ON). Deploy:
//   npx supabase functions deploy wallet-status
//
// Uses wallet_ensure() to create the row and grant the first trial balance
// server-side, then returns the current balance and recent ledger.

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ error: "unauthorized" }, 401);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: { user }, error: whoErr } = await admin.auth.getUser(jwt);
  if (whoErr || !user) return json({ error: "unauthorized" }, 401);

  const limitRaw = await req.json().catch(() => ({}));
  const limit = Math.min(Math.max(Number(limitRaw?.limit) || 30, 1), 100);

  const { error: ensureErr } = await admin.rpc("wallet_ensure", {
    p_user_id: user.id,
    p_initial_cents: 500,
  });
  if (ensureErr) return json({ error: "wallet_ensure_failed", detail: ensureErr.message }, 500);

  const { data: wallet, error: walletErr } = await admin
    .from("wallets")
    .select("balance_cents, currency")
    .eq("user_id", user.id)
    .single();
  if (walletErr) return json({ error: "wallet_read_failed", detail: walletErr.message }, 500);

  const { data: ledger, error: ledgerErr } = await admin
    .from("wallet_ledger")
    .select("id, kind, amount_cents, balance_after_cents, provider, request_id, metadata, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (ledgerErr) return json({ error: "ledger_read_failed", detail: ledgerErr.message }, 500);

  return json({ wallet, ledger: ledger || [] });
});
