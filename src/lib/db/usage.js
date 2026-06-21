import { supabase } from '../supabase';
import { postJson, postJsonStream } from '../apiFetch';
import { supabaseFunctionUrl, supabasePublicAnonKey } from '../supabase';

// Wallet-backed AI chat via the coach-proxy Edge Function. The shared DeepSeek
// key stays server-side; successful replies debit the caller's wallet.
// Throws an Error with `.code` (e.g. 'insufficient_balance') so the caller can branch.
export async function coachProxy({ system, messages, max_tokens }) {
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData?.session?.access_token;
  if (!accessToken) {
    const e = new Error('unauthorized');
    e.code = 'unauthorized';
    throw e;
  }

  const resp = await postJson({
    url: supabaseFunctionUrl('coach-proxy'),
    headers: {
      'Content-Type': 'application/json',
      apikey: supabasePublicAnonKey,
      Authorization: `Bearer ${accessToken}`,
    },
    body: { system, messages, max_tokens },
  });

  const data = await resp.json().catch(() => null);
  if (!resp.ok) {
    const code = data?.error || data?.message || `HTTP ${resp.status}`;
    const e = new Error(code);
    e.code = data?.error || code;
    throw e;
  }
  if (data && data.error) { const e = new Error(data.error); e.code = data.error; throw e; }
  return data;
}

export async function coachProxyStream({ system, messages, max_tokens, onToken }) {
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
    body: { system, messages, max_tokens, stream: true },
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
    provider: meta.provider || 'deepseek',
    model: meta.model,
    wallet: meta.wallet,
  };
}
