// Bento grid: a day's entries as tiles packed into a grid, instead of a long feed.
//
// Tile sizes (columns x rows, on a 4-column grid):
//   S  1x1  song, mood, body
//   M  2x1  run, thought, food, anything else
//   L  2x2  photo, learned, and any entry with a picture or video
//   XL 4x2  used when the day has exactly one entry
// Any entry with long text (over 280 characters) grows to L.
//
// CSS grid with grid-auto-flow: dense does the packing. On the home page the whole day
// should fit in one screen (3 rows): if it doesn't, the oldest tiles shrink first
// (text before pictures), and only then the newest ones are kept with a "more from today" tile.
(function () {
  var M = window.Moriyada = window.Moriyada || {};
  var el = function () { return M.el.apply(null, arguments); };

  var COLS = 4;
  var SIZES = { S: [1, 1], M: [2, 1], L: [2, 2], XL: [4, 2] };
  var SMALL = { song: 1, mood: 1, body: 1 };
  var BIG = { photo: 1, learned: 1 };

  function hasPicture(entry) {
    var media = Array.isArray(entry.media) ? entry.media : [];
    return media.some(function (m) {
      return typeof m === 'string' && !/\.(mp3|m4a|aac|ogg|oga|opus|wav|webm)(\?|$)/i.test(m);
    });
  }

  function textLength(entry) {
    var d = entry.data && typeof entry.data === 'object' ? entry.data : {};
    return [d.text, d.own_words, d.note, d.caption].reduce(function (n, t) {
      return n + (typeof t === 'string' ? t.length : 0);
    }, 0);
  }

  M.tileSize = function (entry) {
    if (entry.type === 'song') return 'S';   // its cover is shown small
    if (BIG[entry.type] || hasPicture(entry)) return 'L';
    // Long text gets a wide tile, so it spreads sideways instead of stretching its row.
    if (textLength(entry) > 280) return 'L';
    if (SMALL[entry.type]) return 'S';
    return 'M';
  };

  // How many rows the browser will use for these tiles: the same "dense" placement
  // the browser does (each tile goes in the first free spot from the top-left).
  function rowsNeeded(sizes) {
    var taken = [];
    var rows = 0;
    function free(r, c, w, h) {
      for (var y = r; y < r + h; y++) {
        for (var x = c; x < c + w; x++) if (taken[y] && taken[y][x]) return false;
      }
      return true;
    }
    sizes.forEach(function (s) {
      var w = Math.min(SIZES[s][0], COLS), h = SIZES[s][1];
      for (var r = 0; ; r++) {
        for (var c = 0; c + w <= COLS; c++) {
          if (free(r, c, w, h)) {
            for (var y = r; y < r + h; y++) {
              taken[y] = taken[y] || [];
              for (var x = c; x < c + w; x++) taken[y][x] = true;
            }
            rows = Math.max(rows, r + h);
            return;
          }
        }
      }
    });
    return rows;
  }
  M.bentoRows = rowsNeeded;

  // Entries come newest first, so the last ones are the oldest. Text tiles shrink before
  // pictures (L -> M, then M -> S), oldest first; pictures shrink only when nothing else can.
  function shrinkOldest(sizes, pictures) {
    var steps = [['L', 'M', false], ['M', 'S', false], ['L', 'M', true], ['M', 'S', true]];
    for (var k = 0; k < steps.length; k++) {
      for (var i = sizes.length - 1; i >= 0; i--) {
        if (sizes[i] === steps[k][0] && pictures[i] === steps[k][2]) { sizes[i] = steps[k][1]; return true; }
      }
    }
    return false;
  }

  // Decide sizes (and how many tiles fit) for at most maxRows rows. Returns
  // { sizes: [...], shown: n } where n < entries.length means "add a more tile".
  M.planBento = function (entries, maxRows) {
    if (entries.length === 1) return { sizes: ['XL'], shown: 1 };
    var sizes = entries.map(M.tileSize);
    if (!maxRows) return { sizes: sizes, shown: entries.length };
    var pictures = entries.map(function (e) { return e.type === 'photo' || hasPicture(e); });
    while (rowsNeeded(sizes) > maxRows && shrinkOldest(sizes, pictures)) { /* keep shrinking */ }
    var shown = entries.length;
    while (shown > 0 && rowsNeeded(sizes.slice(0, shown).concat(shown < entries.length ? ['S'] : [])) > maxRows) {
      shown--;
    }
    return { sizes: sizes.slice(0, shown), shown: shown };
  };

  // Tiles whose text doesn't fit get a "more" link to the full entry on the day page.
  function markClipped(container) {
    Array.prototype.forEach.call(container.querySelectorAll('.tile'), function (tile) {
      var link = tile.querySelector(':scope > .tile-more');
      var clipped = tile.scrollHeight > tile.clientHeight + 4;
      tile.classList.toggle('clipped', clipped);   // CSS fades the cut-off text out
      if (clipped && !link && tile.getAttribute('data-full')) {
        tile.appendChild(el('a', { class: 'tile-more', href: tile.getAttribute('data-full') }, ['more »']));
      } else if (!clipped && link) {
        link.parentNode.removeChild(link);
      }
    });
  }

  // On the home page, row height follows the window so the grid ends at the bottom of the screen.
  function fitRows(container, maxRows) {
    if (window.matchMedia('(max-width: 640px)').matches) { container.style.removeProperty('--row'); return; }
    var top = container.getBoundingClientRect().top + window.scrollY;
    var gap = parseFloat(getComputedStyle(container).rowGap) || 20;
    var room = window.innerHeight - top - 28;
    var row = Math.max(115, Math.min(190, Math.floor((room - gap * (maxRows - 1)) / maxRows)));
    container.style.setProperty('--row', row + 'px');
  }

  // opts: { maxRows (home only), moreHref, dayHref(entry), emptyText, showDate }
  M.renderBento = function (container, entries, opts) {
    opts = opts || {};
    container.textContent = '';
    container.className = 'bento' + (opts.maxRows ? ' fit' : ' full');
    if (!entries.length) {
      container.className = '';
      container.appendChild(el('p', { class: 'empty' }, [opts.emptyText || 'Nothing here.']));
      return;
    }

    var plan = M.planBento(entries, opts.maxRows);
    entries.slice(0, plan.shown).forEach(function (entry, i) {
      var tile = M.renderEntry(entry, { showDate: opts.showDate });
      tile.className += ' tile ' + plan.sizes[i];
      if (/^\d+$/.test(String(entry.id))) {
        tile.id = 'e-' + entry.id;
        if (opts.dayHref) tile.setAttribute('data-full', opts.dayHref(entry) + '#e-' + entry.id);
      }
      container.appendChild(tile);
    });
    var hidden = entries.length - plan.shown;
    if (hidden > 0 && opts.moreHref) {
      container.appendChild(el('div', { class: 'tile S more-tile' }, [
        el('a', { href: opts.moreHref }, ['+' + hidden + ' more from today »'])
      ]));
    }

    if (opts.maxRows) {
      var refit = function () { fitRows(container, opts.maxRows); markClipped(container); };
      refit();
      if (!container.getAttribute('data-watching')) {
        container.setAttribute('data-watching', '1');
        var t = null;
        window.addEventListener('resize', function () { clearTimeout(t); t = setTimeout(refit, 150); });
        window.addEventListener('load', refit);
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(refit);
      }
    }
  };
})();
