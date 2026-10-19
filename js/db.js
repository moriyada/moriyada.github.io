// Supabase connections (with time limits), a small cache, and date helpers shared by every page.
// Everything hangs off one global, window.Moriyada, to keep names from clashing.
(function () {
  var M = window.Moriyada = window.Moriyada || {};
  var cfg = window.MORIYADA_CONFIG || {};

  M.configured = Boolean(
    cfg.supabaseUrl && cfg.supabaseAnonKey &&
    cfg.supabaseUrl.indexOf('YOUR-') === -1 && cfg.supabaseAnonKey.indexOf('YOUR-') === -1
  );

  // ---------- never hang: time limits ----------

  M.REQUEST_TIMEOUT = 10000;   // any single network request
  M.LOCK_TIMEOUT = 4000;       // waiting for the login lock (see below)

  // fetch() that gives up after M.REQUEST_TIMEOUT instead of waiting forever.
  function fetchWithTimeout(input, init) {
    init = init || {};
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, M.REQUEST_TIMEOUT);
    if (init.signal) {
      if (init.signal.aborted) ctrl.abort();
      else init.signal.addEventListener('abort', function () { ctrl.abort(); });
    }
    return fetch(input, Object.assign({}, init, { signal: ctrl.signal }))
      .finally(function () { clearTimeout(timer); });
  }
  M.fetch = fetchWithTimeout;

  // Any promise, but rejected after `ms` if it hasn't settled.
  M.withTimeout = function (promise, ms, what) {
    var timer;
    return Promise.race([
      promise,
      new Promise(function (resolve, reject) {
        timer = setTimeout(function () { reject(new Error((what || 'request') + ' timed out')); }, ms);
      })
    ]).finally(function () { clearTimeout(timer); });
  };

  // The Supabase library keeps the saved login behind a browser "lock" shared by all tabs,
  // and by default waits for it forever. A frozen background tab or a token refresh that
  // never answers then hangs every request in every tab. This lock waits at most
  // M.LOCK_TIMEOUT, then takes the lock over ("steal") and carries on.
  function lockWithTimeout(name, acquireTimeout, fn) {
    if (!(window.navigator && navigator.locks && navigator.locks.request)) return fn();
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, M.LOCK_TIMEOUT);
    return navigator.locks.request(name, { mode: 'exclusive', signal: ctrl.signal }, function () {
      clearTimeout(timer);
      return fn();
    }).catch(function (err) {
      if (err && err.name === 'AbortError') {
        if (window.console) console.warn('login lock was stuck; taking it over');
        return navigator.locks.request(name, { steal: true }, function () { return fn(); });
      }
      throw err;
    });
  }
  M.lockWithTimeout = lockWithTimeout;   // also used by Talaarawan's anonymous account (js/dayari.js)

  // ---------- safety nets ----------

  // A broken piece of code or a failed request is logged quietly, never left to break the page.
  window.addEventListener('unhandledrejection', function (e) {
    if (window.console) console.warn('unhandled', e.reason);
    e.preventDefault();
  });
  window.addEventListener('error', function (e) {
    if (window.console) console.warn('error', e.message);
  });

  // Last resort: whatever still says "loading..." after 20 seconds gets a plain message.
  document.addEventListener('DOMContentLoaded', function () {
    setTimeout(function () {
      Array.prototype.forEach.call(document.querySelectorAll('#page p.note, #page span'), function (n) {
        if (n.children.length === 0 && /^\s*loading\.\.\.\s*$/.test(n.textContent)) {
          n.textContent = "couldn't load. Refresh to try again.";
        }
      });
    }, 20000);
  });

  // ---------- two connections ----------
  //
  // M.db: for everything public. It never reads or refreshes the saved login, so the
  //   public site can't get stuck because of it. Used on every page.
  // M.authClient(): the logged-in connection (posting page, and the owner's extras such as
  //   private entries and the visitor count). Created only when needed.

  var ref = '';
  try { ref = new URL(cfg.supabaseUrl).hostname.split('.')[0]; } catch (e) { /* not configured */ }
  M.SESSION_KEY = 'sb-' + ref + '-auth-token';   // where supabase-js keeps the login

  M.db = (M.configured && window.supabase)
    ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'moriyada-public' },
        global: { fetch: fetchWithTimeout }
      })
    : null;

  var authClient = null;
  M.authClient = function () {
    if (!authClient && M.configured && window.supabase) {
      authClient = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
        auth: { lock: lockWithTimeout, detectSessionInUrl: false },
        global: { fetch: fetchWithTimeout }
      });
    }
    return authClient;
  };

  // Is there a saved login in this browser? (Cheap check; doesn't touch the network.)
  M.hasStoredSession = function () {
    try { return Boolean(localStorage.getItem(M.SESSION_KEY)); } catch (e) { return false; }
  };

  // The owner's connection if this browser has a saved login, otherwise null.
  M.ownerClient = function () { return M.hasStoredSession() ? M.authClient() : null; };

  // ---------- small cache, so a refresh shows the last data instantly ----------
  // Only public data is ever cached (never private entries).

  var CACHE_PREFIX = 'moriyada:cache:v1:';
  M.cache = {
    get: function (key) {
      try {
        var raw = localStorage.getItem(CACHE_PREFIX + key);
        return raw ? JSON.parse(raw).v : undefined;
      } catch (e) { return undefined; }
    },
    set: function (key, value) {
      try { localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ t: Date.now(), v: value })); } catch (e) { /* full or blocked: fine */ }
    }
  };

  // Load one thing the "public first, owner on top" way:
  //   cached copy (instant) -> public connection -> logged-in connection (if any).
  // fetchFn(client) returns a promise of data. onData(data, fromOwner) may run up to three
  // times; once the owner's data is shown, public data never replaces it. onFail() runs
  // only if nothing at all could be shown. Nothing here can hang: everything has a time limit.
  M.layered = function (fetchFn, onData, onFail, cacheKey) {
    var ownerShown = false, anyShown = false;
    if (cacheKey) {
      var cached = M.cache.get(cacheKey);
      if (cached !== undefined) { anyShown = true; onData(cached, false); }
    }
    var pub = M.withTimeout(fetchFn(M.db), 12000, 'request').then(function (v) {
      if (cacheKey) M.cache.set(cacheKey, v);
      if (!ownerShown) { anyShown = true; onData(v, false); }
    });
    var owner = M.ownerClient();
    var own = owner
      ? M.withTimeout(fetchFn(owner), 15000, 'login').then(function (v) { ownerShown = true; anyShown = true; onData(v, true); })
      : Promise.resolve();
    return Promise.allSettled([pub, own]).then(function (r) {
      r.forEach(function (x) { if (x.status === 'rejected' && window.console) console.warn(x.reason); });
      if (!anyShown && onFail) onFail();
    });
  };

  // Supabase replies { data, error }; turn an error into a thrown one.
  M.rows = function (res) {
    if (res && res.error) throw res.error;
    return (res && res.data) || [];
  };

  M.TZ = 'Asia/Manila';
  M.MEDIA_BUCKET = 'media';

  // Today's date in Manila as 'YYYY-MM-DD', whatever timezone the visitor is in.
  M.manilaDate = function (when) {
    var parts = {};
    new Intl.DateTimeFormat('en-US', {
      timeZone: M.TZ, year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(when || new Date()).forEach(function (p) { parts[p.type] = p.value; });
    return parts.year + '-' + parts.month + '-' + parts.day;
  };

  // Milliseconds until the next 12:00 AM in Manila. The Philippines is always UTC+8
  // (no daylight saving), so this is plain arithmetic.
  M.msUntilManilaMidnight = function (now) {
    var DAY = 86400000, OFFSET = 8 * 3600000;
    var t = (now === undefined ? Date.now() : now) + OFFSET;
    return DAY - (t % DAY);
  };

  // Pages that show "today" call this: once Manila's date moves past `day`, the page
  // reloads itself onto the new day. Timers can be late (sleeping laptop, background tab),
  // so it also re-checks every 20 seconds and whenever the tab is looked at again.
  M.reloadAtMidnight = function (day) {
    function check() {
      if (M.manilaDate() !== day) location.reload();
    }
    setTimeout(check, M.msUntilManilaMidnight() + 1000);
    setInterval(check, 20000);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) check(); });
    window.addEventListener('focus', check);
  };

  // 'YYYY-MM-DD' <-> whole-day arithmetic. Done in UTC so daylight saving never shifts a day.
  function dayNumber(dateStr) { return Math.round(Date.parse(dateStr + 'T00:00:00Z') / 86400000); }
  M.dayNumber = dayNumber;
  M.daysBetween = function (from, to) { return dayNumber(to) - dayNumber(from); };
  M.addDays = function (dateStr, n) {
    return new Date((dayNumber(dateStr) + n) * 86400000).toISOString().slice(0, 10);
  };

  // 'YYYY-MM-DD' -> 'Thursday, October 8, 2026'
  M.formatDate = function (dateStr, opts) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr))) return '';
    return new Intl.DateTimeFormat('en-US', Object.assign({
      timeZone: 'UTC', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    }, opts || {})).format(new Date(dateStr + 'T00:00:00Z'));
  };

  // timestamp -> '9:14 PM' in Manila
  M.formatTime = function (iso) {
    var d = new Date(iso);
    if (isNaN(d)) return '';
    return new Intl.DateTimeFormat('en-US', { timeZone: M.TZ, hour: 'numeric', minute: '2-digit' }).format(d);
  };

  // timestamp -> 'Oct 8, 2026, 9:14 PM' in Manila
  M.formatDateTime = function (iso) {
    var d = new Date(iso);
    if (isNaN(d)) return '';
    return new Intl.DateTimeFormat('en-US', {
      timeZone: M.TZ, month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit'
    }).format(d);
  };

  // Storage path -> public link to the file.
  M.mediaUrl = function (path) {
    if (!M.db) return '';
    return M.db.storage.from(M.MEDIA_BUCKET).getPublicUrl(path).data.publicUrl;
  };

  // Relative path back to the site root ('' on the home page, '../' inside /html/).
  M.root = function () { return document.body.getAttribute('data-root') || ''; };

  M.dayUrl = function (dateStr) { return M.root() + 'html/day.html?date=' + dateStr; };
})();
