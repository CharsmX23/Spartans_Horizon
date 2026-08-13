/*
# xp_events — a forge-proof XP ledger, and the real level behind "Lv.24"

`Person.level` has been a hardcoded `24` in `src/data.ts` since the app was scaffolded.
This is the table that makes it real. Level is never stored: it is
`floor(sum(amount) / 50) + 1`, recomputed from this ledger on every read, so there is no
number anywhere that can drift from the events that produced it.

## The problem this table solves

`20260808120000_manual_phase_completion.sql` deliberately dropped the trigger that
narrowed `path_phases.status`, because a phase is a to-do item the owner ticks off by
hand. That decision stands and nothing here reverses it. But it means `status` is a freely
client-writable column, and "100 XP when a phase completes" naively implemented against a
freely-writable column is an infinite XP faucet: PATCH pending, PATCH completed, repeat.

The fix is not to re-gate the column — that would take back the manual control this app
chose on purpose. The fix is to make the *grant* idempotent instead of the *write*:

  - The triggers below are AFTER triggers. They react; they never block. Every status
    write that succeeds today still succeeds after this migration, with the same error
    behaviour and the same grants.
  - `UNIQUE (source_type, source_id)` on this ledger is what actually stops the faucet.
    XP for one specific phase row can only ever be inserted once, no matter how many
    times that row's status is toggled.

That is the same idempotency shape `habit_completions` already uses with
`UNIQUE (user_id, habit_id, log_date)` — a uniqueness constraint standing in for a
permission check, because the thing being protected is "how many times", not "by whom".

## Objects created
- TABLE    xp_events
- FUNCTION grant_xp(uuid, text, uuid, int)                — the single insert path
- FUNCTION path_phases_grant_xp()  + TRIGGER on path_phases
- FUNCTION goals_grant_xp()        + TRIGGER on goals
- COLUMN   habits.is_physical
- FUNCTION record_checkin(uuid, text, date, boolean)      — REPLACES the 3-arg version
- FUNCTION record_habit_completion(uuid, uuid, text)      — body changed, signature same
- FUNCTION seed_default_habits(uuid)                      — body changed, signature same

## THIS DOES NOT TOUCH ANY EXISTING PERMISSION
Not one GRANT, REVOKE, or POLICY on `path_phases`, `goals`, `habits`, `streak_logs`,
`habit_completions`, or `users` is widened or narrowed by this file. The only grant
*changed* is `habits`' UPDATE column list, which gains `is_physical` — a new column that
did not exist before. Phase status stays client-writable. Goal status stays
client-writable. Streaks and habit completions stay service_role-only and photo-gated.
The verify section at the bottom asserts all of that rather than asking you to trust it.

## Two design notes worth reading before you apply this

### 1. A habit tick writes TWO rows, and only one of them may pay out
`record_habit_completion()` calls `record_checkin()` — ticking a habit *is* that day's
check-in (see 20260731170000). So one photo of a habit produces a `habit_completions` row
AND a `streak_logs` row. Granting XP off both would make one habit photo worth 100 XP
while one bare streak photo is worth 50, for identical effort.

So `record_checkin()` gains a `p_grant_xp boolean DEFAULT true` parameter, and the habit
path passes `false`: the habit completion pays, the streak row it incidentally creates
does not. A bare streak check-in from the Streaks page still pays its 50. One proof, one
payout, whichever door it came through.

This is why `record_checkin` is DROPped and recreated rather than CREATE OR REPLACEd —
you cannot add a parameter with REPLACE. Both callers (`verify-proof` and
`record_habit_completion`) pass arguments by name, so both keep working unchanged and the
Edge Function does NOT need redeploying.

### 2. `source_id` is unique on its own, not just per source_type
The spec for this table said `UNIQUE (source_type, source_id)`, and that constraint is
here under that name. But it has a hole: `habits.is_physical` is editable, so the same
`habit_completions` row could be graded 'proof' (50) in the morning and 'habit_physical'
(100) after you flip the toggle — two different `source_type`s, same `source_id`, both
inserts pass. `UNIQUE (source_id)` is added alongside it to close that. The composite one
is kept because it states the intent; the single-column one is what enforces it.

### 3. Known residual: delete-and-recreate is still a faucet
This ledger makes a *row* pay out once. It cannot stop you deleting a completed goal and
creating a new one — new uuid, new payout. No constraint on this table can, because the
new row is genuinely a different thing. Closing it needs a rate cap (e.g. at most N
`goal_*` grants per day per user), which is a product decision, not a schema one, and is
deliberately NOT implemented here. Flagging it so it is a choice rather than a surprise.
*/

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. The ledger
-- ═══════════════════════════════════════════════════════════════════════════
/*
`source_id` carries no foreign key, and that is deliberate twice over:

  - It points at five different tables (streak_logs, habit_completions, path_phases,
    goals), so no single REFERENCES can express it.
  - Even if it could, ON DELETE CASCADE would be wrong: deleting a goal must not refund
    the XP it already paid. History is history. A ledger that can be rewritten by
    deleting its subject is not a ledger.

The cost is that `source_id` may point at a row that no longer exists. Nothing reads
through it — the balance is `sum(amount)` and never a join — so that costs nothing.
*/
CREATE TABLE IF NOT EXISTS xp_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_type  text NOT NULL
                 CHECK (source_type IN ('proof', 'habit_physical', 'phase', 'goal_short', 'goal_long')),
  source_id    uuid NOT NULL,
  amount       int  NOT NULL CHECK (amount > 0),
  created_at   timestamptz NOT NULL DEFAULT now(),

  -- The named idempotency constraint: one grant per source row per kind.
  CONSTRAINT xp_events_source_unique UNIQUE (source_type, source_id),
  -- The one that actually holds, per design note 2 above: one grant per source row,
  -- full stop, regardless of how it is later reclassified.
  CONSTRAINT xp_events_source_id_unique UNIQUE (source_id)
);

-- The only query the app runs against this table.
CREATE INDEX IF NOT EXISTS xp_events_user_idx ON xp_events(user_id);

ALTER TABLE xp_events ENABLE ROW LEVEL SECURITY;

/*
Read-only to the browser, exactly like streak_logs and habit_completions. There is no
INSERT policy and no INSERT grant, so a forged POST fails at the table-privilege layer
before RLS is ever consulted. Every write goes through grant_xp(), which is SECURITY
DEFINER and reachable only from the trigger functions and the two record_* functions.
*/
DROP POLICY IF EXISTS "xp_events_select" ON xp_events;
CREATE POLICY "xp_events_select" ON xp_events FOR SELECT
  TO authenticated USING (user_id = auth.uid());

REVOKE ALL ON xp_events FROM anon, authenticated;
GRANT SELECT ON xp_events TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. grant_xp — the single insert path
-- ═══════════════════════════════════════════════════════════════════════════
/*
SECURITY DEFINER, and that is load-bearing rather than habitual. The two triggers below
fire inside an ordinary client UPDATE, so without DEFINER the insert would run as
`authenticated` — which holds no INSERT on xp_events — and the *whole UPDATE would fail*.
The user would be unable to complete a phase at all. So the same property that keeps the
ledger unforgeable is what lets the trigger write to it.

`ON CONFLICT DO NOTHING` with no conflict target covers BOTH unique constraints. This is
the idempotency, expressed in one line: a second grant for a source row is not an error,
it is a no-op. Callers do not have to know whether they are the first.

No EXECUTE is granted to anybody. Its callers are all SECURITY DEFINER functions owned by
the same role, and owners never fail their own privilege check.
*/
CREATE OR REPLACE FUNCTION public.grant_xp(
  p_user_id      uuid,
  p_source_type  text,
  p_source_id    uuid,
  p_amount       int
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- A missing owner or source is a bug in the caller, not something to record. Returning
  -- quietly keeps a malformed grant from aborting the user's actual write.
  IF p_user_id IS NULL OR p_source_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO xp_events (user_id, source_type, source_id, amount)
  VALUES (p_user_id, p_source_type, p_source_id, p_amount)
  ON CONFLICT DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.grant_xp(uuid, text, uuid, int) FROM PUBLIC, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. habits.is_physical — the 50-vs-100 split
-- ═══════════════════════════════════════════════════════════════════════════
/*
An explicit boolean rather than matching on the title. A title is user-editable free text:
renaming "Workout" to "Gym" would silently halve its payout, and "Read about workouts"
would silently double it. A flag says what it means and survives a rename.

It joins the UPDATE grant so the habit-edit UI can toggle it. `user_id` stays outside that
grant, unchanged.
*/
ALTER TABLE habits ADD COLUMN IF NOT EXISTS is_physical boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN habits.is_physical IS
  'Physical activity / workout. A verified proof on this habit pays 100 XP instead of 50.';

GRANT UPDATE (title, icon, active, sort_order, is_physical) ON habits TO authenticated;

-- The seeded starter set ships "Workout" already flagged, so a new user does not have to
-- discover the toggle to get the behaviour the feature is named after. Everything else in
-- the set defaults to false and is togglable in the UI.
CREATE OR REPLACE FUNCTION public.seed_default_habits(p_user_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO habits (user_id, title, icon, sort_order, is_physical)
  SELECT p_user_id, d.title, d.icon, d.sort_order, d.is_physical
  FROM (VALUES
    ('Workout',         'Dumbbell', 0, true),
    ('Deep work block', 'Code2',    1, false),
    ('Read 20 pages',   'BookOpen', 2, false),
    ('Sleep by 11pm',   'Moon',     3, false)
  ) AS d(title, icon, sort_order, is_physical)
  WHERE NOT EXISTS (SELECT 1 FROM habits h WHERE h.user_id = p_user_id);
$$;

REVOKE ALL ON FUNCTION public.seed_default_habits(uuid) FROM PUBLIC, anon, authenticated;

/*
One-time backfill for habits that already exist. This DOES match on the title — the one
place in this migration that does, because there is no other way to identify the habit
that was seeded before the column existed. It runs once, it is a starting value and not a
rule, and it is overridable from the UI the moment you disagree with it.

The one caveat: this is the only statement in the file that is not fully re-runnable. If
you deliberately turn "Workout" back to standard in the UI and then replay this migration
(via apply_all.sql, say), it flags it again. Everything else here is guarded.
*/
UPDATE habits SET is_physical = true
 WHERE lower(trim(title)) = 'workout' AND is_physical = false;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. record_checkin — now grants XP for a bare streak proof
-- ═══════════════════════════════════════════════════════════════════════════
/*
Dropped and recreated, not replaced: `p_grant_xp` is a new parameter and CREATE OR REPLACE
cannot add one. Everything else — the streak rule, the FOR UPDATE row lock, the per-day
upsert, the service_role-only EXECUTE — is byte-for-byte what 20260730120000 established.

The single behavioural addition is the grant_xp() call, keyed on the `streak_logs` row's
id. That id is stable across re-submission because the INSERT upserts on
UNIQUE (user_id, log_date), so submitting three photos in one day updates one row, yields
one source_id, and pays once. The per-day uniqueness the streak already had becomes the
per-day uniqueness of the XP for free.

`p_grant_xp = false` is passed by record_habit_completion only. See design note 1.
*/
DROP FUNCTION IF EXISTS public.record_checkin(uuid, text, date);

CREATE OR REPLACE FUNCTION public.record_checkin(
  p_user_id   uuid,
  p_note      text    DEFAULT NULL,
  p_log_date  date    DEFAULT NULL,
  p_grant_xp  boolean DEFAULT true
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today   date := coalesce(p_log_date, current_date);
  v_last    date;
  v_streak  int;
  v_already boolean := false;
  v_log_id  uuid;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id is required';
  END IF;

  -- Row lock: without it two concurrent check-ins could both read streak = N.
  SELECT last_checkin_date, current_streak
    INTO v_last, v_streak
    FROM users
   WHERE id = p_user_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No profile row for that user';
  END IF;

  IF v_last = v_today THEN
    v_already := true;                 -- already counted today
  ELSIF v_last = v_today - 1 THEN
    v_streak := v_streak + 1;          -- consecutive day
  ELSE
    v_streak := 1;                     -- first check-in, or the chain broke
  END IF;

  IF NOT v_already THEN
    UPDATE users
       SET current_streak    = v_streak,
           last_checkin_date = v_today
     WHERE id = p_user_id;
  END IF;

  -- One verified log per user per day; re-submission refreshes the note.
  -- The DO UPDATE (rather than DO NOTHING) is what makes RETURNING always yield the row
  -- id, first submission or fifth — a DO NOTHING conflict returns no row at all.
  INSERT INTO streak_logs (user_id, log_date, verified, note)
  VALUES (p_user_id, v_today, true, p_note)
  ON CONFLICT (user_id, log_date) DO UPDATE
     SET verified = true,
         note     = coalesce(excluded.note, streak_logs.note)
  RETURNING id INTO v_log_id;

  -- 50 XP for a verified proof, once per streak_logs row (so: once per day).
  IF p_grant_xp THEN
    PERFORM grant_xp(p_user_id, 'proof', v_log_id, 50);
  END IF;

  RETURN json_build_object(
    'current_streak',     v_streak,
    'last_checkin_date',  v_today,
    'already_checked_in', v_already
  );
END;
$$;

-- Re-asserted for the new signature. EXECUTE defaults to PUBLIC on a newly created
-- function, so the REVOKE is load-bearing: without it any signed-in user could call this
-- and hand themselves a streak — and now XP with it.
REVOKE ALL ON FUNCTION public.record_checkin(uuid, text, date, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_checkin(uuid, text, date, boolean) TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. record_habit_completion — 50, or 100 for a physical habit
-- ═══════════════════════════════════════════════════════════════════════════
/*
Signature unchanged, so verify-proof needs no redeploy. Two changes in the body:

  - `is_physical` is read in the same SELECT that already validated ownership and
    `active`, so the grade costs no extra query and cannot be read from a habit that
    failed validation.
  - The record_checkin() call passes p_grant_xp := false. The completion below pays for
    this proof; the streak row it creates must not pay again. Design note 1.

The upsert returns the completion's id the same way record_checkin does, and
UNIQUE (user_id, habit_id, log_date) means that id is stable per habit per day — so five
photos of the same habit today pay once, and a second *different* habit today pays its
own 50 or 100.
*/
CREATE OR REPLACE FUNCTION public.record_habit_completion(
  p_user_id   uuid,
  p_habit_id  uuid,
  p_note      text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today       date := current_date;
  v_title       text;
  v_physical    boolean;
  v_streak      json;
  v_completion  uuid;
BEGIN
  IF p_user_id IS NULL OR p_habit_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id and p_habit_id are required';
  END IF;

  SELECT title, is_physical INTO v_title, v_physical
    FROM habits
   WHERE id = p_habit_id AND user_id = p_user_id AND active;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No active habit % for that user', p_habit_id;
  END IF;

  INSERT INTO habit_completions (user_id, habit_id, log_date, verified, evaluation_text)
  VALUES (p_user_id, p_habit_id, v_today, true, p_note)
  ON CONFLICT (user_id, habit_id, log_date) DO UPDATE
     SET verified        = true,
         evaluation_text = coalesce(excluded.evaluation_text, habit_completions.evaluation_text)
  RETURNING id INTO v_completion;

  -- 100 for proof of physical activity, 50 for everything else.
  IF v_physical THEN
    PERFORM grant_xp(p_user_id, 'habit_physical', v_completion, 100);
  ELSE
    PERFORM grant_xp(p_user_id, 'proof', v_completion, 50);
  END IF;

  -- A verified habit is the day's check-in. Idempotent, so ticking more habits today
  -- keeps the streak where it is rather than inflating it.
  -- p_grant_xp := false — the completion above already paid for this proof.
  -- NULL::date, explicitly typed: an untyped NULL in a positional call leaves the third
  -- argument as `unknown` and makes overload resolution depend on there being exactly one
  -- candidate. Casting it removes that dependency.
  v_streak := record_checkin(p_user_id, p_note, NULL::date, false);

  RETURN json_build_object(
    'habit_id',  p_habit_id,
    'title',     v_title,
    'log_date',  v_today,
    'streak',    v_streak
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_habit_completion(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_habit_completion(uuid, uuid, text) TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. path_phases — 100 XP on transition into completed
-- ═══════════════════════════════════════════════════════════════════════════
/*
AFTER, not BEFORE. This is the whole difference between this trigger and the
`path_phases_no_forged_completion` trigger that 20260808120000 deliberately removed:

  - That one was BEFORE and RAISEd. It decided whether your write was allowed.
  - This one is AFTER and only ever inserts into a different table. By the time it runs
    the status has already changed; it has no way to refuse and no code path that RAISEs.
    Toggling a phase back to pending still works. Completing it again still works.

`RETURN NULL` because the return value of an AFTER FOR EACH ROW trigger is discarded.

INSERT is covered as well as UPDATE, because `authenticated` holds INSERT on path_phases
and a phase can be born `completed` — the client legitimately creates one that way. An
UPDATE-only trigger would silently pay nothing for those, which reads as a bug rather
than a policy. It is not a farming route: the ledger is keyed on the phase's id.

The `WHEN` clause keeps the function from being called at all for the overwhelmingly
common case (a title edit, a reorder, a move to `live`), so the ordinary write path is
untouched down to not even entering plpgsql.
*/
CREATE OR REPLACE FUNCTION public.path_phases_grant_xp()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM grant_xp(NEW.user_id, 'phase', NEW.id, 100);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS path_phases_xp ON public.path_phases;
CREATE TRIGGER path_phases_xp
  AFTER INSERT OR UPDATE OF status ON public.path_phases
  FOR EACH ROW
  WHEN (NEW.status = 'completed')
  EXECUTE FUNCTION public.path_phases_grant_xp();

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. goals — 250 XP short-term, 500 XP long-term
-- ═══════════════════════════════════════════════════════════════════════════
/*
Identical shape to the phase trigger. `goals.status` was already owner-writable
(20260731180000 grants UPDATE on it), so the checkbox on the Goals page is an ordinary
UPDATE through a grant that already existed — this file adds nothing to it.

The amount is read from NEW.goal_type rather than passed in, so retyping a goal from
short to long *after* completing it does not re-pay: the source_id is already in the
ledger and grant_xp() no-ops on the second call regardless of amount. First completion
sets the price.
*/
CREATE OR REPLACE FUNCTION public.goals_grant_xp()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.goal_type = 'long_term' THEN
    PERFORM grant_xp(NEW.user_id, 'goal_long', NEW.id, 500);
  ELSE
    PERFORM grant_xp(NEW.user_id, 'goal_short', NEW.id, 250);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS goals_xp ON public.goals;
CREATE TRIGGER goals_xp
  AFTER INSERT OR UPDATE OF status ON public.goals
  FOR EACH ROW
  WHEN (NEW.status = 'completed')
  EXECUTE FUNCTION public.goals_grant_xp();

NOTIFY pgrst, 'reload schema';


/*
════════════════════════════════════════════════════════════════════════════════
VERIFY — run after applying. Nothing in this block writes except where marked,
and those parts are wrapped in ROLLBACK.
════════════════════════════════════════════════════════════════════════════════

-- ── 1. THE GRANTS CHECK. This is the one that matters. ──────────────────────
-- EXPECT: xp_select = true, and INSERT/UPDATE/DELETE all false for BOTH roles.
-- If xp_insert reads true for authenticated, the ledger is forgeable from the
-- browser console and every number in the header is a lie.
SELECT
  has_table_privilege('authenticated', 'public.xp_events', 'SELECT') AS xp_select_authenticated,
  has_table_privilege('authenticated', 'public.xp_events', 'INSERT') AS xp_insert_authenticated,
  has_table_privilege('authenticated', 'public.xp_events', 'UPDATE') AS xp_update_authenticated,
  has_table_privilege('authenticated', 'public.xp_events', 'DELETE') AS xp_delete_authenticated,
  has_table_privilege('anon',          'public.xp_events', 'SELECT') AS xp_select_anon,
  has_table_privilege('anon',          'public.xp_events', 'INSERT') AS xp_insert_anon;

-- EXPECT: exactly one row — authenticated / SELECT. `anon` must not appear.
SELECT grantee, privilege_type
FROM information_schema.table_privileges
WHERE table_schema = 'public' AND table_name = 'xp_events'
  AND grantee IN ('anon', 'authenticated')
ORDER BY grantee, privilege_type;

-- EXPECT: rowsecurity = true, and exactly one policy: xp_events_select, cmd SELECT,
-- qual (user_id = auth.uid()). No INSERT policy.
SELECT relrowsecurity AS rls_enabled FROM pg_class WHERE oid = 'public.xp_events'::regclass;
SELECT policyname, cmd, qual FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'xp_events';

-- EXPECT: both unique constraints present.
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint WHERE conrelid = 'public.xp_events'::regclass AND contype = 'u'
ORDER BY conname;

-- EXPECT: grant_xp is security_definer = true and executable by NOBODY but its owner.
SELECT p.prosecdef AS security_definer,
       has_function_privilege('authenticated', 'public.grant_xp(uuid,text,uuid,int)', 'EXECUTE') AS grant_xp_authenticated,
       has_function_privilege('anon',          'public.grant_xp(uuid,text,uuid,int)', 'EXECUTE') AS grant_xp_anon,
       has_function_privilege('service_role',  'public.grant_xp(uuid,text,uuid,int)', 'EXECUTE') AS grant_xp_service_role
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'grant_xp';


-- ── 2. NOTHING ELSE MOVED ───────────────────────────────────────────────────
-- The claim in the header is that no existing permission changed. Check it.

-- EXPECT: can_write_status = true (manual completion still works — the
-- 20260808120000 decision stands), user_id/path_id false.
SELECT
  has_column_privilege('authenticated', 'public.path_phases', 'status',  'UPDATE') AS phase_status_writable,
  has_column_privilege('authenticated', 'public.path_phases', 'user_id', 'UPDATE') AS phase_user_id_writable,
  has_column_privilege('authenticated', 'public.goals',       'status',  'UPDATE') AS goal_status_writable,
  has_column_privilege('authenticated', 'public.goals',       'user_id', 'UPDATE') AS goal_user_id_writable,
  has_column_privilege('authenticated', 'public.habits', 'is_physical',  'UPDATE') AS habit_physical_writable,
  has_column_privilege('authenticated', 'public.habits',      'user_id', 'UPDATE') AS habit_user_id_writable;
-- EXPECT: true, false, true, false, true, false.

-- EXPECT: for BOTH record functions — authenticated false, anon false, service_role true.
SELECT
  has_function_privilege('authenticated', 'public.record_checkin(uuid,text,date,boolean)', 'EXECUTE')      AS checkin_authenticated,
  has_function_privilege('anon',          'public.record_checkin(uuid,text,date,boolean)', 'EXECUTE')      AS checkin_anon,
  has_function_privilege('service_role',  'public.record_checkin(uuid,text,date,boolean)', 'EXECUTE')      AS checkin_service_role,
  has_function_privilege('authenticated', 'public.record_habit_completion(uuid,uuid,text)', 'EXECUTE')     AS habit_authenticated,
  has_function_privilege('service_role',  'public.record_habit_completion(uuid,uuid,text)', 'EXECUTE')     AS habit_service_role;

-- EXPECT: NULL. The 3-arg record_checkin must be gone, or PostgREST sees two
-- overloads and 300s on an ambiguous call from verify-proof.
SELECT to_regprocedure('public.record_checkin(uuid,text,date)') AS old_3arg_must_be_null;

-- EXPECT: streak_logs and habit_completions still grant SELECT and nothing else.
SELECT table_name, grantee, privilege_type
FROM information_schema.table_privileges
WHERE table_schema = 'public'
  AND table_name IN ('streak_logs', 'habit_completions')
  AND grantee IN ('anon', 'authenticated')
ORDER BY table_name, grantee, privilege_type;

-- EXPECT: the two new AFTER triggers, and NOTHING resembling a BEFORE gate.
-- tgtype bit 0 (value 1) = ROW, bit 1 (value 2) = BEFORE. Both should read AFTER.
SELECT c.relname AS table_name, t.tgname,
       CASE WHEN (t.tgtype & 2) = 2 THEN 'BEFORE' ELSE 'AFTER' END AS timing
FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
WHERE NOT t.tgisinternal AND c.relname IN ('path_phases', 'goals')
ORDER BY c.relname, t.tgname;


-- ── 3. A BRAND-NEW USER IS LEVEL 1 WITH 0 XP ────────────────────────────────
-- The balance query the header runs, for every user. sum() over zero rows is NULL,
-- so the coalesce is what makes a new account read 0 and not blank.
SELECT u.username,
       coalesce(sum(x.amount), 0)                        AS total_xp,
       floor(coalesce(sum(x.amount), 0) / 50) + 1        AS level,
       coalesce(sum(x.amount), 0) % 50                   AS xp_into_level
FROM public.users u
LEFT JOIN public.xp_events x ON x.user_id = u.id
GROUP BY u.username
ORDER BY total_xp DESC;
-- EXPECT: a user who has done nothing reads total_xp 0, level 1, xp_into_level 0.


-- ── 4. THE TOGGLE TEST — phase XP is paid exactly once ──────────────────────
-- Substitute a real phase id you own that is NOT already completed.
-- Everything is rolled back, so this leaves no XP behind.
BEGIN;
  SELECT count(*) AS before_count FROM xp_events WHERE source_id = '<phase-uuid>';
  -- EXPECT: 0

  UPDATE path_phases SET status = 'completed' WHERE id = '<phase-uuid>';
  SELECT count(*), sum(amount) FROM xp_events WHERE source_id = '<phase-uuid>';
  -- EXPECT: 1, 100

  UPDATE path_phases SET status = 'pending'   WHERE id = '<phase-uuid>';
  UPDATE path_phases SET status = 'completed' WHERE id = '<phase-uuid>';
  UPDATE path_phases SET status = 'pending'   WHERE id = '<phase-uuid>';
  UPDATE path_phases SET status = 'completed' WHERE id = '<phase-uuid>';
  SELECT count(*), sum(amount) FROM xp_events WHERE source_id = '<phase-uuid>';
  -- EXPECT: still 1, still 100. Four completions, one payout.
  -- Note the toggles themselves all SUCCEEDED — the trigger never blocks.
ROLLBACK;

-- Same for a goal. Substitute a real goal id.
BEGIN;
  UPDATE goals SET status = 'completed' WHERE id = '<goal-uuid>';
  UPDATE goals SET status = 'active'    WHERE id = '<goal-uuid>';
  UPDATE goals SET status = 'completed' WHERE id = '<goal-uuid>';
  SELECT source_type, amount, count(*) OVER () AS rows
  FROM xp_events WHERE source_id = '<goal-uuid>';
  -- EXPECT: exactly 1 row. goal_short/250 or goal_long/500 matching the goal's type.
ROLLBACK;
*/
