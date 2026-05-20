import { supabase } from '../supabase';

// Internal helper for DAL modules. Resolves the current Supabase user id (used
// for upsert payloads and explicit `.eq('id', ...)` filters even though RLS
// would already constrain queries to the caller's own rows).
export async function getCurrentUserId() {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error) throw new Error(error.message);
  if (!user) throw new Error('Not authenticated');
  return user.id;
}
