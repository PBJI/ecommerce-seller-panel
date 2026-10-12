/**
 * Public browser configuration for Merchant Desk.
 * These values are intentionally public identifiers, not secrets.
 * Never put a Supabase service-role key or Google OAuth client secret here.
 */
export const config = {
  supabaseUrl: 'https://xuksitorphqnkldanouz.supabase.co',
  supabasePublishableKey: 'sb_publishable_wLh2ceb-FSd7WRrjhCnp4A_m5BAtOXy',
  googleClientId: '86578346656-tudggef050illl7oj4klgltuequs1b56.apps.googleusercontent.com'
};

export function isSupabaseConfigured() {
  return /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(config.supabaseUrl)
    && !config.supabaseUrl.includes('YOUR_PROJECT_REF')
    && Boolean(config.supabasePublishableKey)
    && !config.supabasePublishableKey.includes('YOUR_');
}

export function isDriveConfigured() {
  return Boolean(config.googleClientId)
    && !config.googleClientId.includes('YOUR_')
    && config.googleClientId.endsWith('.apps.googleusercontent.com');
}
