// Dayari Mo home (/dayari/): the age gate, writing, your own posts (delete), and the public
// feed (report). Every write goes through M.dayari.send (the Edge Function); the page only
// ever reads published posts directly.
(function () {
  var M = window.Moriyada;
  var D = M.dayari;
  var T = D.T;
  var el = M.el;
  var PAGE = 20;
  var oldestId = null;
  var mine = {};          // post id -> status, for this browser's own posts

  function $(id) { return document.getElementById(id); }

  function setMsg(box, kind, title, text) {
    box.className = 'dy-msg' + (kind ? ' ' + kind : '');
    box.textContent = '';
    if (title) { box.appendChild(el('strong', null, [title])); box.appendChild(document.createTextNode(' ')); }
    if (text) box.appendChild(document.createTextNode(text));
  }

  // ---------- writing ----------

  function setupWrite() {
    var form = $('write-form');
    var text = $('text');
    var count = $('count');
    var button = $('post-button');
    var msg = $('write-msg');
    var care = $('care');

    function updateCount() {
      var n = text.value.length;
      count.textContent = n.toLocaleString('en-US') + ' / 2,000';
      count.classList.toggle('over', n > D.MAX);
    }
    text.value = D.draft.get();
    updateCount();
    text.addEventListener('input', function () { D.draft.set(text.value); updateCount(); });

    // Age gate + house rules, once per browser, before the first post.
    if (!D.gateAccepted()) {
      $('gate').hidden = false;
      form.hidden = true;
      $('gate-ok').addEventListener('click', function () {
        if (!$('gate-age').checked || !$('gate-rules').checked) {
          $('gate-msg').textContent = T.errors.gate;
          return;
        }
        D.acceptGate();
        $('gate').hidden = true;
        form.hidden = false;
        text.focus();
      });
    }

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      care.textContent = '';
      var value = text.value.trim();
      if (!value) { setMsg(msg, 'error', T.errorTitle, T.errors.empty); text.focus(); return; }
      if (value.length > D.MAX) { setMsg(msg, 'error', T.errorTitle, T.errors.too_long); return; }

      button.disabled = true;
      setMsg(msg, '', '', T.checking);
      var r;
      try {
        var token = await D.captcha($('captcha-box'), 'dayari_post');
        setMsg(msg, '', '', T.sending);
        r = await D.send({ action: 'post', text: value, ageOk: D.gateAccepted(), rulesOk: D.gateAccepted(), turnstileToken: token });
      } catch (err) {
        r = { ok: false, code: err && err.code ? err.code : 'captcha' };
      }
      button.disabled = false;

      if (r.ok) {
        text.value = '';
        D.draft.set('');
        updateCount();
        setMsg(msg, 'ok', '', r.status === 'held' ? T.held : T.published);
        var post = { id: r.id, body: value, created_at: new Date().toISOString(), status: r.status };
        mine[r.id] = r.status;
        addMine(post, true);
        if (r.status === 'published') prependFeed(post);
      } else {
        setMsg(msg, 'error', r.code === 'pii' ? T.piiTitle : T.errorTitle, D.errorText(r));
      }
      if (r.crisis) care.appendChild(D.careNote());
    });
  }

  // ---------- one post ----------

  function postItem(p, inMineList) {
    var li = el('li', { class: 'dy-post', 'data-id': String(p.id) });
    var meta = el('div', { class: 'when' }, [D.when(p.created_at)]);
    if (inMineList) {
      var label = { published: 'Published', held: 'Waiting for review', hidden: 'Hidden' }[p.status] || p.status;
      meta.insertBefore(el('span', { class: 'dy-badge ' + p.status }, [label]), meta.firstChild);
    }
    var tools = el('div', { class: 'tools' });
    li.appendChild(meta);
    li.appendChild(el('p', { class: 'body' }, [p.body]));
    li.appendChild(tools);
    if (mine[p.id] !== undefined) {
      if (!inMineList) tools.appendChild(el('span', { class: 'yours' }, ['yours']));
      tools.appendChild(deleteButton(p.id, tools));
    } else {
      tools.appendChild(reportButton(p.id, li));
    }
    return li;
  }

  function note(container, text) {
    var old = container.querySelector('.note');
    if (old) old.remove();
    var n = el('p', { class: 'note', role: 'status' }, [text]);
    container.appendChild(n);
    return n;
  }

  // ---------- delete (own posts) ----------

  function deleteButton(id, tools) {
    var b = el('button', { type: 'button', class: 'quiet', 'aria-label': 'Delete this post' }, ['Delete']);
    b.addEventListener('click', function () {
      b.hidden = true;
      var yes = el('button', { type: 'button', class: 'danger' }, ['Yes, delete for good']);
      var no = el('button', { type: 'button', class: 'quiet' }, ['Keep it']);
      var box = el('span', { class: 'tools' }, [yes, no]);
      tools.appendChild(box);
      yes.focus();
      no.addEventListener('click', function () { box.remove(); b.hidden = false; b.focus(); });
      yes.addEventListener('click', async function () {
        yes.disabled = no.disabled = true;
        var r = await D.send({ action: 'delete', postId: id });
        if (r.ok) {
          delete mine[id];
          document.querySelectorAll('.dy-post[data-id="' + id + '"]').forEach(function (n) { n.remove(); });
          note($('mine'), T.deleted);
          if (!$('mine-list').children.length) $('mine-list').appendChild(el('li', { class: 'dy-empty' }, ['Nothing here anymore.']));
        } else {
          box.remove();
          b.hidden = false;
          note(tools, D.errorText(r));
        }
      });
    });
    return b;
  }

  // ---------- report (other people's posts) ----------

  var REASONS = [
    'Personal info or doxxing',
    'Names a real private person',
    'Hate or harassment',
    'Sexual content',
    'Threats or violence',
    'Spam or scam',
    'It\'s mine and I can\'t delete it anymore',
    'Something else'
  ];

  function reportButton(id, li) {
    var b = el('button', { type: 'button', class: 'quiet', 'aria-label': 'Report this post' }, ['Report']);
    b.addEventListener('click', function () {
      if (li.querySelector('.report-form')) return;
      b.hidden = true;
      var name = 'reason-' + id;
      var options = REASONS.map(function (r, i) {
        return el('label', { class: 'dy-check' }, [el('input', { type: 'radio', name: name, value: r, checked: i === 0 }), el('span', null, [r])]);
      });
      var send = el('button', { type: 'submit', class: 'primary' }, ['Send report']);
      var cancel = el('button', { type: 'button', class: 'quiet' }, ['Cancel']);
      var captcha = el('div', { class: 'dy-captcha' });
      var form = el('form', { class: 'report-form' }, [
        el('fieldset', null, [el('legend', null, ['What\'s wrong with this post?'])].concat(options)),
        el('div', { class: 'actions' }, [send, cancel]),
        captcha
      ]);
      li.appendChild(form);
      form.querySelector('input').focus();
      cancel.addEventListener('click', function () { form.remove(); b.hidden = false; b.focus(); });
      form.addEventListener('submit', async function (e) {
        e.preventDefault();
        send.disabled = cancel.disabled = true;
        var picked = form.querySelector('input:checked');
        var r;
        try {
          var token = await D.captcha(captcha, 'dayari_report');
          r = await D.send({ action: 'report', postId: id, reason: picked ? picked.value : '', turnstileToken: token });
        } catch (err) {
          r = { ok: false, code: err && err.code ? err.code : 'captcha' };
        }
        form.remove();
        if (r.ok) {
          var text = { reported: T.reported, hidden: T.reportHidden, already: T.reportAlready, own: T.reportOwn, missing: T.reportMissing }[r.result] || T.reported;
          note(li, text);
          if (r.result === 'hidden') li.querySelector('.body').hidden = true;
        } else {
          b.hidden = false;
          note(li, D.errorText(r));
        }
      });
    });
    return b;
  }

  // ---------- your posts ----------

  function addMine(p, atTop) {
    var list = $('mine-list');
    var empty = list.querySelector('.dy-empty');
    if (empty) empty.remove();
    var item = postItem(p, true);
    if (atTop) list.insertBefore(item, list.firstChild); else list.appendChild(item);
    $('mine').hidden = false;
  }

  async function loadMine() {
    var rows = await D.myPosts();
    rows.forEach(function (p) { mine[p.id] = p.status; });
    rows.forEach(function (p) { addMine(p, false); });
  }

  // ---------- the public feed ----------

  function prependFeed(p) {
    var list = $('feed-list');
    var empty = list.querySelector('.dy-empty');
    if (empty) empty.remove();
    list.insertBefore(postItem(p, false), list.firstChild);
  }

  async function loadPage() {
    var q = M.db.from('dayari_posts').select('id, entry_date, body, created_at').order('id', { ascending: false }).limit(PAGE);
    if (oldestId !== null) q = q.lt('id', oldestId);
    return M.rows(await M.withTimeout(q, 12000, 'feed'));
  }

  async function loadFeed() {
    var list = $('feed-list');
    var more = $('more');
    if (!M.db) {
      list.textContent = '';
      list.appendChild(el('li', { class: 'dy-empty' }, ['Dayari Mo isn\'t connected yet.']));
      return;
    }
    more.disabled = true;
    try {
      var rows = await loadPage();
      if (oldestId === null) list.textContent = '';
      rows.forEach(function (p) { list.appendChild(postItem(p, false)); });
      if (rows.length) oldestId = rows[rows.length - 1].id;
      if (!list.children.length) list.appendChild(el('li', { class: 'dy-empty' }, ['No entries yet. Be the first page.']));
      more.hidden = rows.length < PAGE;
    } catch (e) {
      if (window.console) console.warn(e);
      if (oldestId === null) {
        list.textContent = '';
        list.appendChild(el('li', { class: 'dy-empty' }, ['Couldn\'t load entries. Refresh to try again.']));
      }
    }
    more.disabled = false;
    list.setAttribute('aria-busy', 'false');
  }

  document.addEventListener('DOMContentLoaded', function () {
    setupWrite();
    $('more').addEventListener('click', loadFeed);
    // Own posts first (fast, only if this browser wrote before) so the feed knows which are yours.
    M.withTimeout(loadMine(), 12000, 'my posts')
      .catch(function (e) { if (window.console) console.warn(e); })
      .then(loadFeed);
  });
})();
