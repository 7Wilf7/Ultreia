import { supabase } from '../supabase';

const CURRENCY = 'CNY';

export function formatWalletAmount(cents, currency = CURRENCY) {
  const amount = (Number(cents) || 0) / 100;
  if (currency === 'CNY') return `¥${amount.toFixed(2)}`;
  return `${amount.toFixed(2)} ${currency || ''}`.trim();
}

function normalizeWallet(data) {
  return {
    balanceCents: data?.wallet?.balance_cents ?? 0,
    currency: data?.wallet?.currency || CURRENCY,
    ledger: Array.isArray(data?.ledger)
      ? data.ledger.map(row => ({
          id: row.id,
          kind: row.kind,
          amountCents: row.amount_cents ?? 0,
          balanceAfterCents: row.balance_after_cents ?? 0,
          provider: row.provider || '',
          requestId: row.request_id || '',
          metadata: row.metadata || {},
          createdAt: row.created_at,
        }))
      : [],
  };
}

export async function getMyWallet() {
  const { data, error } = await supabase.functions.invoke('wallet-status', {
    body: { limit: 30 },
  });
  if (error) {
    let code = '';
    try {
      const ctx = error.context;
      if (ctx && typeof ctx.json === 'function') {
        const b = await ctx.json();
        code = b?.error || '';
      }
    } catch { /* ignore */ }
    const e = new Error(code || error.message || 'wallet_status_failed');
    e.code = code;
    throw e;
  }
  if (data?.error) {
    const e = new Error(data.error);
    e.code = data.error;
    throw e;
  }
  return normalizeWallet(data);
}
