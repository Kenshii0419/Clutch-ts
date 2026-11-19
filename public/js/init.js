// Supabase client initialization — shared by every page.
// Reads the runtime config injected by /js/config.js (Supabase URL + anon key).
// Security is enforced by Row Level Security in the database, not by key secrecy.

const createClient = window.supabase && window.supabase.createClient;
let supabase = null;
let currentUser = null;
let latestSession = null;
let initialized = false;
let authResolved = false;
let domReady = document.readyState === 'complete';
let initialAuthDispatched = false;
let lastDispatchedUserId = undefined;
let cachedProfile = null;
let cachedProfileUserId = null;

if (!domReady) {
  document.addEventListener('DOMContentLoaded', () => {
    domReady = true;
    if (authResolved && !initialAuthDispatched) {
      dispatchAuthState(latestSession);
    }
  }, { once: true });
}

function dispatchAuthState(session) {
  latestSession = session || null;
  if (!domReady) return;
  const nextUserId = currentUser ? currentUser.id : null;
  if (initialAuthDispatched && lastDispatchedUserId === nextUserId) {
    return;
  }
  initialAuthDispatched = true;
  lastDispatchedUserId = nextUserId;
  window.dispatchEvent(new CustomEvent('authstate', {
    detail: { user: currentUser, session: latestSession }
  }));
}

export function onAuthState(handler) {
  if (typeof handler !== 'function') return;
  window.addEventListener('authstate', handler);
  if (initialAuthDispatched) {
    queueMicrotask(() => handler({ detail: { user: currentUser, session: latestSession } }));
  }
}

export function clearProfileCache() {
  cachedProfile = null;
  cachedProfileUserId = null;
}

export async function getCurrentProfile(forceRefresh = false) {
  if (!supabase || !currentUser) {
    clearProfileCache();
    return null;
  }
  if (!forceRefresh && cachedProfile && cachedProfileUserId === currentUser.id) {
    return cachedProfile;
  }
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, display_name, email, avatar_url, bio, role, approval_status, created_at')
      .eq('id', currentUser.id)
      .maybeSingle();
    if (error) return null;
    cachedProfile = data || null;
    cachedProfileUserId = currentUser.id;
    return cachedProfile;
  } catch (_) {
    return null;
  }
}

export function initSupabase() {
  if (initialized) return supabase;
  initialized = true;

  // Always use the warm cream, pale yellow, and soft sage palette.
  try { localStorage.removeItem('theme'); } catch (_) {}
  document.documentElement.setAttribute('data-theme', 'light');

  const cfg = window.SUPABASE_CONFIG || {};
  if (!createClient || !cfg.url || !cfg.key) {
    console.error('Supabase browser client or configuration is missing.');
    authResolved = true;
    dispatchAuthState(null);
    return null;
  }

  supabase = createClient(cfg.url, cfg.key, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
      flowType: 'implicit'
    }
  });

  supabase.auth.onAuthStateChange((event, session) => {
    const nextUser = session ? session.user : null;
    const prevId = currentUser ? currentUser.id : null;
    const nextId = nextUser ? nextUser.id : null;
    currentUser = nextUser;
    if (prevId !== nextId) {
      clearProfileCache();
    }
    if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') {
      authResolved = true;
      if (event === 'USER_UPDATED') {
        lastDispatchedUserId = undefined;
      }
      dispatchAuthState(session);
    }
  });

  // Fallback resolution in case INITIAL_SESSION hasn't fired immediately on cached loads
  supabase.auth.getSession().then(({ data }) => {
    currentUser = data?.session?.user || null;
    authResolved = true;
    dispatchAuthState(data?.session || null);
  }).catch(() => {
    currentUser = null;
    authResolved = true;
    dispatchAuthState(null);
  });

  return supabase;
}

export { supabase, currentUser };
