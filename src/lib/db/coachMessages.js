import { supabase } from '../supabase';
import { getCurrentUserId } from './_auth';

function fromRow(row) {
  if (!row) return null;
  return {
    id:        row.id,
    role:      row.role,        // 'user' | 'assistant'
    content:   row.content,
    createdAt: row.created_at,
  };
}

export async function listMyMessages() {
  // Ascending order — chat history reads oldest-first (top → bottom).
  const { data, error } = await supabase
    .from('coach_messages')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) {
    console.error('listMyMessages failed:', error);
    throw new Error(error.message);
  }
  return (data ?? []).map(fromRow);
}

export async function appendMessage(role, content, opts = {}) {
  const userId = await getCurrentUserId();
  const row = { user_id: userId, role, content };
  if (opts.createdAt) row.created_at = opts.createdAt;
  const { data, error } = await supabase
    .from('coach_messages')
    .insert(row)
    .select('*')
    .single();
  if (error) {
    console.error('appendMessage failed:', error);
    throw new Error(error.message);
  }
  return fromRow(data);
}

export async function deleteMessages(ids = []) {
  const safeIds = [...new Set((ids || []).map(id => String(id || '').trim()).filter(Boolean))];
  if (!safeIds.length) return;
  const userId = await getCurrentUserId();
  const { error } = await supabase
    .from('coach_messages')
    .delete()
    .eq('user_id', userId)
    .in('id', safeIds);
  if (error) {
    console.error('deleteMessages failed:', error);
    throw new Error(error.message);
  }
}

export async function clearAllMessages() {
  // Explicit user_id filter — RLS would also constrain this, but the explicit
  // predicate is defence-in-depth in case RLS is ever misconfigured.
  const userId = await getCurrentUserId();
  const { error } = await supabase
    .from('coach_messages')
    .delete()
    .eq('user_id', userId);
  if (error) {
    console.error('clearAllMessages failed:', error);
    throw new Error(error.message);
  }
}
