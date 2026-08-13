/*
# reset_xp.sql — wipe the XP ledger and start everyone from 0

ONE-OFF. Deliberately NOT in migrations/: it destroys data, and a migration is meant to
replay cleanly into a fresh project. build_apply_all.sh only globs migrations/, so this
file can never be swept into apply_all.sql and re-run by accident.

Run it in the Supabase SQL Editor. Nothing in the frontend can do this — `authenticated`
holds SELECT on xp_events and nothing else (20260813130000), which is the whole reason the
displayed total is trustworthy. That property is why the wipe has to happen here.

## What it does and does not do

There is no level to reset. Level is computed from sum(amount) on every read, so emptying
this table *is* the reset: every user reads 0 XP, Level 1, 0/50 on the bar, immediately,
with no other change anywhere.

It does not touch goals, path_phases, habits, streak_logs, habit_completions, or
users.current_streak. Completed work stays completed; only its payout is erased.

## ⚠ Read this before running: the wipe re-opens the faucet for past completions

`UNIQUE (source_id)` is what makes a grant idempotent — it remembers that a given goal or
phase already paid. Deleting those rows deletes that memory. A goal completed last week
still reads `status = 'completed'` and now has no ledger row, so toggling it back to
active and to completed again fires the AFTER trigger and pays its 250/500 a second time.
Same for phases and their 100.

That is a re-grind of work already done, not a forged number, and no client-side change
can prevent it — but it means "everyone starts from 0" holds only until someone re-toggles
old rows. If you want a true hard reset with no re-farmable history, run section 3 as well.
*/

-- ═══════════════════════════════════════════════════════════════════════════
-- 0. Look before you delete
-- ═══════════════════════════════════════════════════════════════════════════
SELECT u.username,
       count(x.id)                AS events,
       coalesce(sum(x.amount), 0) AS total_xp
FROM public.users u
LEFT JOIN public.xp_events x ON x.user_id = u.id
GROUP BY u.username
ORDER BY total_xp DESC;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Wipe everyone  ← the usual case
-- ═══════════════════════════════════════════════════════════════════════════
-- TRUNCATE rather than DELETE: nothing references xp_events (source_id carries no FK, by
-- design), so there is nothing to cascade and no reason to pay for row-by-row deletion.
TRUNCATE TABLE public.xp_events;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. …or wipe one account only. Use INSTEAD of section 1, not as well as.
-- ═══════════════════════════════════════════════════════════════════════════
-- DELETE FROM public.xp_events
--  WHERE user_id = (SELECT id FROM public.users WHERE username = '<username>');

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. OPTIONAL — close the re-toggle faucet described in the header
-- ═══════════════════════════════════════════════════════════════════════════
/*
Only if you want past completions to be unable to pay again. This reopens finished work as
unfinished — it is a product decision, so it is commented out rather than assumed.

  UPDATE public.goals       SET status = 'active'  WHERE status = 'completed';
  UPDATE public.path_phases SET status = 'pending' WHERE status = 'completed';

The alternative, which keeps the history intact, is to leave them completed and accept
that re-toggling pays again. Habits and streaks need nothing either way: their grants are
keyed to a per-day row that cannot be recreated for a day in the past.
*/

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFY — expect 0 rows, and every user at total_xp 0 / level 1
-- ═══════════════════════════════════════════════════════════════════════════
SELECT count(*) AS remaining_events FROM public.xp_events;

-- The curve the client now uses: level is the largest n where 25·n·(n-1) <= total,
-- i.e. floor((1 + sqrt(1 + total*4/25)) / 2). Level 1 at 0, L2 at 50, L3 at 150, L4 at 300.
SELECT u.username,
       coalesce(sum(x.amount), 0) AS total_xp,
       floor((1 + sqrt(1 + coalesce(sum(x.amount), 0) * 4 / 25.0)) / 2) AS level
FROM public.users u
LEFT JOIN public.xp_events x ON x.user_id = u.id
GROUP BY u.username
ORDER BY total_xp DESC;
-- EXPECT: every row total_xp 0, level 1.
