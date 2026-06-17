import { supabase } from '../supabase';
import { postJsonStream } from '../apiFetch';
import { supabaseFunctionUrl, supabasePublicAnonKey } from '../supabase';

// Wallet-backed AI chat via the coach-proxy Edge Function. Shared provider
// keys stay server-side; successful replies debit the caller's wallet.
// Throws an Error with `.code` (e.g. 'insufficient_balance') so the caller can branch.
export async function coachProxy({ system, messages, max_tokens, provider }) {
  const { data, error } = await supabase.functions.invoke('coach-proxy', {
    body: { system, messages, max_tokens, provider },
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

export async function coachProxyStream({ system, messages, max_tokens, provider, onToken }) {
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData?.session?.access_token;
  if (!accessToken) {
    const e = new Error('unauthorized');
    e.code = 'unauthorized';
    throw e;
  }

  const result = await postJsonStream({
    url: supabaseFunctionUrl('coach-proxy'),
    headers: {
      'Content-Type': 'application/json',
      apikey: supabasePublicAnonKey,
      Authorization: `Bearer ${accessToken}`,
    },
    body: { system, messages, max_tokens, provider, stream: true },
    onToken,
  });

  if (!result.ok) {
    const code = result.errorText || 'coach_proxy_failed';
    const e = new Error(code);
    e.code = code;
    throw e;
  }

  const meta = result.data || {};
  if (!meta.wallet) {
    const e = new Error('missing_wallet_metadata');
    e.code = 'missing_wallet_metadata';
    throw e;
  }

  return {
    content: [{ type: 'text', text: result.text || '' }],
    usage: result.usage || meta.usage || null,
    provider: meta.provider || provider,
    model: meta.model,
    wallet: meta.wallet,
  };
}
