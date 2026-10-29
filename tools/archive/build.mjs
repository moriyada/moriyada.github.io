// Builds what GitHub Pages publishes: the site itself plus a fresh public archive.
//
//   node tools/archive/build.mjs <output folder>
//
// Runs in GitHub Actions (.github/workflows/pages.yml), never on the website. Steps:
//   1. copy the site's files (everything in git except dot-files like .github/, tools/ and the
//      README/CLAUDE notes)
//   2. read every PUBLIC entry (and the tabs: books, quotes, goals, hobbies, favorites,
//      weather) from Supabase with the public anon key, and write
//        archive/<year>.json   entries of that year
//        archive/tabs.json     books, quotes, goals, hobbies, favorites, saved weather
//        archive/meta.json     when it was saved, how many entries, which photos
//   3. put a copy of every photo those use in archive/media/, re-encoded (about 300 KB at
//      most) so no EXIF/GPS or other metadata survives
//   4. if Supabase can't be read, publish the archive that is live right now instead (so a
//      broken run never replaces a good archive with an empty one)
//
// Safety: only the anon/publishable key is accepted (a service_role / secret key makes the
// run stop). Private entries are filtered out twice (in the query and again here), so they
// never reach the archive, and neither do their photos. Nothing here is committed to git:
// the files only exist inside the Pages artifact.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const OUT = path.resolve(process.argv[2] || '_site');
const ARCHIVE = path.join(OUT, 'archive');
const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
const ANON_KEY = (process.env.SUPABASE_ANON_KEY || '').trim();
const LIVE_URL = (process.env.LIVE_URL || 'https://moriyada.github.io').replace(/\/+$/, '');
const BUCKET = 'media';
const PAGE = 1000;                       // rows per request (Supabase's default maximum)
const MAX_PHOTO = 300 * 1024;            // target size of one archived photo
const PHOTO_SIDE = 1600;                 // longest side of an archived photo
const WARN_SIZE = 750 * 1024 * 1024;     // GitHub Pages sites can be at most 1 GB
const LIMIT_SIZE = 1000 * 1024 * 1024;

// A photo's storage path, exactly as the database allows it: 2026/10/08/x7k2abc1.jpg
const PATH_OK = /^\d{4}\/\d{2}\/\d{2}\/[a-z0-9]{6,40}\.(jpe?g|png|webp)$/i;

// What the site reads from each table (only these columns are exported).
const TABS = {
  books: 'id,title,author,cover,status,thoughts,started_on,finished_on',
  quotes: 'id,text,source,saved_on',
  goals: 'id,title,steps,feeling,status,started_on,closed_on,updated_at',
  hobbies: 'id,name,photo,why,since,position',
  favorite_categories: 'id,name,position',
  favorites: 'id,category_id,name,why,photo,since,until',
  day_weather: 'weather_date,summary,temp_c,data'
};
const ENTRY_COLUMNS = 'id,created_at,entry_date,type,tags,data,media,private';

// ---------- logging (GitHub Actions understands ::warning:: and ::error::) ----------

const log = (msg) => console.log(msg);
const warn = (msg) => console.log('::warning::' + msg);
const fail = (msg) => { console.log('::error::' + msg); process.exit(1); };

// ---------- 1. the site ----------

function copySite() {
  fs.rmSync(OUT, { recursive: true, force: true });
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT }).toString().split('\0').filter(Boolean);
  let n = 0;
  for (const f of files) {
    if (f.split('/').some((part) => part.startsWith('.')) || f.startsWith('tools/') || f.startsWith('archive/') || /^[^/]+\.md$/.test(f)) continue;   // notes like README.md aren't web pages
    const to = path.join(OUT, f);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(path.join(ROOT, f), to);
    n++;
  }
  log(`Copied ${n} site files.`);
}

// ---------- the key must be the public one ----------

function checkKey() {
  if (!SUPABASE_URL || !ANON_KEY) return 'The SUPABASE_URL / SUPABASE_ANON_KEY secrets are not set.';
  if (!/^(https:\/\/[a-z0-9.-]+|http:\/\/(127\.0\.0\.1|localhost):\d+)$/i.test(SUPABASE_URL)) return 'SUPABASE_URL should look like https://xxxx.supabase.co';
  if (/^sb_secret_/i.test(ANON_KEY)) fail('SUPABASE_ANON_KEY is a SECRET key. Use the anon / publishable key instead. Stopping.');
  if (/^eyJ/.test(ANON_KEY)) {
    let role = '';
    try { role = JSON.parse(Buffer.from(ANON_KEY.split('.')[1], 'base64url').toString()).role; } catch (e) { /* unreadable */ }
    if (role !== 'anon') fail(`SUPABASE_ANON_KEY has role "${role || '?'}". Only the anon key is allowed. Stopping.`);
  }
  return null;
}

// ---------- 2. reading Supabase (public API, anon key) ----------

async function getJson(url, headers, timeoutMs = 30000) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url.replace(/\?.*/, '')}`);
  return res.json();
}

async function readTable(table, columns, filter = '') {
  const headers = { apikey: ANON_KEY, Authorization: 'Bearer ' + ANON_KEY, Accept: 'application/json' };
  const rows = [];
  for (let offset = 0; ; offset += PAGE) {
    const url = `${SUPABASE_URL}/rest/v1/${table}?select=${columns}${filter}&order=${columns.split(',')[0]}.asc&limit=${PAGE}&offset=${offset}`;
    const page = await getJson(url, headers);
    if (!Array.isArray(page)) throw new Error(`unexpected reply for ${table}`);
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

// ---------- what the live site has right now ----------

async function liveArchive() {
  try {
    const meta = await getJson(`${LIVE_URL}/archive/meta.json?ts=${Date.now()}`, {});
    if (!meta || !Array.isArray(meta.years)) return null;
    return meta;
  } catch (e) {
    return null;
  }
}

async function download(url, timeoutMs = 60000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// ---------- 3. photos: small, and with no metadata at all ----------

// sharp writes no EXIF, GPS, XMP or IPTC unless asked to (we never ask). .rotate() first
// applies the phone's "which way up" flag to the pixels, so dropping it doesn't turn photos.
async function cleanPhoto(buf, ext) {
  const kind = /png/i.test(ext) ? 'png' : /webp/i.test(ext) ? 'webp' : 'jpeg';
  let side = PHOTO_SIDE, out = null;
  for (let tries = 0; tries < 3; tries++, side = Math.round(side * 0.75)) {
    const base = () => sharp(buf, { failOn: 'none' }).rotate().resize({ width: side, height: side, fit: 'inside', withoutEnlargement: true });
    if (kind === 'png') {
      out = await base().png({ compressionLevel: 9, palette: true }).toBuffer();
    } else {
      for (const q of [82, 74, 66, 58]) {
        out = kind === 'webp' ? await base().webp({ quality: q }).toBuffer() : await base().jpeg({ quality: q, mozjpeg: true }).toBuffer();
        if (out.length <= MAX_PHOTO) break;
      }
    }
    if (out.length <= MAX_PHOTO) break;
  }
  const meta = await sharp(out).metadata();
  if (meta.exif || meta.xmp || meta.iptc) throw new Error('metadata survived');   // never publish it
  return out;
}

async function hasMetadata(buf) {
  try { const m = await sharp(buf).metadata(); return Boolean(m.exif || m.xmp || m.iptc); } catch (e) { return true; }
}

// Photos already in the live archive are reused from there (they were cleaned when first
// archived, and storage paths never change), so each photo is read from Supabase only once.
async function savePhotos(paths, live) {
  const liveSet = new Set(live && Array.isArray(live.media) ? live.media : []);
  const saved = [];
  let fromLive = 0, fromSupabase = 0, missing = 0;
  for (const p of paths) {
    const to = path.join(ARCHIVE, 'media', p);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    let buf = null;
    if (liveSet.has(p)) {
      try {
        const got = await download(`${LIVE_URL}/archive/media/${p}`);
        if (!(await hasMetadata(got))) { buf = got; fromLive++; }
      } catch (e) { /* fetch it from Supabase below */ }
    }
    if (!buf) {
      try {
        const raw = await download(`${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${p}`);
        buf = await cleanPhoto(raw, path.extname(p));
        fromSupabase++;
      } catch (e) {
        missing++;
        warn(`Photo not archived (${e.message}): ${p}`);
        continue;
      }
    }
    fs.writeFileSync(to, buf);
    saved.push(p);
  }
  log(`Photos: ${saved.length} archived (${fromLive} reused from the live archive, ${fromSupabase} new), ${missing} missing.`);
  return saved;
}

// ---------- 4. fallback: publish the live archive again ----------

async function keepLiveArchive(why) {
  warn(`Supabase couldn't be read (${why}). Publishing the archive that is live now instead of an empty one.`);
  const live = await liveArchive();
  if (!live) { warn('There is no live archive yet either, so this run publishes the site without one.'); return; }
  fs.mkdirSync(ARCHIVE, { recursive: true });
  const files = live.years.map((y) => `${y}.json`).concat(['tabs.json']);
  for (const f of files) {
    try { fs.writeFileSync(path.join(ARCHIVE, f), await download(`${LIVE_URL}/archive/${f}`)); }
    catch (e) { warn(`Couldn't copy archive/${f} from the live site: ${e.message}`); }
  }
  const media = [];
  for (const p of (live.media || []).filter((p) => PATH_OK.test(p))) {
    try {
      const buf = await download(`${LIVE_URL}/archive/media/${p}`);
      if (await hasMetadata(buf)) continue;
      const to = path.join(ARCHIVE, 'media', p);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.writeFileSync(to, buf);
      media.push(p);
    } catch (e) { warn(`Couldn't copy a live photo: ${p}`); }
  }
  fs.writeFileSync(path.join(ARCHIVE, 'meta.json'), JSON.stringify({ ...live, media, republished_at: new Date().toISOString(), source: 'previous archive' }, null, 1));
  log(`Kept the live archive from ${live.saved_at} (${live.entries} entries, ${media.length} photos).`);
}

// ---------- build ----------

function photoPaths(entries, tabs) {
  const set = new Set();
  for (const e of entries) for (const m of (Array.isArray(e.media) ? e.media : [])) if (typeof m === 'string' && PATH_OK.test(m)) set.add(m);
  for (const b of tabs.books || []) if (PATH_OK.test(b.cover || '')) set.add(b.cover);
  for (const h of tabs.hobbies || []) if (PATH_OK.test(h.photo || '')) set.add(h.photo);
  for (const f of tabs.favorites || []) if (PATH_OK.test(f.photo || '')) set.add(f.photo);
  return [...set].sort();
}

function folderSize(dir) {
  let total = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    total += e.isDirectory() ? folderSize(p) : fs.statSync(p).size;
  }
  return total;
}

async function main() {
  copySite();
  const keyProblem = checkKey();
  const live = await liveArchive();

  let entries;
  if (keyProblem) {
    await keepLiveArchive(keyProblem);
  } else {
    try {
      entries = await readTable('entries', ENTRY_COLUMNS, '&private=eq.false');
    } catch (e) {
      await keepLiveArchive(e.message);
    }
  }

  if (entries) {
    // second check: anything not explicitly public is dropped
    const before = entries.length;
    entries = entries.filter((e) => e && e.private === false && /^\d{4}-\d{2}-\d{2}$/.test(e.entry_date || ''));
    if (entries.length !== before) warn(`${before - entries.length} rows were not public and were left out.`);

    if (entries.length === 0 && live && live.entries > 0) {
      // A sudden empty diary is far more likely a broken key or rule than a real wipe.
      await keepLiveArchive('Supabase returned 0 public entries but the live archive has ' + live.entries);
    } else {
      const tabs = {};
      for (const [table, cols] of Object.entries(TABS)) {
        try { tabs[table] = await readTable(table, cols); }
        catch (e) { tabs[table] = []; warn(`Couldn't read ${table} (${e.message}); it is empty in this archive.`); }
      }
      entries.sort((a, b) => (a.entry_date < b.entry_date ? 1 : a.entry_date > b.entry_date ? -1 : (a.created_at < b.created_at ? 1 : -1)));
      const years = {};
      for (const e of entries) (years[e.entry_date.slice(0, 4)] ||= []).push(e);

      fs.mkdirSync(ARCHIVE, { recursive: true });
      for (const [y, list] of Object.entries(years)) {
        fs.writeFileSync(path.join(ARCHIVE, `${y}.json`), JSON.stringify({ year: Number(y), entries: list }));
      }
      fs.writeFileSync(path.join(ARCHIVE, 'tabs.json'), JSON.stringify(tabs));
      const media = await savePhotos(photoPaths(entries, tabs), live);
      const now = new Date();
      const meta = {
        version: 1,
        saved_at: now.toISOString(),
        saved_day: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(now),
        entries: entries.length,
        years: Object.keys(years).map(Number).sort((a, b) => b - a),
        counts: Object.fromEntries(Object.entries(tabs).map(([k, v]) => [k, v.length])),
        media,
        source: 'supabase'
      };
      fs.writeFileSync(path.join(ARCHIVE, 'meta.json'), JSON.stringify(meta, null, 1));
      log(`Archive: ${entries.length} public entries in ${meta.years.length} year file(s), ${media.length} photos.`);
    }
  }

  const size = folderSize(OUT);
  const mb = (size / 1048576).toFixed(1);
  log(`Site + archive size: ${mb} MB (GitHub Pages limit: 1 GB).`);
  if (size >= LIMIT_SIZE) warn(`The site is ${mb} MB, over GitHub Pages' 1 GB limit. The deploy will probably fail; old photos need to move elsewhere.`);
  else if (size >= WARN_SIZE) warn(`The site is ${mb} MB, getting close to GitHub Pages' 1 GB limit.`);
}

main().catch((e) => fail(e && e.stack ? e.stack : String(e)));
