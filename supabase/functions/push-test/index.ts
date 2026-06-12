// Phase 1 smoke test for the daily-coach push pipeline.
//
// Sends a STATIC notification to a user's registered devices via Firebase
// Cloud Messaging (FCM HTTP v1). No AI, no scheduling — this exists only to
// prove the chain works end to end: Edge Function → service account → FCM →
// device. Phase 2 replaces the static body with an LLM-generated check-in and
// adds pg_cron + per-user timezone scheduling.
//
// Secrets it needs (set in Supabase → Edge Functions → Secrets, NOT in git):
//   FCM_SERVICE_ACCOUNT  – the full service-account JSON (one line is fine)
// Auto-injected by Supabase (no need to set):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// Invoke (manual test), sending to one user's devices:
//   POST { "userId": "<auth uid>" }
// Omit userId to fan out to every registered device (fine while only your
// own test device is registered).

import { createClient } from "npm:@supabase/supabase-js@2";

// ── FCM HTTP v1 auth: mint a short-lived OAuth token from the service account ──

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
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

async function getAccessToken(sa: {
  client_email: string;
  private_key: string;
  token_uri: string;
}): Promise<string> {
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
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput),
  );
  const jwt = `${signingInput}.${base64url(new Uint8Array(sig))}`;

  const resp = await fetch(sa.token_uri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(`token exchange failed: ${JSON.stringify(data)}`);
  return data.access_token as string;
}

async function sendPush(
  projectId: string,
  accessToken: string,
  token: string,
  title: string,
  body: string,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const resp = await fetch(
    `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: { token, notification: { title, body } },
      }),
    },
  );
  const respBody = await resp.json().catch(() => ({}));
  return { ok: resp.ok, status: resp.status, body: respBody };
}

Deno.serve(async (req) => {
  try {
    const saRaw = Deno.env.get("FCM_SERVICE_ACCOUNT");
    if (!saRaw) return json({ error: "FCM_SERVICE_ACCOUNT secret not set" }, 500);
    const sa = JSON.parse(saRaw);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { userId } = await req.json().catch(() => ({ userId: undefined }));
    let q = supabase.from("push_subscriptions").select("fcm_token, user_id");
    if (userId) q = q.eq("user_id", userId);
    const { data: rows, error } = await q;
    if (error) return json({ error: error.message }, 500);
    if (!rows || rows.length === 0) return json({ sent: 0, note: "no registered devices" });

    const accessToken = await getAccessToken(sa);
    const results = [];
    for (const row of rows) {
      const r = await sendPush(
        sa.project_id,
        accessToken,
        row.fcm_token,
        "Ultreia",
        "✅ Push pipeline works — this is a test from your coach.",
      );
      results.push({ user_id: row.user_id, status: r.status, ok: r.ok, body: r.body });
    }
    return json({ sent: results.filter((r) => r.ok).length, total: results.length, results });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
