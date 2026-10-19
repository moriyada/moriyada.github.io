// Archive: every past day that has entries, newest first, grouped by month, like a
// list of manga chapters. Today isn't here yet: it moves in at 12:00 AM Manila time.
// Nothing is added by hand; the list comes straight from the entries table.
(function () {
  var M = window.Moriyada = window.Moriyada || {};
  var el = function () { return M.el.apply(null, arguments); };

  function pad(n, width) {
    var s = String(n);
    while (s.length < width) s = '0' + s;
    return s;
  }

  function render(out, dates, today) {
    out.textContent = '';
    // The first day ever (even if it's today) is chapter 1.
    var first = dates.length ? dates[dates.length - 1].day : null;
    var past = dates.filter(function (r) { return r.day < today; });
    if (!past.length) {
      out.appendChild(el('p', { class: 'empty' }, ['No chapters yet.']));
      return;
    }

    var month = null, list = null;
    past.forEach(function (r) {
      var key = r.day.slice(0, 7);
      if (key !== month) {
        month = key;
        out.appendChild(el('h2', { class: 'month' }, [M.formatDate(r.day, { weekday: undefined, day: undefined })]));
        list = el('ul', { class: 'chapters' });
        out.appendChild(list);
      }
      var count = Number(r.entry_count) || 0;
      list.appendChild(el('li', null, [
        el('span', { class: 'chapter-no' }, ['Ch. ' + pad(M.daysBetween(first, r.day) + 1, 4)]),
        ' ',
        el('a', { href: M.dayUrl(r.day) }, [M.formatDate(r.day, { year: undefined })]),
        el('span', { class: 'chapter-extra' }, [
          el('span', { class: 'note' }, [count + (count === 1 ? ' entry' : ' entries')]),
          // that day's figure of the day (none before the first one)
          M.almanacPick && M.almanacPick(r.day)
            ? el('span', { class: 'figure-tag', title: 'figure of the day' }, [M.figureName(M.almanacPick(r.day))])
            : null
        ])
      ]));
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    var out = document.getElementById('archive');
    if (!M.db) {
      out.textContent = '';
      out.appendChild(el('p', { class: 'note' }, ['Not connected to the database yet.']));
      return;
    }
    var today = M.manilaDate();
    M.reloadAtMidnight(today);   // yesterday joins the list at midnight

    var clean = function (rows) { return (rows || []).filter(function (r) { return /^\d{4}-\d{2}-\d{2}$/.test(r.day); }); };
    M.layered(
      function (c) { return c.rpc('entry_dates').then(M.rows); },
      function (rows) { render(out, clean(rows), today); },
      function () {
        out.textContent = '';
        out.appendChild(el('p', { class: 'note' }, ["Couldn't load the archive. Check your connection and refresh."]));
      },
      'archive:dates'
    );
  });
})();
