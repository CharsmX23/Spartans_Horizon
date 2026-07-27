/*
# Phase 1 — squads + users (username auth)

Creates the two tables everything else in Spartans_Horizon hangs off, and the
server-side entry points for squad membership.

## Auth model
Passwords are owned by Supabase Auth, not by us. The frontend turns a username into a
synthetic email (`<username>@spartans.local`) and calls the normal Supabase password
flow, so we inherit session handling, refresh tokens, and bcrypt hashing for free.

This is why `public.users` has NO `password_hash` column even though the build brief
lists one: storing a second copy of the password next to `auth.users.encrypted_password`
would be a duplicate secret with no reader. `public.users` is the *profile* half of the
identity — `auth.users` is the credential half, joined on id.

## Tables
- `squads` — id, name, join_code (the 6-char code members enter), created_by.
- `users`  — id (= auth.users.id), username, squad_id, current_streak,
             last_checkin_date. One row per account, created by trigger on signup.

## Privilege model
Clients may only change their own `username`. `squad_id`, `current_streak`, and
`last_checkin_date` are stripped from the `authenticated` role's UPDATE grant, and all
writes to `squads` are revoked outright. Membership and (later) streak math therefore
have to go through the SECURITY DEFINER functions below, which can enforce rules the
browser can't forge — this is the "do the streak math server-side" requirement from the
brief, enforced at the privilege layer rather than by convention.

## Functions
- `username_available(text)` — anon-callable pre-check for a friendly signup error.
- `create_squad(text)`       — creates a squad, joins the caller, returns the row.
- `join_squad(text)`         — joins the caller to a squad by join code.
- `handle_new_user()`        — trigger; materializes the profile row on signup.
- `current_squad_id()`       — RLS helper; avoids infinite recursion in the policy that
                               lets squadmates see each other.

## No extension dependency
Join codes are built with core `random()` over a fixed alphabet. This is deliberately
not cryptographic: a join code is a convenience lookup, not a secret. Security lives in
RLS and the SECURITY DEFINER RPCs — knowing a code lets you join a squad, which is the
entire point of having one. Uniqueness, not unguessability, is the requirement, and
that is enforced by the UNIQUE constraint plus the bounded retry loop below.

Everything else here uses `gen_random_uuid()`, core Postgres since 13, so this
migration needs no extensions at all.
*/

-- ── squads ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS squads (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL CHECK (char_length(trim(name)) BETWEEN 2 AND 40),
  join_code   text NOT NULL UNIQUE CHECK (join_code ~ '^[A-Z0-9]{6}$'),
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ── users (profile half of the identity) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id                uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username          text NOT NULL CHECK (username ~ '^[a-z0-9_]{3,20}$'),
  squad_id          uuid REFERENCES squads(id) ON DELETE SET NULL,
  current_streak    int NOT NULL DEFAULT 0 CHECK (current_streak >= 0),
  last_checkin_date date,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS users_username_key ON users(username);
CREATE INDEX IF NOT EXISTS users_squad_id_idx ON users(squad_id);

-- ── Profile row is created by trigger, not by the client ─────────────────
-- If the client created it, a crash between signUp() and insert() would leave an
-- account that can authenticate but has no profile and no username.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.users (id, username)
  VALUES (
    NEW.id,
    lower(coalesce(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1)))
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ── RLS helper ───────────────────────────────────────────────────────────
-- A policy on `users` that reads `users` would recurse. This function is owned by the
-- table owner, so its lookup is not itself subject to RLS.
CREATE OR REPLACE FUNCTION public.current_squad_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT squad_id FROM public.users WHERE id = auth.uid();
$$;

-- ── RLS: users ───────────────────────────────────────────────────────────
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_select" ON users;
DROP POLICY IF EXISTS "users_insert" ON users;
DROP POLICY IF EXISTS "users_update" ON users;

-- You can see yourself, and anyone in your squad (the squad roster).
CREATE POLICY "users_select" ON users FOR SELECT
  TO authenticated
  USING (
    id = auth.uid()
    OR (squad_id IS NOT NULL AND squad_id = public.current_squad_id())
  );

CREATE POLICY "users_insert" ON users FOR INSERT
  TO authenticated WITH CHECK (id = auth.uid());

-- Own row only, and squad_id must come out unchanged — joining a squad is
-- join_squad()'s job, not a client UPDATE with a guessed squad id.
CREATE POLICY "users_update" ON users FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (
    id = auth.uid()
    AND squad_id IS NOT DISTINCT FROM public.current_squad_id()
  );

-- No DELETE policy: accounts are removed via auth.users (cascades).

-- Column-level lockdown. RLS decides which rows; this decides which columns.
REVOKE ALL ON users FROM anon, authenticated;
GRANT SELECT ON users TO authenticated;
GRANT INSERT ON users TO authenticated;
GRANT UPDATE (username) ON users TO authenticated;

-- ── RLS: squads ──────────────────────────────────────────────────────────
ALTER TABLE squads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "squads_select" ON squads;

-- Members can read their own squad (including its join code, to invite others).
CREATE POLICY "squads_select" ON squads FOR SELECT
  TO authenticated USING (id = public.current_squad_id());

-- Read-only to clients; creation and joining go through the RPCs below.
REVOKE ALL ON squads FROM anon, authenticated;
GRANT SELECT ON squads TO authenticated;

-- ── username_available ───────────────────────────────────────────────────
-- Callable by anon so the signup form can fail fast with a clear message. The unique
-- index remains the real guard against the check/insert race.
CREATE OR REPLACE FUNCTION public.username_available(p_username text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NOT EXISTS (SELECT 1 FROM public.users WHERE username = lower(trim(p_username)));
$$;

GRANT EXECUTE ON FUNCTION public.username_available(text) TO anon, authenticated;

-- ── create_squad ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_squad(p_name text)
RETURNS squads
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- No 0/O, 1/I/L — join codes get read aloud and typed by hand.
  v_alphabet CONSTANT text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';  -- 31 chars
  v_max_tries CONSTANT int := 10;
  v_uid   uuid := auth.uid();
  v_code  text;
  v_squad squads;
  v_tries int := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF public.current_squad_id() IS NOT NULL THEN
    RAISE EXCEPTION 'You are already in a squad';
  END IF;

  -- 31^6 ≈ 887M codes, so a collision is remote; when one happens the UNIQUE
  -- constraint raises and we simply draw again. Bounded at v_max_tries so a
  -- pathological case fails loudly instead of spinning forever.
  LOOP
    v_tries := v_tries + 1;

    SELECT string_agg(substr(v_alphabet, floor(random() * length(v_alphabet))::int + 1, 1), '')
      INTO v_code
      FROM generate_series(1, 6);

    BEGIN
      INSERT INTO squads (name, join_code, created_by)
      VALUES (trim(p_name), v_code, v_uid)
      RETURNING * INTO v_squad;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      IF v_tries >= v_max_tries THEN
        RAISE EXCEPTION 'Could not allocate a join code, try again';
      END IF;
    END;
  END LOOP;

  UPDATE users SET squad_id = v_squad.id WHERE id = v_uid;
  RETURN v_squad;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_squad(text) TO authenticated;

-- ── join_squad ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.join_squad(p_join_code text)
RETURNS squads
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_squad squads;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF public.current_squad_id() IS NOT NULL THEN
    RAISE EXCEPTION 'You are already in a squad';
  END IF;

  SELECT * INTO v_squad FROM squads WHERE join_code = upper(trim(p_join_code));

  IF v_squad.id IS NULL THEN
    RAISE EXCEPTION 'No squad found with that code';
  END IF;

  UPDATE users SET squad_id = v_squad.id WHERE id = v_uid;
  RETURN v_squad;
END;
$$;

GRANT EXECUTE ON FUNCTION public.join_squad(text) TO authenticated;
