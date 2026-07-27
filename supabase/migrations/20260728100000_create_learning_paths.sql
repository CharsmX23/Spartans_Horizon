/*
# Phase 2 — learning paths, modules, tasks

Three tables in a paths -> modules -> tasks hierarchy, matching the Phase 4 generator
output one-for-one so the AI layer can write straight into them without reshaping.

## Deviation from the build brief (agreed)
The brief listed a flat `learning_tasks` carrying `module_title`, `ai_leverage`, and
`estimated_days` per task, with no home for the required per-module `why_it_matters`.
Those four fields are module-level in the AI schema, so repeating them on every task
would duplicate data and lose `why_it_matters` entirely. `learning_modules` is inserted
between paths and tasks instead, and `learning_tasks.path_id` becomes `module_id`.

## user_id is denormalized onto all three tables
RLS on a task would otherwise need two joins to reach the owner. Every table carries
`user_id uuid NOT NULL DEFAULT auth.uid()` so policies stay single-predicate. The risk
of denormalization — a module whose owner drifts from its path's owner — is closed by
composite foreign keys: children reference `(id, user_id)` of their parent, so Postgres
makes divergence unrepresentable rather than merely discouraged.

## Sharing
Squadmates can READ each other's paths (progress visibility is the point of a squad);
only the owner can write. Journals stay private and are untouched by this migration.

## is_done is not client-writable
Tasks are ticked through `set_task_done()`, not a direct UPDATE. Phase 2 passes the
value straight through; Phase 4 adds proof verification inside that one function, so no
grants change and no client code moves when the AI lands.
*/

-- ── Helper: does the caller share a squad with this user? ────────────────
-- SECURITY DEFINER so the lookup is not itself filtered by users' own RLS.
CREATE OR REPLACE FUNCTION public.shares_squad_with(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_user_id = auth.uid()
      OR EXISTS (
        SELECT 1
        FROM public.users me
        JOIN public.users them ON them.squad_id = me.squad_id
        WHERE me.id = auth.uid()
          AND them.id = p_user_id
          AND me.squad_id IS NOT NULL
      );
$$;

GRANT EXECUTE ON FUNCTION public.shares_squad_with(uuid) TO authenticated;

-- ── learning_paths ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS learning_paths (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid NOT NULL DEFAULT auth.uid()
                         REFERENCES auth.users(id) ON DELETE CASCADE,
  title                text NOT NULL CHECK (char_length(trim(title)) BETWEEN 1 AND 120),
  overview             text NOT NULL DEFAULT '',
  -- [{ "term": "...", "definition": "..." }] — the glossary defined before any
  -- module assumes knowledge.
  foundational_terms   jsonb NOT NULL DEFAULT '[]'::jsonb
                         CHECK (jsonb_typeof(foundational_terms) = 'array'),
  total_timeline_weeks int CHECK (total_timeline_weeks IS NULL OR total_timeline_weeks BETWEEN 1 AND 104),
  created_at           timestamptz NOT NULL DEFAULT now(),
  -- Target for the composite FK from learning_modules.
  UNIQUE (id, user_id)
);

CREATE INDEX IF NOT EXISTS learning_paths_user_id_idx ON learning_paths(user_id);

-- ── learning_modules ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS learning_modules (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  path_id         uuid NOT NULL,
  user_id         uuid NOT NULL DEFAULT auth.uid(),
  title           text NOT NULL CHECK (char_length(trim(title)) BETWEEN 1 AND 120),
  why_it_matters  text NOT NULL DEFAULT '',
  -- How to use AI tools to learn/apply THIS topic faster. Required by the brief on
  -- every module, so it is a column rather than a nullable afterthought.
  ai_leverage     text NOT NULL DEFAULT '',
  estimated_days  int CHECK (estimated_days IS NULL OR estimated_days BETWEEN 1 AND 365),
  sort_order      int NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  -- Owner cannot drift from the parent path's owner.
  FOREIGN KEY (path_id, user_id) REFERENCES learning_paths(id, user_id) ON DELETE CASCADE,
  UNIQUE (id, user_id)
);

CREATE INDEX IF NOT EXISTS learning_modules_path_idx ON learning_modules(path_id, sort_order);
CREATE INDEX IF NOT EXISTS learning_modules_user_id_idx ON learning_modules(user_id);

-- ── learning_tasks ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS learning_tasks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id   uuid NOT NULL,
  user_id     uuid NOT NULL DEFAULT auth.uid(),
  label       text NOT NULL CHECK (char_length(trim(label)) BETWEEN 1 AND 200),
  proof_type  text NOT NULL DEFAULT 'text' CHECK (proof_type IN ('photo', 'link', 'text')),
  is_done     boolean NOT NULL DEFAULT false,
  -- Phase 4 fills these when a proof passes verification.
  done_at     timestamptz,
  sort_order  int NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (module_id, user_id) REFERENCES learning_modules(id, user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS learning_tasks_module_idx ON learning_tasks(module_id, sort_order);
CREATE INDEX IF NOT EXISTS learning_tasks_user_id_idx ON learning_tasks(user_id);

-- ── RLS ──────────────────────────────────────────────────────────────────
ALTER TABLE learning_paths   ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_tasks   ENABLE ROW LEVEL SECURITY;

-- Read: you or your squad. Write: you only.
DROP POLICY IF EXISTS "lp_select" ON learning_paths;
DROP POLICY IF EXISTS "lp_insert" ON learning_paths;
DROP POLICY IF EXISTS "lp_update" ON learning_paths;
DROP POLICY IF EXISTS "lp_delete" ON learning_paths;

CREATE POLICY "lp_select" ON learning_paths FOR SELECT
  TO authenticated USING (public.shares_squad_with(user_id));
CREATE POLICY "lp_insert" ON learning_paths FOR INSERT
  TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "lp_update" ON learning_paths FOR UPDATE
  TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "lp_delete" ON learning_paths FOR DELETE
  TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "lm_select" ON learning_modules;
DROP POLICY IF EXISTS "lm_insert" ON learning_modules;
DROP POLICY IF EXISTS "lm_update" ON learning_modules;
DROP POLICY IF EXISTS "lm_delete" ON learning_modules;

CREATE POLICY "lm_select" ON learning_modules FOR SELECT
  TO authenticated USING (public.shares_squad_with(user_id));
CREATE POLICY "lm_insert" ON learning_modules FOR INSERT
  TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "lm_update" ON learning_modules FOR UPDATE
  TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "lm_delete" ON learning_modules FOR DELETE
  TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "lt_select" ON learning_tasks;
DROP POLICY IF EXISTS "lt_insert" ON learning_tasks;
DROP POLICY IF EXISTS "lt_update" ON learning_tasks;
DROP POLICY IF EXISTS "lt_delete" ON learning_tasks;

CREATE POLICY "lt_select" ON learning_tasks FOR SELECT
  TO authenticated USING (public.shares_squad_with(user_id));
CREATE POLICY "lt_insert" ON learning_tasks FOR INSERT
  TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "lt_update" ON learning_tasks FOR UPDATE
  TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "lt_delete" ON learning_tasks FOR DELETE
  TO authenticated USING (user_id = auth.uid());

-- ── Column grants ────────────────────────────────────────────────────────
-- RLS picks the rows; these pick the columns. `user_id` is never client-writable —
-- the DEFAULT supplies it — and `is_done` / `done_at` belong to set_task_done().
REVOKE ALL ON learning_paths, learning_modules, learning_tasks FROM anon, authenticated;

GRANT SELECT, INSERT, DELETE ON learning_paths TO authenticated;
GRANT UPDATE (title, overview, foundational_terms, total_timeline_weeks)
  ON learning_paths TO authenticated;

GRANT SELECT, INSERT, DELETE ON learning_modules TO authenticated;
GRANT UPDATE (title, why_it_matters, ai_leverage, estimated_days, sort_order)
  ON learning_modules TO authenticated;

GRANT SELECT, INSERT, DELETE ON learning_tasks TO authenticated;
GRANT UPDATE (label, proof_type, sort_order) ON learning_tasks TO authenticated;

-- ── set_task_done ────────────────────────────────────────────────────────
-- The single seam where a checkbox changes state. Phase 4 adds proof verification
-- here; nothing else has to move.
CREATE OR REPLACE FUNCTION public.set_task_done(p_task_id uuid, p_done boolean)
RETURNS learning_tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_task learning_tasks;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- SECURITY DEFINER bypasses RLS, so ownership is checked explicitly here.
  SELECT * INTO v_task FROM learning_tasks WHERE id = p_task_id;

  IF v_task.id IS NULL THEN
    RAISE EXCEPTION 'Task not found';
  END IF;

  IF v_task.user_id <> v_uid THEN
    RAISE EXCEPTION 'That task belongs to someone else';
  END IF;

  UPDATE learning_tasks
     SET is_done = p_done,
         done_at = CASE WHEN p_done THEN now() ELSE NULL END
   WHERE id = p_task_id
  RETURNING * INTO v_task;

  RETURN v_task;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_task_done(uuid, boolean) TO authenticated;
