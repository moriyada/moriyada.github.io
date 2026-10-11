// Tests for the "dayari" Edge Function, with fake Supabase, Turnstile and OpenAI.
//   node --test tests/dayari/
// (Node 22+ runs the TypeScript file directly.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as F from '../../supabase/functions/dayari/index.ts';

const URL_ = 'https://proj.supabase.co';
const USER = '11111111-2222-3333-4444-555555555555';
const IP = '203.0.113.7';

// A fake world. Records every database call so tests can check what was (not) saved.
function world(opts = {}) {
  const calls = [];
  const env = Object.assign({
    SUPABASE_URL: URL_,
    SUPABASE_ANON_KEY: 'anon-key',
    SUPABASE_SERVICE_ROLE_KEY: 'eyJservice.key',
    TURNSTILE_SECRET_KEY: 'ts-secret',
    DAYARI_IP_SALT: 'salt'
  }, opts.env || {});
  for (const k of Object.keys(env)) if (env[k] === undefined) delete env[k];
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const fetch = async (url, init = {}) => {
    url = String(url);
    if (url === URL_ + '/auth/v1/user') {
      const auth = new Headers(init.headers).get('authorization') || '';
      if (auth === 'Bearer anon-token') return json(200, { id: USER, is_anonymous: true });
      if (auth === 'Bearer email-token') return json(200, { id: USER, is_anonymous: false, email: 'x@y.z' });
      return json(401, { msg: 'bad jwt' });
    }
    if (url.startsWith('https://challenges.cloudflare.com/')) {
      const form = new URLSearchParams(String(init.body));
      calls.push({ turnstile: Object.fromEntries(form) });
      return json(200, { success: form.get('response') === 'good-token' });
    }
    if (url === 'https://api.openai.com/v1/moderations') {
      calls.push({ openai: JSON.parse(init.body) });
      if (opts.openaiDown) return json(500, { error: 'down' });
      return json(200, { results: [opts.openai || { flagged: false, categories: {}, category_scores: {} }] });
    }
    if (url.startsWith(URL_ + '/rest/v1/rpc/')) {
      const name = url.slice((URL_ + '/rest/v1/rpc/').length);
      const args = JSON.parse(init.body);
      calls.push({ rpc: name, args, headers: Object.fromEntries(new Headers(init.headers)) });
      if (name === 'dayari_gate') return json(200, opts.gate || 'ok');
      if (name === 'dayari_insert_post') return json(200, 42);
      if (name === 'dayari_add_report') return json(200, 'reported');
      if (name === 'dayari_delete_own') return json(200, true);
      if (name === 'dayari_log_rejection') return json(200, null);
    }
    throw new Error('unexpected fetch ' + url);
  };
  return { deps: { env: (k) => env[k], fetch }, calls };
}

function req(body, { token = 'anon-token', origin = 'https://moriyada.github.io', method = 'POST' } = {}) {
  const headers = { 'content-type': 'application/json', origin, 'x-forwarded-for': IP + ', 10.0.0.1' };
  if (token) headers.authorization = 'Bearer ' + token;
  return new Request(URL_ + '/functions/v1/dayari', { method, headers, body: method === 'POST' ? JSON.stringify(body) : undefined });
}

const post = (text, extra = {}) => Object.assign({ action: 'post', text, ageOk: true, rulesOk: true, turnstileToken: 'good-token' }, extra);
async function call(w, body, o) {
  const res = await F.handle(req(body, o), w.deps);
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
}
const rpcs = (w, name) => w.calls.filter((c) => c.rpc === name);

// ---------- the door ----------

test('CORS: the site is allowed, other sites are not', async () => {
  const w = world();
  const ok = await F.handle(req(null, { method: 'OPTIONS' }), w.deps);
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get('access-control-allow-origin'), 'https://moriyada.github.io');
  const evil = await F.handle(req(null, { method: 'OPTIONS', origin: 'https://evil.example' }), w.deps);
  assert.equal(evil.headers.get('access-control-allow-origin'), null);
});

test('no login, a fake token, or a real (email) account cannot write', async () => {
  for (const token of [null, 'forged-token']) {
    const w = world();
    const r = await call(w, post('hello'), { token });
    assert.equal(r.status, 401);
    assert.equal(rpcs(w, 'dayari_insert_post').length, 0);
  }
  const w = world();
  const r = await call(w, post('hello'), { token: 'email-token' });
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'not_anonymous');
});

test('the age gate and house rules must be accepted', async () => {
  const w = world();
  assert.equal((await call(w, post('hello', { ageOk: false }))).body.code, 'gate');
  assert.equal((await call(w, post('hello', { rulesOk: undefined }))).body.code, 'gate');
});

test('empty and too-long posts are refused', async () => {
  const w = world();
  assert.equal((await call(w, post('   \n  '))).body.code, 'empty');
  assert.equal((await call(w, post('a'.repeat(2001)))).body.code, 'too_long');
  assert.equal(rpcs(w, 'dayari_insert_post').length, 0);
});

test('Turnstile: missing secret closes posting; a bad token is refused', async () => {
  let w = world({ env: { TURNSTILE_SECRET_KEY: undefined } });
  let r = await call(w, post('hello'));
  assert.equal(r.status, 503);
  assert.equal(r.body.code, 'closed');
  w = world();
  r = await call(w, post('hello', { turnstileToken: 'bot-token' }));
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'captcha');
  assert.equal(rpcs(w, 'dayari_insert_post').length, 0);
});

test('bans and rate limits are enforced', async () => {
  let r = await call(world({ gate: 'banned' }), post('hello'));
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'banned');
  r = await call(world({ gate: 'rate_user' }), post('hello'));
  assert.equal(r.status, 429);
  r = await call(world({ gate: 'rate_ip' }), post('hello'));
  assert.equal(r.status, 429);
});

test('the raw network address is never sent to the database, only a hash', async () => {
  const w = world();
  await call(w, post('Maganda ang araw ko.'));
  const all = JSON.stringify(w.calls.filter((c) => c.rpc));
  assert.ok(!all.includes(IP));
  const gate = rpcs(w, 'dayari_gate')[0];
  assert.match(gate.args.p_ip_hash, /^[0-9a-f]{32}$/);
  assert.equal(gate.args.p_user, USER);
});

// ---------- a normal post ----------

test('a normal post is published', async () => {
  const w = world();
  const r = await call(w, post('Maganda ang araw ko. Nag-jogging ako sa umaga.'));
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, id: 42, status: 'published', crisis: false });
  const ins = rpcs(w, 'dayari_insert_post')[0].args;
  assert.equal(ins.p_user, USER);
  assert.equal(ins.p_status, 'published');
  assert.deepEqual(ins.p_reasons, []);
});

test('the writer is always the logged-in account, never one sent in the request', async () => {
  const w = world();
  await call(w, post('hello there', { p_user: 'someone-else', userId: 'someone-else' }));
  assert.equal(rpcs(w, 'dayari_insert_post')[0].args.p_user, USER);
});

// ---------- personal info ----------

const PII = {
  phone: ['Text me 0917 123 4567', 'call +63 917-123-4567 ha', 'landline namin (02) 8123-4567', '0 9 1 7 1 2 3 4 5 6 7'],
  email: ['juan.cruz@gmail.com', 'juan dot cruz at gmail dot com', 'email me at yahoo juancruz'],
  address: ['Blk 5 Lot 12 Phase 2 dito ako', 'nakatira ako sa 123 Rizal St. Pasig', 'Purok 3 kami'],
  social: ['follow me @juan_cruz', 'ig: juancruz.ph', 'facebook.com/juan.cruz'],
  name_place: ['Si Ana Reyes sa UST ang crush ko', 'My classmate Juan P. Dela Cruz is so mean', 'Mark Santos from Accenture']
};
for (const [kind, samples] of Object.entries(PII)) {
  test('personal info is refused: ' + kind, async () => {
    for (const text of samples) {
      const w = world();
      const r = await call(w, post(text));
      assert.equal(r.status, 422, text);
      assert.deepEqual(r.body, { ok: false, code: 'pii', kind }, text);
      assert.equal(rpcs(w, 'dayari_insert_post').length, 0, 'not saved: ' + text);
      assert.deepEqual(rpcs(w, 'dayari_log_rejection')[0].args, { p_reason: 'pii_' + kind });
      assert.ok(!JSON.stringify(w.calls).includes(text.slice(0, 12)) || kind === 'x', 'the text is not logged');
    }
  });
}

test('ordinary writing is not mistaken for personal info', () => {
  for (const text of [
    'Today Ana and I went to Manila.', 'Ana Reyes is my friend', 'Pagod ako sa school today.',
    'From 2019 2020 2021 to 2022 ang hirap.', 'We read Noli Me Tangere in class.',
    'Tinawagan ko ang NCMH 1553 at 0917-899-8727, nakatulong.', 'I ran 5 km in 32 minutes at 6:30 AM.',
    'Grade 10 na ako', 'Ang ganda ng Sunday Mass sa Quiapo Church.', 'Gumising ako ng 5:45, 3 cups of coffee.'
  ]) assert.equal(F.findPersonalInfo(text), null, text);
});

// ---------- crisis ----------

test('crisis words are NOT blocked: published, flagged, hotline shown', async () => {
  for (const text of ['Gusto ko nang mamatay.', 'I want to die tonight', 'ayoko na mabuhay', 'I keep cutting myself', 'wanna dieee']) {
    const w = world();
    const r = await call(w, post(text));
    assert.equal(r.status, 200, text);
    assert.equal(r.body.status, 'published', text);
    assert.equal(r.body.crisis, true, text);
    const ins = rpcs(w, 'dayari_insert_post')[0].args;
    assert.equal(ins.p_crisis, true);
    assert.deepEqual(ins.p_reasons, ['crisis']);
  }
});

test('OpenAI self-harm categories also count as crisis, never rejected', async () => {
  const w = world({ env: { OPENAI_API_KEY: 'sk-test' }, openai: { flagged: true, categories: { 'self-harm/intent': true }, category_scores: { 'self-harm/intent': 0.9 } } });
  const r = await call(w, post('Pagod na pagod na ako sa lahat.'));
  assert.equal(r.body.status, 'published');
  assert.equal(r.body.crisis, true);
});

// ---------- moderation ----------

test('OpenAI: threats are rejected and not saved', async () => {
  const w = world({ env: { OPENAI_API_KEY: 'sk-test' }, openai: { flagged: true, categories: { 'harassment/threatening': true }, category_scores: { 'harassment/threatening': 0.95 } } });
  const r = await call(w, post('some text'));
  assert.equal(r.status, 422);
  assert.equal(r.body.code, 'moderation');
  assert.equal(rpcs(w, 'dayari_insert_post').length, 0);
  assert.equal(w.calls.find((c) => c.openai).openai.model, 'omni-moderation-latest');
});

test('OpenAI: sexual content involving minors is rejected', async () => {
  const w = world({ env: { OPENAI_API_KEY: 'sk-test' }, openai: { flagged: true, categories: { 'sexual/minors': true }, category_scores: { 'sexual/minors': 0.5 } } });
  assert.equal((await call(w, post('x'))).body.code, 'moderation');
});

test('OpenAI: hate / harassment / sexual content is held for review', async () => {
  for (const cat of ['hate', 'harassment', 'sexual', 'violence']) {
    const w = world({ env: { OPENAI_API_KEY: 'sk-test' }, openai: { flagged: true, categories: { [cat]: true }, category_scores: { [cat]: 0.6 } } });
    const r = await call(w, post('some text'));
    assert.equal(r.body.status, 'held', cat);
    assert.deepEqual(rpcs(w, 'dayari_insert_post')[0].args.p_reasons, ['held']);
  }
});

test('OpenAI: borderline (not flagged, but scored) is held', async () => {
  const w = world({ env: { OPENAI_API_KEY: 'sk-test' }, openai: { flagged: false, categories: {}, category_scores: { harassment: 0.45 } } });
  assert.equal((await call(w, post('some text'))).body.status, 'held');
});

test('no OpenAI key: keyword filter rejects threats/slurs, holds borderline, lets normal posts through', async () => {
  let w = world();
  assert.equal((await call(w, post('Papatayin kita bukas'))).body.code, 'moderation');
  w = world();
  assert.equal((await call(w, post('n i g g e r'))).body.code, 'moderation');
  w = world();
  const r = await call(w, post('Tangina mo talaga'));
  assert.equal(r.body.status, 'held');
  assert.deepEqual(rpcs(w, 'dayari_insert_post')[0].args.p_reasons, ['held', 'fallback']);
  w = world();
  assert.equal((await call(w, post('Putangina ang init ngayon, pero okay lang.'))).body.status, 'published');
  assert.equal(w.calls.filter((c) => c.openai).length, 0);
});

test('OpenAI down: falls back to the keyword filter', async () => {
  const w = world({ env: { OPENAI_API_KEY: 'sk-test' }, openaiDown: true });
  assert.equal((await call(w, post('fuck you'))).body.status, 'held');
  const w2 = world({ env: { OPENAI_API_KEY: 'sk-test' }, openaiDown: true });
  assert.equal((await call(w2, post('Masaya ako ngayon'))).body.status, 'published');
});

// ---------- report and delete ----------

test('report: needs Turnstile, uses the logged-in account', async () => {
  let w = world();
  let r = await call(w, { action: 'report', postId: 7, reason: 'mean', turnstileToken: 'bot' });
  assert.equal(r.status, 403);
  w = world();
  r = await call(w, { action: 'report', postId: 7, reason: 'mean', turnstileToken: 'good-token', p_user: 'x' });
  assert.deepEqual(r.body, { ok: true, result: 'reported' });
  const args = rpcs(w, 'dayari_add_report')[0].args;
  assert.equal(args.p_user, USER);
  assert.equal(args.p_post, 7);
  assert.equal(rpcs(w, 'dayari_gate')[0].args.p_action, 'report');
});

test('delete: only ever deletes as the logged-in account', async () => {
  const w = world();
  const r = await call(w, { action: 'delete', postId: '9', userId: 'someone-else' });
  assert.deepEqual(r.body, { ok: true, deleted: true });
  assert.deepEqual(rpcs(w, 'dayari_delete_own')[0].args, { p_post: 9, p_user: USER });
});

test('bad input is refused politely', async () => {
  const w = world();
  assert.equal((await call(w, { action: 'delete', postId: 'abc' })).status, 400);
  assert.equal((await call(w, { action: 'nuke' })).status, 400);
  const res = await F.handle(new Request(URL_, { method: 'POST', headers: { authorization: 'Bearer anon-token' }, body: '{not json' }), w.deps);
  assert.equal(res.status, 400);
});

test('the service key goes only to the database, never into a reply', async () => {
  const w = world();
  const r = await call(w, post('hello'));
  assert.ok(!JSON.stringify(r.body).includes('service'));
  for (const c of w.calls) if (c.turnstile) assert.ok(!JSON.stringify(c).includes('eyJservice'));
});
