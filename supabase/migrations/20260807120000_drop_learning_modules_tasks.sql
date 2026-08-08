/*
# Drop learning_modules and learning_tasks

Power Up's `paths -> modules -> tasks` hierarchy collapses to `paths -> phases`. A path
now describes itself (title, overview, timeframe) and is broken into `path_phases`, the
same timeline shape as a mission on the home screen. Modules and tasks were a second,
parallel way of saying the same thing, in a different vocabulary, in a different visual
language — so one of them had to go, and the phase timeline is the one that is already
shared with missions.

## What this drops
- TABLE learning_tasks           (with its policies, indexes, and grants)
- TABLE learning_modules         (ditto)
- FUNCTION set_task_done(uuid, boolean)

`set_task_done()` returns `learning_tasks` and writes to it; it cannot outlive the table
and there is nothing left for it to tick. Its `GRANT EXECUTE ... TO authenticated` is
dropped by Postgres along with the function — a grant cannot survive its object, so
there is no separate REVOKE to remember here.

## What this deliberately keeps
- TABLE learning_paths, including `UNIQUE (id, user_id)`. That constraint was added as
  the target of the composite FK from learning_modules, which is now gone — but
  `path_phases` points at the *same* pair, so dropping it would break the ownership
  guard on phases. It stays, and the DO block at the bottom fails the migration if it
  ever silently doesn't.
- TABLE path_phases — untouched by this migration; it is what replaces the dropped two.
- FUNCTION shares_squad_with(uuid) — the SELECT policies on both learning_paths and
  path_phases call it. Nothing about it is module-specific.

## Ordering, and why there is no CASCADE
`learning_tasks` is dropped before `learning_modules` so the FK between them resolves in
the ordinary way. Neither drop uses CASCADE: if some object added later depends on these
tables, this migration should fail loudly and be re-thought, not quietly take that object
with it. The one known dependency, set_task_done(), is dropped explicitly above.

## Before you run this
`supabase/backup_before_module_drop.sql` dumps all three tables plus a flattened
path/module/task export. Run and export it first — this migration is not reversible.
*/

-- ── The only object outside the tables that references them ─────────────────
DROP FUNCTION IF EXISTS public.set_task_done(uuid, boolean);

-- ── The tables, child first, no CASCADE ─────────────────────────────────────
DROP TABLE IF EXISTS public.learning_tasks;
DROP TABLE IF EXISTS public.learning_modules;

-- ── Assert the keepers survived ─────────────────────────────────────────────
-- A drop migration's real risk is not what it removes but what it removes *with* it.
-- These four checks are the things path_phases and Power Up depend on; if any of them
-- is missing when this block runs, the whole migration rolls back rather than leaving a
-- half-dismantled schema behind.
DO $$
BEGIN
  IF to_regclass('public.learning_paths') IS NULL THEN
    RAISE EXCEPTION 'learning_paths is gone — it must survive this migration';
  END IF;

  IF to_regclass('public.path_phases') IS NULL THEN
    RAISE EXCEPTION 'path_phases is gone — it is what replaces modules and tasks';
  END IF;

  -- The composite-FK target that path_phases(path_id, user_id) points at.
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    WHERE c.conrelid = 'public.learning_paths'::regclass
      AND c.contype = 'u'
      AND c.conkey @> ARRAY[
        (SELECT attnum FROM pg_attribute
          WHERE attrelid = 'public.learning_paths'::regclass AND attname = 'id'),
        (SELECT attnum FROM pg_attribute
          WHERE attrelid = 'public.learning_paths'::regclass AND attname = 'user_id')
      ]::smallint[]
  ) THEN
    RAISE EXCEPTION 'learning_paths lost its UNIQUE (id, user_id) — path_phases FK is unbacked';
  END IF;

  IF to_regprocedure('public.shares_squad_with(uuid)') IS NULL THEN
    RAISE EXCEPTION 'shares_squad_with(uuid) is gone — squad-read policies depend on it';
  END IF;
END;
$$;

-- PostgREST caches the schema; without this it keeps advertising the dropped tables and
-- a stale client gets a confusing 404 instead of a clean "relation does not exist".
NOTIFY pgrst, 'reload schema';
