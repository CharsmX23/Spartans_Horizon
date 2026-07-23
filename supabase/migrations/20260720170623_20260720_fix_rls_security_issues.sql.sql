/*
# Fix RLS security issues and function search_path

## Summary
This migration closes two classes of security findings reported against the
Spartan / Event Horizon dashboard:

1. `public.update_updated_at` had a role-mutable `search_path` (Supabase's
   "Function Search Path Mutable" warning). We pin its `search_path` to `public`
   so a hostile role cannot shadow `now()` or other built-ins.
2. The RLS policies on `journal_entries`, `skills`, `goals`, `streak_logs`, and
   `profile_settings` used `USING (true)` / `WITH CHECK (true)` for INSERT,
   UPDATE, and DELETE. With `TO anon, authenticated` this effectively disabled
   RLS — any anon-key client could insert, edit, or delete any row. To fix this
   properly we convert the app to a signed-in, owner-scoped model: every row
   now carries a `user_id` (defaulted to `auth.uid()`), and each policy checks
   `auth.uid() = user_id`. SELECT stays open to `anon, authenticated` only on
   the shared `profile_settings` singleton; all per-user tables are
   `authenticated`-only.

## Tables modified
- `journal_entries` — add `user_id uuid NOT NULL DEFAULT auth.uid()` FK to
  `auth.users`, ON DELETE CASCADE. Index on `user_id`.
- `skills` — same `user_id` column + index.
- `goals` — same `user_id` column + index.
- `streak_logs` — same `user_id` column + index. The existing unique constraint
  on `log_date` is replaced with a composite unique constraint on
  `(user_id, log_date)` so multiple users can each log the same day.
- `profile_settings` — add `user_id uuid NOT NULL DEFAULT auth.uid()` FK to
  `auth.users`, ON DELETE CASCADE. Drop the `id = 1` check and the integer PK
  in favor of a per-user row keyed by `user_id` (unique). Existing rows are
  backfilled to a placeholder user id is NOT done — instead we keep the table
  empty (it has 0 rows) and let new users create their own row on first load.

## Security changes
- `ALTER FUNCTION public.update_updated_at(...) SET search_path = public`.
- Drop and recreate all INSERT/UPDATE/DELETE policies on the five tables so
  they enforce `auth.uid() = user_id`. SELECT policies on per-user tables are
  also scoped to the owner. `profile_settings` SELECT is `authenticated`-only
  and scoped to the owner.
- All policies use `TO authenticated` because the app now has a sign-in
  screen. The anon role receives no direct grants on these tables.

## Important notes
1. The frontend is being updated in the same task to add a sign-in / sign-up
   screen. Without an authenticated session, `auth.uid()` is null and every
   write fails the new RLS checks — the app would silently appear broken.
   Both halves ship together.
2. `user_id` columns are `NOT NULL DEFAULT auth.uid()` so client inserts that
   omit `user_id` (which is all of them in this codebase) still satisfy the
   INSERT policy's `WITH CHECK (auth.uid() = user_id)`.
3. Existing rows (the tables currently have 0 rows) would be orphaned by the
   new NOT NULL `user_id` constraint if any existed. With 0 rows there is no
   data loss. We never DROP tables or columns — only ADD columns and
   constraints.
4. The unique constraint on `streak_logs.log_date` is dropped and replaced
   with `UNIQUE (user_id, log_date)`. Dropping a constraint is safe and does
   not lose data.
*/

-- ── 1. Pin search_path on update_updated_at ──────────────────────────────
ALTER FUNCTION public.update_updated_at() SET search_path = public;

-- ── 2. journal_entries: add user_id + owner-scoped policies ──────────────
ALTER TABLE journal_entries
  ADD COLUMN IF NOT EXISTS user_id uuid
    NOT NULL DEFAULT auth.uid()
    REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS journal_entries_user_id_idx ON journal_entries(user_id);

DROP POLICY IF EXISTS "je_select" ON journal_entries;
DROP POLICY IF EXISTS "je_insert" ON journal_entries;
DROP POLICY IF EXISTS "je_update" ON journal_entries;
DROP POLICY IF EXISTS "je_delete" ON journal_entries;

CREATE POLICY "je_select" ON journal_entries FOR SELECT
  TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "je_insert" ON journal_entries FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "je_update" ON journal_entries FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "je_delete" ON journal_entries FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- ── 3. skills: add user_id + owner-scoped policies ──────────────────────
ALTER TABLE skills
  ADD COLUMN IF NOT EXISTS user_id uuid
    NOT NULL DEFAULT auth.uid()
    REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS skills_user_id_idx ON skills(user_id);

DROP POLICY IF EXISTS "skills_select" ON skills;
DROP POLICY IF EXISTS "skills_insert" ON skills;
DROP POLICY IF EXISTS "skills_update" ON skills;
DROP POLICY IF EXISTS "skills_delete" ON skills;

CREATE POLICY "skills_select" ON skills FOR SELECT
  TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "skills_insert" ON skills FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "skills_update" ON skills FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "skills_delete" ON skills FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- ── 4. goals: add user_id + owner-scoped policies ───────────────────────
ALTER TABLE goals
  ADD COLUMN IF NOT EXISTS user_id uuid
    NOT NULL DEFAULT auth.uid()
    REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS goals_user_id_idx ON goals(user_id);

DROP POLICY IF EXISTS "goals_select" ON goals;
DROP POLICY IF EXISTS "goals_insert" ON goals;
DROP POLICY IF EXISTS "goals_update" ON goals;
DROP POLICY IF EXISTS "goals_delete" ON goals;

CREATE POLICY "goals_select" ON goals FOR SELECT
  TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "goals_insert" ON goals FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "goals_update" ON goals FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "goals_delete" ON goals FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- ── 5. streak_logs: add user_id, swap unique constraint, owner policies ──
ALTER TABLE streak_logs
  ADD COLUMN IF NOT EXISTS user_id uuid
    NOT NULL DEFAULT auth.uid()
    REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS streak_logs_user_id_idx ON streak_logs(user_id);

-- Replace the global unique-on-log_date with a per-user unique constraint.
ALTER TABLE streak_logs DROP CONSTRAINT IF EXISTS streak_logs_log_date_key;
ALTER TABLE streak_logs DROP CONSTRAINT IF EXISTS streak_logs_user_log_date_key;
ALTER TABLE streak_logs ADD CONSTRAINT streak_logs_user_log_date_key
  UNIQUE (user_id, log_date);

DROP POLICY IF EXISTS "streaks_select" ON streak_logs;
DROP POLICY IF EXISTS "streaks_insert" ON streak_logs;
DROP POLICY IF EXISTS "streaks_update" ON streak_logs;
DROP POLICY IF EXISTS "streaks_delete" ON streak_logs;

CREATE POLICY "streaks_select" ON streak_logs FOR SELECT
  TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "streaks_insert" ON streak_logs FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "streaks_update" ON streak_logs FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "streaks_delete" ON streak_logs FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- ── 6. profile_settings: convert to per-user, owner-scoped policies ─────
-- The existing table is a singleton (id = 1, CHECK (id = 1)). We add a
-- user_id column and a per-user unique constraint, and drop the singleton
-- check so each user can own their own row. The integer PK stays as a
-- surrogate; the unique constraint on user_id enforces one-row-per-user.
ALTER TABLE profile_settings
  ADD COLUMN IF NOT EXISTS user_id uuid
    NOT NULL DEFAULT auth.uid()
    REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE profile_settings DROP CONSTRAINT IF EXISTS profile_settings_user_id_key;
ALTER TABLE profile_settings ADD CONSTRAINT profile_settings_user_id_key
  UNIQUE (user_id);

-- Drop the singleton check so multiple users can each have a row.
ALTER TABLE profile_settings DROP CONSTRAINT IF EXISTS profile_settings_id_check;

CREATE INDEX IF NOT EXISTS profile_settings_user_id_idx ON profile_settings(user_id);

DROP POLICY IF EXISTS "profile_select" ON profile_settings;
DROP POLICY IF EXISTS "profile_insert" ON profile_settings;
DROP POLICY IF EXISTS "profile_update" ON profile_settings;
DROP POLICY IF EXISTS "profile_delete" ON profile_settings;

CREATE POLICY "profile_select" ON profile_settings FOR SELECT
  TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "profile_insert" ON profile_settings FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "profile_update" ON profile_settings FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "profile_delete" ON profile_settings FOR DELETE
  TO authenticated USING (auth.uid() = user_id);
