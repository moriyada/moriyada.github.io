// The menu (plain spaced links; the current page is underlined), plus a little easter egg on the site title. Lives here so changing the menu means editing one file, not every page.
//
// `ready: true` marks pages that exist. Anything else shows faded with a small "soon" and can't be
// clicked. When a page gets built, the same change that adds it flips its flag to true here,
// so "soon" disappears by itself the moment that update goes live.
(function () {
  var ITEMS = [
    { label: 'home', path: 'index.html', ready: true },
    { label: 'archive', path: 'html/archive.html', ready: true },
    { label: 'favorites', path: 'html/favorites.html', ready: true },
    { label: 'hobbies', path: 'html/hobbies.html', ready: true },
    { label: 'bookshelf', path: 'html/bookshelf.html', ready: true },
    { label: 'quotes', path: 'html/quotes.html', ready: true },
    { label: 'goals', path: 'html/goals.html', ready: true },
    { label: 'places', path: 'html/places.html' },
    { label: 'about', path: 'html/about.html', ready: true },
    { label: 'dayari mo', path: 'dayari/index.html', ready: true }
  ];
  // Easter egg: the title read backward by syllable. mo-ri-ya-da -> da-ya-ri mo, "your diary".
  // Hover shows it (CSS, from data-egg). On touch screens the first tap shows it instead of
  // leaving the page; a second tap while it's showing follows the link as usual.
  function easterEgg() {
    var title = document.querySelector('#top h1 a');
    if (!title) return;
    title.setAttribute('data-egg', 'dayari mo');
    var touched = false, timer = null;
    title.addEventListener('touchstart', function () { touched = true; }, { passive: true });
    title.addEventListener('click', function (e) {
      if (!touched) return;
      touched = false;
      if (title.classList.contains('egg-on')) return;   // second tap: go
      e.preventDefault();
      title.classList.add('egg-on');
      clearTimeout(timer);
      timer = setTimeout(function () { title.classList.remove('egg-on'); }, 2500);
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    easterEgg();
    var nav = document.getElementById('ribbon');
    if (!nav) return;
    var root = document.body.getAttribute('data-root') || '';
    var current = document.body.getAttribute('data-page');

    ITEMS.forEach(function (item) {
      var node;
      if (!item.ready) {
        // not built yet: faded, not clickable, with a small "soon" tag
        node = document.createElement('span');
        node.className = 'item soon';
        node.setAttribute('aria-disabled', 'true');
        node.textContent = item.label;
        var tag = document.createElement('small');
        tag.textContent = 'soon';
        node.appendChild(tag);
      } else if (item.label === current) {
        node = document.createElement('span');
        node.className = 'item current';
        node.setAttribute('aria-current', 'page');
        node.textContent = item.label;
      } else {
        node = document.createElement('a');
        node.className = 'item';
        node.href = root + item.path;
        node.textContent = item.label;
      }
      nav.appendChild(node);
    });
  });
})();
