// Home page: header, quote of the day, today's bento grid, NOW box, On this day.
//
// How it loads, fast and without ever hanging:
// 1. The last data this browser saw is shown instantly from the cache (public data only).
// 2. Fresh public data loads in parallel through M.db (never touches the saved login),
//    each piece with a time limit, and replaces the cached view as it arrives.
// 3. If this browser has a saved login (the owner), the same pieces load again through the
//    logged-in connection to add private entries. If that fails or times out, the public
//    page stays and a short note says why. It can never block the page.
(function () {
  var M = window.Moriyada = window.Moriyada || {};
  var el = function () { return M.el.apply(null, arguments); };
  function $(id) { return document.getElementById(id); }

  var PART_TIMEOUT = 12000;
  var OWNER_TIMEOUT = 15000;
  var ENTRY_COLUMNS = 'id, created_at, entry_date, type, tags, data, media, private';

  var today;
  var state = {};          // latest data per part
  var fromOwner = {};      // parts already shown with the owner's (fuller) data
  var shown = {};          // parts shown at least once (cache or network)

  // ---------- fetching: each returns plain data; `c` is the connection to use ----------

  function latest(c, type, limit) {
    return c.from('entries').select('data').eq('type', type)
      .order('entry_date', { ascending: false }).order('created_at', { ascending: false })
      .limit(limit || 1).then(M.rows);
  }

  var FETCH = {
    last: function (c) {
      return c.from('entries').select('created_at').order('created_at', { ascending: false }).limit(1)
        .then(M.rows).then(function (r) { return r.length ? r[0].created_at : null; });
    },
    dates: function (c) {
      return c.rpc('entry_dates').then(M.rows);
    },
    quotes: function (c) {
      return c.from('quotes').select('id, text, source').order('id').then(M.rows);   // the quotes tab
    },
    now: function (c) {
      // reading and goal come from their own tabs (books, goals), the rest from daily posts
      var book = c.from('books').select('title, author').eq('status', 'reading')
        .order('started_on', { ascending: false }).limit(1).then(M.rows).catch(function () { return []; });
      var goal = c.from('goals').select('title').eq('status', 'active')
        .order('started_on', { ascending: false }).limit(1).then(M.rows).catch(function () { return []; });
      return Promise.all([book, latest(c, 'body', 30), latest(c, 'learned'), goal]).then(function (r) {
        return { reading: r[0], body: r[1], learned: r[2], goal: r[3] };
      });
    },
    otd: function (c) {
      return c.rpc('on_this_day', { d: today }).select('entry_date, type').then(M.rows);
    },
    today: function (c) {
      return c.from('entries').select(ENTRY_COLUMNS).eq('entry_date', today)
        .order('created_at', { ascending: false }).then(M.rows);
    }
  };
  var PARTS = Object.keys(FETCH);

  // Day-specific parts are cached per date, so yesterday's never shows as today's.
  function cacheKey(part) { return part === 'today' || part === 'otd' ? 'home:' + part + ':' + today : 'home:' + part; }

  // ---------- rendering ----------

  function pad(n) { var s = String(n); while (s.length < 4) s = '0' + s; return s; }

  function streakFrom(dates) {
    var set = {};
    (dates || []).forEach(function (r) { set[r.day] = true; });
    var d = set[today] ? today : M.addDays(today, -1);   // today counts once posted
    var n = 0;
    while (set[d]) { n++; d = M.addDays(d, -1); }
    return n;
  }

  function firstWith(list, field) {
    for (var i = 0; i < (list || []).length; i++) {
      var v = list[i].data && list[i].data[field];
      if (v !== null && v !== undefined && v !== '') return list[i].data;
    }
    return null;
  }

  var RENDER = {
    last: function (v) {
      $('last-updated').textContent = v ? 'updated ' + M.formatDateTime(v) : 'no posts yet';
    },
    dates: function (dates) {
      var real = (dates || []).filter(function (r) { return /^\d{4}-\d{2}-\d{2}$/.test(r.day); });
      if (real.length) {
        var first = real[real.length - 1].day;   // newest first
        $('day-counter').textContent = 'DAY ' + pad(Math.max(1, M.daysBetween(first, today) + 1));
      }
      var streak = streakFrom(real);
      var box = $('streak');
      if (box) {
        box.querySelector('.n').textContent = String(streak);
        box.title = streak + (streak === 1 ? ' day' : ' days') + ' in a row';
        box.setAttribute('aria-label', box.title);
        box.hidden = streak < 1;
      }
    },
    quotes: function (quotes) {
      quotes = (quotes || []).filter(function (q) { return q.text; });
      var box = $('qotd');
      if (!quotes.length) { box.hidden = true; return; }
      var q = quotes[M.dayNumber(today) % quotes.length];   // same quote all day
      box.querySelector('blockquote').textContent = '“' + q.text + '”';
      box.querySelector('.source').textContent = q.source ? '— ' + q.source : '';
      box.hidden = false;
    },
    now: function (n) {
      var box = $('now'), tbody = box.querySelector('tbody');
      tbody.textContent = '';
      var reading = (n.reading || [])[0] || null;   // the latest book still being read (bookshelf tab)
      var weight = firstWith(n.body, 'weight_kg');
      var height = firstWith(n.body, 'height_cm');
      var learned = n.learned[0] && n.learned[0].data;
      var goal = (n.goal || [])[0] || null;         // the latest active goal (goals tab)

      var list = [];
      if (reading && reading.title) list.push(['reading', [el('i', null, [reading.title]), reading.author ? ' by ' + reading.author : null]]);
      if (weight) list.push(['weight', [weight.weight_kg + ' kg']]);
      if (height) list.push(['height', [height.height_cm + ' cm']]);
      if (learned && learned.topic) list.push(['learning', [M.link(learned.wikipedia_url, learned.topic) || learned.topic]]);
      if (goal && goal.title) list.push(['goal', [el('a', { href: 'html/goals.html' }, [goal.title])]]);
      list.forEach(function (row) {
        tbody.appendChild(el('tr', null, [el('th', null, [row[0]]), el('td', null, row[1])]));
      });
      box.hidden = list.length === 0;   // rows without data never appear
    },
    otd: function (entries) {
      var out = $('otd-list');
      out.textContent = '';
      if (!entries.length) {
        out.appendChild(el('p', { class: 'note' }, ['nothing from this date in past years yet.']));
        return;
      }
      var byDate = {}, order = [];
      entries.forEach(function (e) {
        if (!byDate[e.entry_date]) { byDate[e.entry_date] = []; order.push(e.entry_date); }
        if (byDate[e.entry_date].indexOf(e.type) === -1) byDate[e.entry_date].push(e.type);
      });
      var thisYear = Number(today.slice(0, 4));
      var ul = el('ul');
      order.forEach(function (date) {
        var ago = thisYear - Number(date.slice(0, 4));
        ul.appendChild(el('li', null, [
          el('a', { href: M.dayUrl(date) }, [date.slice(0, 4)]),
          ' (' + ago + (ago === 1 ? ' year' : ' years') + ' ago)',
          el('div', { class: 'note' }, [byDate[date].join(', ')])
        ]));
      });
      out.appendChild(ul);
    },
    today: function (entries) {
      M.renderBento($('bento'), entries, { emptyText: 'Nothing yet today. A new page, waiting.' });
    }
  };

  // What a part shows when it never loaded at all.
  var FAILED = {
    last: function () { $('last-updated').textContent = '?'; },
    dates: function () {},
    quotes: function () {},
    now: function () {},
    otd: function () { message($('otd-list'), "couldn't load past years."); },
    today: function () { message($('bento'), "Couldn't load today's entries. Check your connection and refresh."); }
  };

  function message(node, text) {
    node.textContent = '';
    node.appendChild(el('p', { class: 'note' }, [text]));
  }

  function show(part, value, owner) {
    if (!owner && fromOwner[part]) return;   // never replace the owner's view with the public one
    if (owner) fromOwner[part] = true;
    state[part] = value;
    shown[part] = true;
    try { RENDER[part](value); } catch (e) { if (window.console) console.error(part, e); }
  }

  function notice(text) {
    var n = $('notice');
    n.textContent = text;
    n.hidden = false;
  }

  // ---------- the owner's extras ----------

  function loadOwnerView(owner) {
    var jobs = PARTS.map(function (part) {
      return FETCH[part](owner).then(function (v) { show(part, v, true); });
    });
    M.withTimeout(Promise.all(jobs), OWNER_TIMEOUT, 'login').then(function () {
      return M.withTimeout(owner.auth.getSession(), 4000, 'login check');
    }).then(function (res) {
      if (!(res && res.data && res.data.session)) {
        notice('Your login has expired, so private entries are hidden. Log in again on the post page.');
      }
    }).catch(function (err) {
      if (window.console) console.warn('owner view', err);
      if (M.archiveMode) return;   // Supabase is down and the archive is showing; nothing to log in to
      notice("Couldn't check your login in time, so only public entries are shown. " +
        'Refresh, or log in again on the post page.');
    });
  }

  // ---------- start ----------

  document.addEventListener('DOMContentLoaded', function () {
    today = M.manilaDate();   // always Manila's date, whatever the device's timezone
    $('today-label').textContent = M.formatDate(today);
    M.reloadAtMidnight(today);

    if (!M.db) {
      notice(M.configured
        ? "Couldn't load the Supabase library. Check your internet connection and refresh."
        : 'Not connected to the database yet. Fill in js/config.js (see README).');
      FAILED.last(); FAILED.today(); message($('otd-list'), '-');
      return;
    }

    // 1. instant: last seen data
    PARTS.forEach(function (part) {
      var cached = M.cache.get(cacheKey(part));
      if (cached !== undefined) show(part, cached);   // only successful results are ever cached
    });

    // 2. fresh public data, all at once
    PARTS.forEach(function (part) {
      M.withTimeout(FETCH[part](M.db), PART_TIMEOUT, part).then(function (v) {
        M.cache.set(cacheKey(part), v);
        show(part, v);
      }).catch(function (err) {
        if (window.console) console.warn(part, err);
        if (!shown[part]) FAILED[part]();
      });
    });

    // 3. the owner's private extras, if logged in on this browser
    var owner = M.ownerClient();
    if (owner) loadOwnerView(owner);
  });
})();
