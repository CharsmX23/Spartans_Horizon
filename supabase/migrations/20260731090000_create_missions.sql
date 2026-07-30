/*
# missions — private, per-user deadlines for the "Next Missions" home section

## Schema decision: a dedicated table, not a user_id path on `projects`
`projects` does not exist. It was specified in the build brief for Phase 3 but never
built, so there is nothing to add a user_id path to. The real choice was between a new
`missions` table and reusing `goals`, which is already owner-scoped and already carries
`title` + `deadline`.

Dedicated table, because reusing `goals` would mean either widening its
`goal_type IN ('long_term','short_term')` CHECK to include a third kind — mutating a
constraint GoalsPage depends on and entangling two features — or filing missions under a
goal type they are not. `goals` also carries `status` and `description` semantics that a
mission (title + deadline) does not need. A separate table keeps GoalsPage untouched and
lets priority/progress land here later without touching goals.

## Privacy
Owner-only, and unlike `learning_paths` there is NO squad read: these are private, so
the SELECT policy is `user_id = auth.uid()` rather than `shares_squad_with()`.

## Room for priority/progress
Both columns exist now, nullable, so adding them to the UI later needs no schema change.
They are deliberately left OUT of the UPDATE grant: with no UI behind them, nothing
should be able to set a priority or a progress percentage yet. Enabling them later is
one explicit GRANT — which is the point, since a fabricated "78% CRITICAL" is exactly
the kind of fake signal this app has been removing.
*/

CREATE TABLE IF NOT EXISTS missions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL DEFAULT auth.uid()
                REFERENCES auth.users(id) ON DELETE CASCADE,
  title       text NOT NULL CHECK (char_length(trim(title)) BETWEEN 1 AND 120),
  deadline    date,
  -- Reserved. Nullable + CHECK that tolerates NULL, so no backfill is ever needed.
  priority    text CHECK (priority IS NULL OR priority IN ('critical', 'high', 'medium', 'low')),
  progress    int  CHECK (progress IS NULL OR progress BETWEEN 0 AND 100),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Home section sorts by nearest deadline for one user.
CREATE INDEX IF NOT EXISTS missions_user_deadline_idx ON missions(user_id, deadline);

ALTER TABLE missions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "missions_select" ON missions;
DROP POLICY IF EXISTS "missions_insert" ON missions;
DROP POLICY IF EXISTS "missions_update" ON missions;
DROP POLICY IF EXISTS "missions_delete" ON missions;

CREATE POLICY "missions_select" ON missions FOR SELECT
  TO authenticated USING (user_id = auth.uid());
CREATE POLICY "missions_insert" ON missions FOR INSERT
  TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "missions_update" ON missions FOR UPDATE
  TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "missions_delete" ON missions FOR DELETE
  TO authenticated USING (user_id = auth.uid());

-- RLS picks the rows; grants pick the columns. `user_id` is never client-writable —
-- the DEFAULT supplies it — and priority/progress stay ungranted until they have UI.
REVOKE ALL ON missions FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON missions TO authenticated;
GRANT UPDATE (title, deadline) ON missions TO authenticated;

-- PostgREST caches the schema; without this the table 404s until the cache refreshes.
NOTIFY pgrst, 'reload schema';
