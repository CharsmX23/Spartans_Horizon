/*
# path_phases — expandable phase timeline per learning path

Power Up's answer to `mission_phases`. A path's timeline used to be derived from module
estimates, which meant it could only ever say "module 3 takes 5 days" — you could not
name a stage. Phases are entered by hand ("Prototyping", "Evaluation") and chained in
order, exactly like the phases under a mission on the home screen.

## Objects created
- TABLE path_phases
- INDEX path_phases_path_order_idx, path_phases_user_id_idx

## Ownership cannot drift
`FOREIGN KEY (path_id, user_id) REFERENCES learning_paths(id, user_id)` — a phase whose
owner differs from its path's owner is unrepresentable. `learning_paths` already carries
the UNIQUE (id, user_id) this points at, so no prerequisite constraint is needed here.

## Visibility follows the path, not the mission
`mission_phases` is owner-only because missions are private. Learning paths are
squad-readable (`shares_squad_with`), and a squadmate who can see the modules but not the
phases would see a timeline with holes in it — so SELECT matches `learning_paths`.
Writes stay owner-only.

## Grants
UPDATE is limited to the user-editable columns. `user_id` and `path_id` are excluded, so
a phase can never be reassigned to another user or moved to another path from the client.
*/

CREATE TABLE IF NOT EXISTS path_phases (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  path_id      uuid NOT NULL,
  user_id      uuid NOT NULL DEFAULT auth.uid(),
  title        text NOT NULL CHECK (char_length(trim(title)) BETWEEN 1 AND 120),
  description  text,
  status       text NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'live', 'completed')),
  start_date   date,
  target_date  date,
  order_index  int NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (path_id, user_id) REFERENCES learning_paths(id, user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS path_phases_path_order_idx ON path_phases(path_id, order_index);
CREATE INDEX IF NOT EXISTS path_phases_user_id_idx ON path_phases(user_id);

-- ── RLS ─────────────────────────────────────────────────────────────────
ALTER TABLE path_phases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pp_select" ON path_phases;
DROP POLICY IF EXISTS "pp_insert" ON path_phases;
DROP POLICY IF EXISTS "pp_update" ON path_phases;
DROP POLICY IF EXISTS "pp_delete" ON path_phases;

CREATE POLICY "pp_select" ON path_phases FOR SELECT
  TO authenticated USING (public.shares_squad_with(user_id));
CREATE POLICY "pp_insert" ON path_phases FOR INSERT
  TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "pp_update" ON path_phases FOR UPDATE
  TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "pp_delete" ON path_phases FOR DELETE
  TO authenticated USING (user_id = auth.uid());

-- ── Grants: RLS picks rows, these pick columns ──────────────────────────
REVOKE ALL ON path_phases FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON path_phases TO authenticated;
GRANT UPDATE (title, description, status, start_date, target_date, order_index)
  ON path_phases TO authenticated;

NOTIFY pgrst, 'reload schema';
