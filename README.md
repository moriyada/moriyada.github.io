# Moriyada

*Read it backward by syllable: mo-ri-ya-da → da-ya-ri mo, "your diary."*

A public diary and life archive of Deffoh. Anyone can read it. Only Deffoh can post.

Plain HTML, CSS and JavaScript (no build step), hosted on GitHub Pages, with
Supabase for the database, photo storage and login.

```
/index.html   home page
/html/        other pages (archive, day, hobbies, post, random, about, ...)
/css/         stylesheets
/js/          scripts, one file per feature
/sql/         database setup to paste into Supabase
```

## One-time setup

You only do this once. Takes about 10 minutes.

### 1. Make the Supabase project

1. Go to <https://supabase.com>, sign in, click **New project**. Free tier is fine.
   Pick the **Southeast Asia (Singapore)** region so it's fast from Manila.
2. Wait for it to finish setting up (a minute or two).

### 2. Create the database

1. In Supabase, open **SQL Editor** (left sidebar) and click **New query**.
2. Open [`sql/setup.sql`](sql/setup.sql) from this repo, copy everything, paste it in, click **Run**.
3. You should see "Success. No rows returned". If you ever change that file
   later, you can run the whole thing again. It won't delete your entries.

### 2b. Run the numbered SQL files too

After `setup.sql`, run each numbered file in `sql/` once, in order (`002_speed.sql`,
`003_...`, ...), the same way. Each is safe to run again. New ones get added over time;
the pull request that adds one will say so.

### 3. Create your login and lock the door

1. **Authentication > Users > Add user > Create new user.** Use your email and a
   strong password. Tick "Auto Confirm User".
2. **Authentication > Sign In / Providers** (may be called "Providers" or
   "Settings"): turn **off** "Allow new users to sign up". Now nobody else can
   make an account.
3. Back in **SQL Editor**, run this one line with your email in it:

   ```sql
   insert into public.site_owner (user_id) select id from auth.users where email = 'YOUR-EMAIL-HERE' on conflict do nothing;
   ```

   This is what tells the database "this account is Deffoh". Even if sign-ups
   were ever turned back on by accident, other accounts still can't post,
   edit or delete, because the rules check this list, not just "is logged in".

### 4. Connect the website to Supabase

1. In Supabase go to **Project Settings > API** (or **Data API**).
2. Copy the **Project URL** and the **anon public** key.
3. Paste them into [`js/config.js`](js/config.js).

The anon key is meant to be public. It can only do what the database rules
allow, which is reading non-private entries. **Never** put the
`service_role` key anywhere in this repo: that one skips all the rules.

### 5. Turn on GitHub Pages

Repo **Settings > Pages**: source "Deploy from a branch", branch `main`, folder `/ (root)`.

## Posting

Go to the small **post** link at the bottom of the home page (or `/html/post.html`)
and log in. Pick a type and the form changes to match. A few things to know:

- **Photos** are shrunk in your browser to about 300 KB before uploading, so
  phone photos are fine. This also removes the hidden location data phones put in photos.
- **Tags** are lowercased, so `Running` and `running` are the same hobby.
- **Songs**: start typing in "search a song" and pick a result; it fills in the title,
  artist and cover. You can still type everything by hand.
- **Weather**: the first time you open the posting page each day, it saves Manila's
  weather for that day; it shows on that day's page.
- **Favorites**: managed in the Favorites box near the bottom of the posting page.
- **Recent posts** at the bottom let you edit or delete. Deleting an entry
  also deletes its photos.
- Staying logged in on a device also shows your private entries on the home page.
  Log out on shared computers.

## Why the security works

Anyone can read the JavaScript on a website, so a password check in JS would
be useless. Instead the rules live inside the database (Supabase "Row Level
Security"). Every request is checked there:

| Who | Can do |
| --- | --- |
| Anyone | read entries that aren't private, read weather, bump the visitor counter |
| Deffoh (logged in) | everything: read private entries, post, edit, delete, upload |

**"I can see a key when I click Inspect."** That's the anon key in
`js/config.js`, and it's supposed to be public: every Supabase website has
one in its code. It works like a building's street address. It tells the
browser where the database is, but the locks (the rules above) decide what
it may do, which is only "read public entries". The key that must stay
secret is the `service_role` key (or a key starting with `sb_secret_`).
It is not in this repo and never should be.

Other protections built in:

- **2-step login** (turn it on from the posting page). Once on, the database
  itself refuses any change from a login that skipped the 6-digit code, so a
  stolen password alone is useless.
- **Wrong-password lockout**: 3 wrong tries lock login on that device for
  15 minutes, then 30 min, 1 h, ... up to 8 h. Someone determined can get
  around this one by clearing their browser data, so the server-side limits
  below are what really stop password guessing.
- **Content Security Policy** on every page: the browser only runs code
  from this site and only talks to Supabase, Open-Meteo and iTunes. Even if
  someone slipped code into an entry, it would not run (and entries are
  always shown as plain text anyway).
- **No outside code**: the Supabase library is kept in `js/vendor/`
  instead of loaded from a CDN, so no other server can change what runs here.
- The posting page refuses to work inside another site's frame.
- Uploads are limited to 5 MB and to JPEG/PNG/WebP/GIF/audio. Entries have
  size limits too.

Photos go in a storage bucket called `media`. A photo can be opened by anyone
who has its exact link, but nobody else can list, upload or delete files, and
file names are random so links can't be guessed. That means a photo on a
private entry is hidden, but not locked: don't share its link.

### Security checklist for the Supabase dashboard

These settings live in Supabase, not in this code, so only you can change them.

1. **Re-run `sql/setup.sql`** whenever it changes (it's safe to re-run).
2. **Authentication > Sign In / Providers**: "Allow new users to sign up" is
   **off**. "Allow anonymous sign-ins" is **off**. Only Email is enabled.
3. **Authentication > Rate Limits**: lower "sign-ups and sign-ins" to about
   **10 per 5 minutes**, and "token verifications" (2-step codes) to about
   **10 per 5 minutes**. This is the real anti-bombing limit: it's enforced
   on Supabase's servers per internet connection, and nobody can switch it
   off from a browser.
4. **Authentication > URL Configuration**: set Site URL to
   `https://moriyada.github.io`.
5. **Use a long password** you don't use anywhere else (a 4-5 word phrase
   is great), then **turn on 2-step login** from the posting page.
6. **Advisors > Security Advisor**: click "Rerun linter". It should show no
   errors. If it shows something, send it to Claude.
7. Never paste the `service_role` / `sb_secret_` key into this repo, a chat,
   or a screenshot. If it ever leaks, go to **Project Settings > API Keys**
   and roll (replace) it.

### Lost your phone (2-step login)

In Supabase go to **Authentication > Users**, open your user, and delete
the authenticator factor. Then log in with just your password and set
2-step login up again on your new phone.

## Tabs with their own things

Books, quotes, goals, hobbies and favorites are **not daily posts**. Each has its own table
and is added, edited and deleted on its own tab, in a "manage" box only you see while
logged in. They never show up in the daily feed.

| tab | table | fields |
| --- | --- | --- |
| bookshelf | `books` | title, author, cover photo, status (reading / finished), started, finished on, my thoughts |
| quotes | `quotes` | the line, who said it, saved on |
| goals | `goals` | title, steps (a checklist you can tick on the page), how I feel right now, status (working on it / done / dropped), started, done or dropped on |
| hobbies | `hobbies` | name, photo, why I love it, since when |
| favorites | `favorite_categories`, `favorites` | see the favorites page |

## Entry fields

Every post is one row in the `entries` table. The common columns are
`entry_date`, `type`, `tags`, `media`, `private`. The type-specific stuff goes
in `data`:

| type | data fields |
| --- | --- |
| thought | `text` |
| learned | `topic`, `wikipedia_url`, `own_words`, `voice_note` (storage path, optional), `rabbit_hole` (list of `{title, url}`, optional) |
| fasting | `start`, `end`, `note` (old entries only: fasting was taken off the form; write it as a thought) |
| run | `distance_km`, `minutes`, `note` |
| photo | `caption` (photos themselves go in `media`) |
| song | `title`, `artist`, `album_art` (image link), `spotify_url` (optional) |
| body | `weight_kg`, `height_cm` (either or both) |
| food | `text` (photos go in `media`) |
| mood | `mood` (a word), `note` |

`media` holds storage paths (like `2026/10/08/x7k2.jpg`) or YouTube links.
Any field can be left out; the site just skips what isn't there.

## Talaarawan setup (the anonymous public diary at `/talaarawan/`)

Talaarawan has its own tables and pages; nothing here changes the personal diary. Do these
once, in this order. Everything is free tier. **No secret key ever goes in this repo**: the
Turnstile secret and the OpenAI key live only in Supabase's Edge Function secrets.

### 1. Database
Supabase > **SQL Editor** > New query > paste all of [`sql/006_dayari.sql`](sql/006_dayari.sql) > **Run**.

### 2. Sign-up guard (do this BEFORE step 3)
Supabase > **Authentication** > **Hooks** (may be under Authentication > "Auth Hooks") >
**Add hook** > **Before User Created** > type **Postgres** > schema `public` > function
`dayari_before_user_created` > **Create/Enable**.
This refuses every new account that has an email or phone, so step 3 can't be used to make
real accounts. Only anonymous ones get through. (If you ever need to add a real user
yourself, switch this hook off for a minute, add them, switch it back on.)

### 3. Turn on anonymous accounts
Supabase > **Authentication** > **Sign In / Providers** (or "Providers"/"Settings"):
1. Turn **on** "Allow new users to sign up" (anonymous sign-in doesn't work without it; the
   hook from step 2 keeps it safe; your owner rules still only trust `site_owner`).
2. Turn **on** "Allow anonymous sign-ins". Save.
3. Leave **Attack Protection > CAPTCHA** OFF. (It would also ask for a captcha on your own
   login; Talaarawan checks Turnstile in its Edge Function instead.)
Optional: Authentication > **Rate Limits** > anonymous sign-ins is 30 per hour per network by
default. Raise it if a whole school on one wifi starts using it.

### 4. Cloudflare Turnstile (the invisible "are you human" check)
1. Make a free account at <https://dash.cloudflare.com>, open **Turnstile** > **Add widget**.
2. Name: `Talaarawan`. Hostnames: `moriyada.github.io` (add `localhost` too if you test on
   your computer). Widget mode: **Invisible**. Create.
3. Copy the **Site Key** into `dayariTurnstileSiteKey` in [`js/config.js`](js/config.js)
   (it's public, like the anon key). Keep the **Secret Key** for step 6.

### 5. OpenAI moderation key (optional, free)
<https://platform.openai.com> > **API keys** > **Create new secret key** (if it offers
"Restricted", allow only the Moderations endpoint). The moderation endpoint costs nothing.
Skip this and Talaarawan uses its built-in keyword filter instead (and holds borderline posts
for your review).

### 6. Edge Function secrets
Supabase > **Edge Functions** > **Secrets** (or Project Settings > Edge Functions) > add:

| Name | Value |
| --- | --- |
| `TURNSTILE_SECRET_KEY` | the Turnstile **Secret Key** from step 4 (required; without it posting stays closed) |
| `OPENAI_API_KEY` | the key from step 5 (optional) |
| `DAYARI_IP_SALT` | any long random text, e.g. 40 random letters and numbers from a password generator (recommended) |

Don't add the others you see listed (`SUPABASE_URL` etc.); Supabase provides those itself.

### 7. Deploy the Edge Function
1. Supabase > **Edge Functions** > **Deploy a new function** > **Via Editor**.
2. Name it exactly `dayari`.
3. Delete the sample code, paste ALL of
   [`supabase/functions/dayari/index.ts`](supabase/functions/dayari/index.ts), click **Deploy**.
4. Open the function > **Details** (or Settings) > turn **off** "Enforce JWT verification" /
   "Verify JWT" > Save. The function checks the login itself as its very first step, and this
   avoids the browser's pre-check being refused.
5. Whenever a pull request changes that file, paste it again the same way (Code tab > edit >
   Deploy).

### 8. Try it
Open `https://moriyada.github.io/talaarawan/` in a private window: pass the age check, post
something normal, try a phone number (refused kindly), try "gusto ko nang mamatay" (posted,
with the hotline note), report a post from a second private window, delete your own post.
Then log in on your posting page and open `https://moriyada.github.io/admin/`.
