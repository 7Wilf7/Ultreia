import { supabase } from '../supabase';
import { getCurrentUserId } from './_auth';

function fromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    rangeMode: row.range_mode || 'this',
    start: row.period_start,
    end: row.period_end,
    nextStart: row.next_start,
    nextEnd: row.next_end,
    source: row.source || 'manual',
    status: row.status || 'ready',
    title: row.title || '',
    text: row.body || '',
    error: row.error || '',
    walletChargeCents: row.wallet_charge_cents,
    model: row.model || '',
    metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata : {},
    generatedAt: row.created_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    readAt: row.read_at,
  };
}

function toInsert(report, userId) {
  return {
    user_id: userId,
    period_start: report.start,
    period_end: report.end,
    next_start: report.nextStart || null,
    next_end: report.nextEnd || null,
    range_mode: report.rangeMode || 'this',
    source: report.source || 'manual',
    status: report.status || 'ready',
    title: report.title || null,
    body: report.text || report.body || '',
    error: report.error || null,
    wallet_charge_cents: report.walletChargeCents ?? null,
    model: report.model || null,
    metadata: report.metadata || {},
    created_at: report.generatedAt || report.createdAt || undefined,
    read_at: report.readAt || null,
  };
}

export async function listMyReports({ limit = 20 } = {}) {
  const { data, error } = await supabase
    .from('coach_reports')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.error('listMyReports failed:', error);
    throw new Error(error.message);
  }
  return (data ?? []).map(fromRow);
}

export async function createReport(report) {
  const userId = await getCurrentUserId();
  const { data, error } = await supabase
    .from('coach_reports')
    .insert(toInsert(report, userId))
    .select('*')
    .single();
  if (error) {
    console.error('createReport failed:', error);
    throw new Error(error.message);
  }
  return fromRow(data);
}

export async function importStoredReports(reports = []) {
  const cleanReports = (Array.isArray(reports) ? reports : [])
    .filter(r => r?.start && r?.end && (r?.text || r?.body))
    .slice(0, 20);
  if (!cleanReports.length) return [];

  const userId = await getCurrentUserId();
  const rows = cleanReports.map(report => toInsert({
    ...report,
    source: report.source || 'manual',
    status: report.status || 'ready',
    metadata: {
      ...(report.metadata || {}),
      migratedFromDevice: true,
      legacyId: report.id || null,
    },
  }, userId));
  const { data, error } = await supabase
    .from('coach_reports')
    .insert(rows)
    .select('*')
    .order('created_at', { ascending: false });
  if (error) {
    console.error('importStoredReports failed:', error);
    throw new Error(error.message);
  }
  return (data ?? []).map(fromRow);
}

export async function clearAll() {
  const userId = await getCurrentUserId();
  const { error } = await supabase
    .from('coach_reports')
    .delete()
    .eq('user_id', userId);
  if (error) {
    console.error('clearAll (coach reports) failed:', error);
    throw new Error(error.message);
  }
}
