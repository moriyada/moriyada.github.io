# Moriyada: notes for Claude

Moriyada is Deffoh's public diary and life archive: what he did each day (thoughts,
things learned, fasting, runs, photos, songs...). Anyone can read it. Only he can post.

**The name:** read it backward by syllable. mo-ri-ya-da becomes "da-ya-ri mo", which
means "your diary" (dayari mo). Hovering or tapping the site title shows "dayari mo" (an
easter egg in `js/ribbon.js`: CSS `::after` from `data-egg` on hover; on touch screens the
first tap shows it and the second tap follows the link). The site was called "Moridaya"
before the GitHub org and repo were renamed to `moriyada/moriyada.github.io`.
README.md has the setup steps and the entry field reference; this file has the rules.

## Working with Deffoh

- BS Economics student, not a developer. Explain steps plainly, casual tone is fine,
  be direct and give reasons. Say what *he* has to do (e.g. re-run SQL) clearly.
- Keep changes small and reviewable. Work on a branch, open a pull request, never push to `main`.
- Database changes go in a NEW numbered file (`sql/002_speed.sql`, `sql/003_...`), never edits
  to `setup.sql` or older files. Each file is idempotent (safe to re-run) and he pastes it into
  the Supabase SQL editor himself; always tell him which files to run, in order.
- When working unattended: don't stop to ask, pick the most reasonable option and list every
  decision in the PR description. One PR per group of work, push after each finished item.
- Claude can't reach his live Supabase from the sandbox. Test with Playwright against a
  mocked Supabase API (real supabase-js), and say plainly that live testing is his step.

## Stack and layout

- Plain HTML, CSS, JavaScript. No framework, no build step, no npm at runtime.
- GitHub Pages from `main` (repo `moriyada/moriyada.github.io`). Supabase (free tier) for
  database, storage (bucket `media`) and login.
- Folders by language: `/index.html`, `/html/` (other pages), `/css/style.css`, `/js/` (one
  file per feature), `/sql/setup.sql` (whole database; idempotent, safe to re-run), `404.html`.
- JS: classic scripts (not modules), ES5-style `var`/`function` plus async/await where it
  reads better. Everything shared hangs off `window.Moriyada` (`M`). All scripts are in
  `<head>` with `defer` (download in parallel, run in order after parsing), except
  `theme.js`, which runs immediately so the page never flashes the wrong theme. Order:
  vendor supabase -> config -> db -> render -> (lightbox, bento) -> ribbon -> page script.
- Fonts are self-hosted in `/fonts` (Latin-subset woff2, SIL OFL) with `@font-face` at the
  top of `style.css`; the two main ones are preloaded. No Google Fonts requests.
- Each page has `<link rel="preconnect">` to the Supabase project URL (hard-coded; update it
  if the project ever changes).
- `js/vendor/supabase-2.45.4.js` is the unmodified npm file (hash in `js/vendor/README.md`).
  Never load scripts from a CDN.

## Security rules (don't break these)

- Only the Project URL and anon key go in `js/config.js`. Never the `service_role` /
  `sb_secret_` key, anywhere.
- Permissions live in the database (RLS), never in JS. `public.is_owner()` = listed in
  `site_owner` AND (session is `aal2` OR no verified 2-step factor). Every write and every
  private read goes through it.
- Never insert user content as HTML. Build DOM with `M.el()` / `textContent`; links only via
  `M.link()` (http/https only). No `innerHTML`, no inline scripts, no inline `style=""`.
- Every page carries the same Content Security Policy `<meta>` (scripts/styles/fonts only
  from this site; network only to Supabase, Open-Meteo, iTunes; frames only YouTube-nocookie
  and Spotify; no workers; upgrade-insecure-requests). If a page needs a new outside host,
  add it to the CSP on every page and say why.
- No third-party scripts. The vendored Supabase library is loaded with Subresource Integrity
  (`integrity="sha384-..."`); if it's ever replaced, update the hash on every page (command in
  `js/vendor/README.md`).
- The database refuses bad data by itself (`sql/003_hardening.sql`): each type's required
  fields, text/number/link limits, valid media paths and tags, no future `entry_date`, and
  `created_at` set by the server (can't be faked). Keep the posting form's `need` rules and
  these database rules in sync when adding a type or field.
- `site_owner` and `site_stats` are unreachable from the API (RLS on, no rules, privileges
  revoked). Only `bump_visits()` / `get_visits()` touch the counter.
- Errors: every page part ends in data or a short message; unhandled errors are logged
  quietly (`js/db.js` safety nets), and leftover "loading..." text is replaced after 20 s.
- Keep-alive: `.github/workflows/keep-alive.yml` pings Supabase every 3 days with the public
  anon key read from `js/config.js` (no secrets, no third-party actions).
- Secrets audit (all files + full git history): only the anon key was ever committed. His
  email appears only in commit author info from GitHub-website commits (fix: GitHub >
  Settings > Emails > "Keep my email addresses private").
- Photos are `<button class="zoom">` around an `<img>`, never links to the storage file.
  Never show file names, storage paths or raw URLs in the UI. Link text without a title
  falls back to the Wikipedia title or the site name.
- Login lockout (3 wrong tries -> 15 min, doubling to 8 h) is a speed bump; Supabase rate
  limits + 2-step login are the real protection.
- Visitor counter: everyone adds 1 (not the owner), only the owner sees the number
  (`get_visits()` returns null otherwise).

## Loading: fast, and never hangs

- Two connections (`js/db.js`):
  - `M.db`: public, never reads or refreshes the saved login, so it can't hang because of
    it. Use it for everything public.
  - `M.authClient()`: the logged-in connection (posting page). `M.ownerClient()` returns it
    only when this browser has a saved login (`M.hasStoredSession()`), else null.
- Every request has a time limit: fetch is wrapped (10 s), `M.withTimeout()` for anything
  else. The supabase-js login lock waits at most 4 s, then takes the lock over (`steal`);
  by default it waits forever, which made logged-in browsers hang (frozen tab holding the
  lock, or a token refresh that never answered).
- Pages load in layers with `M.layered()`: cached copy (instant) -> public data -> owner's
  data (private entries) on top. Owner failures never blank the page; show a short note.
  Only public data is cached (`M.cache`, localStorage), never private entries.
- Fetch only the columns a page needs. Run independent requests in parallel.
- RLS policies call `(select public.is_owner())` so Postgres checks it once per query.

## Time: always Manila

- "Today" is always `M.manilaDate()` (Asia/Manila, UTC+8, no daylight saving), never the
  browser's timezone and never the UTC part of a timestamp.
- Match days by `entry_date`, never by `created_at`. Show times with `M.formatTime()`.
- Pages that show "today" call `M.reloadAtMidnight(today)`; at 12:00 AM Manila the home page
  rolls over (today's area empties) and the archive gains yesterday.
- The posting page's date follows Manila today until changed by hand, and is re-read at save.
- Test midnight logic with Playwright's fake clock at 11:59 PM and 12:01 AM Manila, with the
  browser in several timezones (Asia/Manila, UTC, America/Los_Angeles).

## Design

- Site name: **Moriyada** everywhere (titles, header, meta, code: `window.Moriyada`,
  `MORIYADA_CONFIG`, `moriyada-*` storage keys). The SQL files keep "Moridaya" in their
  header comments on purpose: never edit already-run SQL files (it would only raise "do I
  need to re-run this?"). theme.js still reads the old `moridaya-theme` key as a fallback.
- Site subtitle is "a public diary & archive" (no name), and subtitles are not italic.
- Old-internet look: white background, navy `#000080` headings and borders, default blue
  links `#0000ee`, purple visited. No gradients, no emoji, no modern "card" styling.
  Colors are CSS variables on `:root` with a dark set under `:root[data-theme="dark"]`.
- Dark mode: one sun/moon button at the top right, saved in localStorage (try/catch).
- Fonts are four variables: `--font-head`, `--font-body`, `--font-meta`, `--font-mono`.
  Current pairing is **2. Retro serif** (IM Fell English + Old Standard TT, self-hosted);
  Verdana for small meta text, Courier New for counters. `html/fonts.html` previews the three
  options. To switch: change the variables and the font preload `<link>`s on each page.
- Narrow centered column (max 860px), works on phones (16px side padding, things stack
  below 640px, no sideways scroll).
- Empty states are short lines in the site's voice, e.g. "Nothing yet today. A new page,
  waiting.", "No chapters yet.", "Nothing was written on this day."

## Pages

- **Home** (`index.html`): header (title, subtitle, last updated, Manila weather; top right
  dark-mode button and DAY counter), ribbon, one-line quote of the day, today's **bento
  grid**, then NOW and On this day side by side, footer (visitor counter for the owner, post
  link). No archive list or hobby list on the home page.
- **Bento grid** (`js/bento.js`), used on home and day pages:
  - 4 columns, `grid-auto-flow: dense`, no visible boxes (spacing + the small label line).
  - Sizes: S 1x1 = song, mood, body; M 2x1 = run, fasting, thought,
    food, other; L 2x2 = photo, learned, anything with a picture/video, any text over 280
    characters; XL 4x2 = when the day has exactly one entry.
  - Home must fit one screen: 3 rows whose height follows the window. Too much: shrink
    oldest text tiles first (L->M->S), pictures last, then keep the newest and add
    "+N more from today »" to the day page. Clipped text gets "more »" to `day.html#e-<id>`.
  - Day page: every entry, rows grow to fit (nothing clipped). Phones: one column.
- **Archive** (`html/archive.html`): every past day with entries, newest first, grouped by
  month, as chapters ("Ch. 0042 Thursday, October 8 · 3 entries"). Chapter number = days
  since the first entry + 1. Today joins at midnight.
- **Day** (`html/day.html?date=YYYY-MM-DD`): chapter, saved weather, entry count,
  previous/next day; handles impossible, future and empty dates.
- **Post** (`html/post.html`): login (+ optional 2-step), one form whose fields change by
  type, photo compression to ~300 KB JPEG (song covers ~600px/120 KB), edit/delete recent.
- **Ribbon** (`js/ribbon.js`): home, archive, favorites, hobbies, bookshelf, quotes, goals,
  places, about. **No brackets** (he disliked them): plain lowercase links, widely spaced
  (flex, 30px gap), no underlines, thin rules above and below; the current page is bold navy
  with a 2px underline, hover shows a soft underline. Pages not built yet have no
  `ready: true` flag: faded, not clickable, with a tiny "SOON" tag. When you build a page,
  set its flag in the same PR. Only places is still "soon". **Random day was dropped (he doesn't want it); don't build it.**
- **Favorites** (`html/favorites.html`, tables in `sql/004_favorites.sql`): editable
  categories (seeded: philosopher, chess player, FlipTop emcee, food, song, book, movie,
  place, emotion, word). A favorite = name, optional photo (600px/120 KB), one-line why,
  since date. The current one has empty `until`; `set_favorite()` closes the old one
  (until = new since) so history shows "previously: X, from A to B". Empty categories are
  hidden on the public page. Photos show as a fixed 96px square thumbnail (center-cropped,
  `object-fit: cover`, `flex: none` so long text can't squeeze it), like an Instagram grid;
  tapping opens the whole uncropped photo. **Favorites are not daily posts**: they're managed on the
  favorites page itself, in a "Manage favorites" box that only appears for the logged-in
  owner (`js/favorites-manage.js`, checks `is_owner()`). The posting page is for daily
  entries only and just links there. **Edit**: the owner gets [edit] buttons on the public
  list and in the manage box; editing fixes a favorite in place (name, why, since, until for
  past ones, photo replace/remove) without creating history. "Set a new favorite" is what
  moves the old one to "previously".
- **Bookshelf, quotes, goals, hobbies are their own things, NOT daily posts** (his rule:
  avoid redundancy; anything else on a daily post goes under "thought"). Each has its own
  table (`sql/005_tabs.sql`: `books`, `quotes`, `goals`, `hobbies`), is managed on its own tab
  in an owner-only "Manage ..." box, and never shows in the daily feed. The daily form has no
  reading/quote/goal types anymore; 005 moved the old ones into the tables.
  Shared engine: `js/collection.js` (`M.collection({...})`: fields, toRow/fromRow, render
  with ctx.owner/edit/save); each page script only describes its form and its own layout:
  - **Bookshelf**: title, author, cover (2:3, 92x138), reading/finished, started/finished,
    thoughts (in a `<details>`). Covers on a shelf grid, "Reading now" then "Finished";
    no cover = a navy spine with the title.
  - **Quotes**: the line + who said it, no explanation. Big centered lines, newest first.
  - **Goals**: title, steps (jsonb `[{text, done}]`, a checklist; the owner ticks steps right
    on the page), how I feel right now (+ updated date), status working on it/done/dropped.
    Text progress bar (▰▱). Sections by status.
  - **Hobbies**: name, photo (square), why I love it, since. Card grid. Tags on daily posts
    are now plain labels (no hobby links).
  - The home NOW box reads "reading" from `books` and "goal" from `goals`; quote of the day
    comes from `quotes`.
  **About**: static placeholder text he fills in himself.
- Phones (< 640px): header, title, ribbon, day counter and theme button are centered;
  entry text stays left-aligned.

- **Song search** (`js/song-search.js`): on song entries, type to search the iTunes Search
  API (`media=music&entity=song&country=PH`, no key, debounced 350 ms, newest search wins);
  a pick fills title, artist and 600px album art (`/600x600bb.`). If iTunes can't be reached
  the form says so and still works by hand. The CSP allows `itunes.apple.com` for this.
- **Daily weather** (`M.saveTodayWeather` in `js/weather.js`): the owner's posting page
  saves today's Open-Meteo forecast (high, low, condition) into `day_weather` once per day
  if it's missing (`upsert ... ignoreDuplicates`). Only the owner writes weather, so
  visitors can't fake it. The day page shows "Manila: high 32°C, light rain". Days he
  doesn't open the posting page get no weather (they have no entries either).
- **Favicon**: `favicon.svg` (navy square, white serif M) + `favicon.ico`, linked on every
  page. **404**: `404.html`, old-web "Not Found ... Server at ... Port 443" style,
  absolute paths (GitHub Pages serves it for any missing URL).

## Data

- One table `entries` for daily posts (see README "Entry fields"), plus `day_weather`,
  `site_owner`, `site_stats`, the favorites tables (004) and the tab tables (005: `books`,
  `quotes`, `goals`, `hobbies`). Helper RPCs: `entry_dates()`, `tag_counts()`,
  `on_this_day(d)`, `bump_visits()`, `get_visits()`.
- `media` holds storage paths (`YYYY/MM/DD/<random>.jpg`) or YouTube links. Videos are
  YouTube links only (embedded via youtube-nocookie).

## Dayari Mo (the anonymous public diary, `/dayari/`)

Asked 2026-10-11: open Moriyada to the public as "Dayari Mo", an anonymous daily diary.
**The personal diary stays exactly as it is**: separate pages, tables, scripts and styles.
Built in phases A-F (spec in the project thread), **one PR per phase, never merged by
Claude; wait for his review before starting the next phase.**

- **Free tier only, no paid services. Public posts are text-only.**
- **Pages:** `/dayari/index.html` (write + read), `/dayari/privacy.html` (Data Privacy Act
  notice, plain language), `/dayari/rules.html` (house rules / terms), `/admin/index.html`
  (owner only). Ribbon item "dayari mo" (no brackets, like every ribbon item). Scripts:
  `js/dayari.js` (shared: anonymous account, Turnstile, calling the Edge Function, texts),
  `js/dayari-home.js`, `js/dayari-admin.js`. Styles: `css/dayari.css` on top of `style.css`.
- **Look:** keeps the Moriyada identity (navy, IM Fell English headings, same ribbon and
  theme button) but is more modern and accessible: system sans-serif body at 18px, 1.6 line
  height, 44px+ tap targets, rounded buttons, visible focus rings, light + dark. The
  "no modern card styling" rule is for the personal diary only.
- **All interface text lives in one object (`T` in `js/dayari.js`)** so the Tagalog/English
  toggle (phase E) only has to add a second set.

### Accounts
- Supabase **anonymous sign-ins**. The account is created lazily: only when someone posts,
  reports or deletes, never just for reading (keeps the free-tier MAU count down).
- The anonymous session is stored under its own key (`moriyada-dayari-auth`), never the
  owner's `sb-<ref>-auth-token`, so it can't overwrite his login or make
  `M.hasStoredSession()` true for visitors.
- The private ID (`author_id`) is **never readable through the API** (column-level grants),
  never shown anywhere. Admin shows only a 6-character tag (`left(md5(id), 6)`).
- Anonymous sign-in needs "Allow new users to sign up" ON. The Auth hook
  `dayari_before_user_created` (sql/006) then refuses any non-anonymous sign-up, so nobody
  can make an email account. Supabase Auth's own CAPTCHA setting stays OFF (it would also
  demand a CAPTCHA on his own password login); Turnstile is checked in the Edge Function.

### Writes: only through the `dayari` Edge Function
- RLS + revoked privileges: **nobody** (visitor, anonymous account, even the owner) can
  insert/update/delete any `dayari_*` table through the API. Visitors can read published
  posts, 4 columns only (`id, entry_date, body, created_at`; `select *` fails on purpose).
- One function, `supabase/functions/dayari/index.ts`, one file, no imports (so he can paste
  it into the dashboard editor), actions `post`, `report`, `delete`. It uses the service key
  (provided by Supabase inside functions, never in the repo) to call service-only SQL
  functions: `dayari_gate` (bans + rate limits), `dayari_insert_post`, `dayari_add_report`,
  `dayari_delete_own`, `dayari_log_rejection`.
- Post pipeline, in order: login check (must be an anonymous account) -> age 13+ and house
  rules accepted -> length 1-2000 -> Turnstile -> ban + rate limit (per account and per
  network) -> personal info -> crisis words -> moderation -> save.
- **Rate limits** (sql/006 `dayari_gate`): posts 6/hour and 15/day per account, 20/hour and
  60/day per network; reports 10/30 and 20/60; deletes 30/100 and 60/200. Phase B adds the
  one-entry-per-day rule on top.
- **Network address**: only a salted SHA-256 hash (`DAYARI_IP_SALT` secret, falls back to
  the service key), used for rate limits, report de-duplication and 30-day network bans.
  Wiped from posts after 30 days; rate counters deleted after 2 days.
- **Personal info** blocked (kind message, nothing saved): PH/intl phone numbers (hotline
  numbers allowed), emails (also "name at gmail dot com"), street addresses (house number +
  street, Blk/Lot, Purok, unit), social profile links/handles, and a full name in the same
  post as a school or workplace. Heuristic; reports + review catch the rest.
- **Moderation**: OpenAI `omni-moderation-latest` (free) when `OPENAI_API_KEY` is set:
  sexual/minors, threats (hate/threatening, harassment/threatening, violence >= 0.5) ->
  rejected; other flagged hate/harassment/sexual/violence/illicit -> held for review;
  unflagged but score >= 0.4 in those -> held. Missing key or OpenAI down -> built-in keyword
  filter (English + Filipino): clear threats/slurs rejected, borderline held, posts reviewed
  by the fallback get the review reason `fallback` only when held.
- **Crisis** (suicide/self-harm words in English/Filipino, or OpenAI self-harm categories):
  **never blocked**. Published normally, writer sees a gentle note with NCMH 1553 /
  0917-899-8727, post flagged `crisis` in the admin queue. Exception: OpenAI
  `self-harm/instructions` is held for review (writer still gets the note).
- **Reports**: one per account and one per network per post; 3 reports -> hidden + queued.
  Approving clears the reports.
- **Rejected posts are never stored**; only a reason + day count (`dayari_rejections`).
- **Turnstile** is the one outside script on the site, loaded only on `/dayari/` pages, only
  when someone is about to write/report/delete (CSP adds `https://challenges.cloudflare.com`
  to script-src and frame-src on dayari pages only). No SRI possible (Cloudflare updates it).
  Missing secret on the server = posting closed (fails safe), never "skip the check".

### Admin (`/admin/`)
- Uses the owner's existing login from the posting page (`M.authClient()`); no new login.
  Owner-only SQL functions (`dayari_admin_*`) check `is_owner()` (so 2-step applies).
- Views: needs review, held, reported, crisis, hidden, recent. Actions: approve, hide,
  delete, "seen" (leave as is, out of the queue), ban writer (account forever + network 30
  days + hides all their posts), lift ban. Stats: today's posts/writers, queue sizes,
  reports, rejections by reason.

### Tests
- `bash tests/dayari/run-sql-tests.sh`: a throwaway local Postgres with a small Supabase
  stand-in (`tests/dayari/supabase-stub.sql`), loads every `sql/` file twice, then checks
  every policy (`tests/dayari/sql-tests.sql`).
- `node --test tests/dayari/`: the Edge Function's checks and pipeline with fake
  Supabase/Turnstile/OpenAI, and the pages in Playwright against a mocked API.

## Build order / what's left

Done: 1 database, 2 home, 3 posting, 4 archive + day, favorites, hobbies, quotes,
bookshelf, goals, about, song search, daily weather, favicon, 404. Random day: dropped.
Left: [places] (still "soon"). Dayari Mo: phase A in progress (see above).
Later, not v1: weight graph, year-in-pixels mood grid, "changed my mind" log, letter to
future self, RSS, search, places map.
