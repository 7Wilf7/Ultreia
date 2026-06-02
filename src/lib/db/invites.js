import { supabase } from '../supabase';

// Invite codes — admin-only (RLS: only the ADMIN_EMAIL account can read/write
// invite_codes). One-time use: registration burns a code by setting used_by.
// Registration itself goes through the register-with-invite Edge Function
// (service_role) since the registrant has no session to satisfy RLS.

function fromRow(row) {
  if (!row) return null;
  return {
    code: row.code,
    createdAt: row.created_at,
    usedBy: row.used_by ?? null,
    usedAt: row.used_at ?? null,
    note: row.note ?? '',
  };
}

// Random human-readable code: TS-XXXXXXXX (no ambiguous chars I/O/0/1).
function genCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  const arr = new Uint32Array(8);
  crypto.getRandomValues(arr);
  for (let i = 0; i < 8; i++) s += alphabet[arr[i] % alphabet.length];
  return `TS-${s}`;
}

export async function listMyInviteCodes() {
  const { data, error } = await supabase
    .from('invite_codes')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) {
    console.error('listMyInviteCodes failed:', error);
    throw new Error(error.message);
  }
  return (data ?? []).map(fromRow);
}

export async function createInviteCode(note = '') {
  const { data: { user } } = await supabase.auth.getUser();
  const row = { code: genCode(), created_by: user?.id ?? null, note: note || null };
  const { data, error } = await supabase
    .from('invite_codes')
    .insert(row)
    .select('*')
    .single();
  if (error) {
    console.error('createInviteCode failed:', error);
    throw new Error(error.message);
  }
  return fromRow(data);
}

// Calls the Edge Function. Throws an Error whose `.code` is the server's error
// id (invalid_code / code_used / email_taken / weak_password / bad_input) so the
// UI can map it to a friendly message.
export async function registerWithInvite(email, password, code) {
  const { data, error } = await supabase.functions.invoke('register-with-invite', {
    body: { email, password, code },
  });
  // functions.invoke surfaces non-2xx as a FunctionsHttpError; the JSON body
  // (with our { error } id) is on error.context — parse it for the code.
  if (error) {
    let serverErr = '';
    try {
      const ctx = error.context;
      if (ctx && typeof ctx.json === 'function') {
        const body = await ctx.json();
        serverErr = body?.error || '';
      }
    } catch { /* fall through to generic */ }
    const e = new Error(serverErr || error.message || 'register_failed');
    e.code = serverErr || 'register_failed';
    throw e;
  }
  if (data && data.error) {
    const e = new Error(data.error);
    e.code = data.error;
    throw e;
  }
  return true;
}
