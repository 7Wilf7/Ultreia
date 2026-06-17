import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Supabase 环境变量缺失,请检查 .env.local');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
export const supabaseFunctionUrl = (name) => `${supabaseUrl.replace(/\/+$/, '')}/functions/v1/${name}`;
export const supabasePublicAnonKey = supabaseAnonKey;
