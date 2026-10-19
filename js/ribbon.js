// The menu. Home, archive and favorites are always showing (plus the page you're on); every
// other page sits behind the three-line button, in one box that opens on hover (mouse) or
// tap (phones). Lives here so changing the menu means editing one file, not every page.
//
// `ready: true` marks pages that exist. Anything else shows faded with a small "soon" and can't be
// clicked. When a page gets built, the same change that adds it flips its flag to true here,
// so "soon" disappears by itself the moment that update goes live.
(function () {
  var ITEMS = [
    { label: 'home', path: 'index.html', ready: true, main: true },
    { label: 'archive', path: 'html/archive.html', ready: true, main: true },
    { label: 'favorites', path: 'html/favorites.html', ready: true, main: true },
    { label: 'hobbies', path: 'html/hobbies.html', ready: true },
    { label: 'bookshelf', path: 'html/bookshelf.html', ready: true },
    { label: 'quotes', path: 'html/quotes.html', ready: true },
    { label: 'goals', path: 'html/goals.html', ready: true },
    { label: 'places', path: 'html/places.html' },
    { label: 'about', path: 'html/about.html', ready: true },
    { label: 'talaarawan', path: 'talaarawan/index.html', ready: true }
  ];

  function node(item, root, current) {
    var n;
    if (!item.ready) {
      // not built yet: faded, not clickable, with a small "soon" tag
      n = document.createElement('span');
      n.className = 'item soon';
      n.setAttribute('aria-disabled', 'true');
      n.textContent = item.label;
      var tag = document.createElement('small');
      tag.textContent = 'soon';
      n.appendChild(tag);
    } else if (item.label === current) {
      n = document.createElement('span');
      n.className = 'item current';
      n.setAttribute('aria-current', 'page');
      n.textContent = item.label;
    } else {
      n = document.createElement('a');
      n.className = 'item';
      n.href = root + item.path;
      n.textContent = item.label;
    }
    return n;
  }

  document.addEventListener('DOMContentLoaded', function () {
    var nav = document.getElementById('ribbon');
    if (!nav) return;
    var root = document.body.getAttribute('data-root') || '';
    var current = document.body.getAttribute('data-page');
    var extra = document.getElementById('nav-extra');   // weather + streak on the home page

    var main = document.createElement('div');
    main.className = 'nav-main';
    ITEMS.forEach(function (item) {
      if (item.main || item.label === current) main.appendChild(node(item, root, current));
    });

    // the three-line button and its box
    var more = document.createElement('div');
    more.className = 'nav-more';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'menu-btn';
    btn.setAttribute('aria-label', 'more pages');
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-controls', 'menu-box');
    for (var i = 0; i < 3; i++) btn.appendChild(document.createElement('i'));
    var box = document.createElement('div');
    box.id = 'menu-box';
    box.className = 'menu-box';
    ITEMS.forEach(function (item) {
      if (!item.main && item.label !== current) box.appendChild(node(item, root, current));
    });
    more.appendChild(btn);
    more.appendChild(box);
    main.appendChild(more);
    nav.insertBefore(main, extra || null);

    function setOpen(open) {
      more.classList.toggle('open', open);
      btn.setAttribute('aria-expanded', String(open));
    }
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      setOpen(!more.classList.contains('open'));
    });
    document.addEventListener('click', function (e) { if (!more.contains(e.target)) setOpen(false); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && more.classList.contains('open')) { setOpen(false); btn.focus(); }
    });
    // keyboard: leaving the box closes it
    more.addEventListener('focusout', function (e) { if (!more.contains(e.relatedTarget)) setOpen(false); });
  });
})();
