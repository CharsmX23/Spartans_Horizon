/*
# habits — real, per-user daily habits with AI-verified completions

Replaces the hardcoded `HABITS` / `TODAY_ITEMS` fixtures in `src/data.ts`, whose ticks
were decoration — a literal `done: true/false` that never changed. This is the same
category of fake signal the app has been removing (the "78% CRITICAL" progress bars, the
canned AI verdicts). A habit is now ticked only by a passing Gemini verdict on a photo,
exactly like a streak check-in.

## Tables
- `habits`             — id, user_id, title, icon, active, sort_order, created_at.
                         Owner-only, mirrors `missions`.
- `habit_completions`  — one verified completion per habit per day
                         (UNIQUE (user_id, habit_id, log_date)). NOT client-writable:
                         SELECT is granted, every write goes through
                         record_habit_completion(), same shape as `streak_logs`.

## Ownership cannot drift
`habit_completions` carries a composite FK to `habits(id, user_id)`, so a completion
whose owner differs from its habit's owner is unrepresentable — the same structural
guarantee learning_tasks -> learning_modules uses. That needs UNIQUE (id, user_id) on
`habits`, added below (id is already the PK, so the pair is unique by construction).

## Streak coupling (product decision)
A verified habit also advances the daily streak: record_habit_completion() calls
record_checkin() after recording the completion. Ticking any habit *is* that day's
check-in. record_checkin() is idempotent per day, so ticking a second habit the same day
records the completion without double-counting the streak.

## Seeding
Every user starts with the four original demo habits (Workout / Deep work block /
Read 20 pages / Sleep by 11pm). New users are seeded by the signup trigger; existing
users are backfilled once at the bottom of this migration. seed_default_habits() is the
single source of truth for that default set and is a no-op if the user already has any.
*/

-- ── habits ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS habits (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL DEFAULT auth.uid()
                REFERENCES auth.users(id) ON DELETE CASCADE,
  title       text NOT NULL CHECK (char_length(trim(title)) BETWEEN 1 AND 80),
  -- lucide icon name; the client maps a known set to components with a fallback.
  icon        text NOT NULL DEFAULT 'Flame',
  active       boolean NOT NULL DEFAULT true,
  sort_order  int NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  -- Prerequisite for the composite FK from habit_completions.
  CONSTRAINT habits_id_user_key UNIQUE (id, user_id)
);

CREATE INDEX IF NOT EXISTS habits_user_sort_idx ON habits(user_id, sort_order);

ALTER TABLE habits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "habits_select" ON habits;
DROP POLICY IF EXISTS "habits_insert" ON habits;
DROP POLICY IF EXISTS "habits_update" ON habits;
DROP POLICY IF EXISTS "habits_delete" ON habits;

CREATE POLICY "habits_select" ON habits FOR SELECT
  TO authenticated USING (user_id = auth.uid());
CREATE POLICY "habits_insert" ON habits FOR INSERT
  TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "habits_update" ON habits FOR UPDATE
  TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "habits_delete" ON habits FOR DELETE
  TO authenticated USING (user_id = auth.uid());

-- RLS picks rows; grants pick columns. `user_id` is never client-writable (the DEFAULT
-- supplies it); a habit can be renamed, reordered, or archived, nothing else.
REVOKE ALL ON habits FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON habits TO authenticated;
GRANT UPDATE (title, icon, active, sort_order) ON habits TO authenticated;

-- ── habit_completions ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS habit_completions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL DEFAULT auth.uid(),
  habit_id         uuid NOT NULL,
  log_date         date NOT NULL DEFAULT current_date,
  verified         boolean NOT NULL DEFAULT false,
  evaluation_text  text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (habit_id, user_id) REFERENCES habits(id, user_id) ON DELETE CASCADE,
  -- One completion per habit per day; re-submission refreshes it, never duplicates.
  CONSTRAINT habit_completions_unique_day UNIQUE (user_id, habit_id, log_date)
);

CREATE INDEX IF NOT EXISTS habit_completions_user_date_idx
  ON habit_completions(user_id, log_date);

ALTER TABLE habit_completions ENABLE ROW LEVEL SECURITY;

-- Read-only to the client, exactly like streak_logs. Every write goes through
-- record_habit_completion(), so `verified` is not client-settable and no photo verdict
-- can be forged from the browser.
DROP POLICY IF EXISTS "habit_completions_select" ON habit_completions;
CREATE POLICY "habit_completions_select" ON habit_completions FOR SELECT
  TO authenticated USING (user_id = auth.uid());

REVOKE ALL ON habit_completions FROM anon, authenticated;
GRANT SELECT ON habit_completions TO authenticated;

-- ── record_habit_completion — the only write path ─────────────────────────
/*
Same shape and rationale as record_checkin(): EXECUTE is service_role-only, so a signed-in
user cannot call it and hand themselves a completion. `auth.uid()` is therefore NULL
inside it and ownership arrives as p_user_id — which the verify-proof Edge Function
resolves from the verified JWT, never from the request body.

The habit is validated to belong to the caller and to be active before anything is
recorded, so a stale or foreign habit_id fails loudly instead of writing an orphan.

On success it also advances the streak by calling record_checkin(). record_checkin() is
idempotent per day, so a second habit ticked the same day records its own completion
without moving the streak twice.
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
  v_today   date := current_date;
  v_title   text;
  v_streak  json;
BEGIN
  IF p_user_id IS NULL OR p_habit_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id and p_habit_id are required';
  END IF;

  SELECT title INTO v_title
    FROM habits
   WHERE id = p_habit_id AND user_id = p_user_id AND active;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No active habit % for that user', p_habit_id;
  END IF;

  INSERT INTO habit_completions (user_id, habit_id, log_date, verified, evaluation_text)
  VALUES (p_user_id, p_habit_id, v_today, true, p_note)
  ON CONFLICT (user_id, habit_id, log_date) DO UPDATE
     SET verified        = true,
         evaluation_text = coalesce(excluded.evaluation_text, habit_completions.evaluation_text);

  -- A verified habit is the day's check-in. Idempotent, so ticking more habits today
  -- keeps the streak where it is rather than inflating it.
  v_streak := record_checkin(p_user_id, p_note);

  RETURN json_build_object(
    'habit_id',  p_habit_id,
    'title',     v_title,
    'log_date',  v_today,
    'streak',    v_streak
  );
END;
$$;

-- EXECUTE defaults to PUBLIC; the REVOKE is load-bearing, or any signed-in user could
-- tick a habit (and thus their streak) with no photo at all.
REVOKE ALL ON FUNCTION public.record_habit_completion(uuid, uuid, text) FROM public;
REVOKE ALL ON FUNCTION public.record_habit_completion(uuid, uuid, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_habit_completion(uuid, uuid, text) TO service_role;

-- ── Default habit set + seeding ───────────────────────────────────────────
-- Single source of truth for the starter habits. SECURITY DEFINER so it can write
-- regardless of the caller's grants; no-op if the user already has any habit, which
-- makes both the trigger and the backfill idempotent.
CREATE OR REPLACE FUNCTION public.seed_default_habits(p_user_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO habits (user_id, title, icon, sort_order)
  SELECT p_user_id, d.title, d.icon, d.sort_order
  FROM (VALUES
    ('Workout',         'Dumbbell', 0),
    ('Deep work block', 'Code2',    1),
    ('Read 20 pages',   'BookOpen', 2),
    ('Sleep by 11pm',   'Moon',     3)
  ) AS d(title, icon, sort_order)
  WHERE NOT EXISTS (SELECT 1 FROM habits h WHERE h.user_id = p_user_id);
$$;

REVOKE ALL ON FUNCTION public.seed_default_habits(uuid) FROM public;
REVOKE ALL ON FUNCTION public.seed_default_habits(uuid) FROM anon, authenticated;

-- ── Extend the signup trigger to seed habits ──────────────────────────────
-- Re-declares handle_new_user() from 20260727120000 with one added call. Kept as a full
-- CREATE OR REPLACE (not an ALTER) so a fresh replay ends with this definition; the
-- profile-row insert is unchanged.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.users (id, username)
  VALUES (
    NEW.id,
    lower(coalesce(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1)))
  );

  PERFORM public.seed_default_habits(NEW.id);

  RETURN NEW;
END;
$$;

-- ── Backfill existing users ───────────────────────────────────────────────
-- The trigger only fires on new signups; give everyone already here the same starter
-- set. seed_default_habits() skips anyone who already has a habit, so this is safe to
-- replay.
DO $$
DECLARE
  v_id uuid;
BEGIN
  FOR v_id IN SELECT id FROM public.users LOOP
    PERFORM public.seed_default_habits(v_id);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
