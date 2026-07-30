/*
# record_checkin — server-side streak math

The streak counter had no server-side path. `StreaksPage` wrote `streak_logs.verified`
straight from the browser and nothing ever touched `users.current_streak`, so the
dashboard number stayed at 0 while the UI claimed "+1 streak day added". This closes
both halves: the increment now happens in the database, and the client can no longer
write the fields it depends on.

## Why the caller is identified by argument, not auth.uid()
`set_task_done()` runs on the caller's own JWT, which is right for a task the user is
allowed to tick manually. A streak is different — it may only advance on a Gemini
verdict, so the *user* must not be able to call this at all. EXECUTE is therefore
granted to `service_role` only, which means `auth.uid()` is NULL inside the function
and ownership has to arrive as `p_user_id`.

That argument is not client input. The `verify-proof` Edge Function resolves it from the
caller's JWT via `auth.getUser()` before invoking this, so a forged body cannot check in
as someone else.

## Streak rule
- last check-in was today      -> no-op, streak unchanged (idempotent re-submission)
- last check-in was yesterday  -> current_streak + 1
- anything else (null, gap)    -> reset to 1

`SELECT ... FOR UPDATE` serialises concurrent submissions so two requests can't both
read the same streak and each add one.
*/

CREATE OR REPLACE FUNCTION public.record_checkin(
  p_user_id  uuid,
  p_note     text DEFAULT NULL,
  p_log_date date DEFAULT NULL
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
  INSERT INTO streak_logs (user_id, log_date, verified, note)
  VALUES (p_user_id, v_today, true, p_note)
  ON CONFLICT (user_id, log_date) DO UPDATE
     SET verified = true,
         note     = coalesce(excluded.note, streak_logs.note);

  RETURN json_build_object(
    'current_streak',     v_streak,
    'last_checkin_date',  v_today,
    'already_checked_in', v_already
  );
END;
$$;

-- EXECUTE defaults to PUBLIC on a new function, so the REVOKE is load-bearing:
-- without it any signed-in user could call this and hand themselves a streak.
REVOKE ALL ON FUNCTION public.record_checkin(uuid, text, date) FROM public;
REVOKE ALL ON FUNCTION public.record_checkin(uuid, text, date) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_checkin(uuid, text, date) TO service_role;

-- ── Lock down streak_logs ────────────────────────────────────────────────
-- The client reads its own history to draw the grid and nothing more. Every write
-- goes through record_checkin(), so `verified` is no longer client-settable.
REVOKE ALL ON streak_logs FROM anon, authenticated;
GRANT SELECT ON streak_logs TO authenticated;

-- Write policies would now be dead letters — no grant backs them. Drop them so the
-- policy list stops implying the client can write here.
DROP POLICY IF EXISTS "streaks_insert" ON streak_logs;
DROP POLICY IF EXISTS "streaks_update" ON streak_logs;
DROP POLICY IF EXISTS "streaks_delete" ON streak_logs;

-- Owner-scoped read stays.
DROP POLICY IF EXISTS "streaks_select" ON streak_logs;
CREATE POLICY "streaks_select" ON streak_logs FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

/*
`users.current_streak` and `users.last_checkin_date` were already unreachable —
20260727120000 does `REVOKE ALL ON users` then grants only
`SELECT, INSERT, UPDATE (username)`. Re-asserted here so this migration is
self-contained and a fresh replay cannot leave them writable.
*/
REVOKE ALL ON users FROM anon, authenticated;
GRANT SELECT ON users TO authenticated;
GRANT INSERT ON users TO authenticated;
GRANT UPDATE (username) ON users TO authenticated;
