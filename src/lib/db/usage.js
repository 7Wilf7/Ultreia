import { supabase } from '../supabase';

// Wallet-backed AI chat via the coach-proxy Edge Function. The shared DeepSeek
// key stays server-side; successful replies debit the caller's wallet.
// Throws an Error with `.code` (e.g. 'insufficient_balance') so the caller can branch.
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
