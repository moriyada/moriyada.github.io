-- Dayari Mo database policy tests. Run with: bash tests/dayari/run-sql-tests.sh
-- Each check prints "ok - ..." or stops the run with "FAIL - ...".
--
-- People in these tests:
--   anon   a visitor with no account (role anon)
--   alice  an anonymous Dayari account (role authenticated, is_anonymous)
--   bob    another anonymous Dayari account
--   owner  Deffoh (in site_owner)
--   fn     the Edge Function (role service_role)

\set QUIET on
\pset tuples_only on
\pset format unaligned

create schema if not exists t;
create or replace function t.ok(cond boolean, name text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL - %', name; end if;
  raise notice 'ok - %', name;
end $$;
-- Runs `sql` and checks that it fails (any error). Returns the error text.
create or replace function t.fails(sql text, name text) returns void language plpgsql as $$
begin
  begin
    execute sql;
  exception when others then
    raise notice 'ok - % (refused: %)', name, sqlerrm;
    return;
  end;
  raise exception 'FAIL - % (it was allowed)', name;
end $$;
grant usage on schema t to anon, authenticated, service_role;
grant execute on all functions in schema t to anon, authenticated, service_role;

-- people
insert into auth.users (id, is_anonymous) values
  ('aaaaaaaa-0000-0000-0000-000000000001', true),
  ('bbbbbbbb-0000-0000-0000-000000000002', true),
  ('cccccccc-0000-0000-0000-000000000003', true),
  ('dddddddd-0000-0000-0000-000000000004', true);
insert into auth.users (id, email) values ('99999999-0000-0000-0000-000000000009', 'owner@example.com');
insert into public.site_owner values ('99999999-0000-0000-0000-000000000009');

-- some posts, written the only allowed way (the service functions)
set role service_role;
select t.ok(public.dayari_insert_post('aaaaaaaa-0000-0000-0000-000000000001', 'Alice''s published post', 'published', false, '{}', '{}', 'ipA') = 1, 'fn can save a post');
select public.dayari_insert_post('aaaaaaaa-0000-0000-0000-000000000001', 'Alice''s held post', 'held', false, '{held}', '{"source":"openai"}', 'ipA');
select public.dayari_insert_post('bbbbbbbb-0000-0000-0000-000000000002', 'Bob''s published post', 'published', true, '{crisis}', '{}', 'ipB');
reset role;

\echo '--- strangers cannot write directly ---'
begin;
set local role anon;
select t.fails($$insert into public.dayari_posts (author_id, body) values ('aaaaaaaa-0000-0000-0000-000000000001', 'x')$$, 'visitor cannot insert a post');
select t.fails($$update public.dayari_posts set body = 'x'$$, 'visitor cannot edit posts');
select t.fails($$delete from public.dayari_posts$$, 'visitor cannot delete posts');
select t.fails($$insert into public.dayari_reports (post_id, reporter_id, ip_hash) values (1, 'aaaaaaaa-0000-0000-0000-000000000001', 'x')$$, 'visitor cannot insert a report');
rollback;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":true}';
select t.fails($$insert into public.dayari_posts (author_id, body) values ('aaaaaaaa-0000-0000-0000-000000000001', 'x')$$, 'anonymous account cannot insert a post directly');
select t.fails($$update public.dayari_posts set status = 'published' where id = 2$$, 'anonymous account cannot publish its held post');
select t.fails($$delete from public.dayari_posts where id = 1$$, 'anonymous account cannot delete directly, even its own');
select t.fails($$insert into public.dayari_reports (post_id, reporter_id, ip_hash) values (3, 'aaaaaaaa-0000-0000-0000-000000000001', 'x')$$, 'anonymous account cannot insert a report directly');
select t.fails($$insert into public.dayari_bans (user_id) values ('bbbbbbbb-0000-0000-0000-000000000002')$$, 'anonymous account cannot ban');
select t.fails($$delete from public.dayari_bans$$, 'anonymous account cannot lift bans');
select t.fails($$insert into public.dayari_rate_events (bucket) values ('x')$$, 'anonymous account cannot touch rate limits');
select t.fails($$delete from public.dayari_rate_events$$, 'anonymous account cannot reset rate limits');
select t.fails($$select public.dayari_insert_post('aaaaaaaa-0000-0000-0000-000000000001', 'x', 'published', false, '{}', '{}', null)$$, 'anonymous account cannot call the save function');
select t.fails($$select public.dayari_delete_own(3, 'bbbbbbbb-0000-0000-0000-000000000002')$$, 'anonymous account cannot call the delete function (even pretending to be the author)');
select t.fails($$select public.dayari_add_report(3, 'aaaaaaaa-0000-0000-0000-000000000001', 'x', null)$$, 'anonymous account cannot call the report function');
select t.fails($$select public.dayari_gate('aaaaaaaa-0000-0000-0000-000000000001', 'x', 'post')$$, 'anonymous account cannot call the rate limit function');
select t.fails($$select public.dayari_log_rejection('x')$$, 'anonymous account cannot fake rejection stats');
-- the personal diary is still owner-only
select t.fails($$insert into public.entries (type, data) values ('thought', '{"text":"hi"}')$$, 'anonymous account cannot post to the personal diary');
select t.fails($$insert into public.quotes (text) values ('hi')$$, 'anonymous account cannot add to the personal quotes');
rollback;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"99999999-0000-0000-0000-000000000009","role":"authenticated"}';
select t.fails($$insert into public.dayari_posts (author_id, body) values ('99999999-0000-0000-0000-000000000009', 'x')$$, 'even the owner cannot insert directly');
select t.fails($$update public.dayari_posts set body = 'edited'$$, 'even the owner cannot edit posts directly');
rollback;

\echo '--- strangers cannot see private IDs ---'
begin;
set local role anon;
select t.ok((select count(*) from public.dayari_posts) = 2, 'visitors see only the 2 published posts');
select t.ok((select string_agg(body, '|' order by id) from public.dayari_posts) = 'Alice''s published post|Bob''s published post', 'visitors see the published text, not the held one');
select t.fails($$select author_id from public.dayari_posts$$, 'visitors cannot read author_id');
select t.fails($$select ip_hash from public.dayari_posts$$, 'visitors cannot read ip_hash');
select t.fails($$select moderation from public.dayari_posts$$, 'visitors cannot read moderation notes');
select t.fails($$select * from public.dayari_posts$$, 'select * is refused (it would include author_id)');
select t.fails($$select * from public.dayari_reports$$, 'visitors cannot read reports');
select t.fails($$select * from public.dayari_bans$$, 'visitors cannot read bans');
select t.fails($$select * from public.dayari_rate_events$$, 'visitors cannot read rate limits');
select t.fails($$select * from public.dayari_rejections$$, 'visitors cannot read rejection stats');
select t.fails($$select * from public.dayari_my_posts()$$, 'visitors (no account) cannot call my_posts');
select t.fails($$select public.dayari_admin_stats()$$, 'visitors cannot call admin functions');
rollback;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated","is_anonymous":true}';
select t.fails($$select author_id from public.dayari_posts$$, 'anonymous accounts cannot read author_id either');
select t.ok((select count(*) from public.dayari_my_posts()) = 1, 'Bob''s my_posts lists only his 1 post');
select t.ok((select body from public.dayari_my_posts()) = 'Bob''s published post', 'my_posts returns his own text');
select t.ok(not exists (select 1 from public.dayari_my_posts() where body like 'Alice%'), 'my_posts never shows someone else''s posts');
select t.fails($$select public.dayari_admin_stats()$$, 'anonymous accounts cannot see admin stats');
select t.fails($$select * from public.dayari_admin_posts('queue', 10)$$, 'anonymous accounts cannot see the review queue');
select t.fails($$select public.dayari_admin_act(1, 'delete')$$, 'anonymous accounts cannot use admin actions');
select t.fails($$select public.dayari_admin_ban(1, null)$$, 'anonymous accounts cannot ban');
rollback;

\echo '--- deleting own posts only ---'
set role service_role;
select t.ok(public.dayari_delete_own(1, 'bbbbbbbb-0000-0000-0000-000000000002') = false, 'Bob cannot delete Alice''s post');
select t.ok((select count(*) from public.dayari_posts where id = 1) = 1, 'Alice''s post is still there');
select t.ok(public.dayari_delete_own(2, 'aaaaaaaa-0000-0000-0000-000000000001') = true, 'Alice can delete her own (held) post');
select t.ok((select count(*) from public.dayari_posts where id = 2) = 0, 'it is gone');
reset role;

\echo '--- reports ---'
set role service_role;
select t.ok(public.dayari_add_report(1, 'aaaaaaaa-0000-0000-0000-000000000001', 'ipA', null) = 'own', 'you cannot report your own post');
select t.ok(public.dayari_add_report(1, 'bbbbbbbb-0000-0000-0000-000000000002', 'ipB', 'mean') = 'reported', 'report 1 counts');
select t.ok(public.dayari_add_report(1, 'bbbbbbbb-0000-0000-0000-000000000002', 'ipZ', null) = 'already', 'the same account cannot report twice');
select t.ok(public.dayari_add_report(1, 'cccccccc-0000-0000-0000-000000000003', 'ipB', null) = 'already', 'a second account on the same network does not count');
select t.ok(public.dayari_add_report(1, 'cccccccc-0000-0000-0000-000000000003', 'ipC', null) = 'reported', 'report 2 counts');
select t.ok((select status from public.dayari_posts where id = 1) = 'published', 'still public after 2 reports');
select t.ok(public.dayari_add_report(1, 'dddddddd-0000-0000-0000-000000000004', 'ipD', null) = 'hidden', 'report 3 hides it');
select t.ok((select status = 'hidden' and needs_review and 'reports' = any(review_reasons) and report_count = 3 from public.dayari_posts where id = 1), 'hidden post waits in the review queue');
select t.ok(public.dayari_add_report(1, '99999999-0000-0000-0000-000000000009', 'ipE', null) = 'missing', 'a hidden post cannot be reported again');
reset role;
begin;
set local role anon;
select t.ok((select count(*) from public.dayari_posts where id = 1) = 0, 'visitors no longer see the hidden post');
rollback;

\echo '--- rate limits and bans ---'
set role service_role;
select t.ok((select count(*) from generate_series(1, 6) g where public.dayari_gate('cccccccc-0000-0000-0000-000000000003', 'ipC', 'post') = 'ok') = 6, '6 posts an hour are allowed');
select t.ok(public.dayari_gate('cccccccc-0000-0000-0000-000000000003', 'ipC', 'post') = 'rate_user', 'the 7th in an hour is refused (per account)');
select t.ok((select count(*) from generate_series(1, 20) g
             where public.dayari_gate(gen_random_uuid(), 'ipShared', 'post') = 'ok') = 20, '20 accounts on one network are allowed in an hour');
select t.ok(public.dayari_gate(gen_random_uuid(), 'ipShared', 'post') = 'rate_ip', 'a 21st new account on that network is refused (per network)');
select t.ok(public.dayari_gate('cccccccc-0000-0000-0000-000000000003', 'ipC', 'report') = 'ok', 'limits are counted per action');
reset role;

\echo '--- owner admin ---'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"99999999-0000-0000-0000-000000000009","role":"authenticated","aal":"aal1"}';
select t.ok((select count(*) from public.dayari_admin_posts('queue', 50)) = 2, 'owner sees the 2 posts in the queue (reported + crisis)');
select t.ok((select writer from public.dayari_admin_posts('queue', 50) where id = 1) = left(md5('aaaaaaaa-0000-0000-0000-000000000001'), 6), 'admin shows a short writer tag, not the ID');
select t.ok((public.dayari_admin_stats() ->> 'needs_review')::int = 2, 'stats count the queue');
select t.ok(public.dayari_admin_act(1, 'approve') = 'ok', 'owner approves the reported post');
select t.ok((select status = 'published' and not needs_review and report_count = 0 from public.dayari_admin_posts('recent', 50) where id = 1), 'approved: public again, reports cleared');
select t.ok(public.dayari_admin_act(3, 'reviewed') = 'ok', 'owner marks the crisis post as seen');
select t.ok(public.dayari_admin_ban(1, 'test') = 1, 'owner bans the writer of post 1 (hides 1 post)');
select t.ok((select count(*) from public.dayari_admin_bans()) = 2, 'ban covers the account and the network');
rollback;
-- (rolled back; do the ban for real to test it blocks)
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"99999999-0000-0000-0000-000000000009","role":"authenticated"}';
select t.ok(public.dayari_admin_ban(1, 'test') >= 0, 'ban saved');
commit;
set role service_role;
select t.ok(public.dayari_gate('aaaaaaaa-0000-0000-0000-000000000001', 'ipNew', 'post') = 'banned', 'banned account cannot post from a new network');
select t.ok(public.dayari_gate(gen_random_uuid(), 'ipA', 'post') = 'banned', 'a new account on the banned network cannot post (30 days)');
reset role;

-- owner with 2-step login turned on but only a password session: refused
insert into auth.mfa_factors (user_id, status) values ('99999999-0000-0000-0000-000000000009', 'verified');
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"99999999-0000-0000-0000-000000000009","role":"authenticated","aal":"aal1"}';
select t.fails($$select public.dayari_admin_stats()$$, 'owner without the 2-step code cannot use admin');
set local request.jwt.claims = '{"sub":"99999999-0000-0000-0000-000000000009","role":"authenticated","aal":"aal2"}';
select t.ok(public.dayari_admin_stats() is not null, 'owner with the 2-step code can');
rollback;

\echo '--- data rules ---'
set role service_role;
select t.fails($$select public.dayari_insert_post('aaaaaaaa-0000-0000-0000-000000000001', '   ', 'published', false, '{}', '{}', null)$$, 'blank posts are refused');
select t.fails($$select public.dayari_insert_post('aaaaaaaa-0000-0000-0000-000000000001', repeat('a', 2001), 'published', false, '{}', '{}', null)$$, 'posts over 2000 characters are refused');
select t.fails($$select public.dayari_insert_post('aaaaaaaa-0000-0000-0000-000000000001', 'x', 'featured', false, '{}', '{}', null)$$, 'unknown status is refused');
reset role;

\echo '--- sign-up guard hook ---'
select t.ok(public.dayari_before_user_created('{"user":{"is_anonymous":true,"email":"","phone":""}}') = '{}'::jsonb, 'anonymous sign-ups are allowed');
select t.ok(public.dayari_before_user_created('{"user":{"is_anonymous":false,"email":"x@y.com","phone":""}}') ? 'error', 'email sign-ups are refused');
select t.ok(public.dayari_before_user_created('{"user":{"email":"","phone":"+639171234567"}}') ? 'error', 'phone sign-ups are refused');
select t.ok(public.dayari_before_user_created('{"user":{"email":null,"phone":""}}') = '{}'::jsonb, 'no email and no phone = anonymous, allowed');
select t.ok(public.dayari_before_user_created('{"user":{"is_anonymous":false,"email":"","phone":""}}') ? 'error', 'marked not-anonymous is refused');

\echo 'ALL DATABASE TESTS PASSED'
