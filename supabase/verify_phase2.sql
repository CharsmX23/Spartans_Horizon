/*
Phase 2 verification — run in the Supabase SQL Editor after applying
20260728100000_create_learning_paths.sql.

Run verify_phase1.sql first; these tables depend on public.users existing.
*/

-- ── 1. Tables and the composite-FK integrity guard ──────────────────────────
-- EXPECT: 3 rows, rowsecurity = true on all three.
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('learning_paths', 'learning_modules', 'learning_tasks')
ORDER BY tablename;

-- EXPECT: learning_modules -> learning_paths and learning_tasks -> learning_modules,
-- each on TWO columns (the id + user_id pair). A single-column FK here means the
-- ownership guard is missing and a child's user_id could drift from its parent's.
SELECT
  c.conrelid::regclass  AS child_table,
  c.confrelid::regclass AS parent_table,
  array_length(c.conkey, 1) AS fk_column_count
FROM pg_constraint c
WHERE c.contype = 'f'
  AND c.conrelid IN ('public.learning_modules'::regclass, 'public.learning_tasks'::regclass)
ORDER BY child_table;


-- ── 2. Column grants: is_done must NOT be client-writable ───────────────────
-- EXPECT:
--   can_write_label      = true
--   can_write_sort_order = true
--   can_write_is_done    = false   <- the checkbox seam for Phase 4
--   can_write_done_at    = false
--   can_write_user_id    = false   (all three tables)
SELECT
  has_column_privilege('authenticated', 'public.learning_tasks', 'label',      'UPDATE') AS can_write_label,
  has_column_privilege('authenticated', 'public.learning_tasks', 'sort_order', 'UPDATE') AS can_write_sort_order,
  has_column_privilege('authenticated', 'public.learning_tasks', 'is_done',    'UPDATE') AS can_write_is_done,
  has_column_privilege('authenticated', 'public.learning_tasks', 'done_at',    'UPDATE') AS can_write_done_at,
  has_column_privilege('authenticated', 'public.learning_tasks', 'user_id',    'UPDATE') AS can_write_task_user_id,
  has_column_privilege('authenticated', 'public.learning_paths', 'user_id',    'UPDATE') AS can_write_path_user_id,
  has_column_privilege('authenticated', 'public.learning_modules','user_id',   'UPDATE') AS can_write_module_user_id;

-- Every UPDATE-able column across the three tables.
-- EXPECT: paths -> title, overview, foundational_terms, total_timeline_weeks
--         modules -> title, why_it_matters, ai_leverage, estimated_days, sort_order
--         tasks -> label, proof_type, sort_order
-- `anon` must not appear at all.
SELECT table_name, grantee, column_name
FROM information_schema.column_privileges
WHERE table_schema = 'public'
  AND table_name IN ('learning_paths', 'learning_modules', 'learning_tasks')
  AND privilege_type = 'UPDATE'
  AND grantee IN ('anon', 'authenticated')
ORDER BY table_name, column_name;


-- ── 3. Policies and functions ───────────────────────────────────────────────
-- EXPECT: 4 policies per table (select/insert/update/delete), all TO authenticated.
-- SELECT uses shares_squad_with(); the write policies use auth.uid() = user_id.
SELECT tablename, policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('learning_paths', 'learning_modules', 'learning_tasks')
ORDER BY tablename, cmd;

-- EXPECT: both SECURITY DEFINER with search_path pinned to public.
SELECT p.proname, p.prosecdef AS security_definer, p.proconfig
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('set_task_done', 'shares_squad_with')
ORDER BY p.proname;


-- ── 3b. record_checkin() is service_role only ───────────────────────────────
-- EXPECT: service_role = true, everything else = false. If `authenticated` can
-- execute this, any signed-in user can hand themselves a streak without a photo.
SELECT
  has_function_privilege('service_role',   'public.record_checkin(uuid,text,date)', 'EXECUTE') AS service_role_can_execute,
  has_function_privilege('authenticated',  'public.record_checkin(uuid,text,date)', 'EXECUTE') AS authenticated_can_execute,
  has_function_privilege('anon',           'public.record_checkin(uuid,text,date)', 'EXECUTE') AS anon_can_execute;

-- EXPECT: all false — the streak fields are written only by record_checkin().
SELECT
  has_column_privilege('authenticated', 'public.users', 'current_streak',    'UPDATE') AS can_write_streak,
  has_column_privilege('authenticated', 'public.users', 'last_checkin_date', 'UPDATE') AS can_write_checkin_date,
  has_table_privilege ('authenticated', 'public.streak_logs', 'INSERT')                AS can_insert_logs,
  has_table_privilege ('authenticated', 'public.streak_logs', 'UPDATE')                AS can_update_logs,
  has_table_privilege ('authenticated', 'public.streak_logs', 'DELETE')                AS can_delete_logs,
  has_table_privilege ('authenticated', 'public.streak_logs', 'SELECT')                AS can_read_logs;  -- true

-- EXPECT: SELECT only. The write policies were dropped as dead letters.
SELECT policyname, cmd FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'streak_logs' ORDER BY cmd;


-- ── 4. Journals stay private ────────────────────────────────────────────────
-- EXPECT: the SELECT policy on journal_entries is `auth.uid() = user_id` — NOT
-- shares_squad_with(). Journals are personal; squad sharing is for learning paths.
SELECT policyname, cmd, qual
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'journal_entries' AND cmd = 'SELECT';


/*
── 5. Live proof that a checkbox cannot be forged ──────────────────────────────
Run as a signed-in user from the browser console (or adapt the Phase 1 forgery
script). Both must fail:

  -- direct UPDATE: expect "permission denied for column is_done"
  await supabase.from('learning_tasks').update({ is_done: true }).eq('id', '<task-id>');

  -- someone else's task through the RPC: expect "That task belongs to someone else"
  await supabase.rpc('set_task_done', { p_task_id: '<squadmate-task-id>', p_done: true });

And this must succeed on your own task:

  await supabase.rpc('set_task_done', { p_task_id: '<your-task-id>', p_done: true });
*/
