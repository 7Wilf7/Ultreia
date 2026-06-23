import { supabase } from '../supabase';
import { getCurrentUserId } from './_auth';

function parseSourceRef(row) {
  const type = row.source_ref_type || '';
  const id = row.source_ref_id || null;
  if (type === 'coach_message') return { sourceMessageId: id };
  if (type === 'coach_report') return { sourceReportId: id };
  return {};
}

function sourceRefFromAction(action = {}) {
  if (action.sourceReportId) {
    return { source_ref_type: 'coach_report', source_ref_id: String(action.sourceReportId) };
  }
  if (action.sourceMessageId) {
    return { source_ref_type: 'coach_message', source_ref_id: String(action.sourceMessageId) };
  }
  return { source_ref_type: null, source_ref_id: null };
}

function fromRow(row) {
  if (!row) return null;
  return {
    id: row.client_id || row.id,
    rowId: row.id,
    type: row.type,
    title: row.title || '',
    reason: row.reason || '',
    payload: row.payload && typeof row.payload === 'object' ? row.payload : {},
    result: row.result && typeof row.result === 'object' ? row.result : {},
    error: row.error || '',
    risk: row.risk || 'low',
    requiresConfirmation: row.requires_confirmation !== false,
    source: row.source || 'ai_coach',
    status: row.status || 'proposed',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    decidedAt: row.decided_at,
    executedAt: row.executed_at,
    ...parseSourceRef(row),
  };
}

function toUpsert(action, userId) {
  const { source_ref_type, source_ref_id } = sourceRefFromAction(action);
  return {
    user_id: userId,
    client_id: action.id,
    type: action.type,
    status: action.status || 'proposed',
    title: action.title || null,
    reason: action.reason || null,
    risk: action.risk || 'low',
    requires_confirmation: action.requiresConfirmation !== false,
    source: action.source || 'ai_coach',
    source_ref_type,
    source_ref_id,
    payload: action.payload || {},
    result: action.result || {},
    error: action.error || null,
    created_at: action.createdAt || undefined,
    decided_at: action.decidedAt || null,
    executed_at: action.executedAt || null,
  };
}

export async function listMyActions({ limit = 100 } = {}) {
  const userId = await getCurrentUserId();
  const { data, error } = await supabase
    .from('agent_actions')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.error('listMyActions failed:', error);
    throw new Error(error.message);
  }
  return (data ?? []).map(fromRow);
}

export async function upsertAction(action) {
  if (!action?.id) throw new Error('upsertAction: action.id is required');
  if (!action?.type) throw new Error('upsertAction: action.type is required');
  const userId = await getCurrentUserId();
  const { data, error } = await supabase
    .from('agent_actions')
    .upsert(toUpsert(action, userId), { onConflict: 'user_id,client_id' })
    .select('*')
    .single();
  if (error) {
    console.error('upsertAction failed:', error);
    throw new Error(error.message);
  }
  return fromRow(data);
}
