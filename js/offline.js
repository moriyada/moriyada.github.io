// Archive mode: if Supabase can't be reached, the site reads the copy GitHub Actions publishes
// with it every day (/archive/, see tools/archive/build.mjs) and keeps working, read-only.
//
// How: M.db (the public connection every page uses) is wrapped. Each request first goes to
// Supabase with a short time limit (5 s until Supabase has answered once). If Supabase
// doesn't answer, can't be reached or is down (paused/deleted project), the page switches to
// archive mode and that request, and every one after it, is answered from /archive/ instead:
// same tables, same filters and sorting, so every page renders exactly as before.
//
// In archive mode: a small "archive mode · last saved <date>" note shows, nothing can be
// written (no posting, no login, no manage boxes), and photos come from /archive/media/.
// Add ?archive=1 to any page address to force archive mode (to check that it works);
// ?archive=0 turns it off again.
(function () {
  var M = window.Moriyada = window.Moriyada || {};
  var real = M.db;                    // the real public Supabase connection (or null)
  var FIRST_LIMIT = 5000;             // how long the first requests may take before giving up
  var reachable = false;              // Supabase answered at least once on this page
  // ?archive=1 forces archive mode (for testing) and keeps it on while clicking around in this
  // tab; ?archive=0 turns it back off.
  var forced = false;
  try {
    if (/(?:^|[?&])archive=1(?:&|$)/.test(location.search)) sessionStorage.setItem('moriyada-archive-test', '1');
    if (/(?:^|[?&])archive=0(?:&|$)/.test(location.search)) sessionStorage.removeItem('moriyada-archive-test');
    forced = sessionStorage.getItem('moriyada-archive-test') === '1';
  } catch (e) {
    forced = /(?:^|[?&])archive=1(?:&|$)/.test(location.search);
  }

  M.archiveMode = false;

  // ---------- reading /archive/ ----------

  var archivePromise = null;
  function archiveData() {
    if (!archivePromise) {
      var base = M.root() + 'archive/';
      var get = function (f) {
        return fetch(base + f, { cache: 'no-cache' }).then(function (r) {
          if (!r.ok) throw new Error('archive/' + f + ': HTTP ' + r.status);
          return r.json();
        });
      };
      archivePromise = get('meta.json').then(function (meta) {
        return Promise.all([
          Promise.all((meta.years || []).map(function (y) { return get(y + '.json'); })),
          get('tabs.json').catch(function () { return {}; })
        ]).then(function (r) {
          var db = { entries: [] };
          r[0].forEach(function (file) { db.entries = db.entries.concat(file.entries || []); });
          db.entries = db.entries.filter(function (e) { return e && e.private === false; });   // public only, always
          Object.keys(r[1] || {}).forEach(function (t) { db[t] = r[1][t] || []; });
          var media = {};
          (meta.media || []).forEach(function (p) { media[p] = true; });
          return { meta: meta, db: db, media: media };
        });
      });
      archivePromise.then(showNote, showNote);
    }
    return archivePromise;
  }

  // ---------- a tiny stand-in for the database queries the pages make ----------

  function cmp(a, b) {
    if (a === b) return 0;
    if (a === null || a === undefined) return 1;
    if (b === null || b === undefined) return -1;
    return a < b ? -1 : 1;
  }

  function project(rows, columns) {
    if (!columns || columns.trim() === '*') return rows;
    var cols = columns.split(',').map(function (c) { return c.trim(); }).filter(Boolean);
    return rows.map(function (r) {
      var o = {};
      cols.forEach(function (c) { o[c] = r[c] === undefined ? null : r[c]; });
      return o;
    });
  }

  function rpcRows(name, args, db) {
    var entries = db.entries;
    if (name === 'entry_dates') {
      var count = {};
      entries.forEach(function (e) { count[e.entry_date] = (count[e.entry_date] || 0) + 1; });
      return Object.keys(count).sort().reverse().map(function (d) { return { day: d, entry_count: count[d] }; });
    }
    if (name === 'on_this_day') {
      var d = String(args && args.d || '');
      return entries.filter(function (e) { return e.entry_date.slice(5) === d.slice(5) && e.entry_date < d; })
        .sort(function (a, b) { return cmp(b.entry_date, a.entry_date) || cmp(b.created_at, a.created_at); });
    }
    if (name === 'tag_counts') {
      var tags = {};
      entries.forEach(function (e) { (e.tags || []).forEach(function (t) { tags[t] = (tags[t] || 0) + 1; }); });
      return Object.keys(tags).sort().map(function (t) { return { tag: t, entry_count: tags[t] }; });
    }
    if (name === 'is_owner' || name === 'get_visits' || name === 'bump_visits') return null;
    throw new Error(name + ' is not in the archive');
  }

  var WRITES = { insert: 1, update: 1, upsert: 1, delete: 1 };

  function runArchive(ops) {
    return archiveData().then(function (a) {
      var first = ops[0], rows, single = null, columns = null, orders = [], limit = null, from = 0;
      if (ops.some(function (op) { return WRITES[op[0]]; })) throw new Error('archive mode is read-only');
      if (first[0] === 'rpc') {
        var out = rpcRows(first[1][0], first[1][1], a.db);
        if (!Array.isArray(out)) return { data: out, error: null, status: 200 };
        rows = out.slice();
      } else {
        if (!a.db[first[1][0]]) throw new Error(first[1][0] + ' is not in the archive');
        rows = a.db[first[1][0]].slice();
      }
      ops.slice(1).forEach(function (op) {
        var n = op[0], x = op[1];
        if (n === 'select') columns = x[0];
        else if (n === 'eq') rows = rows.filter(function (r) { return String(r[x[0]]) === String(x[1]); });
        else if (n === 'neq') rows = rows.filter(function (r) { return String(r[x[0]]) !== String(x[1]); });
        else if (n === 'lt') rows = rows.filter(function (r) { return r[x[0]] !== null && r[x[0]] < x[1]; });
        else if (n === 'lte') rows = rows.filter(function (r) { return r[x[0]] !== null && r[x[0]] <= x[1]; });
        else if (n === 'gt') rows = rows.filter(function (r) { return r[x[0]] !== null && r[x[0]] > x[1]; });
        else if (n === 'gte') rows = rows.filter(function (r) { return r[x[0]] !== null && r[x[0]] >= x[1]; });
        else if (n === 'in') rows = rows.filter(function (r) { return (x[1] || []).map(String).indexOf(String(r[x[0]])) !== -1; });
        else if (n === 'is') rows = rows.filter(function (r) { return (r[x[0]] === undefined ? null : r[x[0]]) === x[1]; });
        else if (n === 'contains') rows = rows.filter(function (r) { return (x[1] || []).every(function (v) { return (r[x[0]] || []).indexOf(v) !== -1; }); });
        else if (n === 'order') orders.push({ col: x[0], asc: !(x[1] && x[1].ascending === false) });
        else if (n === 'limit') limit = x[0];
        else if (n === 'range') { from = x[0]; limit = x[1] - x[0] + 1; }
        else if (n === 'maybeSingle' || n === 'single') single = n;
        else throw new Error('archive mode can\'t do .' + n + '()');
      });
      if (orders.length) {
        rows.sort(function (r1, r2) {
          for (var i = 0; i < orders.length; i++) {
            var o = orders[i], v1 = r1[o.col], v2 = r2[o.col];
            var n1 = v1 === null || v1 === undefined, n2 = v2 === null || v2 === undefined;
            var c;
            if (n1 || n2) c = n1 === n2 ? 0 : (n1 ? 1 : -1) * (o.asc ? 1 : -1);   // like Postgres: empty last going up, first going down
            else c = (v1 < v2 ? -1 : v1 > v2 ? 1 : 0) * (o.asc ? 1 : -1);
            if (c) return c;
          }
          return 0;
        });
      }
      rows = rows.slice(from, limit === null ? undefined : from + limit);
      rows = project(rows, columns);
      if (single) {
        if (single === 'single' && rows.length !== 1) return { data: null, error: { message: 'expected one row' }, status: 406 };
        return { data: rows[0] || null, error: null, status: 200 };
      }
      return { data: rows, error: null, status: 200 };
    }).catch(function (err) {
      return { data: null, error: { message: String(err && err.message || err) }, status: 0 };
    });
  }

  // ---------- the wrapped public connection ----------

  // A reply that means "Supabase itself is unreachable", not "this query was wrong":
  // no connection at all (offline, project deleted, DNS gone) or a server error (5xx,
  // including a paused project). A normal error from a working database never switches.
  function unreachable(res) {
    if (!res || !res.error) return false;
    var s = Number(res.status) || 0;
    return s === 0 || s >= 500;
  }

  function runReal(ops) {
    var q = real;
    ops.forEach(function (op) { q = q[op[0]].apply(q, op[1]); });
    return M.withTimeout(Promise.resolve(q), reachable ? 15000 : FIRST_LIMIT, 'supabase');
  }

  function run(ops) {
    if (M.archiveMode || !real) {
      if (!M.archiveMode) switchToArchive('not connected');
      return runArchive(ops);
    }
    return runReal(ops).then(function (res) {
      if (unreachable(res)) throw new Error('supabase unreachable (HTTP ' + (res.status || 0) + ')');
      reachable = true;
      return res;
    }).catch(function (err) {
      if (window.console) console.warn('switching to archive mode:', err && err.message);
      switchToArchive(String(err && err.message || err));
      return runArchive(ops);
    });
  }

  function Query(ops) { this.ops = ops; }
  ['select', 'eq', 'neq', 'lt', 'lte', 'gt', 'gte', 'in', 'is', 'contains', 'order', 'limit', 'range',
    'maybeSingle', 'single', 'insert', 'update', 'upsert', 'delete', 'match', 'not', 'or', 'filter', 'like', 'ilike']
    .forEach(function (name) {
      Query.prototype[name] = function () { return new Query(this.ops.concat([[name, Array.prototype.slice.call(arguments)]])); };
    });
  Query.prototype.then = function (ok, bad) { return run(this.ops).then(ok, bad); };
  Query.prototype.catch = function (bad) { return this.then(null, bad); };
  Query.prototype.finally = function (fn) { return run(this.ops).finally(fn); };

  M.db = {
    from: function (table) { return new Query([['from', [table]]]); },
    rpc: function (name, args) { return new Query([['rpc', [name, args]]]); },
    get storage() { return real ? real.storage : null; },
    get auth() { return real ? real.auth : null; }
  };

  // Photos: from Supabase normally, from /archive/media/ in archive mode (only the ones the
  // archive has, so voice notes and anything not archived simply don't show).
  var realMediaUrl = M.mediaUrl;
  M.mediaUrl = function (path) {
    if (!M.archiveMode) return realMediaUrl ? realMediaUrl(path) : '';
    if (archiveMedia && !archiveMedia[path]) return '';
    return M.root() + 'archive/media/' + path;
  };
  var archiveMedia = null;

  // ---------- switching ----------

  var realHasStored = M.hasStoredSession;
  M.hasStoredSession = function () { return M.archiveMode ? false : realHasStored(); };
  var realOwnerClient = M.ownerClient;
  M.ownerClient = function () { return M.archiveMode ? null : realOwnerClient(); };

  function switchToArchive(why) {
    if (M.archiveMode) return;
    M.archiveMode = true;
    M.archiveReason = why;
    document.documentElement.classList.add('archive-mode');
    archiveData().then(function (a) { archiveMedia = a.media; }, function () {});
  }

  // "archive mode · last saved Oct 29, 2026", small, at the top of the page
  function showNote(a) {
    var place = function () {
      var page = document.getElementById('page');
      if (!page || document.getElementById('archive-note')) return;
      var saved = a && a.meta && a.meta.saved_at ? M.formatDateTime(a.meta.saved_at).replace(/,\s*\d+:\d+.*$/, '') : null;
      var p = document.createElement('p');
      p.id = 'archive-note';
      p.className = 'archive-note';
      p.setAttribute('role', 'status');
      p.textContent = saved ? 'archive mode · last saved ' + saved : 'archive mode · no saved copy yet';
      page.insertBefore(p, page.firstChild);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', place); else place();
  }

  if (forced) switchToArchive('?archive=1');

  // Pages that write (posting, admin): check right away, and switch them off in archive mode.
  document.addEventListener('DOMContentLoaded', function () {
    var page = document.body.getAttribute('data-page');
    if (page !== 'post' && page !== 'admin') return;
    var off = function () {
      if (!M.archiveMode || document.getElementById('archive-off')) return;
      var main = document.getElementById('page');
      var msg = document.createElement('p');
      msg.id = 'archive-off';
      msg.className = 'empty';
      msg.textContent = 'Posting is off while the site runs from its archive.';
      main.insertBefore(msg, main.querySelector('footer'));
    };
    if (M.archiveMode) off();
    else M.db.from('entries').select('id').limit(1).then(off, off);
  });
})();
