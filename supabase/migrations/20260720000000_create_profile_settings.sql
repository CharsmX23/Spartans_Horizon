/*
# Create profile_settings (repair migration)

`20260720170623_..._fix_rls_security_issues.sql` runs `ALTER TABLE profile_settings`,
but no migration in this repo ever created that table — it exists only in the original
hosted project, so replaying the migrations into a fresh Supabase project fails.

This migration recreates the table in its pre-fix shape (singleton row, id = 1) so the
later ALTERs apply cleanly. It is dated before the fix migration deliberately.

The table is not referenced anywhere in the frontend. It is recreated only to keep the
migration chain replayable; drop both it and its ALTERs if it is confirmed dead.
*/

CREATE TABLE IF NOT EXISTS profile_settings (
  id          int PRIMARY KEY DEFAULT 1,
  display_name text,
  accent      text NOT NULL DEFAULT 'ember',
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT profile_settings_id_check CHECK (id = 1)
);

ALTER TABLE profile_settings ENABLE ROW LEVEL SECURITY;
