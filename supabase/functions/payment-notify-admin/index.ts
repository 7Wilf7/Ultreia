// User-submitted manual payment reminder.
//
// The user pays via the owner's personal QR code, then submits the paid amount
// here. This function does NOT credit the wallet automatically; it creates an
// admin-facing reminder in push_inbox and best-effort sends an FCM notification.
//
// Auth: caller must be logged in (verify JWT stays ON). Deploy:
//   npx supabase functions deploy payment-notify-admin
//
// Secrets:
//   FCM_SERVICE_ACCOUNT  – optional for tray push; inbox record still works
// Auto-injected: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "npm:@supabase/supabase-js@2";

const ADMIN_EMAIL = "wilf7wufan@gmail.com";
const MAX_AMOUNT_CENTS = 1_000_000; // ¥10,000 guardrail.
const PAYMENT_REQUEST_TITLE = "wallet_payment_request";
const PAYMENT_REQUEST_TITLE_PREFIX = `${PAYMENT_REQUEST_TITLE}:`;

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
        android: {
          priority: "high",
          notification: {
            channel_id: "wallet_alerts_v1",
            notification_priority: "PRIORITY_HIGH",
            default_sound: true,
            default_vibrate_timings: true,
          },
        },
      },
    }),
  });
  const respBody = await resp.json().catch(() => ({}));
  return { ok: resp.ok, status: resp.status, body: respBody };
}

function tokenPreview(token: string): string {
  return `${token.slice(0, 12)}...`;
}

function getFcmErrorCode(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const error = (body as { error?: { status?: string; details?: Array<Record<string, unknown>> } }).error;
  const detailCode = error?.details?.find((item) => typeof item.errorCode === "string")?.errorCode;
  return detailCode || error?.status || "";
}

async function findUserByEmail(admin: ReturnType<typeof createClient>, email: string) {
  let page = 1;
  const perPage = 1000;
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const users = data?.users || [];
    const hit = users.find(u => (u.email || "").toLowerCase() === email.toLowerCase());
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

  let body: { amount_cents?: number };
  try { body = await req.json(); } catch { return json({ error: "bad_input" }, 400); }

  const amountCents = Math.round(Number(body.amount_cents) || 0);
  if (amountCents <= 0 || amountCents > MAX_AMOUNT_CENTS) return json({ error: "bad_input" }, 400);

  const adminUser = await findUserByEmail(admin, ADMIN_EMAIL).catch((e) => {
    console.error("find admin failed:", e?.message || e);
    return null;
  });
  if (!adminUser) return json({ error: "admin_not_found" }, 500);

  const email = (user.email || "").toLowerCase();
  const payload = {
    type: PAYMENT_REQUEST_TITLE,
    email,
    amount_cents: amountCents,
    created_at: new Date().toISOString(),
  };
  const notifyBody = `${email} 提交 ${formatCny(amountCents)} 充值提醒`;
  const { data: inbox, error: inboxErr } = await admin
    .from("push_inbox")
    .insert({
      user_id: adminUser.id,
      title: `${PAYMENT_REQUEST_TITLE_PREFIX}${base64url(JSON.stringify(payload))}`,
      body: notifyBody,
      read: false,
    })
    .select("id")
    .single();
  if (inboxErr) return json({ error: "inbox_insert_failed", detail: inboxErr.message }, 500);
  console.info("payment reminder inbox created", {
    inbox_id: inbox?.id,
    admin_user_id: adminUser.id,
    sender_user_id: user.id,
    amount_cents: amountCents,
  });

  let sent = 0;
  let subscriptionCount = 0;
  const fcmErrors: unknown[] = [];
  const saRaw = Deno.env.get("FCM_SERVICE_ACCOUNT");
  if (saRaw) {
    try {
      const sa = JSON.parse(saRaw);
      const { data: subs, error: subsErr } = await admin
        .from("push_subscriptions")
        .select("fcm_token")
        .eq("user_id", adminUser.id);
      if (subsErr) throw subsErr;
      subscriptionCount = subs?.length || 0;
      console.info("payment reminder push subscriptions", {
        inbox_id: inbox?.id,
        admin_user_id: adminUser.id,
        subscription_count: subscriptionCount,
        fcm_project_id: sa.project_id,
      });
      if (subs && subs.length > 0) {
        const accessToken = await getAccessToken(sa);
        const results = await Promise.allSettled(subs.map(async (sub) => {
          const r = await sendPush(
            sa.project_id,
            accessToken,
            sub.fcm_token,
            "Ultreia 充值提醒",
            notifyBody,
          );
          return { sub, r };
        }));
        for (const result of results) {
          if (result.status === "rejected") {
            console.error("payment reminder push request failed", {
              inbox_id: inbox?.id,
              error: String(result.reason),
            });
            fcmErrors.push(String(result.reason));
            continue;
          }
          const { sub, r } = result.value;
          if (r.ok) {
            sent += 1;
            console.info("payment reminder push sent", {
              inbox_id: inbox?.id,
              token: tokenPreview(sub.fcm_token),
            });
          } else {
            const errorCode = getFcmErrorCode(r.body);
            console.error("payment reminder push failed", {
              inbox_id: inbox?.id,
              token: tokenPreview(sub.fcm_token),
              status: r.status,
              error_code: errorCode,
              body: r.body,
            });
            fcmErrors.push({ status: r.status, error_code: errorCode, body: r.body });
            if (errorCode === "UNREGISTERED") {
              await admin
                .from("push_subscriptions")
                .delete()
                .eq("user_id", adminUser.id)
                .eq("fcm_token", sub.fcm_token);
            }
          }
        }
      }
    } catch (e) {
      console.error("payment reminder push exception", {
        inbox_id: inbox?.id,
        error: String(e),
      });
      fcmErrors.push(String(e));
    }
  } else {
    console.warn("payment reminder push skipped: FCM_SERVICE_ACCOUNT missing", {
      inbox_id: inbox?.id,
      admin_user_id: adminUser.id,
    });
  }

  return json({
    ok: true,
    inbox_id: inbox?.id,
    sent,
    subscription_count: subscriptionCount,
    fcm_errors: fcmErrors,
  });
});
