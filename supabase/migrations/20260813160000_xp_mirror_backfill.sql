/*
# One-time reconciliation: bring the existing ledger in line with the mirror

20260813150000 made phase/goal XP a live mirror of `status`, but triggers only fire on
events, and the rows already in `xp_events` were written under the old permanent model.
They are not wrong so much as stale: they record completions that happened, for things
that are no longer completed, or no longer exist at all.

Measured on this project at the time of writing, every phase/goal row in the ledger was
stale — 500 XP for a `goal_long` whose goal had been deleted, and 100 XP for a phase
currently sitting at `pending`. The header read 600 XP for work worth 0 under the new
rule. The mirror is only a mirror once this runs.

## What it deletes

Exactly two shapes, and only within phase/goal source types:

  1. ORPHANS — the source row no longer exists. Under the old model this was deliberate
     ("deleting a goal must not refund the XP it already paid"); under a mirror it is
     precisely the delete-and-recreate faucet that 20260813150000 closed going forward.
  2. STALE — the source row exists and is not currently 'completed'.

## What it cannot touch

`proof` and `habit_physical` are excluded by the WHERE clause, and they would be excluded
anyway: streak and habit XP is permanent (a photo taken on a Tuesday stays taken), and
their source rows are per-day records that are never un-completed. The verify block below
asserts the proof total is byte-identical before and after.

## This is destructive and not re-runnable in the "harmless" sense

Re-running it is a no-op — after the first run there is nothing stale left to find. But
the first run permanently deletes ledger rows, and there is no undo. Every user's XP
total will drop by the value of their stale rows, and their level will drop with it, since
level is computed from the total on read.

Run `SELECT` section 1 first and look at the numbers before running section 2.
*/

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. LOOK FIRST — what would be deleted, per user
-- ═══════════════════════════════════════════════════════════════════════════
SELECT u.username,
       coalesce(sum(x.amount) FILTER (WHERE src.status IS NULL), 0)                       AS orphaned_xp,
       coalesce(sum(x.amount) FILTER (WHERE src.status IS NOT NULL
                                        AND src.status <> 'completed'), 0)                AS stale_xp,
       coalesce(sum(x.amount) FILTER (WHERE src.status = 'completed'), 0)                 AS kept_xp,
       (SELECT coalesce(sum(amount), 0) FROM xp_events p
         WHERE p.user_id = u.id AND p.source_type IN ('proof','habit_physical'))          AS proof_xp_untouched
FROM public.users u
LEFT JOIN public.xp_events x
       ON x.user_id = u.id AND x.source_type IN ('phase','goal_short','goal_long')
LEFT JOIN LATERAL (
  SELECT CASE WHEN x.source_type = 'phase'
              THEN (SELECT status FROM public.path_phases WHERE id = x.source_id)
              ELSE (SELECT status FROM public.goals       WHERE id = x.source_id) END AS status
) src ON true
GROUP BY u.id, u.username
-- Repeats the two aggregates rather than naming the output columns: an output name is
-- only resolvable in ORDER BY when it stands alone, and inside an expression Postgres
-- looks for an *input* column called orphaned_xp, which does not exist (42703).
ORDER BY coalesce(sum(x.amount) FILTER (WHERE src.status IS NULL), 0)
       + coalesce(sum(x.amount) FILTER (WHERE src.status IS NOT NULL
                                          AND src.status <> 'completed'), 0) DESC;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. THE RECONCILIATION
-- ═══════════════════════════════════════════════════════════════════════════
/*
Written as one DELETE with a NOT EXISTS per source type rather than a join, so a row is
kept only if a *currently completed* source can be found for it. Anything else — missing,
pending, live, active, paused — goes. That is the mirror's rule stated once, in the
positive, instead of two separate delete passes that could disagree with each other.
*/
DELETE FROM public.xp_events x
 WHERE x.source_type IN ('phase', 'goal_short', 'goal_long')
   AND NOT EXISTS (
     SELECT 1 FROM public.path_phases p
      WHERE p.id = x.source_id AND p.status = 'completed' AND x.source_type = 'phase'
   )
   AND NOT EXISTS (
     SELECT 1 FROM public.goals g
      WHERE g.id = x.source_id AND g.status = 'completed'
        AND x.source_type IN ('goal_short', 'goal_long')
   );

NOTIFY pgrst, 'reload schema';


/*
════════════════════════════════════════════════════════════════════════════════
VERIFY — run after applying.
════════════════════════════════════════════════════════════════════════════════

-- EXPECT: zero rows. Every surviving phase/goal grant points at something that is
-- completed right now. This is the mirror property, stated as a query.
SELECT x.source_type, x.source_id, x.amount
FROM public.xp_events x
WHERE x.source_type IN ('phase','goal_short','goal_long')
  AND NOT EXISTS (SELECT 1 FROM public.path_phases p
                   WHERE p.id = x.source_id AND p.status = 'completed'
                     AND x.source_type = 'phase')
  AND NOT EXISTS (SELECT 1 FROM public.goals g
                   WHERE g.id = x.source_id AND g.status = 'completed'
                     AND x.source_type IN ('goal_short','goal_long'));

-- EXPECT: for every user, ledger_total = earned_now. The left side is what the header
-- displays; the right side is what their currently-completed work is worth, computed
-- from the source tables without consulting the ledger at all. They must agree.
SELECT u.username,
       (SELECT coalesce(sum(amount),0) FROM public.xp_events x WHERE x.user_id = u.id) AS ledger_total,
       (SELECT coalesce(sum(amount),0) FROM public.xp_events x
         WHERE x.user_id = u.id AND x.source_type IN ('proof','habit_physical'))
     + (SELECT count(*) * 100 FROM public.path_phases p
         WHERE p.user_id = u.id AND p.status = 'completed')
     + (SELECT coalesce(sum(CASE WHEN g.goal_type = 'long_term' THEN 500 ELSE 250 END), 0)
          FROM public.goals g WHERE g.user_id = u.id AND g.status = 'completed')       AS earned_now
FROM public.users u ORDER BY u.username;
-- NOTE: earned_now re-prices goals at their CURRENT type, while the ledger priced them
-- at completion time (20260813130000 §7). A goal retyped after completion is the one
-- legitimate way these two columns can differ.

-- EXPECT: unchanged from before the run. Nothing here can reach a proof grant.
SELECT source_type, count(*), sum(amount)
FROM public.xp_events WHERE source_type IN ('proof','habit_physical')
GROUP BY source_type ORDER BY source_type;
*/
