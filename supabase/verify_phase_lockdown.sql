/*
⚠ PARTS B AND C ARE OBSOLETE — they assert a lockdown that no longer exists.

`20260808120000_manual_phase_completion.sql` dropped the trigger and
`set_phase_verified()`: path phases are completed by hand now, so every "EXPECT: rejected"
in Part B and every forge attempt in Part C should now SUCCEED. Do not run them and read a
pass as a regression. That migration carries its own VERIFY block; use it instead.

Part A still applies — the dropped-tables checks are unaffected.

────────────────────────────────────────────────────────────────────────────────
Verification for the Power Up restructure — run in the Supabase SQL Editor.

Part A after 20260807120000_drop_learning_modules_tasks.sql.
Part B after 20260807130000_set_phase_verified.sql.  [OBSOLETE — see above]
Part C is the live forge attempt, run from the browser console as a signed-in user.
                                                     [OBSOLETE — see above]

Nothing here writes except Part B's §6, which is clearly marked, wrapped in an explicit
transaction, and rolled back.
*/


-- ════════════════════════════════════════════════════════════════════════════
-- PART A — after the drop migration
-- ════════════════════════════════════════════════════════════════════════════

-- ── A1. The two tables are gone, the keepers are not ────────────────────────
-- EXPECT: learning_modules = NULL, learning_tasks = NULL,
--         learning_paths and path_phases both non-NULL.
SELECT
  to_regclass('public.learning_modules') AS learning_modules,
  to_regclass('public.learning_tasks')   AS learning_tasks,
  to_regclass('public.learning_paths')   AS learning_paths,
  to_regclass('public.path_phases')      AS path_phases;

-- ── A2. set_task_done() is gone; shares_squad_with() is not ─────────────────
-- EXPECT: set_task_done = NULL, shares_squad_with non-NULL.
SELECT
  to_regprocedure('public.set_task_done(uuid,boolean)') AS set_task_done,
  to_regprocedure('public.shares_squad_with(uuid)')     AS shares_squad_with;

-- EXPECT: 0 rows. A function's grants are dropped with the function; this proves no
-- orphaned EXECUTE entry survived.
SELECT routine_name, grantee, privilege_type
FROM information_schema.routine_privileges
WHERE routine_schema = 'public' AND routine_name = 'set_task_done';

-- ── A3. learning_paths kept UNIQUE (id, user_id) ────────────────────────────
-- The composite FK from path_phases points at this pair. It was originally added for
-- learning_modules, so the drop is exactly when it could go missing unnoticed.
-- EXPECT: one row, columns = {id, user_id}.
SELECT
  c.conname,
  (SELECT array_agg(a.attname ORDER BY a.attname)
     FROM unnest(c.conkey) k
     JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k) AS columns
FROM pg_constraint c
WHERE c.conrelid = 'public.learning_paths'::regclass
  AND c.contype = 'u';

-- EXPECT: one row — path_phases -> learning_paths on TWO columns. A single-column FK
-- means the ownership guard on phases is gone.
SELECT
  c.conrelid::regclass  AS child_table,
  c.confrelid::regclass AS parent_table,
  array_length(c.conkey, 1) AS fk_column_count
FROM pg_constraint c
WHERE c.contype = 'f' AND c.conrelid = 'public.path_phases'::regclass;

-- ── A4. No dangling references to the dropped tables ────────────────────────
-- EXPECT: 0 rows. Any policy or function body still naming them would now be broken.
SELECT p.proname
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prosrc ~* '\mlearning_(modules|tasks)\M';

SELECT tablename, policyname
FROM pg_policies
WHERE schemaname = 'public'
  AND (qual ~* 'learning_(modules|tasks)' OR with_check ~* 'learning_(modules|tasks)');


-- ════════════════════════════════════════════════════════════════════════════
-- PART B — after the set_phase_verified migration
-- ════════════════════════════════════════════════════════════════════════════

-- ── B1. The trigger exists, and is BEFORE + row-level ───────────────────────
-- EXPECT: one row.
--   timing = 'BEFORE'                <- an AFTER trigger cannot stop the write
--   level  = 'ROW'                   <- a STATEMENT trigger has no NEW.id to check
--   events = INSERT and UPDATE
--   enabled = 'O' (enabled, origin)
SELECT
  t.tgname,
  CASE WHEN (t.tgtype & 2) <> 0 THEN 'BEFORE' ELSE 'AFTER' END  AS timing,
  CASE WHEN (t.tgtype & 1) <> 0 THEN 'ROW'    ELSE 'STATEMENT' END AS level,
  CASE WHEN (t.tgtype &  4) <> 0 THEN 'INSERT ' ELSE '' END
  || CASE WHEN (t.tgtype & 16) <> 0 THEN 'UPDATE ' ELSE '' END
  || CASE WHEN (t.tgtype &  8) <> 0 THEN 'DELETE' ELSE '' END      AS events,
  t.tgenabled AS enabled,
  p.proname   AS trigger_function
FROM pg_trigger t
JOIN pg_proc p ON p.oid = t.tgfoid
WHERE t.tgrelid = 'public.path_phases'::regclass
  AND NOT t.tgisinternal;

-- ── B2. Both functions are declared the way the guard assumes ───────────────
-- EXPECT:
--   set_phase_verified                    security_definer = true,  search_path=public
--   path_phases_block_forged_completion   security_definer = false, search_path=public
-- The trigger function must NOT be definer — it reads a GUC and needs no privilege of
-- its own, and a definer trigger is a needless escalation surface.
SELECT p.proname, p.prosecdef AS security_definer, p.proconfig
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('set_phase_verified', 'path_phases_block_forged_completion')
ORDER BY p.proname;

-- ── B3. Grants: the column grant is deliberately still wide ─────────────────
-- EXPECT: can_write_status = true. This is not a bug. The client has to write `live`
-- and `pending`; the trigger is what narrows the column to those two values. If this
-- reads false, somebody "hardened" the grant and every status change is now broken.
-- EXPECT: can_write_user_id = false, can_write_path_id = false — a phase can never be
-- reassigned to another user or moved to another path from the client.
SELECT
  has_column_privilege('authenticated', 'public.path_phases', 'status',      'UPDATE') AS can_write_status,
  has_column_privilege('authenticated', 'public.path_phases', 'title',       'UPDATE') AS can_write_title,
  has_column_privilege('authenticated', 'public.path_phases', 'target_date', 'UPDATE') AS can_write_target_date,
  has_column_privilege('authenticated', 'public.path_phases', 'user_id',     'UPDATE') AS can_write_user_id,
  has_column_privilege('authenticated', 'public.path_phases', 'path_id',     'UPDATE') AS can_write_path_id,
  has_table_privilege ('authenticated', 'public.path_phases', 'INSERT')                AS can_insert,
  has_table_privilege ('authenticated', 'public.path_phases', 'DELETE')                AS can_delete;

-- Every UPDATE-able column, and who holds it.
-- EXPECT: authenticated -> description, order_index, start_date, status, target_date,
--         title. `anon` must not appear at all.
SELECT grantee, column_name
FROM information_schema.column_privileges
WHERE table_schema = 'public'
  AND table_name = 'path_phases'
  AND privilege_type = 'UPDATE'
  AND grantee IN ('anon', 'authenticated')
ORDER BY grantee, column_name;

-- EXPECT: authenticated = false, anon = false, service_role = true.
--
-- The signature is `(p_user_id uuid, p_phase_id uuid)` and the function is service_role-
-- only. An earlier draft took `(p_phase_id uuid)` with EXECUTE granted to `authenticated`,
-- reading the caller from auth.uid(); that was tested and rejected, because it closed the
-- PATCH forge path while leaving the RPC one open — a signed-in user could complete their
-- own phase from the console with no photo. See the migration header.
--
-- Note that `GRANT ... TO service_role` alone would NOT produce anon = false: Postgres
-- grants EXECUTE to PUBLIC on every new function, and anon inherits through it. The
-- REVOKE in the migration is what makes this row read the way it should.
SELECT
  to_regprocedure('public.set_phase_verified(uuid)')::text      AS old_1arg_must_be_null,
  to_regprocedure('public.set_phase_verified(uuid,uuid)')::text AS current_signature,
  has_function_privilege('authenticated', 'public.set_phase_verified(uuid,uuid)', 'EXECUTE') AS authenticated_can_execute,
  has_function_privilege('anon',          'public.set_phase_verified(uuid,uuid)', 'EXECUTE') AS anon_can_execute,
  has_function_privilege('service_role',  'public.set_phase_verified(uuid,uuid)', 'EXECUTE') AS service_role_can_execute;

-- ── B4. The guard rejects a plain UPDATE — even as `postgres` ───────────────
-- WRITES, THEN ROLLS BACK. Run the whole block at once.
--
-- EXPECT: the UPDATE fails with
--   ERROR: A phase is completed by photo verification, not by writing status directly
-- and the ROLLBACK is then a formality. If it *succeeds*, the trigger is not firing —
-- check B1 before trusting anything else in this file.
--
-- Substitute a real phase id that is not already completed:
--   SELECT id, title, status FROM path_phases WHERE status <> 'completed' LIMIT 5;
/*
BEGIN;
  UPDATE path_phases SET status = 'completed' WHERE id = '<phase-uuid>';
ROLLBACK;
*/

-- ── B5. The ticket lets the same UPDATE through ─────────────────────────────
-- The other half: prove the guard is a gate and not a wall, or a passing photo would
-- fail too and you would not find out until Gemini said yes.
-- EXPECT: UPDATE 1, then rolled back.
/*
BEGIN;
  SELECT set_config('app.verified_phase_id', '<phase-uuid>', true);
  UPDATE path_phases SET status = 'completed' WHERE id = '<phase-uuid>';
  SELECT id, status FROM path_phases WHERE id = '<phase-uuid>';   -- completed
ROLLBACK;
*/

-- ── B6. A ticket is good for one row only ───────────────────────────────────
-- The reason the GUC holds an id instead of a boolean. Ticket for phase A, UPDATE
-- targeting A and B in one statement.
-- EXPECT: rejected — the statement fails when it reaches B.
/*
BEGIN;
  SELECT set_config('app.verified_phase_id', '<phase-A-uuid>', true);
  UPDATE path_phases SET status = 'completed'
   WHERE id IN ('<phase-A-uuid>', '<phase-B-uuid>');
ROLLBACK;
*/

-- ── B7. An INSERT cannot be born completed ──────────────────────────────────
-- EXPECT: rejected with the same error. Without the INSERT arm of the trigger this
-- succeeds and the whole lockdown is bypassable by creating a phase instead of
-- editing one.
/*
BEGIN;
  INSERT INTO path_phases (path_id, user_id, title, status)
  SELECT path_id, user_id, 'forged', 'completed' FROM path_phases LIMIT 1;
ROLLBACK;
*/


/*
════════════════════════════════════════════════════════════════════════════════
PART C — the live forge attempt, from the browser console
════════════════════════════════════════════════════════════════════════════════

Everything above runs as `postgres`, which bypasses RLS. This part runs as a real
signed-in user over PostgREST, which is the path an attacker actually has. Sign in as
the owner of the phase, open the console on the running app, and paste each one.

`supabase` is not on `window` by default — if these throw "supabase is not defined",
temporarily add `window.supabase = supabase` in src/lib/supabase.ts, or run them from a
component while developing.

  // Pick a target: one of your own phases that is not already completed.
  const { data: phases } = await supabase
    .from('path_phases').select('id, title, status').neq('status', 'completed');
  const id = phases[0].id;


  // ── C1. THE FORGE ATTEMPT — a direct PATCH to completed ──────────────────
  // MUST FAIL. This is the whole point of the trigger: `status` is in the UPDATE
  // grant, so PostgREST is perfectly willing to send this write — the database is
  // what refuses it.
  // EXPECT: error.message contains
  //   "A phase is completed by photo verification, not by writing status directly"
  // EXPECT: error.code === '42501'  (insufficient_privilege)
  await supabase.from('path_phases').update({ status: 'completed' }).eq('id', id);


  // ── C2. The same forge, dressed up ───────────────────────────────────────
  // MUST FAIL, all three. Bulk PATCH, a fresh row born completed, and a status write
  // smuggled alongside a legitimate title edit.
  await supabase.from('path_phases').update({ status: 'completed' }).eq('path_id', '<path-uuid>');

  await supabase.from('path_phases').insert({ path_id: '<path-uuid>', title: 'forged', status: 'completed' });

  await supabase.from('path_phases').update({ title: 'Renamed', status: 'completed' }).eq('id', id);


  // ── C3. Ordinary editing still works ─────────────────────────────────────
  // MUST SUCCEED. If the trigger is over-broad it takes normal use down with it, and
  // that failure is much easier to ship unnoticed than an over-permissive one.
  await supabase.from('path_phases').update({ status: 'live' }).eq('id', id);
  await supabase.from('path_phases').update({ status: 'pending' }).eq('id', id);
  await supabase.from('path_phases').update({ title: 'Prototyping' }).eq('id', id);


  // ── C4. The RPC is not reachable from the browser at all ─────────────────
  // MUST FAIL, both of them. This is the half the trigger cannot cover: the trigger
  // exists to stop forged PATCHes, but set_phase_verified() is the one caller allowed to
  // issue a ticket, so if the browser could call it the percentage would still be
  // fakeable — just through a different door.
  //
  // EXPECT: 'permission denied for function set_phase_verified', code 42501.
  await supabase.rpc('set_phase_verified', {
    p_user_id: '<your-own-uuid>', p_phase_id: id });

  // EXPECT: PGRST202 / 404 — the one-argument version no longer exists.
  await supabase.rpc('set_phase_verified', { p_phase_id: id });


  // ── C5. The photo route, end to end ──────────────────────────────────────
  // The positive case, and the one that proves the lockdown is a gate rather than a
  // wall. Submit a real photo of the work through verify-proof; on `progress` it calls
  // set_phase_verified() with the admin client and the phase flips to completed.
  // EXPECT: { status: 'ok', verdict: 'progress', phase_confirmed: true }, and the
  // path percentage moves.
  await supabase.functions.invoke('verify-proof', { body: {
    kind: 'phase_review', phase_id: id, context: '<phase title>',
    image_base64: '<raw base64, no data: prefix>', mime_type: 'image/png' } });


  // ── C5b. Someone else's phase, through verify-proof ──────────────────────
  // MUST FAIL with "That phase belongs to someone else", even with a photo Gemini
  // passes. verify-proof runs the RPC as service_role, which bypasses RLS entirely, so
  // the hand-written ownership check inside the function is the only thing standing
  // between a crafted `phase_id` and any phase in the database. Use a squadmate's phase
  // id (readable via shares_squad_with, but not writable).
  await supabase.functions.invoke('verify-proof', { body: {
    kind: 'phase_review', phase_id: '<squadmate-phase-uuid>', context: 'x',
    image_base64: '<a photo that passes>', mime_type: 'image/png' } });


  // ── C6. Reopening a completed phase is allowed ───────────────────────────
  // MUST SUCCEED. Only the transition *into* completed is guarded; walking one back is
  // ordinary editing, and the UI's dot cycle depends on it.
  await supabase.from('path_phases').update({ status: 'pending' }).eq('id', id);
*/
