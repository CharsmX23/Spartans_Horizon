/*
# Editable username, and a real avatar in a private Storage bucket

Two profile fields that were specified and never built. The avatar in the header has been
`https://i.pravatar.cc/100?img=12` from `src/data.ts` since the app was scaffolded — the
last piece of demo data still rendering in the shell now that level comes from the XP
ledger.

## Objects created
- COLUMN  users.avatar_path
- GRANT   UPDATE (username, avatar_path) ON users TO authenticated
- BUCKET  avatars (private, 2 MB cap, image mime types only)
- POLICY  avatars_read / avatars_insert / avatars_update / avatars_delete ON storage.objects

## Username needs no new write path
`20260727120000` already granted `UPDATE (username) ON users TO authenticated`, and the
owner-scoped RLS policy on `users` already limits that to your own row. So renaming is an
ordinary client UPDATE through a grant that has existed since the table did — nothing here
widens it. Two constraints already do the validating, and the UI maps both to readable
errors rather than inventing its own rules:

  - CHECK (username ~ '^[a-z0-9_]{3,20}$')  -> 23514, the same rule as the signup form
  - UNIQUE INDEX users_username_key         -> 23505, the collision

### Renaming is a display-name change, and only that
Logins are `<username>@spartans.local` (see `lib/auth.tsx`). That address lives in
`auth.users.email`, which this UPDATE does not touch and which nothing in the client
touches either — so after a rename you still sign in under the name you registered with.

That is the deliberate design, not a gap to close. Keeping the two in step needs a second
write to `auth.users` plus a compensating revert when it fails, and Supabase's "Secure
email change" makes even the success path unreliable: it returns OK while parking the new
address in `new_email` pending a confirmation click that a `@spartans.local` address can
never receive. One write that always means what it says beats two that sometimes silently
half-apply.

The cost is that the login and the display name drift apart, so the Settings rename field
states it inline ("Your login stays the same — only your display name changes") rather
than leaving it to be found at the next sign-in.

## Why the bucket is PRIVATE
A public bucket is one line shorter and is what most avatar tutorials do. It also means
anyone who ever sees the URL keeps read access forever, to everyone's photo, signed in or
not. The brief was "squadmates can read it", and a public bucket cannot express
"squadmates" at all — so: private, with a SELECT policy that calls the same
`shares_squad_with()` helper the learning-path policies use, and signed URLs minted on
read.

That choice has one cost worth stating plainly: **a signed URL expires.** So the column
below stores the object *path*, not a URL — storing a URL would guarantee a broken image
a week later. `lib/auth.tsx` mints a fresh signed URL each time the profile loads.

The side benefit is cache-busting for free: every upload overwrites the same object path,
and a same-path image would otherwise sit in the browser cache showing the old photo.
Signed URLs carry a new token each time, so the URL changes even when the path does not.

## Path convention: `<user_id>/avatar`
One object per user, no extension, `upsert: true` on write. The uuid folder is what every
policy below keys on, so ownership is a string comparison against `auth.uid()` and not a
lookup. No extension because the content type travels in the object's metadata, and a
changing extension would leave the old file orphaned on every format change.

## If the storage policies fail to apply
`storage.objects` is owned by `supabase_storage_admin`, not `postgres`. Applying this
through `supabase db push` works because the migration runs as the owner-equivalent role.
If you ever see `42501: must be owner of table objects`, run section 3 alone from the
dashboard SQL editor — nothing else in this file needs re-running.
*/

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. users.avatar_path
-- ═══════════════════════════════════════════════════════════════════════════
/*
Nullable, and null is the normal state — most users will never upload one. The client
renders an initials monogram in that case rather than a stock photo of a stranger, so
there is no placeholder URL to store and no DEFAULT here.
*/
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_path text;

COMMENT ON COLUMN users.avatar_path IS
  'Object path in the private `avatars` bucket, always `<user_id>/avatar`. NOT a URL — '
  'signed URLs expire, so the client mints one per read. Null means no avatar uploaded.';

/*
Extends the existing column grant. `username` was already there; `avatar_path` joins it.
Everything else stays outside: `squad_id`, `current_streak`, and `last_checkin_date` remain
ungranted, so membership still goes through join_squad() and the streak still goes through
record_checkin(). Re-asserted as a full statement so this file states the end state rather
than leaving it four migrations back.
*/
REVOKE ALL ON users FROM anon, authenticated;
GRANT SELECT ON users TO authenticated;
GRANT INSERT ON users TO authenticated;
GRANT UPDATE (username, avatar_path) ON users TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. The bucket
-- ═══════════════════════════════════════════════════════════════════════════
/*
`public = false` is the whole security posture — see the header. The size and mime limits
are enforced by Storage itself, so the client-side validation in SettingsPanel is a
courtesy message and not the guard: a crafted upload of a 50 MB file, or of a .exe renamed
to .png, is rejected by the server regardless of what the browser did or did not check.

ON CONFLICT DO UPDATE rather than DO NOTHING so re-running this migration corrects a
bucket that was created by hand with different limits, instead of silently leaving it.
*/
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'avatars',
  'avatars',
  false,
  2097152,                                                    -- 2 MiB
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE
  SET public            = excluded.public,
      file_size_limit   = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Storage policies  (run this section alone from the SQL editor if it 42501s)
-- ═══════════════════════════════════════════════════════════════════════════
/*
`storage.foldername(name)` splits the object path into its folder segments, so for
`3f2b…/avatar` it returns `{3f2b…}` and `[1]` is the owner's uuid as text.

Writes compare that as TEXT against `auth.uid()::text` — no cast, so no cast can fail.

The read policy needs it as a uuid to pass to `shares_squad_with()`, and a cast CAN fail:
one hand-uploaded object at a non-uuid path would raise 22P02 and break SELECT for
everybody, not just for that row. The CASE is what prevents that. It is a CASE and not
`x ~ '...' AND shares_squad_with(...)` because Postgres does not guarantee the evaluation
order of AND, and may evaluate the cast first; CASE guarantees it.

`shares_squad_with()` already returns true for your own id (`p_user_id = auth.uid()`), so
this covers self-read without a second clause — including for a user who has not joined a
squad yet.
*/
DROP POLICY IF EXISTS "avatars_read"   ON storage.objects;
DROP POLICY IF EXISTS "avatars_insert" ON storage.objects;
DROP POLICY IF EXISTS "avatars_update" ON storage.objects;
DROP POLICY IF EXISTS "avatars_delete" ON storage.objects;

-- Squadmates (and you) may read.
CREATE POLICY "avatars_read" ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND CASE
          WHEN (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            THEN public.shares_squad_with(((storage.foldername(name))[1])::uuid)
          ELSE false
        END
  );

-- Only you may write into your own folder. This is also what guarantees every object in
-- the bucket has a uuid folder, which is what the read policy's CASE relies on.
CREATE POLICY "avatars_insert" ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Replacing an avatar is an UPDATE on the same path (upsert). USING picks which rows you
-- may touch; WITH CHECK stops you moving one into someone else's folder on the way out.
CREATE POLICY "avatars_update" ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "avatars_delete" ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

NOTIFY pgrst, 'reload schema';


/*
════════════════════════════════════════════════════════════════════════════════
VERIFY — run after applying. Nothing here writes.
════════════════════════════════════════════════════════════════════════════════

-- 1. The column and its grant.
--    EXPECT: username true, avatar_path true, squad_id false, current_streak false.
--    The last two are the check that matters: this migration re-issued the grant on
--    `users`, and getting that wrong would hand the client its own streak counter.
SELECT
  has_column_privilege('authenticated', 'public.users', 'username',          'UPDATE') AS username_writable,
  has_column_privilege('authenticated', 'public.users', 'avatar_path',       'UPDATE') AS avatar_writable,
  has_column_privilege('authenticated', 'public.users', 'squad_id',          'UPDATE') AS squad_writable,
  has_column_privilege('authenticated', 'public.users', 'current_streak',    'UPDATE') AS streak_writable,
  has_column_privilege('authenticated', 'public.users', 'last_checkin_date', 'UPDATE') AS checkin_writable;
-- EXPECT: true, true, false, false, false.

-- 2. The bucket is private and capped.
--    EXPECT: public = false, file_size_limit = 2097152, four image mime types.
SELECT id, public, file_size_limit, allowed_mime_types
FROM storage.buckets WHERE id = 'avatars';

-- 3. Four policies, and the read one is the only one that is not owner-only.
SELECT policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname LIKE 'avatars%'
ORDER BY policyname;

-- 4. The rename constraints the UI maps its error messages to still exist.
--    EXPECT: one CHECK matching the username regex, one UNIQUE index on username.
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint WHERE conrelid = 'public.users'::regclass AND contype = 'c';
SELECT indexname, indexdef FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'users' AND indexname = 'users_username_key';

-- 5. THE XP LEDGER IS UNTOUCHED. This migration re-issued grants on `users`, which is a
--    table the XP work reads through record_checkin(). Cheap to check, expensive to be
--    wrong about.
--    EXPECT: xp SELECT true, xp INSERT false, checkin authenticated false / service_role true.
SELECT
  has_table_privilege('authenticated', 'public.xp_events', 'SELECT') AS xp_select,
  has_table_privilege('authenticated', 'public.xp_events', 'INSERT') AS xp_insert,
  has_function_privilege('authenticated', 'public.record_checkin(uuid,text,date,boolean)', 'EXECUTE') AS checkin_authenticated,
  has_function_privilege('service_role',  'public.record_checkin(uuid,text,date,boolean)', 'EXECUTE') AS checkin_service_role;


-- 6. Rename forgery, from the SQL editor. Substitute two real user ids.
--    The grant is column-level, so this is about RLS: can you rename SOMEONE ELSE?
--    Run as the anon/authenticated role via the REST probes in verify_avatar_forgery.sh
--    rather than here — as `postgres` you bypass RLS and this proves nothing.
*/
