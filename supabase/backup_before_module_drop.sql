/*
# Backup before dropping learning_modules / learning_tasks

Run these in the Supabase SQL editor and export each result to CSV *before* any drop
migration is applied. Nothing here writes — every statement is a SELECT.

Two things worth knowing:

- The SQL editor runs as `postgres`, which bypasses RLS. These return every user's rows,
  not just yours. That is what you want for a backup; it also means the export is squad
  data, so treat the CSVs accordingly.
- Query 4 is the one that actually matters. 1–3 are faithful table dumps, but the drop
  is a *reshape*, not just a deletion: modules and tasks are collapsing into phases. 4
  hands you each path's modules already ordered and flattened, which is the shape you
  would retype them into `path_phases` from.
*/

-- ── 1. learning_tasks — full dump ────────────────────────────────────────────
-- Dropped by the migration. Every column, ordered so tasks stay grouped under their
-- module in the CSV.
SELECT *
FROM learning_tasks
ORDER BY user_id, module_id, sort_order, created_at;


-- ── 2. learning_modules — full dump ──────────────────────────────────────────
-- Dropped by the migration.
SELECT *
FROM learning_modules
ORDER BY user_id, path_id, sort_order, created_at;


-- ── 3. learning_paths — full dump ────────────────────────────────────────────
-- NOT dropped. Backed up anyway: it is the parent of everything above, and the CSVs in
-- 1 and 2 are unreadable without the path titles to join them back to.
SELECT *
FROM learning_paths
ORDER BY user_id, created_at;


-- ── 3b. path_phases — full dump ──────────────────────────────────────────────
-- NOT dropped, and the table the redesign builds on. Back it up before touching the
-- schema around it.
SELECT *
FROM path_phases
ORDER BY user_id, path_id, order_index;


-- ── 4. Flattened export — what you would rebuild phases from ─────────────────
-- One row per task, carrying its module and path context, in display order. If any of
-- this content is real, this is the CSV to keep: each module becomes a candidate phase
-- title, `why_it_matters` becomes its description, and the task labels are the notes
-- you would fold into that description.
SELECT
  p.title                       AS path_title,
  m.sort_order                  AS module_order,
  m.title                       AS module_title,
  m.why_it_matters,
  m.ai_leverage,
  m.estimated_days,
  t.sort_order                  AS task_order,
  t.label                       AS task_label,
  t.proof_type,
  t.is_done,
  t.done_at,
  p.id                          AS path_id,
  m.id                          AS module_id,
  t.id                          AS task_id,
  p.user_id
FROM learning_paths p
LEFT JOIN learning_modules m ON m.path_id = p.id AND m.user_id = p.user_id
LEFT JOIN learning_tasks   t ON t.module_id = m.id AND t.user_id = m.user_id
ORDER BY p.user_id, p.created_at, m.sort_order, t.sort_order;


-- ── 5. Sanity check — is there anything real in here at all? ─────────────────
-- Run this first. If the counts are tiny and the titles are keyboard mash, the backup
-- is a formality. Row counts are per-table totals across all users.
SELECT
  (SELECT count(*) FROM learning_paths)   AS paths,
  (SELECT count(*) FROM learning_modules) AS modules,
  (SELECT count(*) FROM learning_tasks)   AS tasks,
  (SELECT count(*) FROM learning_tasks WHERE is_done) AS tasks_done,
  (SELECT count(*) FROM path_phases)      AS phases;

-- The titles themselves, so you can eyeball whether any of it is worth keeping.
SELECT 'path' AS kind, title, created_at FROM learning_paths
UNION ALL
SELECT 'module', title, created_at FROM learning_modules
UNION ALL
SELECT 'task', label, created_at FROM learning_tasks
ORDER BY created_at;
