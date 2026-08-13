/*
  # Drop journal_entries

  `journal_entries` was created by 20260719114729 and re-policied by 20260720170623,
  but the table was later removed from the hosted database by hand, and JournalPage
  was removed from the frontend. Nothing in src/ references it.

  That left the repo and the live database disagreeing: replaying migrations into a
  fresh project produced a table production did not have. This migration closes the
  gap from the repo side, so a fresh replay lands exactly where production already is.

  Idempotent: DROP ... IF EXISTS is a no-op against the hosted project (the table is
  already gone) and drops the table, its RLS policies, and its indexes in a fresh one.
*/

DROP TABLE IF EXISTS public.journal_entries CASCADE;
