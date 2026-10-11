// Dayari Mo: shared pieces for the public pages (anonymous account, Turnstile, the Edge
// Function, and every bit of interface text).
//
// Reading never creates an account. The anonymous account is made only when someone
// posts, reports or deletes, and is kept under its own storage key, so it never touches
// the owner's login on the posting page.
(function () {
  var M = window.Moriyada = window.Moriyada || {};
  var cfg = window.MORIYADA_CONFIG || {};
  var D = M.dayari = {};

  D.MAX = 2000;
  D.STORAGE_KEY = 'moriyada-dayari-auth';
  var GATE_KEY = 'moriyada-dayari-gate';     // age 13+ and house rules accepted (version 1)
  var DRAFT_KEY = 'moriyada-dayari-draft';

  // ---------- all interface text (phase E adds a Tagalog set next to this one) ----------

  D.T = {
    published: 'Posted. Salamat sa pagsulat.',
    held: 'Saved, and waiting for a quick review before it shows. This happens to some posts so the page stays kind and safe.',
    deleted: 'Deleted. It\'s gone for good.',
    reported: 'Thanks for telling us. We\'ll take a look.',
    reportHidden: 'Thanks. Enough people reported this, so it\'s hidden until it\'s reviewed.',
    reportAlready: 'You already reported this one.',
    reportOwn: 'That\'s your own post. You can delete it instead.',
    reportMissing: 'This post isn\'t up anymore.',
    sending: 'Sending...',
    checking: 'Checking...',
    errors: {
      empty: 'Write something first.',
      too_long: 'That\'s a bit long. Keep it under 2,000 characters.',
      gate: 'Please confirm you\'re 13 or older and agree to the house rules first.',
      captcha: 'We couldn\'t confirm you\'re a person, not a bot. Refresh the page and try again.',
      closed: 'Posting isn\'t open yet. Check back soon.',
      rate: 'That\'s a lot in a short time. Take a breather and try again later.',
      banned: 'You can\'t post or report on Dayari Mo right now.',
      login: 'Couldn\'t start your anonymous session. Refresh the page and try again.',
      not_anonymous: 'Dayari Mo only takes anonymous posts. Open this page in a private window to write here.',
      moderation: 'We couldn\'t post this. It looks like it may break the house rules (hate, harassment, sexual content or threats). You can still write about hard things, just without attacking anyone.',
      server: 'Something went wrong on our side. Your text is still here, so try again in a bit.',
      network: 'Couldn\'t reach Dayari Mo. Check your connection; your text is still here.'
    },
    pii: {
      phone: 'This looks like it has a phone number. To keep you and others safe, Dayari Mo doesn\'t allow phone numbers. Take it out and post again.',
      email: 'This looks like it has an email address. Please take it out so nobody can be traced, then post again.',
      address: 'This looks like it has an address (house number, street, block or lot). Please remove it so nobody can be found, then post again.',
      social: 'This looks like it has a social media link or @username. Please take it out to stay anonymous, then post again.',
      name_place: 'This looks like it has someone\'s full name together with a school or workplace, which could identify them. Try initials or "a classmate" / "a coworker" instead.'
    },
    piiTitle: 'Almost there.',
    errorTitle: 'Not posted.',
    care: {
      title: 'Mukhang mabigat ang dinadala mo ngayon.',
      body: 'Your entry is posted. If you\'re thinking about hurting yourself, you don\'t have to go through it alone. Free and 24/7:',
      lines: 'NCMH Crisis Hotline: 1553 or 0917-899-8727',
      after: 'If you\'re in danger right now, call 911. Talking to someone you trust helps too.'
    }
  };

  // ---------- age gate + house rules (remembered in this browser) ----------

  D.gateAccepted = function () {
    try { return localStorage.getItem(GATE_KEY) === '1'; } catch (e) { return false; }
  };
  D.acceptGate = function () {
    try { localStorage.setItem(GATE_KEY, '1'); } catch (e) { /* private mode: asked again next time */ }
  };

  D.draft = {
    get: function () { try { return localStorage.getItem(DRAFT_KEY) || ''; } catch (e) { return ''; } },
    set: function (v) { try { if (v) localStorage.setItem(DRAFT_KEY, v); else localStorage.removeItem(DRAFT_KEY); } catch (e) { /* fine */ } }
  };

  // ---------- the anonymous account ----------

  var client = null;
  D.client = function () {
    if (!client && M.configured && window.supabase) {
      client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
        auth: { storageKey: D.STORAGE_KEY, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, lock: M.lockWithTimeout },
        global: { fetch: M.fetch }
      });
    }
    return client;
  };

  // Has this browser written here before? (No network, no account created.)
  D.hasAccount = function () {
    try { return Boolean(localStorage.getItem(D.STORAGE_KEY)); } catch (e) { return false; }
  };

  // The anonymous account's access token, making the account if there isn't one yet.
  D.token = async function () {
    var c = D.client();
    if (!c) throw codeError('closed');
    var got = await M.withTimeout(c.auth.getSession(), 8000, 'session');
    var session = got && got.data && got.data.session;
    if (!session) {
      var made = await M.withTimeout(c.auth.signInAnonymously(), 10000, 'sign-in');
      if (made.error) throw codeError('login');
      session = made.data && made.data.session;
    }
    if (!session) throw codeError('login');
    return session.access_token;
  };

  // My own posts (ids + status), or [] if this browser never wrote here.
  D.myPosts = async function () {
    if (!D.hasAccount()) return [];
    var c = D.client();
    if (!c) return [];
    var res = await M.withTimeout(c.rpc('dayari_my_posts'), 10000, 'my posts');
    return M.rows(res);
  };

  function codeError(code) {
    var e = new Error(code);
    e.code = code;
    return e;
  }

  // ---------- Turnstile (Cloudflare's invisible "are you human" check) ----------
  // Loaded only when someone is about to write or report, never just for reading.

  var tsLoading = null;
  var widget = null;
  function loadTurnstile() {
    if (window.turnstile) return Promise.resolve(window.turnstile);
    if (!tsLoading) {
      tsLoading = new Promise(function (resolve, reject) {
        var s = document.createElement('script');
        s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
        s.async = true;
        s.onload = function () { window.turnstile ? resolve(window.turnstile) : reject(new Error('turnstile')); };
        s.onerror = function () { tsLoading = null; reject(new Error('turnstile')); };
        document.head.appendChild(s);
      });
    }
    return tsLoading;
  }

  // Returns a one-time token. `box` is where Cloudflare may show a checkbox if it isn't sure.
  D.captcha = async function (box, action) {
    if (!cfg.dayariTurnstileSiteKey) throw codeError('closed');
    var ts;
    try { ts = await M.withTimeout(loadTurnstile(), 15000, 'captcha'); } catch (e) { throw codeError('captcha'); }
    return M.withTimeout(new Promise(function (resolve, reject) {
      if (widget !== null) { try { ts.remove(widget); } catch (e) { /* already gone */ } widget = null; }
      box.textContent = '';
      widget = ts.render(box, {
        sitekey: cfg.dayariTurnstileSiteKey,
        action: action,
        appearance: 'interaction-only',
        callback: resolve,
        'error-callback': function () { reject(codeError('captcha')); },
        'expired-callback': function () { reject(codeError('captcha')); }
      });
    }), 60000, 'captcha').catch(function (e) { throw e.code ? e : codeError('captcha'); });
  };

  // ---------- the Edge Function ----------

  // Sends one action. Always resolves to { ok, code, ... } (never throws).
  D.send = async function (payload) {
    try {
      var token = await D.token();
      var res = await M.fetch(cfg.supabaseUrl + '/functions/v1/dayari', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, apikey: cfg.supabaseAnonKey },
        body: JSON.stringify(payload)
      });
      var body = {};
      try { body = await res.json(); } catch (e) { /* not JSON */ }
      if (!body || typeof body !== 'object') body = {};
      if (!res.ok && !body.code) body.code = res.status === 404 ? 'closed' : 'server';
      body.ok = res.ok && body.ok !== false;
      return body;
    } catch (e) {
      return { ok: false, code: e && e.code ? e.code : 'network' };
    }
  };

  // A failed reply -> the kind sentence to show.
  D.errorText = function (r) {
    if (r && r.code === 'pii') return D.T.pii[r.kind] || D.T.pii.phone;
    return (r && D.T.errors[r.code]) || D.T.errors.server;
  };

  // The hotline note, built as plain DOM (numbers are tap-to-call on phones).
  D.careNote = function () {
    var el = M.el;
    var T = D.T.care;
    return el('div', { class: 'dy-care', role: 'note', 'aria-label': 'Crisis hotline' }, [
      el('h3', null, [T.title]),
      el('p', null, [T.body]),
      el('p', { class: 'lines' }, [
        'NCMH Crisis Hotline: ',
        el('a', { href: 'tel:1553' }, ['1553']),
        ' or ',
        el('a', { href: 'tel:+639178998727' }, ['0917-899-8727'])
      ]),
      el('p', null, [T.after])
    ]);
  };

  D.when = function (iso) {
    return M.formatDateTime(iso);
  };
})();
