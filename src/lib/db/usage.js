import { supabase } from '../supabase';
import { getCurrentUserId } from './_auth';

// usage_quota: one row per user, written ONLY by the coach-proxy / weather-proxy
// Edge Functions (service_role). The client can only read its own row (RLS) to
// show the remaining free-allowance countdown — it can't tamper with the count.
// No row yet = nothing used.
export async function getMyUsage() {
  const userId = await getCurrentUserId();
  const { data, error } = await supabase
    .from('usage_quota')
    .select('deepseek_used, weather_used')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) {
    console.error('getMyUsage failed:', error);
    return { deepseekUsed: 0, weatherUsed: 0 };
  }
  return {
    deepseekUsed: data?.deepseek_used ?? 0,
    weatherUsed: data?.weather_used ?? 0,
  };
}

// Free-tier AI chat via the coach-proxy Edge Function (owner's shared DeepSeek
// key, quota-gated). Returns the Anthropic-shaped { content, remaining }.
// Throws an Error with `.code` (e.g. 'quota_exceeded') so the caller can branch.
export async function coachProxy({ system, messages, max_tokens }) {
  const { data, error } = await supabase.functions.invoke('coach-proxy', {
    body: { system, messages, max_tokens },
  });
  if (error) {
    let code = '';
    try {
      const ctx = error.context;
      if (ctx && typeof ctx.json === 'function') { const b = await ctx.json(); code = b?.error || ''; }
    } catch { /* ignore */ }
    const e = new Error(code || error.message || 'coach_proxy_failed');
    e.code = code;
    throw e;
  }
  if (data && data.error) { const e = new Error(data.error); e.code = data.error; throw e; }
  return data;
}
