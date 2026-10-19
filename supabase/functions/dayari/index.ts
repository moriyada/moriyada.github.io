// Talaarawan: the one door for every public write (post, report, delete).
//
// Deployed as the Supabase Edge Function "dayari". One file, no imports, so it can be pasted
// straight into the Supabase dashboard editor. The website calls it at
//   POST https://<project>.supabase.co/functions/v1/dayari
// with the visitor's anonymous login token. The database refuses direct writes from
// everyone, so this file is the only way anything gets into the dayari_ tables.
//
// Secrets (Supabase > Edge Functions > Secrets; never in the repo or the website):
//   TURNSTILE_SECRET_KEY   required. Without it posting and reporting stay closed.
//   OPENAI_API_KEY         optional. Without it a built-in keyword filter is used.
//   DAYARI_IP_SALT         optional but recommended. Any long random text.
//   DAYARI_ALLOWED_ORIGINS optional. Comma-separated; default https://moriyada.github.io
// Provided by Supabase automatically: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.
//
// Post pipeline, in order:
//   1. must be an anonymous account; age 20+ and house rules accepted; 1-2000 characters
//   2. Cloudflare Turnstile (invisible captcha)
//   3. bans + rate limits (per account and per network), in the database
//   4. personal info (phone, email, address, social handles, full name + school/work): refused
//   5. crisis words: never blocked, but flagged for the owner and the writer gets a hotline note
//   6. moderation: OpenAI's free moderation endpoint, or the keyword filter as a fallback
//   7. saved as published, or held for the owner's review

declare const Deno: any;

type Env = (name: string) => string | undefined;
export interface Deps {
  env: Env;
  fetch: typeof fetch;
}

export const MAX_LENGTH = 2000;

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

// Lowercase, accents removed, look-alike characters folded, so "Ki11 y0u" reads as "kill you".
export function fold(text: string, one = 'i'): string {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[0134578@$!]/g, (ch) => ({ '0': 'o', '1': one, '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '@': 'a', '$': 's', '!': 'i' } as Record<string, string>)[ch])
    .replace(/(.)\1{2,}/g, '$1$1')      // "pleeease" -> "pleease"
    .replace(/[^a-z\s']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Same, but with the words glued together: catches "n i g g e r" and "f.a.g.g.o.t".
function squash(text: string): string {
  return fold(text).replace(/[^a-z]/g, '');
}

// A phrase list -> one regex with word boundaries and flexible spaces.
function phrases(list: string[]): RegExp {
  const parts = list.map((p) => p.trim().split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join("[\\s']*"));
  return new RegExp('(?:^|\\s)(?:' + parts.join('|') + ')(?=$|\\s)');
}

function collapse(s: string): string {
  return s.replace(/'/g, '').replace(/([a-z])\1+/g, '$1');
}

// A phrase list -> a test that also catches stretched letters ("dieee"), dropped
// apostrophes ("dont") and 1-for-l/i swaps ("ki11").
function matcher(list: string[]): (text: string) => boolean {
  const exact = phrases(list);
  const loose = phrases(list.map(collapse));
  return (text: string) => [fold(text), fold(text, 'l')].some((f) =>
    exact.test(' ' + f + ' ') || exact.test(' ' + f.replace(/'/g, '') + ' ') || loose.test(' ' + collapse(f) + ' '));
}

// ---------------------------------------------------------------------------
// 4. Personal information
// ---------------------------------------------------------------------------

// Crisis lines may be shared freely (digits only, local format).
const HOTLINES = new Set([
  '1553', '09178998727', '09663514518', '09086392672',   // NCMH
  '0288044673', '09175584673', '09188734673', '2919'      // Hopeline
]);

function localDigits(s: string): string {
  let d = s.replace(/\D/g, '');
  if (d.startsWith('63')) d = '0' + d.slice(2);
  return d;
}

// Digits written with spaces, dots, dashes or brackets between them are joined up first.
function joinDigits(text: string): string {
  return text.replace(/\((?=\d)/g, '').replace(/(\d)[\s.\-()\/]+(?=\d)/g, '$1');
}

const PHONE_PATTERNS = [
  /(?:\+?63|(?<!\d)0)9\d{9}(?!\d)/g,          // PH mobile: 0917..., +63917...
  /(?:\+?632|(?<!\d)02)[2-9]\d{7}(?!\d)/g,    // Metro Manila landline: (02) 8123 4567
  /\+\d{9,14}(?!\d)/g,                         // international with a plus
  /(?<!\d)0\d{9,10}(?!\d)/g                    // other local numbers 0xx...
];

const EMAIL = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/i;
const EMAIL_SPELLED = /\b[a-z0-9._%+-]{2,}\s*(?:\(at\)|\[at\]|\{at\}|\s+at\s+)\s*[a-z0-9-]+\s*(?:\(dot\)|\[dot\]|\{dot\}|\s+dot\s+|\.)\s*(?:com|net|org|ph|edu|gov|co)\b/i;
const EMAIL_PROVIDER = /(?:@|\bat\s+)(?:gmail|yahoo|ymail|outlook|hotmail|icloud|proton(?:mail)?|live)\b/i;

const SOCIAL = [
  /\b(?:facebook|fb|instagram|tiktok|twitter|x|threads|snapchat|youtube|linkedin|discord)\.(?:com|me|gg)\/\S+/i,
  /\b(?:m\.me|wa\.me|t\.me)\/\S+/i,
  /(?:^|[\s(])@[a-z_][a-z0-9_.]{2,29}\b/i,
  /\b(?:ig|insta|instagram|fb|facebook|tiktok|twitter|telegram|tg|discord|snap|snapchat|viber|whatsapp|wa)\s*(?::|-|=)\s*@?[a-z0-9_.]{3,}/i
];

const ADDRESS = [
  /\b(?:blk|block)\.?\s*#?\s*\d+[a-z]?\b[\s\S]{0,25}?\b(?:lot|lt)\.?\s*#?\s*\d+/i,
  /\blot\.?\s*#?\s*\d+[a-z]?\s*,?\s*(?:blk|block|phase|ph)\.?\s*\d+/i,
  /(?:#|\bno\.?\s*)?\b\d{1,5}[a-z]?\s*,?\s+(?:[a-z][\w.'-]*\s+){1,4}(?:st|street|ave|avenue|road|rd|drive|dr|blvd|boulevard|highway|hwy|extension|ext|lane|ln|kalye)\b/i,
  /\bpurok\s*(?:#?\d+|uno|dos|tres|kwatro|singko|[ivx]{1,4})\b/i,
  /\b(?:unit|rm|room|apt|apartment)\s*#?\s*\d{1,4}[a-z]?\b[\s\S]{0,40}?\b(?:tower|bldg|building|condo|condominium|residences|street|st|ave)\b/i,
  /\b(?:zip\s*code|postal\s*code)\s*:?\s*\d{4}\b/i
];

// Words that can start a capitalised "name-like" pair but aren't names.
const NOT_NAMES = new Set((
  'i im ive id ill ako si sina ni nina kay kina ang ng sa mga ay at na pa ba po opo oo hindi wala may meron ' +
  'kanina kahapon bukas ngayon sana pero kasi tapos grabe nung noong nag yung iyong sila siya sya kami tayo ' +
  'ikaw ka ito iyon yun dito doon diyan salamat sobrang lagi minsan talaga parang baka basta ewan haha hay ' +
  'the a an my our your his her their we you he she they it its this that these those then when after before ' +
  'today tonight yesterday tomorrow also but and so just maybe dear hi hello good happy thank thanks sorry why ' +
  'what how who where okay ok please love life god lord jesus diyos panginoon mama papa nanay tatay inay itay ' +
  'ate kuya tita tito lola lolo lolo ninang ninong maam ma sir miss mr mrs ms dr prof teacher coach ' +
  'monday tuesday wednesday thursday friday saturday sunday lunes martes miyerkules huwebes biyernes sabado linggo ' +
  'january february march april may june july august september october november december enero pebrero marso ' +
  'abril mayo hunyo hulyo agosto setyembre oktubre nobyembre disyembre christmas pasko new year bagong taon ' +
  'manila maynila quezon city cebu davao makati taguig pasig marikina tarlac pampanga bulacan cavite laguna ' +
  'batangas rizal baguio iloilo bacolod cagayan philippines pilipinas luzon visayas mindanao metro ncr ' +
  'university college school academy institute high elementary national state senior junior grade section ' +
  'english filipino tagalog math science talaarawanriyada facebook instagram tiktok youtube netflix spotify ' +
  'google chatgpt jollibee mcdo starbucks shopee lazada gcash'
).split(/\s+/));

const NAME_WORD = /^[A-Z][a-zà-öø-ÿñ'’-]+$/;
const NAME_PARTICLE = /^(?:de|del|dela|delos|de\s?los|san|sta\.?|sto\.?|[A-Z]\.|jr\.?|sr\.?|ii|iii)$/i;

// Two or more capitalised words in a row that look like a person's name ("Ana Reyes",
// "Juan P. Dela Cruz"). Rough on purpose: it only matters together with a school/workplace.
export function findFullName(text: string): string | null {
  const tokens = text.split(/[\s,;:!?()"“”]+/);
  let run: string[] = [];
  const done = (): string | null => {
    const real = run.filter((w) => NAME_WORD.test(w));
    return real.length >= 2 ? run.join(' ') : null;
  };
  for (const raw of tokens) {
    const w = /^[A-Z]\.$/.test(raw) ? raw : raw.replace(/\.+$/, '');
    const plain = w.toLowerCase().replace(/[^a-z\u00e0-\u00ff\u00f1]/g, '');
    if (NAME_WORD.test(w) && !NOT_NAMES.has(plain)) {
      run.push(w);
    } else if (run.length > 0 && NAME_PARTICLE.test(w)) {
      run.push(w);
    } else {
      const found = done();
      if (found) return found;
      run = [];
    }
    if (raw.endsWith('.') && !/^[A-Z]\.$/.test(raw)) {   // a sentence ended
      const found = done();
      if (found) return found;
      run = [];
    }
  }
  return done();
}

const INSTITUTION = /\b(?:[A-Z][\w'.-]*\s+){0,5}(?:University|College|Academy|School|Institute|Colegio|Inc\.?|Corporation|Corp\.?|Company|Hospital)\b|\b(?:UP|PUP|UST|DLSU|ADMU|Ateneo|FEU|UE|Mapua|Mapúa|NU|PLM|TUP|TIP|STI|AMA|USC|PNU|LPU|Adamson|Letran|San Beda|Benilde|Miriam|Assumption|Accenture|Concentrix|Teleperformance|Alorica|PLDT|Meralco|BDO|BPI|Metrobank)\b/;
const SCHOOL_WORK_WORDS = /\b(?:school|eskwela|eskwelahan|paaralan|university|univ|college|campus|section|adviser|classmate|classmates|kaklase|schoolmate|blockmate|teacher|guro|prof|professor|principal|office|opisina|company|kompanya|work|trabaho|workplace|boss|amo|manager|supervisor|officemate|katrabaho|coworker|co-worker|ka-work)\b/i;

export interface PersonalInfo { kind: 'phone' | 'email' | 'address' | 'social' | 'name_place'; }

export function findPersonalInfo(text: string): PersonalInfo | null {
  const joined = joinDigits(text);
  for (const re of PHONE_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(joined))) {
      if (!HOTLINES.has(localDigits(m[0]))) return { kind: 'phone' };
    }
  }
  if (EMAIL.test(text) || EMAIL_SPELLED.test(text) || EMAIL_PROVIDER.test(text)) return { kind: 'email' };
  if (SOCIAL.some((re) => re.test(text))) return { kind: 'social' };
  if (ADDRESS.some((re) => re.test(text))) return { kind: 'address' };
  if ((INSTITUTION.test(text) || SCHOOL_WORK_WORDS.test(text)) && findFullName(text.replace(INSTITUTION, ' '))) {
    return { kind: 'name_place' };
  }
  return null;
}

// ---------------------------------------------------------------------------
// 5. Crisis words (English + Filipino). Never blocks; only flags and shows the hotline.
// ---------------------------------------------------------------------------

const CRISIS = matcher([
  'suicide', 'suicidal', 'kill myself', 'killing myself', 'killed myself', 'end my life', 'ending my life',
  'take my own life', 'take my life', 'want to die', 'wanna die', 'wish i was dead', 'wish i were dead',
  'better off dead', 'dont want to live', "don't want to live", 'do not want to live', 'no reason to live',
  'end it all', 'self harm', 'selfharm', 'self harming', 'cut myself', 'cutting myself', 'hurt myself',
  'hurting myself', 'overdose', 'unalive', 'unalive myself',
  'magpakamatay', 'nagpakamatay', 'magpapakamatay', 'pagpapakamatay', 'papatayin ko sarili ko',
  'papatayin ko ang sarili ko', 'patayin ang sarili ko', 'patayin sarili ko', 'patayin ko na sarili ko',
  'gusto ko nang mamatay', 'gusto ko na mamatay', 'gusto ko ng mamatay', 'gusto ko na lang mamatay',
  'gusto ko nalang mamatay', 'sana mamatay na ako', 'sana mamatay nalang ako', 'sana patay na ako',
  'sana di na ako nagising', 'ayoko na mabuhay', 'ayoko nang mabuhay', 'ayaw ko nang mabuhay',
  'ayoko na sa buhay', 'wala nang saysay ang buhay', 'walang saysay ang buhay ko', 'laslas', 'maglaslas',
  'naglaslas', 'naglalaslas', 'saktan ang sarili', 'sinasaktan ko sarili ko', 'sinasaktan ko ang sarili ko',
  'tapusin ang buhay ko', 'tatapusin ko na', 'pagod na akong mabuhay', 'pagod na ako mabuhay'
]);

export function detectCrisis(text: string): boolean {
  return CRISIS(text);
}

// ---------------------------------------------------------------------------
// 6. Moderation
// ---------------------------------------------------------------------------

export type Decision = 'allow' | 'hold' | 'reject';
export interface Verdict { decision: Decision; source: 'openai' | 'fallback'; categories: string[]; selfHarm: boolean; }

// Built-in filter, used when there's no OpenAI key or OpenAI can't be reached.
const KW_REJECT = matcher([
  // threats
  'i will kill you', 'ill kill you', 'im going to kill you', 'gonna kill you', 'i will hurt you',
  'i will rape', 'papatayin kita', 'papatayin ko kayo', 'papatayin ko siya', 'papatayin ko sya',
  'papatayin ko yan', 'babarilin kita', 'sasaksakin kita', 'pasasabugin ko', 'bomb threat',
  'kill yourself', 'kys', 'go die', 'magpakamatay ka na', 'mamatay ka na sana',
  // slurs
  'nigger', 'niggers', 'faggot', 'faggots', 'chink', 'chinks', 'kike', 'spic',
  // sexual content involving minors
  'child porn', 'cp link', 'underage nudes', 'loli porn'
]);
const KW_REJECT_SQUASHED = ['nigger', 'faggot', 'childporn'];
const KW_HOLD = matcher([
  // harassment aimed at someone
  'fuck you', 'fuck u', 'stfu', 'you are stupid', 'youre stupid', 'you idiot', 'retard', 'retarded',
  'putang ina mo', 'putangina mo', 'tangina mo', 'tang ina mo', 'gago ka', 'gaga ka', 'bobo ka', 'bobo mo',
  'tanga ka', 'ulol ka', 'ulol mo', 'hayop ka', 'pakyu', 'pak yu', 'sana mamatay ka', 'mamatay ka',
  'tranny', 'nigga', 'fag', 'bakla ka', 'bayot ka',
  // sexual content
  'porn', 'pornhub', 'xxx', 'nudes', 'send nudes', 'nude', 'sex video', 'scandal video', 'blowjob', 'handjob',
  'dick pic', 'pussy', 'cum', 'horny', 'kantot', 'kantutan', 'kinantot', 'jakol', 'nagjakol', 'chupa', 'iyot',
  'tamod', 'libog', 'malibog', 'titi', 'pekpek', 'puke', 'burat', 'rape', 'raped', 'rapist', 'ginahasa',
  // violence / illegal
  'kill him', 'kill her', 'kill them', 'patayin', 'shabu', 'bato for sale', 'selling weed', 'gun for sale'
]);
const MINOR_WORDS = matcher(['child', 'kid', 'minor', 'underage', 'bata', 'grade school', 'elementary', 'teen', 'teens', 'highschooler']);

export function keywordModeration(text: string): Verdict {
  const f = fold(text);
  const sq = squash(text);
  const v: Verdict = { decision: 'allow', source: 'fallback', categories: [], selfHarm: false };
  if (KW_REJECT(text) || KW_REJECT_SQUASHED.some((w) => sq.includes(w))) {
    v.decision = 'reject';
    v.categories.push('keyword_reject');
  } else if (KW_HOLD(text)) {
    v.decision = 'hold';
    v.categories.push('keyword_hold');
    // sexual words next to words about children: refuse outright
    if (MINOR_WORDS(text) && /\b(?:porn|nudes?|sex|kantot|iyot|jakol|libog|malibog|rape)/.test(f)) {
      v.decision = 'reject';
      v.categories.push('keyword_minor');
    }
  }
  return v;
}

const THREAT = ['hate/threatening', 'harassment/threatening'];
const WATCHED = ['hate', 'harassment', 'sexual', 'violence', 'violence/graphic', 'illicit', 'illicit/violent'];

// OpenAI moderation result -> decision. Hate/harassment/sexual content and threats are
// rejected or held; self-harm is never rejected (crisis instead).
export function openaiVerdict(r: { flagged?: boolean; categories?: Record<string, boolean>; category_scores?: Record<string, number> }): Verdict {
  const c = r.categories || {};
  const s = r.category_scores || {};
  const score = (k: string) => (typeof s[k] === 'number' ? s[k] : 0);
  const v: Verdict = { decision: 'allow', source: 'openai', categories: [], selfHarm: false };
  const hold = (k: string) => { v.categories.push(k); if (v.decision === 'allow') v.decision = 'hold'; };
  const reject = (k: string) => { v.categories.push(k); v.decision = 'reject'; };

  if (c['sexual/minors'] || score('sexual/minors') >= 0.2) reject('sexual/minors');
  for (const k of THREAT) if (c[k] || score(k) >= 0.5) reject(k);
  if (c['sexual'] && score('sexual') >= 0.8) reject('sexual');
  if ((c['hate'] && score('hate') >= 0.9)) reject('hate');
  if ((c['harassment'] && score('harassment') >= 0.9)) reject('harassment');
  for (const k of WATCHED) {
    if (v.categories.includes(k)) continue;
    if (c[k] || score(k) >= 0.4) hold(k);
  }

  if (c['self-harm'] || c['self-harm/intent'] || score('self-harm') >= 0.4 || score('self-harm/intent') >= 0.4) v.selfHarm = true;
  if (c['self-harm/instructions'] || score('self-harm/instructions') >= 0.4) { v.selfHarm = true; hold('self-harm/instructions'); }
  return v;
}

async function moderate(text: string, deps: Deps): Promise<Verdict> {
  const key = deps.env('OPENAI_API_KEY');
  if (!key) return keywordModeration(text);
  try {
    const res = await withTimeout(deps.fetch('https://api.openai.com/v1/moderations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify({ model: 'omni-moderation-latest', input: text })
    }), 8000);
    if (!res.ok) throw new Error('openai ' + res.status);
    const json = await res.json();
    const result = json && json.results && json.results[0];
    if (!result) throw new Error('openai: no result');
    const v = openaiVerdict(result);
    // the keyword filter still gets a say for words OpenAI may not know (Filipino slang)
    const kw = keywordModeration(text);
    if (kw.decision === 'reject' && v.decision !== 'reject') { v.decision = 'hold'; v.categories.push(...kw.categories); }
    return v;
  } catch (_e) {
    return keywordModeration(text);
  }
}

// ---------------------------------------------------------------------------
// Plumbing: CORS, login check, Turnstile, database calls
// ---------------------------------------------------------------------------

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: any;
  return Promise.race([
    p,
    new Promise<T>((_r, reject) => { timer = setTimeout(() => reject(new Error('timeout')), ms); })
  ]).finally(() => clearTimeout(timer));
}

function allowedOrigin(origin: string | null, env: Env): string | null {
  if (!origin) return null;
  const list = (env('DAYARI_ALLOWED_ORIGINS') || 'https://moriyada.github.io').split(',').map((s) => s.trim()).filter(Boolean);
  if (list.includes(origin)) return origin;
  if (/^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(origin)) return origin;   // testing on his own computer
  return null;
}

function reply(status: number, body: unknown, origin: string | null): Response {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'Origin' };
  if (origin) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Headers'] = 'authorization, x-client-info, apikey, content-type';
    headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
    headers['Access-Control-Max-Age'] = '86400';
  }
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers });
}

function serviceKey(env: Env): string {
  return env('SUPABASE_SERVICE_ROLE_KEY') || '';
}

// Who is calling? Asks Supabase Auth about the token. Returns null if it isn't valid.
async function getUser(token: string, deps: Deps): Promise<{ id: string; is_anonymous?: boolean } | null> {
  if (!token) return null;
  const res = await withTimeout(deps.fetch(deps.env('SUPABASE_URL') + '/auth/v1/user', {
    headers: { apikey: deps.env('SUPABASE_ANON_KEY') || serviceKey(deps.env), Authorization: 'Bearer ' + token }
  }), 8000);
  if (!res.ok) return null;
  const user = await res.json();
  return user && typeof user.id === 'string' ? user : null;
}

async function rpc(name: string, args: Record<string, unknown>, deps: Deps): Promise<any> {
  const key = serviceKey(deps.env);
  const headers: Record<string, string> = { apikey: key, 'Content-Type': 'application/json' };
  if (key.startsWith('eyJ')) headers.Authorization = 'Bearer ' + key;   // old-style JWT key; new sb_secret_ keys go in apikey only
  const res = await withTimeout(deps.fetch(deps.env('SUPABASE_URL') + '/rest/v1/rpc/' + name, {
    method: 'POST', headers, body: JSON.stringify(args)
  }), 8000);
  if (!res.ok) throw new Error('database ' + name + ' ' + res.status + ' ' + (await res.text()).slice(0, 300));
  return res.json();
}

async function verifyTurnstile(token: unknown, ip: string, deps: Deps): Promise<'ok' | 'closed' | 'failed'> {
  const secret = deps.env('TURNSTILE_SECRET_KEY');
  if (!secret) return 'closed';
  if (typeof token !== 'string' || !token || token.length > 2048) return 'failed';
  const form = new URLSearchParams({ secret, response: token });
  if (ip) form.set('remoteip', ip);
  try {
    const res = await withTimeout(deps.fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST', body: form
    }), 8000);
    const json = await res.json();
    return json && json.success === true ? 'ok' : 'failed';
  } catch (_e) {
    return 'failed';
  }
}

function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return req.headers.get('cf-connecting-ip') || req.headers.get('x-real-ip') || '';
}

// Salted SHA-256 of the network address. The address itself is never stored.
async function hashIp(ip: string, env: Env): Promise<string | null> {
  if (!ip) return null;
  const salt = env('DAYARI_IP_SALT') || serviceKey(env);
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + '|' + ip));
  return Array.from(new Uint8Array(bytes)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

// Clean up what was typed: normal line breaks, no invisible control characters.
export function cleanText(raw: unknown): string {
  return String(raw ?? '')
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

// ---------------------------------------------------------------------------
// The handler
// ---------------------------------------------------------------------------

export async function handle(req: Request, deps: Deps): Promise<Response> {
  const origin = allowedOrigin(req.headers.get('origin'), deps.env);
  if (req.method === 'OPTIONS') return reply(204, null, origin);
  if (req.method !== 'POST') return reply(405, { ok: false, code: 'method' }, origin);

  let input: any;
  try {
    const raw = await req.text();
    if (raw.length > 20000) return reply(413, { ok: false, code: 'too_long' }, origin);
    input = JSON.parse(raw);
  } catch (_e) {
    return reply(400, { ok: false, code: 'bad_request' }, origin);
  }
  if (!input || typeof input !== 'object') return reply(400, { ok: false, code: 'bad_request' }, origin);

  try {
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    const user = await getUser(token, deps);
    if (!user) return reply(401, { ok: false, code: 'login' }, origin);
    // Only anonymous Dayari accounts write here (not the owner's or any email account).
    if (user.is_anonymous !== true) return reply(403, { ok: false, code: 'not_anonymous' }, origin);

    const ip = clientIp(req);
    const ipHash = await hashIp(ip, deps.env);

    if (input.action === 'post') return await doPost(input, user.id, ip, ipHash, deps, origin);
    if (input.action === 'report') return await doReport(input, user.id, ip, ipHash, deps, origin);
    if (input.action === 'delete') return await doDelete(input, user.id, ipHash, deps, origin);
    return reply(400, { ok: false, code: 'bad_request' }, origin);
  } catch (e) {
    console.error('dayari', e instanceof Error ? e.message : e);
    return reply(500, { ok: false, code: 'server' }, origin);
  }
}

async function gate(userId: string, ipHash: string | null, action: string, deps: Deps, origin: string | null): Promise<Response | null> {
  const result = await rpc('dayari_gate', { p_user: userId, p_ip_hash: ipHash, p_action: action }, deps);
  if (result === 'banned') return reply(403, { ok: false, code: 'banned' }, origin);
  if (result === 'rate_user' || result === 'rate_ip') return reply(429, { ok: false, code: 'rate' }, origin);
  return null;
}

async function reject(reason: string, body: Record<string, unknown>, deps: Deps, origin: string | null): Promise<Response> {
  try { await rpc('dayari_log_rejection', { p_reason: reason }, deps); } catch (_e) { /* stats only */ }
  return reply(422, { ok: false, ...body }, origin);
}

async function doPost(input: any, userId: string, ip: string, ipHash: string | null, deps: Deps, origin: string | null): Promise<Response> {
  if (input.ageOk !== true || input.rulesOk !== true) return reply(400, { ok: false, code: 'gate' }, origin);
  const text = cleanText(input.text);
  if (!text) return reply(400, { ok: false, code: 'empty' }, origin);
  if (text.length > MAX_LENGTH) return reply(400, { ok: false, code: 'too_long' }, origin);

  const captcha = await verifyTurnstile(input.turnstileToken, ip, deps);
  if (captcha === 'closed') return reply(503, { ok: false, code: 'closed' }, origin);
  if (captcha !== 'ok') return reply(403, { ok: false, code: 'captcha' }, origin);

  const blocked = await gate(userId, ipHash, 'post', deps, origin);
  if (blocked) return blocked;

  // Even a refused post still gets the hotline note if it mentions suicide or self-harm.
  const crisisWords = detectCrisis(text);
  const pii = findPersonalInfo(text);
  if (pii) return reject('pii_' + pii.kind, { code: 'pii', kind: pii.kind, crisis: crisisWords }, deps, origin);

  const verdict = await moderate(text, deps);
  const crisis = crisisWords || verdict.selfHarm;
  if (verdict.decision === 'reject') return reject('moderation', { code: 'moderation', crisis }, deps, origin);

  const held = verdict.decision === 'hold';
  const reasons: string[] = [];
  if (held) reasons.push('held');
  if (held && verdict.source === 'fallback') reasons.push('fallback');
  if (crisis) reasons.push('crisis');

  const id = await rpc('dayari_insert_post', {
    p_user: userId,
    p_body: text,
    p_status: held ? 'held' : 'published',
    p_crisis: crisis,
    p_reasons: reasons,
    p_moderation: { source: verdict.source, categories: verdict.categories.slice(0, 10) },
    p_ip_hash: ipHash
  }, deps);
  return reply(200, { ok: true, id, status: held ? 'held' : 'published', crisis }, origin);
}

async function doReport(input: any, userId: string, ip: string, ipHash: string | null, deps: Deps, origin: string | null): Promise<Response> {
  const postId = Number(input.postId);
  if (!Number.isSafeInteger(postId) || postId <= 0) return reply(400, { ok: false, code: 'bad_request' }, origin);
  const reason = cleanText(input.reason).slice(0, 200);

  const captcha = await verifyTurnstile(input.turnstileToken, ip, deps);
  if (captcha === 'closed') return reply(503, { ok: false, code: 'closed' }, origin);
  if (captcha !== 'ok') return reply(403, { ok: false, code: 'captcha' }, origin);

  const blocked = await gate(userId, ipHash, 'report', deps, origin);
  if (blocked) return blocked;

  const result = await rpc('dayari_add_report', { p_post: postId, p_user: userId, p_ip_hash: ipHash, p_reason: reason || null }, deps);
  return reply(200, { ok: true, result }, origin);
}

async function doDelete(input: any, userId: string, ipHash: string | null, deps: Deps, origin: string | null): Promise<Response> {
  const postId = Number(input.postId);
  if (!Number.isSafeInteger(postId) || postId <= 0) return reply(400, { ok: false, code: 'bad_request' }, origin);
  const blocked = await gate(userId, ipHash, 'delete', deps, origin);
  if (blocked && blocked.status === 429) return blocked;   // banned writers may still delete their own posts
  const deleted = await rpc('dayari_delete_own', { p_post: postId, p_user: userId }, deps);
  return reply(200, { ok: true, deleted: deleted === true }, origin);
}

if (typeof Deno !== 'undefined' && Deno.serve) {
  Deno.serve((req: Request) => handle(req, { env: (k: string) => Deno.env.get(k), fetch: fetch.bind(globalThis) }));
}
