/*
Streak diagnostic — run in the Supabase SQL Editor.

Answers, in order: did the row change, does the write path exist, and is the old
forgeable path still open.
*/

-- ── 1. THE ACTUAL ROW ───────────────────────────────────────────────────────
-- This is the number the dashboard renders. If current_streak is 0 and
-- last_checkin_date is NULL, nothing wrote the increment.
SELECT
  u.username,
  u.current_streak,
  u.last_checkin_date,
  (u.last_checkin_date = current_date) AS checked_in_today
FROM public.users u
ORDER BY u.username;

-- Did a verified log row get written today, even if the counter didn't move?
-- This distinguishes "nothing ran" from "the log wrote but the counter didn't".
SELECT
  sl.log_date,
  sl.verified,
  left(coalesce(sl.note, ''), 80) AS note,
  sl.created_at
FROM public.streak_logs sl
ORDER BY sl.created_at DESC
LIMIT 10;


-- ── 2. DOES THE WRITE PATH EXIST? ───────────────────────────────────────────
-- EXPECT 1 row. 0 rows means migration 20260730120000_record_checkin.sql was
-- never applied — which is the whole explanation: the Edge Function calls a
-- function that isn't there.
SELECT
  p.proname,
  p.prosecdef AS security_definer,
  p.proconfig,
  pg_get_function_identity_arguments(p.oid) AS args
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'record_checkin';

-- EXPECT service_role = true, the others false.
-- Errors with "function does not exist" if the migration is not applied.
SELECT
  has_function_privilege('service_role',  'public.record_checkin(uuid,text,date)', 'EXECUTE') AS service_role_can_execute,
  has_function_privilege('authenticated', 'public.record_checkin(uuid,text,date)', 'EXECUTE') AS authenticated_can_execute;


-- ── 3. IS THE FORGEABLE PATH STILL OPEN? ────────────────────────────────────
-- EXPECT all false except can_read_logs. Any true here means the lockdown in
-- that migration has not landed and the client can still write these directly.
SELECT
  has_table_privilege ('authenticated', 'public.streak_logs', 'INSERT')             AS can_insert_logs,
  has_table_privilege ('authenticated', 'public.streak_logs', 'UPDATE')             AS can_update_logs,
  has_table_privilege ('authenticated', 'public.streak_logs', 'DELETE')             AS can_delete_logs,
  has_table_privilege ('authenticated', 'public.streak_logs', 'SELECT')             AS can_read_logs,
  has_column_privilege('authenticated', 'public.users', 'current_streak', 'UPDATE') AS can_write_streak;

-- EXPECT SELECT only. An insert/update/delete policy still listed means the old
-- client-writable path survives.
SELECT policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'streak_logs'
ORDER BY cmd;
