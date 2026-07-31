/*
# mission_phases — expandable phase timeline per mission

## Prerequisite: missions needs UNIQUE (id, user_id)
`missions` was created without it, so the composite-FK pattern used by
learning_modules/learning_tasks has nothing to point at. This migration adds that
constraint first. It is additive and cannot fail on existing data — `id` is already the
primary key, so (id, user_id) is unique by construction.

## Objects created
- CONSTRAINT missions_id_user_key  UNIQUE (id, user_id) ON missions   [prerequisite]
- TABLE      mission_phases
- INDEX      mission_phases_mission_order_idx, mission_phases_user_id_idx

## Ownership cannot drift
`FOREIGN KEY (mission_id, user_id) REFERENCES missions(id, user_id)` — a phase whose
owner differs from its mission's owner is unrepresentable, not merely discouraged. Same
pattern as learning_modules -> learning_paths.

## Privacy
Owner-only, `user_id = auth.uid()`, matching `missions`. No squad read: phases are as
private as the mission they belong to.

## Grants
UPDATE is limited to the user-editable columns. `user_id` and `mission_id` are excluded,
so a phase can never be reassigned to another user or moved to another mission from the
client — the DEFAULT and the insert supply them once.
*/

-- ── Prerequisite constraint on missions ─────────────────────────────────
ALTER TABLE missions DROP CONSTRAINT IF EXISTS missions_id_user_key;
ALTER TABLE missions ADD CONSTRAINT missions_id_user_key UNIQUE (id, user_id);

-- ── mission_phases ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mission_phases (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id   uuid NOT NULL,
  user_id      uuid NOT NULL DEFAULT auth.uid(),
  title        text NOT NULL CHECK (char_length(trim(title)) BETWEEN 1 AND 120),
  description  text,
  status       text NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'live', 'completed')),
  target_date  date,
  order_index  int NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (mission_id, user_id) REFERENCES missions(id, user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS mission_phases_mission_order_idx
  ON mission_phases(mission_id, order_index);
CREATE INDEX IF NOT EXISTS mission_phases_user_id_idx ON mission_phases(user_id);

-- ── RLS ─────────────────────────────────────────────────────────────────
ALTER TABLE mission_phases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mission_phases_select" ON mission_phases;
DROP POLICY IF EXISTS "mission_phases_insert" ON mission_phases;
DROP POLICY IF EXISTS "mission_phases_update" ON mission_phases;
DROP POLICY IF EXISTS "mission_phases_delete" ON mission_phases;

CREATE POLICY "mission_phases_select" ON mission_phases FOR SELECT
  TO authenticated USING (user_id = auth.uid());
CREATE POLICY "mission_phases_insert" ON mission_phases FOR INSERT
  TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "mission_phases_update" ON mission_phases FOR UPDATE
  TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "mission_phases_delete" ON mission_phases FOR DELETE
  TO authenticated USING (user_id = auth.uid());

-- ── Grants: RLS picks rows, these pick columns ──────────────────────────
REVOKE ALL ON mission_phases FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON mission_phases TO authenticated;
GRANT UPDATE (title, description, status, target_date, order_index)
  ON mission_phases TO authenticated;

NOTIFY pgrst, 'reload schema';
