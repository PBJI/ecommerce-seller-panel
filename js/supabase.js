import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { config, isSupabaseConfigured } from './config.js';

let client = null;

export function getSupabase() {
  if (!isSupabaseConfigured()) return null;
  if (!client) {
    client = createClient(config.supabaseUrl, config.supabasePublishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'pkce'
      },
      global: { headers: { 'x-application-name': 'merchant-desk-github-pages' } }
    });
  }
  return client;
}

// Supabase stores workspace metadata and Drive file references only. Image files are
// uploaded directly from the browser to the user's Google Drive by js/drive.js.
export async function fetchWorkspaceState(userId) {
  const supabase = getSupabase();
  if (!supabase) throw new Error('Supabase is not configured. Edit js/config.js first.');
  const { data, error } = await supabase
    .from('merchant_desk_state')
    .select('state, updated_at')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

export async function saveWorkspaceState(userId, state) {
  const supabase = getSupabase();
  if (!supabase) throw new Error('Supabase is not configured. Edit js/config.js first.');
  const { error } = await supabase
    .from('merchant_desk_state')
    .upsert({ user_id: userId, state, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (error) throw error;
}
