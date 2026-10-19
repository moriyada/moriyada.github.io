// Day page: day.html?date=YYYY-MM-DD shows that day's entries the same way the home page
// does. One page serves every date, so new days work automatically.
(function () {
  var M = window.Moriyada = window.Moriyada || {};
  var el = function () { return M.el.apply(null, arguments); };
  function $(id) { return document.getElementById(id); }

  // '2026-10-08' -> true; '2026-02-30', 'hello', '2026-1-8' -> false
  function isRealDate(s) {
    return /^\d{4}-\d{2}-\d{2}$/.test(s) && M.addDays(s, 0) === s;
  }

  function pad(n, width) {
    var s = String(n);
    while (s.length < width) s = '0' + s;
    return s;
  }

  function fact(label, value) {
    var box = $('day-facts');
    if (box.childNodes.length) box.appendChild(document.createTextNode(' \u00B7 '));
    box.appendChild(el('span', { class: 'fact' }, [el('span', { class: 'note' }, [label + ' ']), value]));
  }

  function message(text) {
    var out = $('bento');
    out.textContent = '';
    out.appendChild(el('p', { class: 'empty' }, [text]));
  }

  function navLink(date, label) {
    return date ? el('a', { href: M.dayUrl(date) }, [label]) : el('span', { class: 'note' }, [label]);
  }

  document.addEventListener('DOMContentLoaded', function () {
    var date = new URLSearchParams(location.search).get('date') || '';
    var today = M.manilaDate();

    if (!isRealDate(date)) {
      $('day-title').textContent = 'no such day';
      $('day-box').hidden = true;
      message("That page doesn't exist. Pick a day from the archive.");
      return;
    }

    var nice = M.formatDate(date);
    document.title = nice + ' - Moriyada';
    $('day-title').textContent = nice;
    $('day-heading').textContent = date === today ? 'Today' : M.formatDate(date, { weekday: undefined, month: 'short' });

    if (date > today) {
      $('day-box').hidden = true;
      message("This page hasn't been written yet.");
      return;
    }
    // That day's figure of the day (worked out from the date; text from Wikipedia).
    if (M.loadDayFigure) M.loadDayFigure(date);

    if (!M.db) { message('Not connected to the database yet.'); return; }

    // Each piece loads on its own (cache -> public -> logged-in), so one slow piece
    // never holds up the others and nothing can hang.
    var facts = { chapter: null, weather: null, entries: null };
    function showFacts() {
      var box = $('day-facts');
      box.textContent = '';
      ['chapter', 'weather', 'entries'].forEach(function (k) { if (facts[k] !== null) fact(k, facts[k]); });
    }

    // Chapter number and previous/next day, from the list of dates with entries.
    M.layered(function (c) { return c.rpc('entry_dates').then(M.rows); }, function (rows) {
      var days = (rows || []).map(function (r) { return r.day; }).filter(isRealDate);   // newest first
      if (days.length) {
        var first = days[days.length - 1];
        facts.chapter = date >= first ? pad(M.daysBetween(first, date) + 1, 4) : null;
        showFacts();
      }
      var older = days.filter(function (d) { return d < date; })[0] || null;
      var newer = days.filter(function (d) { return d > date; }).pop() || null;
      var nav = $('day-nav');
      nav.textContent = '';
      nav.appendChild(navLink(older, '\u00AB previous day'));
      nav.appendChild(document.createTextNode(' \u00B7 '));
      nav.appendChild(el('a', { href: M.root() + 'html/archive.html' }, ['archive']));
      nav.appendChild(document.createTextNode(' \u00B7 '));
      nav.appendChild(navLink(newer, 'next day \u00BB'));
    }, null, 'archive:dates');

    // Weather saved for that day, if any (public data): "Manila: high 32°C, light rain".
    M.withTimeout(M.db.from('day_weather').select('summary, temp_c, data').eq('weather_date', date).maybeSingle(), 12000, 'weather')
      .then(function (res) {
        var w = res && res.data;
        if (!w) return;
        var hasTemp = typeof w.temp_c === 'number' || (w.temp_c !== null && w.temp_c !== undefined && isFinite(Number(w.temp_c)));
        var high = w.data && w.data.high_c !== undefined;
        var bits = [];
        if (hasTemp) bits.push((high ? 'high ' : '') + Math.round(Number(w.temp_c)) + '\u00B0C');
        if (w.summary) bits.push(String(w.summary));
        if (bits.length) { facts.weather = 'Manila: ' + bits.join(', '); showFacts(); }
      }).catch(function () { /* weather is a nice-to-have */ });

    // The entries themselves.
    M.layered(function (c) {
      return c.from('entries').select('id, created_at, entry_date, type, tags, data, media, private')
        .eq('entry_date', date).order('created_at', { ascending: false }).then(M.rows);
    }, function (entries) {
      facts.entries = String(entries.length);
      showFacts();
      // Same bento grid as the home page, but with every entry and tiles that grow to fit.
      M.renderBento($('bento'), entries, {
        emptyText: date === today ? 'Nothing yet today. A new page, waiting.' : 'Nothing was written on this day.'
      });
      if (location.hash) {
        var target = document.getElementById(location.hash.slice(1));
        if (target) target.scrollIntoView({ block: 'center' });
      }
    }, function () {
      message("Couldn't load this day. Check your connection and refresh.");
    }, 'day:' + date);
  });
})();
