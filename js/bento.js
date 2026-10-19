// Bento grid: a day's entries as tiles packed into a grid, instead of a long feed.
//
// Tile sizes (columns x rows, on a 4-column grid):
//   S  1x1  song, mood, body
//   M  2x1  run, thought, food, anything else
//   L  2x2  photo, learned, and any entry with a picture or video
//   XL 4x2  used when the day has exactly one entry
// Any entry with long text (over 280 characters) grows to L.
//
// CSS grid with grid-auto-flow: dense does the packing. Every entry is shown in full
// (rows grow to fit): a diary is for reading, so nothing is cut off behind a "more" link.
(function () {
  var M = window.Moriyada = window.Moriyada || {};
  var el = function () { return M.el.apply(null, arguments); };

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

  M.planBento = function (entries) {
    return entries.length === 1 ? ['XL'] : entries.map(M.tileSize);
  };

  // opts: { emptyText, showDate }
  M.renderBento = function (container, entries, opts) {
    opts = opts || {};
    container.textContent = '';
    container.className = 'bento';
    if (!entries.length) {
      container.className = '';
      container.appendChild(el('p', { class: 'empty' }, [opts.emptyText || 'Nothing here.']));
      return;
    }
    var sizes = M.planBento(entries);
    entries.forEach(function (entry, i) {
      var tile = M.renderEntry(entry, { showDate: opts.showDate });
      tile.className += ' tile ' + sizes[i];
      if (/^\d+$/.test(String(entry.id))) tile.id = 'e-' + entry.id;
      container.appendChild(tile);
    });
  };
})();
