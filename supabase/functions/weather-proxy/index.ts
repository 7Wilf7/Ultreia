// Wallet-backed weather proxy (Caiyun).
//
// The app owner's Caiyun token stays in Edge Function secrets. Every successful
// weather request counts as one wallet debit, even when mode="bundle" fetches
// realtime + 7-day forecast together.
//
// Auth: caller must be logged in (verify JWT can stay ON). Deploy:
//   npx supabase functions deploy weather-proxy
//
// Secrets: SHARED_CAIYUN_TOKEN (Dashboard → Edge Functions → Secrets).
// Auto-injected: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "npm:@supabase/supabase-js@2";

const CAIYUN_BASE = "https://api.caiyunapp.com/v2.6";
const WEATHER_CHARGE_CENTS = 1;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
function isCoord(v: unknown, min: number, max: number): boolean {
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max;
}
function caiyunUrl(token: string, lng: number, lat: number, type: string, begin?: number): string {
  const coord = `${lng},${lat}`;
  switch (type) {
    case "realtime":   return `${CAIYUN_BASE}/${token}/${coord}/realtime`;
    case "daily":      return `${CAIYUN_BASE}/${token}/${coord}/daily?dailysteps=7`;
    case "hourly":     return `${CAIYUN_BASE}/${token}/${coord}/hourly?hourlysteps=72`;
    case "historical": return `${CAIYUN_BASE}/${token}/${coord}/hourly?hourlysteps=24&begin=${Math.floor(Number(begin))}`;
    default: throw new Error("bad_type");
  }
}
function roundCoord(n: number): number {
  return Math.round(Number(n) * 10000) / 10000;
}
async function caiyunGet(url: string): Promise<{ ok: boolean; data: unknown }> {
  const r = await fetch(url);
  const data = await r.json().catch(() => null);
  const ok = r.ok && (data as { status?: string })?.status === "ok";
  return { ok, data };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ error: "unauthorized" }, 401);

  const token = Deno.env.get("SHARED_CAIYUN_TOKEN");
  if (!token) return json({ error: "server_misconfigured" }, 500);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: { user }, error: whoErr } = await admin.auth.getUser(jwt);
  if (whoErr || !user) return json({ error: "unauthorized" }, 401);
  const uid = user.id;

  let body: { lng?: number; lat?: number; mode?: string; type?: string; begin?: number };
  try { body = await req.json(); } catch { return json({ error: "bad_input" }, 400); }
  const { lng, lat, mode = "bundle", type = "realtime", begin } = body;
  if (!isCoord(lng, -180, 180) || !isCoord(lat, -90, 90)) return json({ error: "bad_coords" }, 400);

  const { error: ensureErr } = await admin.rpc("wallet_ensure", {
    p_user_id: uid,
    p_initial_cents: 500,
  });
  if (ensureErr) return json({ error: "wallet_ensure_failed" }, 500);

  const { data: wallet } = await admin
    .from("wallets")
    .select("balance_cents")
    .eq("user_id", uid)
    .single();
  if ((wallet?.balance_cents ?? 0) < WEATHER_CHARGE_CENTS) {
    return json({ error: "insufficient_balance" }, 402);
  }

  try {
    let payload: Record<string, unknown>;
    if (mode === "bundle") {
      const [rt, daily] = await Promise.all([
        caiyunGet(caiyunUrl(token, Number(lng), Number(lat), "realtime")),
        caiyunGet(caiyunUrl(token, Number(lng), Number(lat), "daily")),
      ]);
      if (!rt.ok && !daily.ok) return json({ error: "upstream_error" }, 502);
      payload = { realtime: rt.data, daily: daily.data };
    } else {
      const one = await caiyunGet(caiyunUrl(token, Number(lng), Number(lat), type, begin));
      if (!one.ok) return json({ error: "upstream_error" }, 502);
      payload = { data: one.data };
    }
    const requestId = `weather:${uid}:${Date.now()}:${mode}:${roundCoord(Number(lng))},${roundCoord(Number(lat))}:${type}:${begin || ""}`;
    const { data: balanceAfter, error: debitErr } = await admin.rpc("wallet_debit", {
      p_user_id: uid,
      p_amount_cents: WEATHER_CHARGE_CENTS,
      p_kind: "weather_charge",
      p_provider: "caiyun",
      p_request_id: requestId,
      p_metadata: {
        mode,
        type,
        lng: roundCoord(Number(lng)),
        lat: roundCoord(Number(lat)),
        begin: begin || null,
        charge_cents: WEATHER_CHARGE_CENTS,
      },
    });
    if (debitErr) {
      const insufficient = String(debitErr.message || "").includes("insufficient_balance");
      return json({ error: insufficient ? "insufficient_balance" : "wallet_debit_failed" }, insufficient ? 402 : 500);
    }
    return json({ ...payload, wallet: { balance_cents: balanceAfter, charge_cents: WEATHER_CHARGE_CENTS } });
  } catch (e) {
    return json({ error: "bad_request", detail: String(e) }, 400);
  }
});
