import { supabase } from '../supabase';
import { postJson, postJsonStream } from '../apiFetch';
import { supabaseFunctionUrl, supabasePublicAnonKey } from '../supabase';

// Personal-mode AI calls via the coach-proxy Edge Function. The app prefers the
// desktop Codex runner when available and falls back to server-side DeepSeek.
// No AI request checks wallet balance or debits wallet records.
export async function coachProxy({ kind, system, messages, attachments, max_tokens, signal }) {
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
    body: { kind, system, messages, attachments, max_tokens },
    signal,
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

export async function getRunnerStatus({ signal } = {}) {
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
    body: { action: 'runner_status' },
    signal,
  });

  const data = await resp.json().catch(() => null);
  if (!resp.ok) {
    const code = data?.error || data?.message || `HTTP ${resp.status}`;
    const e = new Error(code);
    e.code = data?.error || code;
    throw e;
  }
  if (data && data.error && data.state !== 'error') {
    const e = new Error(data.error);
    e.code = data.error;
    throw e;
  }
  return data;
}

export function coachProxyActionErrorCode(response, data) {
  if (response?.ok) return null;
  return data?.error || data?.message || `HTTP ${response?.status || 500}`;
}

function createUuid() {
  if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function coachProxyAction(body, { signal } = {}) {
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
    body,
    signal,
  });
  const data = await resp.json().catch(() => null);
  const failureCode = coachProxyActionErrorCode(resp, data);
  if (failureCode) {
    const code = failureCode;
    const e = new Error(code);
    e.code = code;
    e.detail = data || null;
    throw e;
  }
  return data;
}

export function createCoachJobRequestId() {
  return createUuid();
}

export async function startCoachJob({
  kind,
  requestId = createCoachJobRequestId(),
  system,
  messages,
  attachments,
  max_tokens,
  sink,
  signal,
}) {
  return coachProxyAction({
    action: 'start_async',
    kind,
    request_id: requestId,
    system,
    messages,
    attachments,
    max_tokens,
    sink,
  }, { signal });
}

export async function getCoachJob(jobId, { signal } = {}) {
  return coachProxyAction({ action: 'job_status', job_id: jobId }, { signal });
}

export async function cancelCoachJob(jobId, { signal } = {}) {
  return coachProxyAction({ action: 'cancel_async', job_id: jobId }, { signal });
}

export async function listActiveCoachJobs() {
  const columns = 'id,kind,status,provider_requested,provider_actual,fallback_provider,fallback_reason,error,created_at,updated_at,payload,result';
  const [active, completed, failed] = await Promise.all([
    supabase
      .from('ai_jobs')
      .select(columns)
      .contains('payload', { source: 'coach_proxy_async' })
      .in('status', ['queued', 'claimed', 'running'])
      .order('created_at', { ascending: false })
      .limit(25),
    supabase
      .from('ai_jobs')
      .select(columns)
      .contains('payload', { source: 'coach_proxy_async' })
      .in('status', ['completed', 'fallback_used'])
      .is('result->>finalized_at', null)
      .order('created_at', { ascending: false })
      .limit(25),
    supabase
      .from('ai_jobs')
      .select(columns)
      .contains('payload', { source: 'coach_proxy_async' })
      .in('status', ['failed', 'expired'])
      .is('result->>failure_finalized_at', null)
      .order('created_at', { ascending: false })
      .limit(25),
  ]);
  const error = active.error || completed.error || failed.error;
  if (error) {
    const e = new Error(error.message);
    e.code = 'async_job_list_failed';
    throw e;
  }
  return [...(active.data || []), ...(completed.data || []), ...(failed.data || [])]
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
}

function abortError() {
  const e = new Error('aborted');
  e.name = 'AbortError';
  e.code = 'aborted';
  return e;
}

function waitForPoll(ms, signal) {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const finish = () => {
      signal?.removeEventListener('abort', abort);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      reject(abortError());
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

export async function waitForCoachJob(jobId, { signal, pollMs = 1500, maxWaitMs = 18 * 60_000 } = {}) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt <= maxWaitMs) {
    if (signal?.aborted) throw abortError();
    try {
      const job = await getCoachJob(jobId, { signal });
      if (['failed', 'expired'].includes(job?.status)) return job;
      if (['completed', 'fallback_used'].includes(job?.status) && job?.finalized === true) return job;
      lastError = null;
    } catch (err) {
      if (signal?.aborted || err?.code === 'aborted' || err?.name === 'AbortError') throw abortError();
      lastError = err;
    }
    await waitForPoll(pollMs, signal);
  }
  const e = new Error(lastError?.message || 'async_job_poll_timeout');
  e.code = lastError?.code || 'async_job_poll_timeout';
  throw e;
}

export async function coachProxyStream({ kind, system, messages, attachments, max_tokens, onToken, signal }) {
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
    body: { kind, system, messages, attachments, max_tokens, stream: true },
    onToken,
    signal,
  });

  if (!result.ok) {
    if (result.aborted) {
      const e = new Error('aborted');
      e.code = 'aborted';
      throw e;
    }
    const code = typeof result.errorData?.error === 'string'
      ? result.errorData.error
      : result.errorText || 'coach_proxy_failed';
    const e = new Error(code);
    e.code = code;
    e.detail = result.errorData || null;
    throw e;
  }

  const meta = result.data || {};
  if (!meta.wallet) {
    const e = new Error('missing_ai_metadata');
    e.code = 'missing_ai_metadata';
    throw e;
  }

  return {
    content: [{ type: 'text', text: result.text || '' }],
    usage: result.usage || meta.usage || null,
    provider: meta.provider || 'deepseek',
    model: meta.model,
    fallback: meta.fallback || null,
    wallet: meta.wallet,
  };
}
