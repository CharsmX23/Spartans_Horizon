/*
# goals — grant the privileges that were never issued

`goals` is the one live table that got RLS policies but no GRANTs. The 20260720170623
migration added owner-scoped policies for it, and every later migration granted its own
tables explicitly — `goals` was skipped. This project does not hand out blanket default
privileges (anon already gets 42501 on it), so `authenticated` ended up with nothing:

    has_table_privilege('authenticated','public.goals', ...)
      SELECT  false
      INSERT  false
      UPDATE  false
      DELETE  false

Policies alone are not access. RLS narrows what a role can reach; a GRANT is what gives
it any reach at all. With none, every GoalsPage query failed at the table-privilege
layer before RLS was ever consulted — and because the client discarded the error, it
looked like an empty table rather than a permission failure.

## Grants issued
- SELECT, INSERT, DELETE — same shape as missions/learning_paths.
- UPDATE limited to the user-editable columns. `user_id` stays ungranted so a goal can
  never be reassigned to another user; `id` and `created_at` stay ungranted as identity
  and provenance.

No policy changes: the owner-scoped policies from 20260720170623 are already correct and
now actually get exercised.
*/

REVOKE ALL ON goals FROM anon, authenticated;

GRANT SELECT, INSERT, DELETE ON goals TO authenticated;
GRANT UPDATE (title, goal_type, deadline, status, description) ON goals TO authenticated;

NOTIFY pgrst, 'reload schema';
