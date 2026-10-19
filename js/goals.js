// Goals: a title, the steps to get there (a checklist), and how I feel about it right now.
// Grouped into active / done / dropped. On this page the owner can tick steps directly.
// Not daily posts.
(function () {
  var M = window.Moriyada = window.Moriyada || {};
  var el = function () { return M.el.apply(null, arguments); };

  function steps(g) { return Array.isArray(g.steps) ? g.steps.filter(function (s) { return s && s.text; }) : []; }

  // [=====-----]  3 of 5 steps
  function progress(list) {
    if (!list.length) return null;
    var done = list.filter(function (s) { return s.done; }).length;
    return el('p', { class: 'goal-progress' }, [
      el('progress', { max: String(list.length), value: String(done), 'aria-label': done + ' of ' + list.length + ' steps done' }),
      done + ' of ' + list.length + ' steps'
    ]);
  }

  function goalCard(g, ctx) {
    var list = steps(g);
    var edit = null;
    if (ctx.owner) { edit = el('button', { type: 'button', class: 'small' }, ['edit']); edit.addEventListener('click', function () { ctx.edit(g); }); }
    var dates = 'started ' + M.shortDate(g.started_on) +
      (g.status !== 'active' && g.closed_on ? ' · ' + g.status + ' ' + M.shortDate(g.closed_on) : '');
    var ul = list.length ? el('ul', { class: 'goal-steps' }, list.map(function (s, i) {
      var box = el('input', { type: 'checkbox', 'aria-label': s.text });
      box.checked = Boolean(s.done);
      box.disabled = !ctx.owner;
      if (ctx.owner) box.addEventListener('change', function () {
        var next = list.map(function (x, j) { return { text: x.text, done: j === i ? box.checked : Boolean(x.done) }; });
        box.disabled = true;
        ctx.save(g, { steps: next, updated_at: new Date().toISOString() }).catch(function () { box.checked = !box.checked; box.disabled = false; });
      });
      return el('li', { class: s.done ? 'done' : null }, [el('label', null, [box, ' ', s.text])]);
    })) : null;
    return el('article', { class: 'goal goal-' + g.status }, [
      el('h3', { class: 'goal-title' }, [g.title, edit ? ' ' : null, edit]),
      el('p', { class: 'note' }, [dates]),
      progress(list),
      ul,
      g.feeling ? el('div', { class: 'goal-feeling' }, [
        el('p', { class: 'note' }, ['how I feel right now' + (g.updated_at ? ' (' + M.shortDate(M.manilaDate(new Date(g.updated_at))) + ')' : '')]),
        el('p', null, [g.feeling])
      ]) : null
    ]);
  }

  M.collection({
    table: 'goals',
    select: 'id, title, steps, feeling, status, started_on, closed_on, updated_at',
    order: function (q) { return q.order('started_on', { ascending: false }).order('id', { ascending: false }); },
    noun: 'goal',
    cacheKey: 'goals-v2',
    empty: 'No goals yet.',
    fields: [
      { name: 'title', label: 'goal', required: true, max: 200 },
      { name: 'steps', label: 'steps to get there (one per line)', kind: 'lines', rows: 6 },
      { name: 'feeling', label: 'how I feel about it right now', kind: 'textarea', rows: 4, max: 3000 },
      { name: 'status', label: 'status', kind: 'select', options: [['active', 'working on it'], ['done', 'done'], ['dropped', 'dropped']] },
      { name: 'started_on', label: 'started', kind: 'date', today: true },
      { name: 'closed_on', label: 'date done or dropped', kind: 'date' }
    ],
    fromRow: function (g) {
      return Object.assign({}, g, { steps: steps(g).map(function (s) { return s.text; }).join('\n') });
    },
    validate: function (v) {
      var n = v.steps ? v.steps.split('\n').filter(function (s) { return s.trim(); }).length : 0;
      if (n > 40) return 'Up to 40 steps, please.';
      if (v.closed_on && v.started_on && v.closed_on < v.started_on) return '"Done or dropped" can\'t be before "started".';
      return null;
    },
    toRow: function (v, editing) {
      // Steps keep their ticks when you edit the text around them.
      var old = {};
      steps(editing || {}).forEach(function (s) { old[s.text.trim().toLowerCase()] = Boolean(s.done); });
      var list = (v.steps || '').split('\n').map(function (s) { return s.trim().slice(0, 300); }).filter(Boolean)
        .map(function (t) { return { text: t, done: old[t.toLowerCase()] || false }; });
      return {
        title: v.title, steps: list, feeling: v.feeling, status: v.status,
        started_on: v.started_on || M.manilaDate(),
        closed_on: v.status === 'active' ? null : (v.closed_on || M.manilaDate()),
        updated_at: new Date().toISOString()
      };
    },
    summary: function (g) { return g.title; },
    render: function (out, rows, ctx) {
      [['Working on it', 'active', 'Nothing in progress.'], ['Done', 'done', 'None done yet.'], ['Dropped', 'dropped', 'None dropped.']].forEach(function (s) {
        var mine = rows.filter(function (g) { return g.status === s[1]; });
        if (!mine.length && s[1] !== 'active') return;
        out.appendChild(el('h2', { class: 'section-head' }, [s[0] + ' · ' + mine.length]));
        out.appendChild(mine.length ? el('div', { class: 'goal-list' }, mine.map(function (g) { return goalCard(g, ctx); }))
          : el('p', { class: 'empty' }, [s[2]]));
      });
    }
  });
})();
