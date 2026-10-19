// Daily almanac on the home page: a "Figure of the day" and "This day in history".
//
// Both are read from Wikipedia and shown right here on the page (no need to leave the site).
// The figure changes every day at Manila midnight, going through the list below in a fixed
// shuffled order (so a philosopher, then a conqueror, then a scientist...); with this many
// people it takes months before anyone repeats. History is Wikipedia's "selected anniversaries"
// for today's Manila date.
//
// Safety: Wikipedia's text comes in as plain text and is shown with textContent only, never
// as HTML. Pictures are Wikipedia's own free-licensed images. One request per visitor per day
// (the result is cached in this browser until Manila midnight). If Wikipedia can't be reached,
// the cards say so and the rest of the page is untouched.
(function () {
  var M = window.Moriyada = window.Moriyada || {};
  var el = function () { return M.el.apply(null, arguments); };
  var API = 'https://en.wikipedia.org/w/api.php';
  var FEED = 'https://en.wikipedia.org/api/rest_v1/feed/onthisday/selected/';
  var CACHE_KEY = 'almanac-v3';   // v3: history events carry their source links

  // [Wikipedia article title, what they were] - the second part is only shown if Wikipedia
  // can't be reached. Add anyone; the order is reshuffled automatically.
  var PEOPLE = [
    // philosophers
    ['Socrates', 'philosopher'], ['Plato', 'philosopher'], ['Aristotle', 'philosopher'],
    ['Confucius', 'philosopher'], ['Laozi', 'philosopher'], ['Mencius', 'philosopher'],
    ['Zhuang Zhou', 'philosopher'], ['Mozi', 'philosopher'], ['Han Fei', 'philosopher'],
    ['Marcus Aurelius', 'Roman emperor and Stoic philosopher'], ['Seneca the Younger', 'Stoic philosopher'],
    ['Epictetus', 'Stoic philosopher'], ['Diogenes', 'philosopher'], ['Heraclitus', 'philosopher'],
    ['Pythagoras', 'philosopher and mathematician'], ['Zeno of Citium', 'founder of Stoicism'],
    ['Epicurus', 'philosopher'], ['Thales of Miletus', 'philosopher'], ['Parmenides', 'philosopher'],
    ['Augustine of Hippo', 'theologian and philosopher'], ['Thomas Aquinas', 'philosopher'],
    ['Niccolò Machiavelli', 'political philosopher'], ['René Descartes', 'philosopher'],
    ['Baruch Spinoza', 'philosopher'], ['Blaise Pascal', 'philosopher and mathematician'],
    ['John Locke', 'philosopher'], ['Thomas Hobbes', 'philosopher'], ['David Hume', 'philosopher'],
    ['Jean-Jacques Rousseau', 'philosopher'], ['Voltaire', 'writer and philosopher'],
    ['Immanuel Kant', 'philosopher'], ['Georg Wilhelm Friedrich Hegel', 'philosopher'],
    ['Arthur Schopenhauer', 'philosopher'], ['Søren Kierkegaard', 'philosopher'],
    ['Friedrich Nietzsche', 'philosopher'], ['John Stuart Mill', 'philosopher and economist'],
    ['Jeremy Bentham', 'philosopher'], ['Karl Marx', 'philosopher and economist'],
    ['Ludwig Wittgenstein', 'philosopher'], ['Bertrand Russell', 'philosopher'],
    ['Jean-Paul Sartre', 'philosopher'], ['Simone de Beauvoir', 'philosopher'], ['Albert Camus', 'writer and philosopher'],
    ['Hannah Arendt', 'political philosopher'], ['Michel de Montaigne', 'essayist'],
    ['Mary Wollstonecraft', 'philosopher and writer'], ['Hypatia', 'philosopher and mathematician'],
    ['Avicenna', 'philosopher and physician'], ['Averroes', 'philosopher'], ['Ibn Khaldun', 'historian and thinker'],
    ['Al-Farabi', 'philosopher'], ['Adi Shankara', 'philosopher'], ['Nagarjuna', 'philosopher'],
    ['Chanakya', 'philosopher and royal adviser'], ['Sun Tzu', 'military strategist'], ['Wang Yangming', 'philosopher'],
    ['Martin Heidegger', 'philosopher'], ['Michel Foucault', 'philosopher'], ['Simone Weil', 'philosopher'],
    ['Karl Popper', 'philosopher of science'], ['Thomas Kuhn', 'philosopher of science'],
    // economists
    ['Adam Smith', 'economist'], ['David Ricardo', 'economist'], ['Thomas Robert Malthus', 'economist'],
    ['John Maynard Keynes', 'economist'], ['Friedrich Hayek', 'economist'], ['Milton Friedman', 'economist'],
    ['Joseph Schumpeter', 'economist'], ['Thorstein Veblen', 'economist'], ['Alfred Marshall', 'economist'],
    ['Amartya Sen', 'economist'], ['Paul Samuelson', 'economist'], ['Ludwig von Mises', 'economist'],
    ['Vilfredo Pareto', 'economist'], ['John Forbes Nash Jr.', 'mathematician'], ['Elinor Ostrom', 'economist'],
    ['Daniel Kahneman', 'psychologist and economist'], ['Irving Fisher', 'economist'], ['Léon Walras', 'economist'],
    ['Karl Polanyi', 'economic historian'], ['Gary Becker', 'economist'], ['Ronald Coase', 'economist'],
    ['Muhammad Yunus', 'economist'],
    // rulers, conquerors, leaders
    ['Julius Caesar', 'Roman general and statesman'], ['Augustus', 'first Roman emperor'],
    ['Alexander the Great', 'king of Macedon'], ['Genghis Khan', 'founder of the Mongol Empire'],
    ['Kublai Khan', 'Mongol emperor of China'], ['Timur', 'conqueror'], ['Attila', 'ruler of the Huns'],
    ['Mao Zedong', 'Chinese revolutionary leader'], ['Qin Shi Huang', 'first emperor of China'],
    ['Emperor Wu of Han', 'Chinese emperor'], ['Napoleon', 'French emperor'], ['Cleopatra', 'queen of Egypt'],
    ['Hannibal', 'Carthaginian general'], ['Cyrus the Great', 'founder of the Persian Empire'],
    ['Darius the Great', 'Persian king'], ['Ashoka', 'Indian emperor'], ['Akbar', 'Mughal emperor'],
    ['Charlemagne', 'emperor'], ['Constantine the Great', 'Roman emperor'], ['Justinian I', 'Byzantine emperor'],
    ['Suleiman the Magnificent', 'Ottoman sultan'], ['Mehmed II', 'Ottoman sultan'], ['Saladin', 'sultan'],
    ['Mansa Musa', 'ruler of the Mali Empire'], ['Shaka', 'Zulu king'], ['Peter the Great', 'Russian tsar'],
    ['Catherine the Great', 'Russian empress'], ['Elizabeth I', 'queen of England'], ['Queen Victoria', 'British queen'],
    ['Vladimir Lenin', 'Russian revolutionary'], ['Winston Churchill', 'British prime minister'],
    ['Franklin D. Roosevelt', 'American president'], ['Abraham Lincoln', 'American president'],
    ['George Washington', 'American president'], ['Mahatma Gandhi', 'Indian independence leader'],
    ['Nelson Mandela', 'South African president'], ['Lee Kuan Yew', 'Singapore\'s first prime minister'],
    ['Deng Xiaoping', 'Chinese leader'], ['Otto von Bismarck', 'German statesman'],
    ['Mustafa Kemal Atatürk', 'founder of modern Turkey'], ['Ho Chi Minh', 'Vietnamese revolutionary'],
    ['Oda Nobunaga', 'Japanese warlord'], ['Tokugawa Ieyasu', 'Japanese shogun'], ['Emperor Meiji', 'Japanese emperor'],
    ['Sun Yat-sen', 'Chinese revolutionary'], ['Simón Bolívar', 'South American liberator'],
    ['Che Guevara', 'revolutionary'], ['Martin Luther King Jr.', 'civil rights leader'], ['Ramesses II', 'Egyptian pharaoh'],
    ['Hammurabi', 'Babylonian king'], ['Pericles', 'Athenian statesman'], ['Leonidas I', 'Spartan king'],
    ['Spartacus', 'gladiator and rebel'], ['Boudica', 'British queen and rebel'], ['Joan of Arc', 'French heroine'],
    ['William the Conqueror', 'king of England'], ['Isabella I of Castile', 'queen of Castile'],
    ['Louis XIV', 'French king'], ['Frederick the Great', 'Prussian king'],
    // Filipinos
    ['José Rizal', 'Filipino national hero'], ['Andrés Bonifacio', 'Filipino revolutionary'],
    ['Apolinario Mabini', 'Filipino revolutionary'], ['Emilio Aguinaldo', 'first Philippine president'],
    ['Lapulapu', 'chief of Mactan'], ['Melchora Aquino', 'Filipino revolutionary'], ['Gabriela Silang', 'Filipino revolutionary'],
    ['Diego Silang', 'Filipino revolutionary'], ['Juan Luna', 'Filipino painter'], ['Marcelo H. del Pilar', 'Filipino writer and reformist'],
    ['Antonio Luna', 'Filipino general'], ['Gregorio del Pilar', 'Filipino general'], ['Emilio Jacinto', 'Filipino revolutionary'],
    ['Francisco Balagtas', 'Filipino poet'], ['Graciano López Jaena', 'Filipino journalist'], ['Manuel L. Quezon', 'Philippine president'],
    ['Ramon Magsaysay', 'Philippine president'], ['Benigno Aquino Jr.', 'Filipino senator'], ['Corazon Aquino', 'Philippine president'],
    ['Lorenzo Ruiz', 'Filipino saint'], ['Sultan Kudarat', 'sultan of Maguindanao'], ['Rajah Sulayman', 'ruler of Maynila'],
    ['Carlos P. Romulo', 'Filipino diplomat'], ['José Abad Santos', 'Filipino chief justice'], ['Macario Sakay', 'Filipino revolutionary'],
    ['Josefa Llanes Escoda', 'Filipino civic leader'], ['Fernando Amorsolo', 'Filipino painter'], ['Nick Joaquín', 'Filipino writer'],
    ['Efren Reyes', 'Filipino billiards player'], ['Manny Pacquiao', 'Filipino boxer'],
    // scientists and mathematicians
    ['Isaac Newton', 'physicist and mathematician'], ['Albert Einstein', 'physicist'], ['Charles Darwin', 'naturalist'],
    ['Galileo Galilei', 'astronomer'], ['Nicolaus Copernicus', 'astronomer'], ['Johannes Kepler', 'astronomer'],
    ['Marie Curie', 'physicist and chemist'], ['Nikola Tesla', 'inventor'], ['Michael Faraday', 'scientist'],
    ['James Clerk Maxwell', 'physicist'], ['Alan Turing', 'mathematician and computer scientist'], ['Ada Lovelace', 'mathematician'],
    ['Euclid', 'mathematician'], ['Archimedes', 'mathematician and inventor'], ['Muhammad ibn Musa al-Khwarizmi', 'mathematician'],
    ['Leonardo da Vinci', 'painter and inventor'], ['Richard Feynman', 'physicist'], ['Niels Bohr', 'physicist'],
    ['Werner Heisenberg', 'physicist'], ['Kurt Gödel', 'logician'], ['John von Neumann', 'mathematician'],
    ['Carl Friedrich Gauss', 'mathematician'], ['Leonhard Euler', 'mathematician'], ['Srinivasa Ramanujan', 'mathematician'],
    ['Louis Pasteur', 'chemist and microbiologist'], ['Gregor Mendel', 'scientist'], ['Stephen Hawking', 'physicist'],
    ['J. Robert Oppenheimer', 'physicist'], ['Rosalind Franklin', 'chemist'], ['Dmitri Mendeleev', 'chemist'],
    ['Emmy Noether', 'mathematician'], ['Claude Shannon', 'mathematician and engineer'], ['Edward Jenner', 'physician'],
    ['Alexander Fleming', 'physician and microbiologist'], ['Hippocrates', 'physician'], ['Zhang Heng', 'astronomer and inventor'],
    ['Aryabhata', 'mathematician and astronomer'], ['Ibn al-Haytham', 'mathematician and physicist'], ['Tycho Brahe', 'astronomer'],
    ['Antoine Lavoisier', 'chemist'], ['Max Planck', 'physicist'], ['Erwin Schrödinger', 'physicist'], ['Enrico Fermi', 'physicist'],
    ['Carl Sagan', 'astronomer'], ['Rachel Carson', 'biologist and writer'],
    // writers, artists, composers
    ['William Shakespeare', 'playwright and poet'], ['Homer', 'poet'], ['Dante Alighieri', 'poet'], ['Leo Tolstoy', 'writer'],
    ['Fyodor Dostoevsky', 'writer'], ['Franz Kafka', 'writer'], ['George Orwell', 'writer'], ['Ernest Hemingway', 'writer'],
    ['Jorge Luis Borges', 'writer'], ['Gabriel García Márquez', 'writer'], ['Miguel de Cervantes', 'writer'],
    ['Victor Hugo', 'writer'], ['Charles Dickens', 'writer'], ['Jane Austen', 'writer'], ['Mark Twain', 'writer'],
    ['Johann Wolfgang von Goethe', 'writer'], ['Rumi', 'poet'], ['Li Bai', 'poet'], ['Du Fu', 'poet'],
    ['Murasaki Shikibu', 'writer'], ['Matsuo Bashō', 'poet'], ['Rabindranath Tagore', 'poet'], ['Virginia Woolf', 'writer'],
    ['James Joyce', 'writer'], ['Edgar Allan Poe', 'writer'], ['Anton Chekhov', 'writer'], ['Michelangelo', 'artist'],
    ['Vincent van Gogh', 'painter'], ['Pablo Picasso', 'artist'], ['Rembrandt', 'painter'], ['Frida Kahlo', 'painter'],
    ['Hokusai', 'artist'], ['Wolfgang Amadeus Mozart', 'composer'], ['Ludwig van Beethoven', 'composer'],
    ['Johann Sebastian Bach', 'composer'], ['Frédéric Chopin', 'composer'],
    // explorers
    ['Marco Polo', 'explorer'], ['Zheng He', 'admiral and explorer'], ['Ibn Battuta', 'traveller'],
    ['Ferdinand Magellan', 'explorer'], ['Vasco da Gama', 'explorer'], ['Christopher Columbus', 'explorer'],
    ['Roald Amundsen', 'explorer'], ['Neil Armstrong', 'astronaut'], ['Yuri Gagarin', 'cosmonaut'],
    // chess
    ['Bobby Fischer', 'chess player'], ['Garry Kasparov', 'chess player'], ['José Raúl Capablanca', 'chess player'],
    ['Mikhail Tal', 'chess player'], ['Paul Morphy', 'chess player'], ['Magnus Carlsen', 'chess player'],
    ['Emanuel Lasker', 'chess player'], ['Judit Polgár', 'chess player'], ['Eugenio Torre', 'Filipino chess player'],
    ['Wesley So', 'chess player'],
    // and a few more
    ['Florence Nightingale', 'nurse'], ['Martin Luther', 'theologian'], ['The Buddha', 'spiritual teacher'],
    ['Herodotus', 'historian'], ['Thucydides', 'historian'], ['Sima Qian', 'historian']
  ];

  // The same shuffled order on every visit: a tiny seeded random number generator.
  function seeded(seed) {
    return function () {
      seed = (seed + 0x6D2B79F5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  var ORDER = (function () {
    var list = PEOPLE.slice(), rand = seeded(20261019);
    for (var i = list.length - 1; i > 0; i--) {
      var j = Math.floor(rand() * (i + 1));
      var x = list[i]; list[i] = list[j]; list[j] = x;
    }
    return list;
  })();
  M.almanacPick = function (day) { return ORDER[((M.dayNumber(day) % ORDER.length) + ORDER.length) % ORDER.length]; };

  // ---------- reading Wikipedia ----------

  function getJson(url) {
    return M.fetch(url).then(function (res) {
      if (!res.ok) throw new Error('wikipedia ' + res.status);
      return res.json();
    });
  }

  // Plain-text cleanup: Wikipedia's plain extracts keep some leftovers of removed
  // pronunciations, like "( ; born ...)" or "()".
  function tidy(text) {
    return String(text || '')
      .replace(/\(\s*[;,]\s*/g, '(')
      .replace(/\(\s*\)/g, '')
      .replace(/[ \t]+([,.;])/g, '$1')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
  }

  function httpsOnly(u) { return typeof u === 'string' && /^https:\/\//.test(u) ? u : null; }

  function fetchFigure(title) {
    var url = API + '?action=query&format=json&formatversion=2&origin=*&redirects=1' +
      '&prop=extracts%7Cpageimages%7Cdescription&exintro=1&explaintext=1' +
      '&piprop=thumbnail%7Coriginal&pithumbsize=320&titles=' + encodeURIComponent(title);
    return getJson(url).then(function (data) {
      var page = data && data.query && data.query.pages && data.query.pages[0];
      if (!page || page.missing || !page.extract) throw new Error('no article');
      var paras = String(page.extract).split(/\n+/).map(tidy).filter(function (p) { return p.length > 1; }).slice(0, 4);
      if (!paras.length) throw new Error('no text');
      return {
        name: page.title,
        desc: page.description ? tidy(page.description) : '',
        paras: paras,
        thumb: httpsOnly(page.thumbnail && page.thumbnail.source),
        large: httpsOnly(page.original && page.original.source),
        url: 'https://en.wikipedia.org/wiki/' + encodeURIComponent(String(page.title).replace(/ /g, '_'))
      };
    });
  }

  // The Wikipedia articles an event links to: its sources (title + address), up to 4.
  function articles(pages) {
    return (Array.isArray(pages) ? pages : []).map(function (p) {
      if (!p || typeof p !== 'object') return null;
      var title = (p.titles && p.titles.normalized) || p.normalizedtitle || String(p.title || '').replace(/_/g, ' ');
      var url = httpsOnly(p.content_urls && p.content_urls.desktop && p.content_urls.desktop.page);
      return title && url ? { title: tidy(title), url: url } : null;
    }).filter(Boolean).slice(0, 4);
  }

  // A handful of events spread across the centuries, oldest first.
  function fetchHistory(day) {
    return getJson(FEED + day.slice(5, 7) + '/' + day.slice(8, 10)).then(function (data) {
      var all = (data && Array.isArray(data.selected) ? data.selected : [])
        .filter(function (e) { return e && typeof e.text === 'string' && typeof e.year === 'number'; })
        .map(function (e) {
          return {
            year: e.year,
            text: tidy(e.text.replace(/\s*\((?:pictured|depicted|shown|illustrated)[^)]*\)/gi, '')),
            pages: articles(e.pages)
          };
        })
        .sort(function (a, b) { return a.year - b.year; });
      if (!all.length) throw new Error('no events');
      var want = Math.min(5, all.length), picked = [];
      for (var i = 0; i < want; i++) picked.push(all[want === 1 ? 0 : Math.round(i * (all.length - 1) / (want - 1))]);
      return picked;
    });
  }

  // ---------- showing it ----------

  function credit(url) {
    return el('p', { class: 'almanac-credit' }, [
      'Source: ', el('a', { href: url, rel: 'noopener' }, ['Wikipedia']), ' \u00B7 ',
      el('a', { href: 'https://creativecommons.org/licenses/by-sa/4.0/', rel: 'license noopener' }, ['CC BY-SA 4.0'])
    ]);
  }

  function showFigure(box, f) {
    box.textContent = '';
    var photo = null;
    if (f.thumb) {
      photo = el('button', { type: 'button', class: 'zoom figure-photo', 'data-caption': f.name, 'data-large': f.large || f.thumb },
        [el('img', { src: f.thumb, alt: f.name, loading: 'lazy', decoding: 'async' })]);
      photo.firstChild.addEventListener('error', function () { photo.hidden = true; });
    }
    box.appendChild(el('div', { class: 'figure-head' }, [
      photo,
      el('div', null, [
        el('h3', { class: 'figure-name' }, [f.name]),
        f.desc ? el('p', { class: 'figure-desc' }, [f.desc.charAt(0).toUpperCase() + f.desc.slice(1)]) : null
      ])
    ]));
    var text = el('div', { class: 'figure-text' });
    var rest = [];
    f.paras.forEach(function (p, i) {
      var node = el('p', null, [p]);
      if (i > 0) { node.hidden = true; rest.push(node); }
      text.appendChild(node);
    });
    box.appendChild(text);
    if (rest.length) {
      var more = el('button', { type: 'button', class: 'small', 'aria-expanded': 'false' }, ['read more']);
      more.addEventListener('click', function () {
        var open = more.getAttribute('aria-expanded') !== 'true';
        rest.forEach(function (n) { n.hidden = !open; });
        more.setAttribute('aria-expanded', String(open));
        more.textContent = open ? 'show less' : 'read more';
      });
      box.appendChild(more);
    }
    box.appendChild(credit(f.url));
  }

  function showFigureFallback(box, pick) {
    box.textContent = '';
    box.appendChild(el('h3', { class: 'figure-name' }, [pick[0].replace(/\s*\(.*\)$/, '')]));
    box.appendChild(el('p', { class: 'figure-desc' }, [pick[1].charAt(0).toUpperCase() + pick[1].slice(1)]));
    box.appendChild(el('p', { class: 'note' }, ['Couldn\'t reach Wikipedia just now for the rest of the story. Try again later.']));
  }

  function yearText(y) { return y < 0 ? (-y) + ' BC' : String(y); }

  // One event: the year and what happened. Under it, bottom right, a small "source" link
  // that opens the list of Wikipedia articles it comes from.
  function eventItem(e) {
    var sources = (e.pages || []).length ? el('details', { class: 'sources' }, [
      el('summary', null, ['source']),
      el('ul', null, e.pages.map(function (a) {
        return el('li', null, [el('a', { href: a.url, target: '_blank', rel: 'noopener' }, [a.title])]);
      }))
    ]) : null;
    return el('li', null, [
      el('span', { class: 'year' }, [yearText(e.year)]),
      el('div', null, [el('p', null, [e.text]), sources])
    ]);
  }

  function showHistory(box, events) {
    box.textContent = '';
    box.appendChild(el('ul', { class: 'history' }, events.map(eventItem)));
    box.appendChild(credit('https://en.wikipedia.org/wiki/Wikipedia:Selected_anniversaries'));
  }

  function showHistoryFallback(box) {
    box.textContent = '';
    box.appendChild(el('p', { class: 'note' }, ['The history books are closed for now (Wikipedia couldn\'t be reached). Try again later.']));
  }

  M.loadAlmanac = function (day) {
    var figBox = document.getElementById('figure-body');
    var hisBox = document.getElementById('history-body');
    if (!figBox || !hisBox) return Promise.resolve();
    var pick = M.almanacPick(day);
    // "October 19 in history": it changes every day, with the date
    var head = document.querySelector('#history h2');
    if (head) head.textContent = M.formatDate(day, { weekday: undefined, year: undefined }) + ' in history';
    var cached = M.cache.get(CACHE_KEY);
    var saved = cached && cached.day === day ? cached : { day: day };
    if (saved.figure && saved.figure.title === pick[0]) showFigure(figBox, saved.figure);
    if (saved.history) showHistory(hisBox, saved.history);

    var jobs = [];
    if (!(saved.figure && saved.figure.title === pick[0])) {
      jobs.push(M.withTimeout(fetchFigure(pick[0]), 12000, 'wikipedia').then(function (f) {
        f.title = pick[0];
        saved.figure = f;
        showFigure(figBox, f);
      }).catch(function () { showFigureFallback(figBox, pick); }));
    }
    if (!saved.history) {
      jobs.push(M.withTimeout(fetchHistory(day), 12000, 'wikipedia').then(function (h) {
        saved.history = h;
        showHistory(hisBox, h);
      }).catch(function () { showHistoryFallback(hisBox); }));
    }
    return Promise.all(jobs).then(function () { if (jobs.length) M.cache.set(CACHE_KEY, saved); });
  };

  document.addEventListener('DOMContentLoaded', function () {
    if (document.getElementById('almanac')) M.loadAlmanac(M.manilaDate());
  });
})();
