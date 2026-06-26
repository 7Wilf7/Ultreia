import { supabase } from '../supabase';
import { getCurrentUserId } from './_auth';

function fromRow(row) {
  if (!row) return null;
  return {
    id: row.client_id || row.id,
    rowId: row.id,
    clientId: row.client_id || '',
    category: row.category || 'other',
    contentEn: row.content_en || '',
    contentZh: row.content_zh || '',
    source: row.source || 'ai_coach',
    sourceRefType: row.source_ref_type || '',
    sourceRefId: row.source_ref_id || '',
    sourceSummary: row.source_summary || '',
    confidence: row.confidence || 'user_confirmed',
    status: row.status || 'proposed',
    metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata : {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    proposedAt: row.proposed_at,
    acceptedAt: row.accepted_at,
    rejectedAt: row.rejected_at,
    archivedAt: row.archived_at,
    lastUsedAt: row.last_used_at,
  };
}

function toRow(fact, userId) {
  const now = new Date().toISOString();
  const status = fact.status || 'proposed';
  return {
    user_id: userId,
    client_id: fact.clientId || fact.id,
    category: fact.category || 'other',
    content_en: fact.contentEn || null,
    content_zh: fact.contentZh || null,
    source: fact.source || 'ai_coach',
    source_ref_type: fact.sourceRefType || null,
    source_ref_id: fact.sourceRefId || null,
    source_summary: fact.sourceSummary || null,
    confidence: fact.confidence || 'user_confirmed',
    status,
    metadata: fact.metadata && typeof fact.metadata === 'object' ? fact.metadata : {},
    proposed_at: fact.proposedAt || fact.createdAt || now,
    accepted_at: fact.acceptedAt || (status === 'active' ? now : null),
    rejected_at: fact.rejectedAt || null,
    archived_at: fact.archivedAt || null,
    last_used_at: fact.lastUsedAt || null,
  };
}

export async function listMyFacts({ limit = null, statuses = ['active', 'proposed', 'archived'] } = {}) {
  const userId = await getCurrentUserId();
  let query = supabase
    .from('coach_memory_facts')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });
  if (Number.isFinite(Number(limit)) && Number(limit) > 0) {
    query = query.limit(Number(limit));
  }
  if (Array.isArray(statuses) && statuses.length) {
    query = query.in('status', statuses);
  }
  const { data, error } = await query;
  if (error) {
    console.error('listMyFacts failed:', error);
    throw new Error(error.message);
  }
  return (data ?? []).map(fromRow);
}

export async function upsertFacts(facts = []) {
  const safeFacts = (Array.isArray(facts) ? facts : []).filter(f => f?.clientId || f?.id);
  if (!safeFacts.length) return [];
  const userId = await getCurrentUserId();
  const rows = safeFacts.map(fact => toRow(fact, userId));
  const { data, error } = await supabase
    .from('coach_memory_facts')
    .upsert(rows, { onConflict: 'user_id,client_id' })
    .select('*');
  if (error) {
    console.error('upsertFacts failed:', error);
    throw new Error(error.message);
  }
  return (data ?? []).map(fromRow);
}

export async function updateFactStatus(fact, status) {
  if (!fact?.rowId && !fact?.id && !fact?.clientId) throw new Error('updateFactStatus: fact id is required');
  const userId = await getCurrentUserId();
  const now = new Date().toISOString();
  const patch = { status };
  if (status === 'active') patch.accepted_at = fact.acceptedAt || now;
  if (status === 'rejected') patch.rejected_at = fact.rejectedAt || now;
  if (status === 'archived') patch.archived_at = fact.archivedAt || now;
  const base = supabase
    .from('coach_memory_facts')
    .update(patch)
    .eq('user_id', userId);
  const query = fact.rowId
    ? base.eq('id', fact.rowId)
    : base.eq('client_id', fact.clientId || fact.id);
  const { data, error } = await query.select('*').maybeSingle();
  if (error) {
    console.error('updateFactStatus failed:', error);
    throw new Error(error.message);
  }
  return fromRow(data);
}

export async function deleteFact(fact) {
  if (!fact?.rowId && !fact?.id && !fact?.clientId) throw new Error('deleteFact: fact id is required');
  const userId = await getCurrentUserId();
  const base = supabase
    .from('coach_memory_facts')
    .delete()
    .eq('user_id', userId);
  const query = fact.rowId
    ? base.eq('id', fact.rowId)
    : base.eq('client_id', fact.clientId || fact.id);
  const { error } = await query;
  if (error) {
    console.error('deleteFact failed:', error);
    throw new Error(error.message);
  }
  return true;
}
