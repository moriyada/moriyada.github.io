-- =====================================================================
-- Moriyada 006: Dayari Mo, phase A (foundation + safety)
--
-- Run AFTER setup.sql and 002-005. Safe to run more than once.
--
-- Dayari Mo is the anonymous public diary at /dayari/. It has its OWN
-- tables (all named dayari_...). Nothing here touches the personal diary.
--
-- The rules, enforced by the database itself:
--   * Nobody can write to any dayari_ table through the API. Not visitors,
--     not anonymous accounts, not even the owner. Every public write goes
--     through the "dayari" Edge Function (it checks Turnstile, rate limits,
--     personal info and moderation first), which calls the service-only
--     functions below.
--   * Visitors can only read published posts, and only 4 columns:
--     id, entry_date, body, created_at. The writer's private ID
--     (author_id), the hashed network address and the moderation notes
--     can't be read through the API at all.
--   * A writer can list their own posts (my_posts) and nothing else.
--   * The owner's /admin page works through owner-only functions that
--     check public.is_owner() (owner list + 2-step login).
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------

-- One row per public post.
create table if not exists public.dayari_posts (
  id              bigint generated always as identity primary key,
  -- The anonymous account that wrote it. Private: never readable by the API.
  author_id       uuid not null references auth.users (id) on delete cascade,
  entry_date      date not null default (now() at time zone 'Asia/Manila')::date,
  body            text not null,
  -- published = everyone sees it; held = waiting for the owner's review;
  -- hidden = taken down (by the owner, or by 3 reports pending review)
  status          text not null default 'published',
  crisis          boolean not null default false,   -- mentions suicide / self-harm
  needs_review    boolean not null default false,   -- shows in the owner's queue
  review_reasons  text[] not null default '{}',     -- why it's in the queue
  report_count    int not null default 0,
  moderation      jsonb not null default '{}',      -- what the checks said (no personal data)
  -- Salted hash of the network address it came from, so a ban can also block the
  -- network for a while. Not reversible. Wiped after 30 days.
  ip_hash         text,
  created_at      timestamptz not null default now(),
  reviewed_at     timestamptz
);

alter table public.dayari_posts drop constraint if exists dayari_posts_ok;
alter table public.dayari_posts add constraint dayari_posts_ok check (
  status in ('published', 'held', 'hidden')
  and char_length(body) between 1 and 2000
  and btrim(body) <> ''
  and review_reasons <@ array['held', 'crisis', 'reports', 'fallback']::text[]
  and octet_length(moderation::text) <= 5000
) not valid;

create index if not exists dayari_posts_public_idx on public.dayari_posts (created_at desc) where status = 'published';
create index if not exists dayari_posts_author_idx on public.dayari_posts (author_id);
create index if not exists dayari_posts_review_idx on public.dayari_posts (created_at) where needs_review;

-- Reports. One per person per post, and one per network per post, so one person
-- making 3 throwaway accounts on the same wifi can't hide a post alone.
create table if not exists public.dayari_reports (
  id           bigint generated always as identity primary key,
  post_id      bigint not null references public.dayari_posts (id) on delete cascade,
  reporter_id  uuid not null references auth.users (id) on delete cascade,
  ip_hash      text not null,
  reason       text check (reason is null or char_length(reason) <= 200),
  created_at   timestamptz not null default now(),
  unique (post_id, reporter_id),
  unique (post_id, ip_hash)
);

-- Bans. By anonymous account (forever, until lifted) and/or network hash (30 days).
create table if not exists public.dayari_bans (
  id          bigint generated always as identity primary key,
  user_id     uuid,
  ip_hash     text,
  reason      text check (reason is null or char_length(reason) <= 200),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz,
  check (user_id is not null or ip_hash is not null)
);
create index if not exists dayari_bans_user_idx on public.dayari_bans (user_id);
create index if not exists dayari_bans_ip_idx on public.dayari_bans (ip_hash);

-- Rate limit counters. Just a key (e.g. "post:user:<id>") and a time. Deleted after 2 days.
create table if not exists public.dayari_rate_events (
  id          bigint generated always as identity primary key,
  bucket      text not null,
  created_at  timestamptz not null default now()
);
create index if not exists dayari_rate_events_idx on public.dayari_rate_events (bucket, created_at);

-- Counts of rejected posts for the admin stats. Only the reason and day: never the
-- text, never who wrote it.
create table if not exists public.dayari_rejections (
  id          bigint generated always as identity primary key,
  day         date not null default (now() at time zone 'Asia/Manila')::date,
  reason      text not null check (char_length(reason) <= 40),
  created_at  timestamptz not null default now()
);
create index if not exists dayari_rejections_day_idx on public.dayari_rejections (day);


-- ---------------------------------------------------------------------
-- 2. Locks (Row Level Security + privileges)
--    Supabase gives anon/authenticated full privileges on new tables by
--    default, so take them all away first, then give back only what's needed.
-- ---------------------------------------------------------------------

alter table public.dayari_posts       enable row level security;
alter table public.dayari_reports     enable row level security;
alter table public.dayari_bans        enable row level security;
alter table public.dayari_rate_events enable row level security;
alter table public.dayari_rejections  enable row level security;

revoke all on table public.dayari_posts, public.dayari_reports, public.dayari_bans,
  public.dayari_rate_events, public.dayari_rejections from anon, authenticated, public;

-- Public reading: published posts only, and only these columns.
drop policy if exists "dayari posts: read published" on public.dayari_posts;
create policy "dayari posts: read published" on public.dayari_posts
  for select to anon, authenticated
  using (status = 'published');
grant select (id, entry_date, body, created_at) on public.dayari_posts to anon, authenticated;

-- No insert/update/delete rules anywhere = no direct writes, for anyone.
-- The other four tables have no rules at all = unreachable from the API.


-- ---------------------------------------------------------------------
-- 3. Writer's own posts (read-only; deleting goes through the Edge Function)
-- ---------------------------------------------------------------------

create or replace function public.dayari_my_posts()
returns table (id bigint, entry_date date, body text, status text, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.entry_date, p.body, p.status, p.created_at
  from public.dayari_posts p
  where auth.uid() is not null and p.author_id = auth.uid()
  order by p.created_at desc
  limit 100;
$$;
revoke all on function public.dayari_my_posts() from public, anon;
grant execute on function public.dayari_my_posts() to authenticated;


-- ---------------------------------------------------------------------
-- 4. Service-only functions, called by the Edge Function with the
--    service key. Nobody else can run them.
-- ---------------------------------------------------------------------

-- Ban check + rate limit for one action. Records the attempt.
-- Returns 'ok', 'banned', 'rate_user' or 'rate_ip'.
create or replace function public.dayari_gate(p_user uuid, p_ip_hash text, p_action text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  limits jsonb := jsonb_build_object(
    -- action: [per user per hour, per user per day, per network per hour, per network per day]
    'post',   jsonb_build_array(6, 15, 20, 60),
    'report', jsonb_build_array(10, 30, 20, 60),
    'delete', jsonb_build_array(30, 100, 60, 200)
  );
  l jsonb;
  ubucket text := p_action || ':user:' || p_user::text;
  ibucket text := p_action || ':ip:' || coalesce(p_ip_hash, 'none');
begin
  l := limits -> p_action;
  if l is null then
    raise exception 'unknown action %', p_action;
  end if;

  if exists (
    select 1 from public.dayari_bans b
    where (b.user_id = p_user or (p_ip_hash is not null and b.ip_hash = p_ip_hash))
      and (b.expires_at is null or b.expires_at > now())
  ) then
    return 'banned';
  end if;

  -- one at a time per user, so two requests at once can't both squeeze under the limit
  perform pg_advisory_xact_lock(hashtext(ubucket));

  -- housekeeping: old counters, and network hashes older than 30 days
  delete from public.dayari_rate_events where created_at < now() - interval '2 days';
  update public.dayari_posts set ip_hash = null
    where ip_hash is not null and created_at < now() - interval '30 days';

  if (select count(*) from public.dayari_rate_events where bucket = ubucket and created_at > now() - interval '1 hour') >= (l ->> 0)::int
     or (select count(*) from public.dayari_rate_events where bucket = ubucket and created_at > now() - interval '1 day') >= (l ->> 1)::int then
    return 'rate_user';
  end if;
  if (select count(*) from public.dayari_rate_events where bucket = ibucket and created_at > now() - interval '1 hour') >= (l ->> 2)::int
     or (select count(*) from public.dayari_rate_events where bucket = ibucket and created_at > now() - interval '1 day') >= (l ->> 3)::int then
    return 'rate_ip';
  end if;

  insert into public.dayari_rate_events (bucket) values (ubucket), (ibucket);
  return 'ok';
end;
$$;

-- Save a post that passed the checks.
create or replace function public.dayari_insert_post(
  p_user uuid, p_body text, p_status text, p_crisis boolean,
  p_reasons text[], p_moderation jsonb, p_ip_hash text)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  new_id bigint;
begin
  insert into public.dayari_posts
    (author_id, body, status, crisis, needs_review, review_reasons, moderation, ip_hash)
  values
    (p_user, p_body, p_status, p_crisis, cardinality(p_reasons) > 0, p_reasons,
     coalesce(p_moderation, '{}'::jsonb), p_ip_hash)
  returning id into new_id;
  return new_id;
end;
$$;

-- Count a rejected post (reason only) for the admin stats.
create or replace function public.dayari_log_rejection(p_reason text)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.dayari_rejections (reason) values (left(p_reason, 40));
$$;

-- Report a post. 3 reports (from 3 different accounts on 3 different networks)
-- hide it until the owner reviews it.
-- Returns 'reported', 'hidden', 'already', 'own' or 'missing'.
create or replace function public.dayari_add_report(p_post bigint, p_user uuid, p_ip_hash text, p_reason text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  post record;
  n int;
begin
  select id, author_id, status into post from public.dayari_posts where id = p_post for update;
  if not found or post.status <> 'published' then
    return 'missing';
  end if;
  if post.author_id = p_user then
    return 'own';
  end if;
  begin
    insert into public.dayari_reports (post_id, reporter_id, ip_hash, reason)
    values (p_post, p_user, coalesce(p_ip_hash, 'none'), nullif(left(btrim(coalesce(p_reason, '')), 200), ''));
  exception when unique_violation then
    return 'already';
  end;
  select count(*) into n from public.dayari_reports where post_id = p_post;
  if n >= 3 then
    update public.dayari_posts
      set report_count = n, status = 'hidden', needs_review = true,
          review_reasons = (select array_agg(distinct r) from unnest(review_reasons || array['reports']) r)
      where id = p_post;
    return 'hidden';
  end if;
  update public.dayari_posts set report_count = n where id = p_post;
  return 'reported';
end;
$$;

-- A writer deletes their own post. Returns true if something was deleted.
create or replace function public.dayari_delete_own(p_post bigint, p_user uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  delete from public.dayari_posts where id = p_post and author_id = p_user;
  return found;
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.dayari_gate(uuid, text, text)',
    'public.dayari_insert_post(uuid, text, text, boolean, text[], jsonb, text)',
    'public.dayari_log_rejection(text)',
    'public.dayari_add_report(bigint, uuid, text, text)',
    'public.dayari_delete_own(bigint, uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;


-- ---------------------------------------------------------------------
-- 5. Owner-only functions for /admin
--    Each one refuses anyone who isn't the owner (with 2-step login if on).
--    The writer's ID is never shown, only a short tag ("writer 3f9a1c")
--    so the owner can tell when several posts came from the same person.
-- ---------------------------------------------------------------------

create or replace function public.dayari_require_owner()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_owner() then
    raise exception 'owner only' using errcode = '42501';
  end if;
end;
$$;

-- p_view: 'queue' (needs review), 'held', 'reported', 'crisis', 'hidden' or 'recent'
create or replace function public.dayari_admin_posts(p_view text default 'queue', p_limit int default 100)
returns table (
  id bigint, entry_date date, body text, status text, crisis boolean,
  needs_review boolean, review_reasons text[], report_count int,
  report_reasons text[], moderation jsonb, writer text, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.dayari_require_owner();
  return query
    select p.id, p.entry_date, p.body, p.status, p.crisis, p.needs_review,
           p.review_reasons, p.report_count,
           coalesce((select array_agg(r.reason order by r.created_at) from public.dayari_reports r
                     where r.post_id = p.id and r.reason is not null), '{}'),
           p.moderation,
           left(md5(p.author_id::text), 6),
           p.created_at
    from public.dayari_posts p
    where case p_view
      when 'queue'    then p.needs_review
      when 'held'     then p.status = 'held'
      when 'reported' then p.report_count > 0
      when 'crisis'   then p.crisis
      when 'hidden'   then p.status = 'hidden'
      else true
    end
    order by case when p_view = 'queue' then p.created_at end asc,
             p.created_at desc
    limit least(greatest(coalesce(p_limit, 100), 1), 500);
end;
$$;

-- p_action: 'approve' (publish, clear reports), 'hide', 'delete', 'reviewed' (keep as is, leave the queue)
create or replace function public.dayari_admin_act(p_post bigint, p_action text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform public.dayari_require_owner();
  if p_action = 'approve' then
    delete from public.dayari_reports where post_id = p_post;
    update public.dayari_posts
      set status = 'published', needs_review = false, report_count = 0, reviewed_at = now()
      where id = p_post;
  elsif p_action = 'hide' then
    update public.dayari_posts
      set status = 'hidden', needs_review = false, reviewed_at = now()
      where id = p_post;
  elsif p_action = 'reviewed' then
    update public.dayari_posts
      set needs_review = false, reviewed_at = now()
      where id = p_post;
  elsif p_action = 'delete' then
    delete from public.dayari_posts where id = p_post;
  else
    raise exception 'unknown action %', p_action;
  end if;
  if not found then
    return 'missing';
  end if;
  return 'ok';
end;
$$;

-- Ban the anonymous account that wrote a post (until lifted) and its network
-- (30 days), and hide all of that account's posts.
create or replace function public.dayari_admin_ban(p_post bigint, p_reason text default null)
returns int
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  post record;
  n int;
begin
  perform public.dayari_require_owner();
  select author_id, ip_hash into post from public.dayari_posts where id = p_post;
  if not found then
    raise exception 'post % not found', p_post;
  end if;
  if not exists (select 1 from public.dayari_bans where user_id = post.author_id and expires_at is null) then
    insert into public.dayari_bans (user_id, reason) values (post.author_id, left(p_reason, 200));
  end if;
  if post.ip_hash is not null then
    insert into public.dayari_bans (ip_hash, reason, expires_at)
    values (post.ip_hash, left(p_reason, 200), now() + interval '30 days');
  end if;
  update public.dayari_posts
    set status = 'hidden', needs_review = false, reviewed_at = now()
    where author_id = post.author_id and status <> 'hidden';
  get diagnostics n = row_count;
  return n;
end;
$$;

create or replace function public.dayari_admin_bans()
returns table (id bigint, kind text, writer text, reason text, created_at timestamptz, expires_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.dayari_require_owner();
  return query
    select b.id,
           case when b.user_id is not null then 'account' else 'network' end,
           case when b.user_id is not null then left(md5(b.user_id::text), 6) end,
           b.reason, b.created_at, b.expires_at
    from public.dayari_bans b
    where b.expires_at is null or b.expires_at > now()
    order by b.created_at desc
    limit 200;
end;
$$;

create or replace function public.dayari_admin_unban(p_ban bigint)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform public.dayari_require_owner();
  delete from public.dayari_bans where id = p_ban;
end;
$$;

create or replace function public.dayari_admin_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  today date := (now() at time zone 'Asia/Manila')::date;
begin
  perform public.dayari_require_owner();
  return jsonb_build_object(
    'today', today,
    'published_total', (select count(*) from public.dayari_posts where status = 'published'),
    'posts_today',     (select count(*) from public.dayari_posts where entry_date = today),
    'writers_today',   (select count(distinct author_id) from public.dayari_posts where entry_date = today),
    'needs_review',    (select count(*) from public.dayari_posts where needs_review),
    'held',            (select count(*) from public.dayari_posts where status = 'held'),
    'hidden',          (select count(*) from public.dayari_posts where status = 'hidden'),
    'crisis_today',    (select count(*) from public.dayari_posts where crisis and entry_date = today),
    'reports_today',   (select count(*) from public.dayari_reports where created_at >= (today::timestamp at time zone 'Asia/Manila')),
    'active_bans',     (select count(*) from public.dayari_bans where expires_at is null or expires_at > now()),
    'rejected_today',  (select coalesce(jsonb_object_agg(reason, n), '{}') from
                          (select reason, count(*) n from public.dayari_rejections where day = today group by reason) x),
    'rejected_7_days', (select count(*) from public.dayari_rejections where day > today - 7)
  );
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.dayari_require_owner()',
    'public.dayari_admin_posts(text, int)',
    'public.dayari_admin_act(bigint, text)',
    'public.dayari_admin_ban(bigint, text)',
    'public.dayari_admin_bans()',
    'public.dayari_admin_unban(bigint)',
    'public.dayari_admin_stats()'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;


-- ---------------------------------------------------------------------
-- 6. Sign-up guard (an Auth hook; you switch it on in the dashboard)
--    Anonymous sign-ins only work while "Allow new users to sign up" is on.
--    This hook makes sure that switch can't be used to make a real
--    (email/phone) account: only anonymous accounts get created.
--    If you ever need to add a real user yourself, turn the hook off for
--    a minute, add them, and turn it back on.
-- ---------------------------------------------------------------------

create or replace function public.dayari_before_user_created(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
begin
  if coalesce((event -> 'user' ->> 'is_anonymous')::boolean, false)
     and coalesce(event -> 'user' ->> 'email', '') = ''
     and coalesce(event -> 'user' ->> 'phone', '') = '' then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('error', jsonb_build_object(
    'http_code', 403,
    'message', 'Sign-ups are closed. Dayari Mo only uses anonymous accounts.'));
end;
$$;

revoke all on function public.dayari_before_user_created(jsonb) from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    grant execute on function public.dayari_before_user_created(jsonb) to supabase_auth_admin;
  end if;
end;
$$;
