// Talaarawan pages in a real browser (Playwright + Chromium), with Supabase and Cloudflare faked.
//   node --test "tests/dayari/*.test.mjs"
// The /functions/v1/dayari calls go to the REAL Edge Function code (supabase/functions/dayari),
// wired to a small in-memory database, so page + pipeline are tested together.
// Skips itself if Playwright isn't installed.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import * as F from '../../supabase/functions/dayari/index.ts';

const require = createRequire(import.meta.url);
let pw = null;
try { pw = require('playwright'); } catch (e) {
  try { pw = require(path.join(execSync('npm root -g').toString().trim(), 'playwright')); } catch (e2) { pw = null; }
}

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const SB = 'https://uxjsqgeynszqhkzzwvhd.supabase.co';
const ANON_ID = 'aaaaaaaa-1111-2222-3333-444444444444';
const OWNER_ID = '99999999-0000-0000-0000-000000000009';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

let server, base, browser;

before(async () => {
  if (!pw) return;
  server = http.createServer((req, res) => {
    const file = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
  browser = await pw.chromium.launch();
});
after(async () => { if (browser) await browser.close(); if (server) server.close(); });

// ---------- a fake Supabase ----------

function fakeBackend() {
  const db = {
    posts: [
      { id: 1, author_id: 'someone-else', body: 'Unang araw ko dito. Masaya.', status: 'published', created_at: '2026-10-11T01:00:00Z', entry_date: '2026-10-11' },
      { id: 2, author_id: 'someone-else', body: 'Held post, should not show', status: 'held', created_at: '2026-10-11T02:00:00Z', entry_date: '2026-10-11' }
    ],
    reports: [],
    nextId: 10,
    adminCalls: []
  };
  const rpc = {
    dayari_gate: () => 'ok',
    dayari_log_rejection: () => null,
    dayari_insert_post: (a) => {
      const id = db.nextId++;
      db.posts.push({ id, author_id: a.p_user, body: a.p_body, status: a.p_status, crisis: a.p_crisis, created_at: new Date().toISOString(), entry_date: '2026-10-11' });
      return id;
    },
    dayari_add_report: (a) => { db.reports.push(a); return 'reported'; },
    dayari_delete_own: (a) => {
      const i = db.posts.findIndex((p) => p.id === a.p_post && p.author_id === a.p_user);
      if (i < 0) return false;
      db.posts.splice(i, 1);
      return true;
    }
  };
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const deps = {
    env: (k) => ({ SUPABASE_URL: SB, SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'eyJsvc', TURNSTILE_SECRET_KEY: 'ts' })[k],
    fetch: async (url, init = {}) => {
      url = String(url);
      if (url.endsWith('/auth/v1/user')) {
        return new Headers(init.headers).get('authorization') === 'Bearer tok-anon' ? json(200, { id: ANON_ID, is_anonymous: true }) : json(401, {});
      }
      if (url.includes('turnstile')) return json(200, { success: new URLSearchParams(String(init.body)).get('response') === 'ts-ok' });
      const name = url.split('/rpc/')[1];
      return json(200, rpc[name](JSON.parse(init.body)));
    }
  };
  return { db, deps };
}

async function newPage({ owner = false, mobile = false, dark = false } = {}) {
  const ctx = await browser.newContext({
    viewport: mobile ? { width: 375, height: 740 } : { width: 1200, height: 900 },
    colorScheme: dark ? 'dark' : 'light'
  });
  const page = await ctx.newPage();
  const back = fakeBackend();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });

  if (owner) {
    await page.addInitScript(([key, id]) => {
      localStorage.setItem(key, JSON.stringify({
        access_token: 'tok-owner', refresh_token: 'r', token_type: 'bearer', expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id, aud: 'authenticated', role: 'authenticated' }
      }));
    }, ['sb-uxjsqgeynszqhkzzwvhd-auth-token', OWNER_ID]);
  }
  // The Turnstile site key (public) is filled in for the test.
  await page.route('**/js/config.js', async (route) => {
    const body = fs.readFileSync(path.join(ROOT, 'js/config.js'), 'utf8').replace("dayariTurnstileSiteKey: ''", "dayariTurnstileSiteKey: '1x00000000000000000000AA'");
    await route.fulfill({ contentType: 'text/javascript', body });
  });
  // Fake Turnstile: always passes, invisibly.
  await page.route('https://challenges.cloudflare.com/**', (route) => route.fulfill({
    contentType: 'text/javascript',
    body: 'window.turnstile = { render: function (box, o) { setTimeout(function () { o.callback("ts-ok"); }, 10); return "w"; }, remove: function () {} };'
  }));
  await page.route(SB + '/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const auth = req.headers()['authorization'] || '';
    const ok = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body), headers: { 'Access-Control-Allow-Origin': '*' } });
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } });
    if (url.pathname === '/auth/v1/signup') {
      return ok({ access_token: 'tok-anon', refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: ANON_ID, aud: 'authenticated', role: 'authenticated', is_anonymous: true } });
    }
    if (url.pathname === '/rest/v1/dayari_posts') {
      const lt = url.searchParams.get('id');
      let rows = back.db.posts.filter((p) => p.status === 'published').sort((a, b) => b.id - a.id);
      if (lt) rows = rows.filter((p) => p.id < Number(lt.replace('lt.', '')));
      return ok(rows.map(({ id, entry_date, body, created_at }) => ({ id, entry_date, body, created_at })));
    }
    if (url.pathname === '/rest/v1/rpc/dayari_my_posts') {
      const me = auth === 'Bearer tok-anon' ? ANON_ID : null;
      return ok(back.db.posts.filter((p) => p.author_id === me).map(({ id, entry_date, body, status, created_at }) => ({ id, entry_date, body, status, created_at })));
    }
    if (url.pathname.startsWith('/rest/v1/rpc/dayari_admin_')) {
      const name = url.pathname.split('/').pop();
      const args = req.postData() ? JSON.parse(req.postData()) : {};
      back.db.adminCalls.push({ name, args });
      if (auth !== 'Bearer tok-owner') return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ code: '42501', message: 'owner only' }) });
      if (name === 'dayari_admin_stats') return ok({ posts_today: 3, writers_today: 2, needs_review: 1, held: 1, hidden: 0, crisis_today: 1, reports_today: 0, published_total: 1, active_bans: 0, rejected_today: { pii_phone: 2 }, rejected_7_days: 4 });
      if (name === 'dayari_admin_posts') return ok([{ id: 2, entry_date: '2026-10-11', body: 'Held post, should not show', status: 'held', crisis: true, needs_review: true, review_reasons: ['held', 'crisis'], report_count: 0, report_reasons: [], moderation: { source: 'openai', categories: ['harassment'] }, writer: '3f9a1c', created_at: '2026-10-11T02:00:00Z' }]);
      if (name === 'dayari_admin_bans') return ok([]);
      if (name === 'dayari_admin_act') return ok('ok');
      return ok(null);
    }
    if (url.pathname === '/functions/v1/dayari') {
      const res = await F.handle(new Request(req.url(), { method: 'POST', headers: { ...req.headers(), origin: base, 'x-forwarded-for': '198.51.100.4' }, body: req.postData() }), back.deps);
      return route.fulfill({ status: res.status, contentType: 'application/json', body: await res.text(), headers: { 'Access-Control-Allow-Origin': '*' } });
    }
    return route.fulfill({ status: 404, body: '{}' });
  });
  return { page, back, errors, ctx };
}

async function passGate(page) {
  await page.check('#gate-age');
  await page.check('#gate-rules');
  await page.click('#gate-ok');
}

// ---------- tests ----------

test('feed shows only published posts, and never any private ID', { skip: !pw }, async () => {
  const { page, errors, ctx } = await newPage();
  await page.goto(base + '/talaarawan/index.html');
  await page.waitForSelector('#feed-list .dy-post');
  const text = await page.textContent('#feed-list');
  assert.match(text, /Unang araw ko dito/);
  assert.doesNotMatch(text, /Held post/);
  const html = await page.content();
  assert.ok(!html.includes('someone-else') && !html.includes(ANON_ID));
  assert.equal(await page.isVisible('#mine'), false, 'no "your posts" for a new visitor');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('just reading never creates an anonymous account', { skip: !pw }, async () => {
  const { page, ctx } = await newPage();
  const signups = [];
  page.on('request', (r) => { if (r.url().includes('/auth/v1/signup')) signups.push(r.url()); });
  await page.goto(base + '/talaarawan/index.html');
  await page.waitForSelector('#feed-list .dy-post');
  assert.equal(signups.length, 0);
  await ctx.close();
});

test('age gate comes first and needs both boxes', { skip: !pw }, async () => {
  const { page, ctx } = await newPage();
  await page.goto(base + '/talaarawan/index.html');
  assert.equal(await page.isVisible('#gate'), true);
  assert.equal(await page.isVisible('#write-form'), false);
  await page.check('#gate-age');
  await page.click('#gate-ok');
  assert.match(await page.textContent('#gate-msg'), /20 or older/);
  await page.check('#gate-rules');
  await page.click('#gate-ok');
  assert.equal(await page.isVisible('#write-form'), true);
  await page.reload();
  assert.equal(await page.isVisible('#gate'), false, 'remembered');
  await ctx.close();
});

test('posting: published, shows in your posts and the feed, can be deleted', { skip: !pw }, async () => {
  const { page, back, errors, ctx } = await newPage();
  await page.goto(base + '/talaarawan/index.html');
  await passGate(page);
  await page.fill('#text', 'Ang ganda ng araw ko. Nag-kape ako.');
  await page.click('#post-button');
  await page.waitForSelector('#write-msg.ok');
  assert.match(await page.textContent('#write-msg'), /Posted/);
  assert.equal(await page.inputValue('#text'), '');
  assert.equal(back.db.posts.find((p) => p.body.startsWith('Ang ganda')).author_id, ANON_ID);
  assert.match(await page.textContent('#mine-list'), /Ang ganda ng araw ko/);
  assert.match(await page.textContent('#feed-list'), /Ang ganda ng araw ko/);

  // after a reload the page still knows which post is yours
  await page.reload();
  await page.waitForSelector('#mine-list .dy-post');
  await page.click('#mine-list .dy-post button:has-text("Delete")');
  await page.click('#mine-list button:has-text("Yes, delete for good")');
  await page.waitForSelector('#mine .note');
  assert.match(await page.textContent('#mine .note'), /Deleted/);
  assert.equal(back.db.posts.some((p) => p.body.startsWith('Ang ganda')), false);
  assert.equal(await page.locator('.dy-post', { hasText: 'Ang ganda' }).count(), 0);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('personal info: kind explanation, the text stays so it can be fixed', { skip: !pw }, async () => {
  const { page, back, ctx } = await newPage();
  await page.goto(base + '/talaarawan/index.html');
  await passGate(page);
  await page.fill('#text', 'Text me 0917 123 4567 ha');
  await page.click('#post-button');
  await page.waitForSelector('#write-msg.error');
  assert.match(await page.textContent('#write-msg'), /phone number/);
  assert.equal(await page.inputValue('#text'), 'Text me 0917 123 4567 ha');
  assert.equal(back.db.posts.length, 2, 'nothing saved');
  await ctx.close();
});

test('crisis post: posted normally, gentle hotline note with tap-to-call', { skip: !pw }, async () => {
  const { page, back, ctx } = await newPage();
  await page.goto(base + '/talaarawan/index.html');
  await passGate(page);
  await page.fill('#text', 'Pagod na ako. Gusto ko nang mamatay.');
  await page.click('#post-button');
  await page.waitForSelector('.dy-care');
  assert.match(await page.textContent('#write-msg'), /Posted/);
  assert.match(await page.textContent('.dy-care'), /1553/);
  assert.match(await page.textContent('.dy-care'), /0917-899-8727/);
  assert.equal(await page.getAttribute('.dy-care a[href^="tel:"]', 'href'), 'tel:1553');
  const saved = back.db.posts.find((p) => p.body.startsWith('Pagod'));
  assert.equal(saved.status, 'published');
  assert.equal(saved.crisis, true);
  await ctx.close();
});

test('report button: pick a reason, send, thanks', { skip: !pw }, async () => {
  const { page, back, ctx } = await newPage();
  await page.goto(base + '/talaarawan/index.html');
  await page.click('#feed-list .dy-post button:has-text("Report")');
  await page.check('text=Hate or harassment');
  await page.click('button:has-text("Send report")');
  await page.waitForSelector('#feed-list .note');
  assert.match(await page.textContent('#feed-list .note'), /Thanks/);
  assert.deepEqual(back.db.reports.map((r) => [r.p_post, r.p_user, r.p_reason]), [[1, ANON_ID, 'Hate or harassment']]);
  await ctx.close();
});

test('admin: strangers are turned away', { skip: !pw }, async () => {
  const { page, ctx } = await newPage();
  await page.goto(base + '/admin/index.html');
  await page.waitForSelector('#admin-gate.error');
  assert.match(await page.textContent('#admin-gate'), /Owner only/);
  assert.equal(await page.isVisible('#admin'), false);
  await ctx.close();
});

test('admin: owner sees stats and the queue, and can approve', { skip: !pw }, async () => {
  const { page, back, errors, ctx } = await newPage({ owner: true });
  await page.goto(base + '/admin/index.html');
  await page.waitForSelector('#admin-list .dy-post');
  assert.match(await page.textContent('#stats'), /posts today/);
  assert.match(await page.textContent('#rejected'), /2 phone number/);
  const item = await page.textContent('#admin-list');
  assert.match(item, /writer 3f9a1c/);
  assert.match(item, /crisis/);
  await page.click('#admin-list button:has-text("Approve")');
  await page.waitForSelector('#admin-msg.ok');
  assert.ok(back.db.adminCalls.some((c) => c.name === 'dayari_admin_act' && c.args.p_action === 'approve' && c.args.p_post === 2));
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('phone size, dark mode: readable, no sideways scrolling, big enough buttons', { skip: !pw }, async () => {
  const { page, ctx } = await newPage({ mobile: true, dark: true });
  for (const p of ['/talaarawan/index.html', '/talaarawan/privacy.html', '/talaarawan/rules.html', '/admin/index.html']) {
    await page.goto(base + p);
    await page.waitForLoadState('networkidle');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 0, p + ' scrolls sideways by ' + overflow + 'px');
    assert.equal(await page.getAttribute('html', 'data-theme'), 'dark');
  }
  await page.goto(base + '/talaarawan/index.html');
  await passGate(page);
  const h = await page.$eval('#post-button', (b) => b.getBoundingClientRect().height);
  assert.ok(h >= 44, 'post button is ' + h + 'px tall');
  const size = await page.$eval('#text', (t) => parseFloat(getComputedStyle(t).fontSize));
  assert.ok(size >= 16, 'textarea text is ' + size + 'px');
  if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/dayari-phone-dark.png', fullPage: true });
  await ctx.close();
});

test('the personal diary is untouched, and its ribbon links to talaarawan', { skip: !pw }, async () => {
  const { page, ctx } = await newPage();
  await page.goto(base + '/html/about.html');
  const link = page.locator('#ribbon a', { hasText: 'talaarawan' });
  assert.equal(await link.getAttribute('href'), '../talaarawan/index.html');
  assert.equal(await page.evaluate(() => document.body.classList.contains('dayari')), false);
  await ctx.close();
});
