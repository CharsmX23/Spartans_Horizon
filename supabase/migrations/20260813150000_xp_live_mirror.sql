/*
# XP for phases and goals becomes a live mirror of current state

Until now a completion was a permanent event: 20260813130000 made `xp_events` an append-only
ledger, and the whole idempotency story was "one source row can only ever pay once". Ticking a
phase paid 100 forever, un-ticking it kept the 100, and deleting the phase kept it too.

This migration changes what phase/goal XP *means*. It is no longer a record of "you once
completed this"; it is a projection of "this is currently completed". The ledger stops being
append-only for these two source types and starts tracking state:

  complete   -> +100 / +250 / +500   (unchanged, same triggers, same amounts)
  un-complete -> the matching row is deleted
  delete row  -> the matching row is deleted

So the sum of a user's phase/goal XP is always exactly the XP of what is marked complete
right now. Toggle a phase a hundred times and land on `pending`: the ledger reads the same as
if you had never touched it.

## What this does NOT touch, and how that is enforced rather than promised

`record_checkin()` and `record_habit_completion()` — the streak and habit proof paths — are
not in this file. Not dropped, not replaced, not re-granted. Their XP stays permanent, because
a photo you took on a Tuesday is a fact about that Tuesday; there is no "un-take" of it, and
nothing about a habit's later state can make it un-happen. Phases and goals are different in
kind: `status` is a mutable field describing the present, and it now reads as one.

That separation is enforced structurally, not by care. `revoke_xp()` below carries a hardcoded
whitelist — it can only ever delete `phase`, `goal_short`, `goal_long`. A caller that passes
'proof' or 'habit_physical' deletes nothing, today and after any future edit to the triggers.
The only way to make proof XP revocable is to edit that ARRAY, which is a visible, deliberate
act and not an accident.

## This closes the delete-and-recreate faucet

20260813130000's design note 3 flagged a known residual: delete a completed goal, create a new
one, get paid again — new uuid, new payout, and no constraint on the ledger could see it,
because the new row genuinely is a different thing. Note 3 said closing it needed a rate cap.

It did not. Under a live mirror, deleting a completed goal takes its XP with it, so the
delete-and-recreate cycle nets to what you would have had by completing one goal once. The
residual is closed here as a natural consequence of the model change rather than by a cap that
would have had to guess at a fair daily number.

## Objects created / changed
- FUNCTION revoke_xp(uuid, uuid, text[])                  — NEW, the single delete path
- FUNCTION path_phases_revoke_xp()  + 2 TRIGGERS on path_phases   — NEW
- FUNCTION goals_revoke_xp()        + 2 TRIGGERS on goals         — NEW
- Nothing else. No table is altered, no GRANT/REVOKE/POLICY moves, no existing function body
  is edited. The two grant triggers from 20260813130000 keep firing exactly as they do today.
*/

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. revoke_xp — the single delete path, and the wall around proof XP
-- ═══════════════════════════════════════════════════════════════════════════
/*
The mirror image of grant_xp(), with the same two properties for the same two reasons:

  - SECURITY DEFINER, because the triggers fire inside an ordinary client UPDATE/DELETE
    running as `authenticated`, which holds no DELETE on xp_events. Without DEFINER the
    delete would fail and take the user's write down with it — they would be unable to
    un-tick a phase at all.
  - EXECUTE granted to nobody. Its only callers are trigger functions owned by the same
    role, and owners never fail their own privilege check. A direct call from PostgREST
    404s exactly as grant_xp() does.

Deleting zero rows is a success, not an error. Un-completing a phase that never paid (it was
completed before this migration and... no, it paid; but: completed, refunded, un-completed
again) must not abort the user's UPDATE. DELETE is naturally idempotent, so this needs no
ON CONFLICT equivalent — running it twice is the same as running it once.

The `p_source_types` parameter narrows to what the *caller* owns (phases pass ARRAY['phase']),
and the second predicate narrows to what this function will *ever* touch. Both are needed:
the first stops the goals trigger from reaching a phase's row, the second stops any of them
from reaching a proof row. `user_id` is in the predicate as well — it is outside the client's
UPDATE grant on both tables, so it is a stable identity, and scoping to it means even a forged
`source_id` collision could not delete another user's grant.
*/
CREATE OR REPLACE FUNCTION public.revoke_xp(
  p_user_id       uuid,
  p_source_id     uuid,
  p_source_types  text[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_user_id IS NULL OR p_source_id IS NULL THEN
    RETURN;
  END IF;

  DELETE FROM xp_events
   WHERE source_id   = p_source_id
     AND user_id     = p_user_id
     AND source_type = ANY (p_source_types)
     -- The wall. Streak and habit proof XP is permanent, and this is where that is true:
     -- 'proof' and 'habit_physical' are not in this list and cannot be passed into it.
     AND source_type = ANY (ARRAY['phase', 'goal_short', 'goal_long']);
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_xp(uuid, uuid, text[]) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.revoke_xp(uuid, uuid, text[]) IS
  'Deletes the xp_events row for a phase/goal that is no longer completed. Cannot reach '
  'proof or habit_physical grants — those are permanent by construction.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. path_phases — revoke on leaving completed, and on delete
-- ═══════════════════════════════════════════════════════════════════════════
/*
One function, two triggers. OLD is populated for both UPDATE and DELETE, and neither `id` nor
`user_id` is in the client's UPDATE grant on path_phases (20260805120000 grants UPDATE only on
title, description, status, start_date, target_date, order_index), so OLD is the correct row
identity in both cases and cannot have been steered.

AFTER, like the grant triggers, and for the same reason: this reacts to a write that has
already been allowed. There is no code path here that can RAISE, so no un-tick and no delete
can be blocked by XP bookkeeping.
*/
CREATE OR REPLACE FUNCTION public.path_phases_revoke_xp()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM revoke_xp(OLD.user_id, OLD.id, ARRAY['phase']);
  RETURN NULL;
END;
$$;

/*
`IS DISTINCT FROM` rather than `<>`: status is NOT NULL today, so the two are equivalent, but
`<>` against a NULL yields NULL, a WHEN clause treats NULL as false, and the revoke would
silently not fire. IS DISTINCT FROM is the form that stays correct if the column ever loosens.

Note this fires on completed -> paused and completed -> archived as much as completed ->
active. Any exit from completed is an exit; the ledger mirrors `status = 'completed'`, not
"has ever been completed".
*/
DROP TRIGGER IF EXISTS path_phases_xp_revoke ON public.path_phases;
CREATE TRIGGER path_phases_xp_revoke
  AFTER UPDATE OF status ON public.path_phases
  FOR EACH ROW
  WHEN (OLD.status = 'completed' AND NEW.status IS DISTINCT FROM 'completed')
  EXECUTE FUNCTION public.path_phases_revoke_xp();

/*
The delete arm. The WHEN clause means a phase deleted while pending costs one trigger
evaluation and no query at all — and the DELETE inside is keyed on the ledger's UNIQUE
source_id, so even without the guard it would be a single index probe.

This fires on cascade deletes too: `path_phases.path_id` references learning_paths ON DELETE
CASCADE, and a cascade fires row triggers on the child table. Deleting a whole learning path
therefore refunds every completed phase under it, which is the behaviour the mirror requires —
the phases are gone, so their XP must be.
*/
DROP TRIGGER IF EXISTS path_phases_xp_revoke_delete ON public.path_phases;
CREATE TRIGGER path_phases_xp_revoke_delete
  AFTER DELETE ON public.path_phases
  FOR EACH ROW
  WHEN (OLD.status = 'completed')
  EXECUTE FUNCTION public.path_phases_revoke_xp();

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. goals — same two triggers, both goal grades
-- ═══════════════════════════════════════════════════════════════════════════
/*
Both source types are passed, not the one matching the goal's current `goal_type`, and that is
deliberate. goals_grant_xp() reads the type at completion time and the first completion sets
the price (20260813130000 §7); retyping a completed goal from short to long does not re-price
it, so the ledger row may legitimately be `goal_short` while the row now says `long_term`.
Passing both means the revoke finds the grant whichever grade it was written at. Passing the
current type would strand a row and leak 250 XP on exactly that path.
*/
CREATE OR REPLACE FUNCTION public.goals_revoke_xp()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM revoke_xp(OLD.user_id, OLD.id, ARRAY['goal_short', 'goal_long']);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS goals_xp_revoke ON public.goals;
CREATE TRIGGER goals_xp_revoke
  AFTER UPDATE OF status ON public.goals
  FOR EACH ROW
  WHEN (OLD.status = 'completed' AND NEW.status IS DISTINCT FROM 'completed')
  EXECUTE FUNCTION public.goals_revoke_xp();

DROP TRIGGER IF EXISTS goals_xp_revoke_delete ON public.goals;
CREATE TRIGGER goals_xp_revoke_delete
  AFTER DELETE ON public.goals
  FOR EACH ROW
  WHEN (OLD.status = 'completed')
  EXECUTE FUNCTION public.goals_revoke_xp();

NOTIFY pgrst, 'reload schema';


/*
════════════════════════════════════════════════════════════════════════════════
VERIFY — run after applying. Read-only except where marked; the write tests are
wrapped in ROLLBACK and leave nothing behind.
════════════════════════════════════════════════════════════════════════════════

-- ── 1. THE PROOF-XP WALL. This is the one that matters most in this file. ───
-- EXPECT: the ARRAY in the function body lists exactly phase, goal_short, goal_long.
-- If 'proof' or 'habit_physical' ever appears here, streak and habit XP became
-- revocable and every "your streak XP is permanent" claim in this repo is false.
SELECT prosrc LIKE '%ARRAY[''phase'', ''goal_short'', ''goal_long'']%' AS wall_intact,
       prosrc LIKE '%proof%'          AS mentions_proof_MUST_BE_FALSE,
       prosrc LIKE '%habit_physical%' AS mentions_habit_MUST_BE_FALSE
FROM pg_proc WHERE proname = 'revoke_xp';

-- EXPECT: revoke_xp is SECURITY DEFINER and executable by NOBODY but its owner.
SELECT p.prosecdef AS security_definer,
       has_function_privilege('authenticated', 'public.revoke_xp(uuid,uuid,text[])', 'EXECUTE') AS revoke_authenticated,
       has_function_privilege('anon',          'public.revoke_xp(uuid,uuid,text[])', 'EXECUTE') AS revoke_anon,
       has_function_privilege('service_role',  'public.revoke_xp(uuid,uuid,text[])', 'EXECUTE') AS revoke_service_role
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'revoke_xp';
-- EXPECT: true, false, false, false.

-- ── 2. THE STREAK/HABIT PATHS DID NOT MOVE ─────────────────────────────────
-- The claim in the header is that this file does not touch proof XP. Check the
-- functions themselves, not the description.
-- EXPECT: both still call grant_xp, neither mentions revoke_xp, both still
-- service_role-only.
SELECT proname,
       prosrc LIKE '%grant_xp%'  AS still_grants,
       prosrc LIKE '%revoke_xp%' AS calls_revoke_MUST_BE_FALSE,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_MUST_BE_FALSE,
       has_function_privilege('service_role',  p.oid, 'EXECUTE') AS service_role_MUST_BE_TRUE
FROM pg_proc p
WHERE proname IN ('record_checkin', 'record_habit_completion')
ORDER BY proname;

-- EXPECT: zero rows. No trigger anywhere fires revoke on the proof tables.
SELECT c.relname, t.tgname
FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
WHERE NOT t.tgisinternal
  AND c.relname IN ('streak_logs', 'habit_completions')
  AND pg_get_triggerdef(t.oid) ILIKE '%revoke%';

-- ── 3. TRIGGER INVENTORY ───────────────────────────────────────────────────
-- EXPECT: 3 triggers per table — the original grant (INSERT OR UPDATE), the
-- update-revoke, the delete-revoke. ALL of them AFTER. A BEFORE here would mean
-- XP bookkeeping can veto a user's write.
SELECT c.relname AS table_name, t.tgname,
       CASE WHEN (t.tgtype & 2) = 2 THEN 'BEFORE' ELSE 'AFTER' END AS timing,
       CASE WHEN (t.tgtype &  4) =  4 THEN 'INSERT ' ELSE '' END ||
       CASE WHEN (t.tgtype &  8) =  8 THEN 'DELETE ' ELSE '' END ||
       CASE WHEN (t.tgtype & 16) = 16 THEN 'UPDATE ' ELSE '' END AS events
FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
WHERE NOT t.tgisinternal AND c.relname IN ('path_phases', 'goals')
ORDER BY c.relname, t.tgname;

-- ── 4. NO PERMISSION MOVED ─────────────────────────────────────────────────
-- EXPECT: identical to what 20260813130000 asserted — status writable, user_id not.
SELECT
  has_column_privilege('authenticated', 'public.path_phases', 'status',  'UPDATE') AS phase_status_writable,
  has_column_privilege('authenticated', 'public.path_phases', 'user_id', 'UPDATE') AS phase_user_id_writable,
  has_column_privilege('authenticated', 'public.goals',       'status',  'UPDATE') AS goal_status_writable,
  has_column_privilege('authenticated', 'public.goals',       'user_id', 'UPDATE') AS goal_user_id_writable;
-- EXPECT: true, false, true, false.

-- EXPECT: still exactly one row — authenticated / SELECT. The browser gained no
-- ability to write the ledger; the revoke happens under DEFINER, not under it.
SELECT grantee, privilege_type
FROM information_schema.table_privileges
WHERE table_schema = 'public' AND table_name = 'xp_events'
  AND grantee IN ('anon', 'authenticated')
ORDER BY grantee, privilege_type;

-- ── 5. THE CYCLE, IN SQL. Substitute a phase id you own. ───────────────────
BEGIN;
  SELECT coalesce(sum(amount), 0) AS baseline FROM xp_events WHERE user_id = auth.uid();

  UPDATE path_phases SET status = 'completed' WHERE id = '<phase-uuid>';
  SELECT count(*) AS rows_MUST_BE_1, coalesce(sum(amount),0) AS amount_MUST_BE_100
  FROM xp_events WHERE source_id = '<phase-uuid>';

  UPDATE path_phases SET status = 'pending' WHERE id = '<phase-uuid>';
  SELECT count(*) AS rows_MUST_BE_0 FROM xp_events WHERE source_id = '<phase-uuid>';

  UPDATE path_phases SET status = 'completed' WHERE id = '<phase-uuid>';
  UPDATE path_phases SET status = 'pending'   WHERE id = '<phase-uuid>';
  UPDATE path_phases SET status = 'completed' WHERE id = '<phase-uuid>';
  SELECT count(*) AS rows_MUST_BE_1, coalesce(sum(amount),0) AS amount_MUST_BE_100
  FROM xp_events WHERE source_id = '<phase-uuid>';
  -- Three completions, one row. No accumulation.

  DELETE FROM path_phases WHERE id = '<phase-uuid>';
  SELECT count(*) AS rows_MUST_BE_0 FROM xp_events WHERE source_id = '<phase-uuid>';
  -- The delete-and-recreate faucet, closed.
ROLLBACK;

-- ── 6. PROOF XP SURVIVES A GOAL CYCLE ──────────────────────────────────────
-- The negative control for section 1: churn a goal and confirm the proof rows
-- sitting next to it in the same table do not move.
BEGIN;
  SELECT coalesce(sum(amount),0) AS proof_xp_before
  FROM xp_events WHERE user_id = auth.uid() AND source_type IN ('proof','habit_physical');

  UPDATE goals SET status = 'completed' WHERE id = '<goal-uuid>';
  UPDATE goals SET status = 'active'    WHERE id = '<goal-uuid>';
  DELETE FROM goals WHERE id = '<goal-uuid>';

  SELECT coalesce(sum(amount),0) AS proof_xp_after
  FROM xp_events WHERE user_id = auth.uid() AND source_type IN ('proof','habit_physical');
  -- EXPECT: proof_xp_after = proof_xp_before, exactly.
ROLLBACK;
*/
