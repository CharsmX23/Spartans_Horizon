/*
Phase 1 verification — run in the Supabase SQL Editor after applying all four
migrations and completing a signup -> create-squad -> sign-out -> join-by-code loop
with two accounts.

Each query states the expected result. Anything else is a real finding.
*/

-- ── 1. Accounts, trigger, and squad membership ──────────────────────────────
-- EXPECT: one row per test account; `username` non-null on both (proves the
-- on_auth_user_created trigger fired); identical `squad_id` (proves join_squad
-- worked); identical join_code.
SELECT
  au.email,
  au.created_at,
  au.email_confirmed_at,          -- non-null even with confirmation off
  pu.username,
  pu.squad_id,
  pu.current_streak,
  pu.last_checkin_date,
  s.name  AS squad_name,
  s.join_code
FROM auth.users au
LEFT JOIN public.users  pu ON pu.id = au.id
LEFT JOIN public.squads s  ON s.id  = pu.squad_id
ORDER BY au.created_at;

-- EXPECT: 0. Any row here is an auth account with no profile — the trigger failed.
SELECT count(*) AS accounts_without_profile
FROM auth.users au
LEFT JOIN public.users pu ON pu.id = au.id
WHERE pu.id IS NULL;

-- EXPECT: 1 row — on_auth_user_created, tgenabled = 'O' (enabled).
SELECT tgname, tgenabled
FROM pg_trigger
WHERE tgrelid = 'auth.users'::regclass AND NOT tgisinternal;

-- EXPECT: exactly 1 squad, member_count = 2.
SELECT s.id, s.name, s.join_code, count(pu.id) AS member_count
FROM public.squads s
LEFT JOIN public.users pu ON pu.squad_id = s.id
GROUP BY s.id, s.name, s.join_code;

-- EXPECT: 0 rows. Join codes are UNIQUE, so a collision cannot persist — this
-- confirms the retry loop in create_squad() never had to silently drop one.
SELECT join_code, count(*)
FROM public.squads
GROUP BY join_code
HAVING count(*) > 1;


-- ── 2. The privilege layer, proved from the catalog ─────────────────────────
-- This is stronger than a failed request: it reads what Postgres will enforce.
-- EXPECT: can_write_username = true, EVERYTHING ELSE = false.
SELECT
  has_column_privilege('authenticated', 'public.users', 'username',          'UPDATE') AS can_write_username,
  has_column_privilege('authenticated', 'public.users', 'squad_id',          'UPDATE') AS can_write_squad_id,
  has_column_privilege('authenticated', 'public.users', 'current_streak',    'UPDATE') AS can_write_streak,
  has_column_privilege('authenticated', 'public.users', 'last_checkin_date', 'UPDATE') AS can_write_checkin,
  has_table_privilege ('authenticated', 'public.squads', 'INSERT')                     AS can_insert_squads,
  has_table_privilege ('authenticated', 'public.squads', 'UPDATE')                     AS can_update_squads,
  has_table_privilege ('authenticated', 'public.squads', 'DELETE')                     AS can_delete_squads,
  has_table_privilege ('anon',          'public.users',  'SELECT')                     AS anon_can_read_users;

-- Full grant listing on public.users.
-- EXPECT: authenticated holds SELECT/INSERT on all columns and UPDATE on
-- `username` only. `anon` should not appear at all.
SELECT grantee, column_name, privilege_type
FROM information_schema.column_privileges
WHERE table_schema = 'public'
  AND table_name = 'users'
  AND grantee IN ('anon', 'authenticated')
  AND privilege_type = 'UPDATE'
ORDER BY grantee, column_name;

-- EXPECT: all five functions with security_definer = true and
-- proconfig = {search_path=public}. A SECURITY DEFINER function without a pinned
-- search_path is a privilege-escalation hole.
SELECT p.proname, p.prosecdef AS security_definer, p.proconfig
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('create_squad', 'join_squad', 'username_available',
                    'current_squad_id', 'handle_new_user')
ORDER BY p.proname;

-- EXPECT: RLS enabled (relrowsecurity = true) on both tables.
SELECT relname, relrowsecurity, relforcerowsecurity
FROM pg_class
WHERE oid IN ('public.users'::regclass, 'public.squads'::regclass);

-- Policy listing. EXPECT: users has select/insert/update; squads has select only.
SELECT tablename, policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'public' AND tablename IN ('users', 'squads')
ORDER BY tablename, cmd;
