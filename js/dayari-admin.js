// Dayari Mo admin (/admin/): owner only. Review queue, reported/held/crisis posts,
// approve/hide/delete, ban a writer, basic stats.
//
// Uses the owner's normal login from the posting page. Every call is an owner-only database
// function (dayari_admin_*) that checks is_owner() itself, so this page can't do anything
// for anyone else even if they open it.
(function () {
  var M = window.Moriyada;
  var el = M.el;
  var db = null;
  var view = 'queue';

  function $(id) { return document.getElementById(id); }

  function say(text, kind) {
    var box = $('admin-msg');
    box.className = 'dy-msg' + (kind ? ' ' + kind : '');
    box.textContent = text || '';
  }

  async function call(fn, args) {
    return M.rows(await M.withTimeout(db.rpc(fn, args || {}), 12000, fn));
  }

  // ---------- stats ----------

  var REJECT_LABELS = {
    pii_phone: 'phone number', pii_email: 'email', pii_address: 'address', pii_social: 'social handle',
    pii_name_place: 'name + school/work', moderation: 'house rules (moderation)'
  };

  async function loadStats() {
    var s = await call('dayari_admin_stats');
    var tiles = [
      ['posts_today', 'posts today'], ['writers_today', 'writers today'], ['needs_review', 'need review'],
      ['held', 'held'], ['hidden', 'hidden'], ['crisis_today', 'crisis today'],
      ['reports_today', 'reports today'], ['published_total', 'published, all time'], ['active_bans', 'active bans']
    ];
    var box = $('stats');
    box.textContent = '';
    tiles.forEach(function (t) {
      box.appendChild(el('div', { class: 'dy-stat' }, [el('span', { class: 'n' }, [String(s[t[0]] || 0)]), el('span', { class: 'label' }, [t[1]])]));
    });
    var parts = Object.keys(s.rejected_today || {}).map(function (k) { return s.rejected_today[k] + ' ' + (REJECT_LABELS[k] || k); });
    $('rejected').textContent = 'Refused today: ' + (parts.length ? parts.join(', ') : 'none') +
      '. Last 7 days: ' + (s.rejected_7_days || 0) + '. (Refused posts are never saved, only counted.)';
  }

  // ---------- posts ----------

  var REASON_LABELS = { held: 'held by moderation', crisis: 'crisis', reports: '3 reports', fallback: 'keyword filter (no AI)' };

  function actionButton(label, cls, confirmText, run) {
    var b = el('button', { type: 'button', class: cls }, [label]);
    var armed = false;
    b.addEventListener('click', async function () {
      if (confirmText && !armed) {
        armed = true;
        b.textContent = confirmText;
        setTimeout(function () { armed = false; b.textContent = label; }, 4000);
        return;
      }
      b.disabled = true;
      try {
        await run();
      } catch (e) {
        say('That didn\'t work: ' + (e && e.message ? e.message : 'unknown error'), 'error');
        b.disabled = false;
      }
    });
    return b;
  }

  function postItem(p) {
    var badges = [el('span', { class: 'dy-badge ' + p.status }, [p.status])];
    if (p.crisis) badges.push(el('span', { class: 'dy-badge crisis' }, ['crisis']));
    if (p.report_count > 0) badges.push(el('span', { class: 'dy-badge reports' }, [p.report_count + (p.report_count === 1 ? ' report' : ' reports')]));
    if (p.needs_review) badges.push(el('span', { class: 'dy-badge danger' }, ['needs review']));

    var why = [];
    if (p.review_reasons && p.review_reasons.length) why.push('Why: ' + p.review_reasons.map(function (r) { return REASON_LABELS[r] || r; }).join(', '));
    var mod = p.moderation || {};
    if (mod.categories && mod.categories.length) why.push('Checks (' + (mod.source || '?') + '): ' + mod.categories.join(', '));
    if (p.report_reasons && p.report_reasons.length) why.push('Report reasons: ' + p.report_reasons.join(' / '));

    var li = el('li', { class: 'dy-post dy-admin-post' }, [
      el('div', { class: 'meta-line' }, badges.concat(['writer ' + p.writer + ' · ' + M.formatDateTime(p.created_at) + ' · #' + p.id])),
      el('p', { class: 'body' }, [p.body]),
      why.length ? el('p', { class: 'why' }, [why.join(' — ')]) : null
    ]);

    var tools = el('div', { class: 'actions' });
    function after(text) { return function () { say(text, 'ok'); return refresh(); }; }
    if (p.status !== 'published' || p.needs_review) {
      tools.appendChild(actionButton('Approve', 'primary', null, function () { return act(p.id, 'approve').then(after('Approved: it\'s public.')); }));
    }
    if (p.needs_review) {
      tools.appendChild(actionButton('Seen, leave as is', '', null, function () { return act(p.id, 'reviewed').then(after('Marked as seen.')); }));
    }
    if (p.status !== 'hidden') {
      tools.appendChild(actionButton('Hide', '', null, function () { return act(p.id, 'hide').then(after('Hidden.')); }));
    }
    tools.appendChild(actionButton('Delete', 'danger', 'Click again to delete for good', function () { return act(p.id, 'delete').then(after('Deleted.')); }));
    tools.appendChild(actionButton('Ban writer', 'danger', 'Click again to ban', function () {
      return call('dayari_admin_ban', { p_post: p.id, p_reason: 'from admin' }).then(function (n) {
        say('Banned writer ' + p.writer + '. Hid ' + n + ' post(s).', 'ok');
        return refresh();
      });
    }));
    li.appendChild(tools);
    return li;
  }

  async function act(id, action) {
    var r = await call('dayari_admin_act', { p_post: id, p_action: action });
    if (r === 'missing') throw new Error('that post is already gone');
  }

  var EMPTY = {
    queue: 'Nothing waiting for review. All good.', held: 'Nothing held.', reported: 'No reported posts.',
    crisis: 'No crisis-flagged posts.', hidden: 'Nothing hidden.', recent: 'No posts yet.'
  };

  async function loadPosts() {
    var list = $('admin-list');
    list.setAttribute('aria-busy', 'true');
    var rows = await call('dayari_admin_posts', { p_view: view, p_limit: 100 });
    list.textContent = '';
    rows.forEach(function (p) { list.appendChild(postItem(p)); });
    if (!rows.length) list.appendChild(el('li', { class: 'dy-empty' }, [EMPTY[view]]));
    list.setAttribute('aria-busy', 'false');
  }

  // ---------- bans ----------

  async function loadBans() {
    var rows = await call('dayari_admin_bans');
    var list = $('ban-list');
    list.textContent = '';
    rows.forEach(function (b) {
      var what = b.kind === 'account' ? 'Account ' + b.writer + ' (until lifted)' : 'A network (until ' + M.formatDateTime(b.expires_at) + ')';
      list.appendChild(el('li', { class: 'dy-post' }, [
        el('div', { class: 'meta-line' }, [what + ' · since ' + M.formatDateTime(b.created_at) + (b.reason ? ' · ' + b.reason : '')]),
        el('div', { class: 'actions' }, [actionButton('Lift ban', '', 'Click again to lift', function () {
          return call('dayari_admin_unban', { p_ban: b.id }).then(function () { say('Ban lifted.', 'ok'); return refresh(); });
        })])
      ]));
    });
    if (!rows.length) list.appendChild(el('li', { class: 'dy-empty' }, ['No active bans.']));
  }

  function refresh() {
    return Promise.all([loadStats(), loadPosts(), loadBans()]);
  }

  // ---------- start ----------

  function denied(text) {
    var gate = $('admin-gate');
    gate.className = 'dy-msg error';
    gate.textContent = text + ' ';
    gate.appendChild(el('a', { href: '../html/post.html' }, ['Go to the login page']));
  }

  document.addEventListener('DOMContentLoaded', async function () {
    db = M.ownerClient();
    if (!db) { denied('Owner only. Log in on the posting page first, then come back here.'); return; }
    try {
      await loadStats();
    } catch (e) {
      denied('Owner only. If you use 2-step login, log in again with your code.');
      return;
    }
    $('admin-gate').hidden = true;
    $('admin').hidden = false;

    document.querySelectorAll('.dy-tabs button').forEach(function (b) {
      b.addEventListener('click', function () {
        view = b.getAttribute('data-view');
        document.querySelectorAll('.dy-tabs button').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
        say('');
        loadPosts().catch(function (e) { say('Couldn\'t load: ' + e.message, 'error'); });
      });
    });
    refresh().catch(function (e) { say('Couldn\'t load: ' + e.message, 'error'); });
  });
})();
