// Photo viewer: clicking a photo shows it enlarged over the page, with its caption under it.
// Close it with the [x] button, Esc, clicking outside the photo, or the phone/browser back button.
// It never opens a new tab and never shows the file's name or address.
(function () {
  var box, figure, img, caption, closeBtn, lastFocus, pushed = false;

  function build() {
    box = document.createElement('div');
    box.id = 'lightbox';
    box.hidden = true;
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', 'photo');

    closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'lightbox-close';
    closeBtn.textContent = 'close';
    closeBtn.setAttribute('aria-label', 'close photo');

    figure = document.createElement('figure');
    img = document.createElement('img');
    caption = document.createElement('figcaption');
    figure.appendChild(img);
    figure.appendChild(caption);

    box.appendChild(closeBtn);
    box.appendChild(figure);
    document.body.appendChild(box);

    // Anything outside the photo and its caption closes the viewer.
    box.addEventListener('click', function (e) {
      if (e.target === img || e.target === caption) return;
      close();
    });
  }

  function open(src, alt, text) {
    if (!box) build();
    lastFocus = document.activeElement;
    img.src = src;
    img.alt = alt || '';
    caption.textContent = text || '';
    caption.hidden = !text;
    box.hidden = false;
    document.documentElement.classList.add('lightbox-open');
    closeBtn.focus();
    // One extra history step, so the back button closes the photo instead of leaving the page.
    try { history.pushState({ lightbox: true }, ''); pushed = true; } catch (e) { pushed = false; }
  }

  function hide() {
    if (!box || box.hidden) return;
    box.hidden = true;
    img.removeAttribute('src');
    document.documentElement.classList.remove('lightbox-open');
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function close() {
    if (!box || box.hidden) return;
    if (pushed) { pushed = false; history.back(); }   // the popstate below does the hiding
    else hide();
  }

  window.addEventListener('popstate', function () { pushed = false; hide(); });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') close();
  });

  document.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('button.zoom');
    if (!btn) return;
    var pic = btn.querySelector('img');
    if (!pic) return;
    e.preventDefault();
    // data-large: a bigger version of the same picture (only set by our own scripts, https only)
    var large = btn.getAttribute('data-large');
    open(large && /^https:\/\//.test(large) ? large : (pic.currentSrc || pic.src), pic.alt, btn.getAttribute('data-caption'));
  });
})();
