import { supabase } from '../supabase';
import { getCurrentUserId } from './_auth';

export async function upsertMyClientId(cid, platform = 'android') {
  if (!cid) return null;
  const userId = await getCurrentUserId();
  const { data, error } = await supabase
    .from('push_getui_devices')
    .upsert(
      { user_id: userId, cid, platform, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,cid' }
    )
    .select('*')
    .single();
  if (error) {
    console.error('upsertMyClientId failed:', error);
    throw new Error(error.message);
  }
  return data;
}

export async function deleteMyClientId(cid) {
  if (!cid) return;
  const userId = await getCurrentUserId();
  const { error } = await supabase
    .from('push_getui_devices')
    .delete()
    .eq('user_id', userId)
    .eq('cid', cid);
  if (error) {
    console.error('deleteMyClientId failed:', error);
    throw new Error(error.message);
  }
}
