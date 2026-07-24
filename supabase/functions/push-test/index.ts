// Retired Phase 1 push smoke endpoint.
//
// The live predecessor allowed caller-selected targets, implicit all-device
// fan-out, and provider-detail responses. This replacement intentionally does
// not parse a target, read subscriptions, mint provider credentials, or send a
// notification. The existing gateway JWT setting remains in force.

import { retiredPushTestResponse } from "./retirement.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(obj: unknown, status: number): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const result = retiredPushTestResponse();
  return json(result.body, result.status);
});
