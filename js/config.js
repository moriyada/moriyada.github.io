// Supabase connection. Paste the two values from
// Supabase > Project Settings > API.
//
// The anon key is safe to be public: the database rules decide what it can do.
// NEVER put the service_role key here.
window.MORIYADA_CONFIG = {
  supabaseUrl: 'https://uxjsqgeynszqhkzzwvhd.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV4anNxZ2V5bnN6cWhrenp3dmhkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE0NTkyNjIsImV4cCI6MjEwNzAzNTI2Mn0._6N_Rn81H2-lAf_V5tMgCwv0mnWdJWXysdKAy9E1Hpg',

  // Talaarawan: the Cloudflare Turnstile SITE key (public by design, like the anon key).
  // Cloudflare dashboard > Turnstile > your widget > "Site Key". Empty = posting stays closed.
  // NEVER put the Turnstile SECRET key here; that one goes in Supabase Edge Function secrets.
  dayariTurnstileSiteKey: ''
};
