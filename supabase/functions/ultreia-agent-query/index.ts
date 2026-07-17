import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  MAX_QUERY_BODY_BYTES,
  QueryResponderError,
  ULTREIA_QUERY_PATH,
  authenticateQueryRequest,
  buildQueryResultFromLoader,
  localDateKey,
  shiftDateKey,
} from "../../../src/utils/agentQuery.js";

const RACE_COLUMNS = "id,name,date,priority,distance,ascent,category,is_target,updated_at";
const SETTINGS_COLUMNS = "coach_config,updated_at";
const PREFERENCE_COLUMNS = "id,category,content_en,content_zh,status,updated_at";
// `id` is private matching input only. No activity type, note, health, location,
// weather, GPS, source or start timestamp is selected.
const WORKOUT_COLUMNS = "id,date,distance,duration,ascent,is_planned,plan_status,plan_detail,updated_at";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function readRawBody(request: Request) {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_QUERY_BODY_BYTES) {
    throw new QueryResponderError("request_too_large", 413);
  }
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_QUERY_BODY_BYTES) {
      await reader.cancel();
      throw new QueryResponderError("request_too_large", 413);
    }
    chunks.push(value);
  }
  const raw = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    raw.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return raw;
}

async function loadSnapshot(db: ReturnType<typeof createClient>, userId: string, now: Date) {
  const today = localDateKey(now, "Asia/Shanghai");
  const startDate = shiftDateKey(today, -28);
  const endDate = shiftDateKey(today, -1);
  const [races, settings, preferenceFacts, workouts] = await Promise.all([
    db.from("races").select(RACE_COLUMNS).eq("user_id", userId)
      .eq("is_target", true).gte("date", today),
    db.from("user_settings").select(SETTINGS_COLUMNS).eq("user_id", userId).maybeSingle(),
    db.from("coach_memory_facts").select(PREFERENCE_COLUMNS).eq("user_id", userId)
      .eq("category", "training_preferences").eq("status", "active"),
    db.from("workouts").select(WORKOUT_COLUMNS).eq("user_id", userId)
      .gte("date", startDate).lte("date", endDate),
  ]);
  if (races.error || settings.error || preferenceFacts.error || workouts.error) {
    throw new Error("source_read_failed");
  }
  return {
    races: races.data || [],
    settings: settings.data || null,
    preferenceFacts: preferenceFacts.data || [],
    workouts: workouts.data || [],
  };
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (new URL(request.url).pathname !== ULTREIA_QUERY_PATH) return json({ error: "not_found" }, 404);

  const querySecret = Deno.env.get("AEVUM_ULTREIA_QUERY_HMAC_SECRET") || "";
  const userId = Deno.env.get("AEVUM_ULTREIA_USER_ID") || "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!querySecret || !userId || !supabaseUrl || !serviceRoleKey) {
    return json({ error: "query_responder_not_configured" }, 503);
  }

  const requestNow = new Date();
  let query;
  try {
    const rawBody = await readRawBody(request);
    query = await authenticateQueryRequest({
      rawBody,
      headers: request.headers,
      secret: querySecret,
      now: requestNow,
    });
  } catch (error) {
    if (error instanceof QueryResponderError) return json({ error: error.code }, error.status);
    return json({ error: "invalid_query" }, 400);
  }

  const db = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  try {
    const result = await buildQueryResultFromLoader(
      query,
      () => loadSnapshot(db, userId, requestNow),
      { timeZone: "Asia/Shanghai", referenceNow: requestNow },
    );
    return json(result);
  } catch (error) {
    if (error instanceof Error && error.message === "source_read_failed") {
      return json({ error: "source_read_failed" }, 500);
    }
    return json({ error: "snapshot_failed" }, 500);
  }
});
