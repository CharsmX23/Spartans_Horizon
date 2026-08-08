/*
# Power Up phases are completed by hand — the photo gate comes out

## What changes and why
`20260807130000_set_phase_verified.sql` made `completed` unreachable from the client: a
BEFORE trigger rejected the transition for every writer, and the only thing that could
issue the ticket past it was `set_phase_verified()`, called by the verify-proof Edge
Function after Gemini accepted a photo.

That is now the wrong model for paths. A path phase is a to-do item the owner marks off
themselves — the status dot cycles pending -> live -> completed like the mission timeline
already does, and the percentage on the card is self-reported by design. Nothing about
that needs a photo, so the machinery enforcing one is removed rather than left inert.

The AI on this page becomes an advisor instead of a gate: it reads the typed timeline and
returns coaching text. It writes nothing and has no database path at all, so there is no
function or grant here for it.

## THIS DOES NOT TOUCH STREAKS OR HABITS
`record_checkin()` and `record_habit_completion()` are untouched, as are `streak_logs`,
`habit_completions`, `users.current_streak`, and every grant on them. Those stay
photo-gated and service_role-only, because a streak IS a claim about reality and a faked
one is a lie told to squadmates. Only the three path-specific objects below are dropped.
The shared verify-proof Edge Function keeps its `streak` and `habit` branches; only the
`phase_review` branch is removed from it.

## Objects dropped
- TRIGGER  path_phases_no_forged_completion   ON path_phases
- FUNCTION path_phases_block_forged_completion()
- FUNCTION set_phase_verified(uuid, uuid)

## Grants do not change
This is the part worth checking rather than assuming. `status` was ALREADY in the UPDATE
grant from `20260805120000_create_path_phases.sql` — it had to be, because the client
legitimately writes `live` and `pending`. The trigger, not the grant, was what narrowed
the column to those two values. So dropping the trigger is the whole of the change: with
it gone, `completed` is simply the third value of a column the owner could already write.

The grant is re-asserted below anyway. It is idempotent and changes nothing; it is here so
this file states the end state outright instead of leaving it two migrations back.

`user_id` and `path_id` stay outside the grant, so a phase still cannot be reassigned to
another user or moved to another path from the client, and the composite FK to
`learning_paths(id, user_id)` still makes an owner mismatch unrepresentable. RLS is
unchanged: squad-readable, owner-only writes.
*/

-- ── Drop the gate ───────────────────────────────────────────────────────────
-- Trigger before function: the function cannot be dropped while the trigger depends on
-- it, and DROP FUNCTION ... CASCADE would take the trigger silently rather than by name.
DROP TRIGGER IF EXISTS path_phases_no_forged_completion ON public.path_phases;
DROP FUNCTION IF EXISTS public.path_phases_block_forged_completion();

-- Both signatures. The 1-arg version was an earlier draft that
-- 20260807130000 already dropped; naming it here means a database that somehow still
-- carries it (a partial apply, an older branch) ends up in the same state as one that
-- does not.
DROP FUNCTION IF EXISTS public.set_phase_verified(uuid);
DROP FUNCTION IF EXISTS public.set_phase_verified(uuid, uuid);

-- ── Re-assert the end state of the grant (no-op; see the header) ────────────
GRANT UPDATE (title, description, status, start_date, target_date, order_index)
  ON public.path_phases TO authenticated;

NOTIFY pgrst, 'reload schema';


/*
════════════════════════════════════════════════════════════════════════════════
VERIFY — run after applying. Nothing here writes.
════════════════════════════════════════════════════════════════════════════════

-- 1. The three dropped objects are gone.
--    EXPECT: all three NULL / 0 rows.
SELECT
  to_regprocedure('public.set_phase_verified(uuid,uuid)')            AS set_phase_verified_2arg,
  to_regprocedure('public.set_phase_verified(uuid)')                 AS set_phase_verified_1arg,
  to_regprocedure('public.path_phases_block_forged_completion()')    AS trigger_function;

SELECT t.tgname
FROM pg_trigger t
WHERE t.tgrelid = 'public.path_phases'::regclass AND NOT t.tgisinternal;
-- EXPECT: 0 rows.


-- 2. The grant is what the header claims.
--    EXPECT: can_write_status = true   <- completion is now an ordinary client write
--            can_write_user_id = false <- a phase cannot be handed to another user
--            can_write_path_id = false <- a phase cannot be moved to another path
SELECT
  has_column_privilege('authenticated', 'public.path_phases', 'status',  'UPDATE') AS can_write_status,
  has_column_privilege('authenticated', 'public.path_phases', 'title',   'UPDATE') AS can_write_title,
  has_column_privilege('authenticated', 'public.path_phases', 'user_id', 'UPDATE') AS can_write_user_id,
  has_column_privilege('authenticated', 'public.path_phases', 'path_id', 'UPDATE') AS can_write_path_id;

-- Every UPDATE-able column and who holds it.
-- EXPECT: authenticated -> description, order_index, start_date, status, target_date,
--         title.  `anon` must not appear at all.
SELECT grantee, column_name
FROM information_schema.column_privileges
WHERE table_schema = 'public' AND table_name = 'path_phases'
  AND privilege_type = 'UPDATE' AND grantee IN ('anon', 'authenticated')
ORDER BY grantee, column_name;


-- 3. RLS still scopes writes to the owner — dropping the trigger must not have
--    widened *whose* phases you can write, only which values you may write.
--    EXPECT: 4 policies. pp_update USING and WITH CHECK both `user_id = auth.uid()`.
SELECT policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'path_phases'
ORDER BY policyname;


-- 4. THE STREAK SIDE IS UNTOUCHED. This is the check that matters most in this file,
--    because paths and streaks share one Edge Function and the risk was tearing out
--    something the streak side still needs.
--    EXPECT: both non-NULL, both security_definer = true.
SELECT p.proname, p.prosecdef AS security_definer
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('record_checkin', 'record_habit_completion')
ORDER BY p.proname;

-- EXPECT: for BOTH functions — authenticated = false, anon = false, service_role = true.
-- If any of these reads true for authenticated, a signed-in user can advance their own
-- streak from the console with no photo, and this migration broke the thing it promised
-- not to touch.
SELECT
  has_function_privilege('authenticated', 'public.record_checkin(uuid,text,date)', 'EXECUTE')               AS checkin_authenticated,
  has_function_privilege('anon',          'public.record_checkin(uuid,text,date)', 'EXECUTE')               AS checkin_anon,
  has_function_privilege('service_role',  'public.record_checkin(uuid,text,date)', 'EXECUTE')               AS checkin_service_role,
  has_function_privilege('authenticated', 'public.record_habit_completion(uuid,uuid,text)', 'EXECUTE')      AS habit_authenticated,
  has_function_privilege('anon',          'public.record_habit_completion(uuid,uuid,text)', 'EXECUTE')      AS habit_anon,
  has_function_privilege('service_role',  'public.record_habit_completion(uuid,uuid,text)', 'EXECUTE')      AS habit_service_role;

-- EXPECT: streak_logs and habit_completions grant the browser SELECT and nothing else —
-- no INSERT, no UPDATE, no DELETE. Unchanged by this migration; verified because it is
-- cheap and the consequence of being wrong is a fakeable streak.
SELECT table_name, privilege_type, grantee
FROM information_schema.table_privileges
WHERE table_schema = 'public'
  AND table_name IN ('streak_logs', 'habit_completions')
  AND grantee IN ('anon', 'authenticated')
ORDER BY table_name, grantee, privilege_type;


-- 5. Completion now works from the client, and only for your own phases.
--    Run as `postgres` in the SQL editor; substitute a real phase id.
--    Before this migration the first UPDATE raised
--    "A phase is completed by photo verification..." — now it should simply succeed.
/*
BEGIN;
  UPDATE path_phases SET status = 'completed' WHERE id = '<phase-uuid>';
  SELECT id, status FROM path_phases WHERE id = '<phase-uuid>';  -- completed
ROLLBACK;
*/
*/
