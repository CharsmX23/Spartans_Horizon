/*
# set_phase_verified() — a phase reaches `completed` only through a passing photo

## The problem this solves
`path_phases.status` is one column with three values, and the client legitimately writes
two of them: moving a phase to `live` or back to `pending` is ordinary editing. Only
`completed` is a claim about reality that has to be earned.

Column grants cannot express that. `GRANT UPDATE (status)` is all-or-nothing — it says
*which column*, never *which value*. Revoking `status` outright would take `live` and
`pending` with it and turn every status change into an RPC. So the grant stays exactly as
`20260805120000_create_path_phases.sql` left it, and a BEFORE trigger narrows it per
value: writes of `live`/`pending` pass straight through, and a transition into
`completed` is rejected unless it arrives carrying a ticket that only
`set_phase_verified()` can issue.

## Objects created
- FUNCTION path_phases_block_forged_completion()  — the trigger function
- TRIGGER  path_phases_no_forged_completion       — BEFORE INSERT OR UPDATE, per row
- FUNCTION set_phase_verified(p_phase_id uuid)    — SECURITY DEFINER; the only issuer

## The ticket
`set_phase_verified()` stamps the phase's id into the transaction-local GUC
`app.verified_phase_id`, updates the row, then clears it. The trigger allows a
transition into `completed` only when that GUC equals the id of the row being written.

Three properties make the ticket worth anything, and losing any one of them silently
reopens the hole:

1. **It is transaction-local** (`set_config(..., is_local := true)`). PostgREST runs on a
   pooled connection shared across users; a session-scoped GUC would outlive the request
   and hand the next caller on that connection a free completion. `true` is load-bearing.
2. **It carries an id, not a boolean.** A boolean ticket would authorise every row
   touched while it was set — including a bulk `PATCH ...?id=in.(...)`. Scoping to one id
   costs nothing and makes that unrepresentable.
3. **The client cannot set it.** PostgREST exposes RPCs in the `public` schema and no raw
   SQL; `set_config` lives in `pg_catalog` and is not reachable over HTTP. If a function
   that forwards arbitrary `set_config` calls is ever added to `public`, this guard dies
   with it.

## Why a trigger and not "just trust SECURITY DEFINER"
Triggers fire for every writer — RLS-bound clients, SECURITY DEFINER functions,
`service_role`, and `postgres` in the SQL editor alike. That is the point: the guard does
not care who you are, only whether the write is accompanied by a verification. It also
means **hand-editing a phase to `completed` in the SQL editor is rejected too**. To do it
deliberately, issue yourself a ticket in the same transaction:

    BEGIN;
      SELECT set_config('app.verified_phase_id', '<phase-uuid>', true);
      UPDATE path_phases SET status = 'completed' WHERE id = '<phase-uuid>';
    COMMIT;

## INSERT is guarded as well as UPDATE
An UPDATE-only trigger leaves `INSERT ... status = 'completed'` wide open — the client
holds INSERT on `path_phases`, so a forged phase could simply be *born* completed. That
is the same forbidden transition spelled differently, so the trigger covers both and a
new phase always starts `pending` or `live`. If you ever want inserts unguarded, change
the trigger to `BEFORE UPDATE` and delete the `TG_OP = 'INSERT'` branch below; nothing
else changes.

## Why this is `service_role`-only, and not `authenticated`
An earlier draft took `(p_phase_id uuid)` and read the caller from `auth.uid()`, with
EXECUTE granted to `authenticated` — the Edge Function forwarding the caller's JWT, the
same shape as the old `set_task_done()`. That was tested and rejected: it closed the
*PATCH* forge path but left the *RPC* one wide open. A signed-in user could open the
console and call

    await supabase.rpc('set_phase_verified', { p_phase_id: <their own phase> })

and complete a phase with no photo — verified live, it returned 200 and `completed`. The
trigger cannot help here, because this function is precisely the thing authorised to
issue a ticket. Since phase progress is squad-readable, a faked `%` is not self-deception
but a lie told to squadmates, which is the thing the whole verification flow exists to
prevent.

So it follows `record_checkin()` / `record_habit_completion()` instead: the caller id is
a *parameter*, not `auth.uid()`, and only `service_role` may execute. The browser has no
service-role key, so the only caller that can reach this is verify-proof, which supplies
`p_user_id` from the JWT it has already verified — never from the request body, or a
crafted payload would complete a phase as somebody else.

The ownership check below is therefore still load-bearing: `service_role` bypasses RLS,
so without it verify-proof could be talked into completing any phase in the database.
*/

-- ── The trigger function ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.path_phases_block_forged_completion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_ticket text;
BEGIN
  -- Not a write of `completed` at all — `live`, `pending`, and every non-status edit
  -- pass through untouched. This is the common case and the reason the grant can stay
  -- as wide as it is.
  IF NEW.status IS DISTINCT FROM 'completed' THEN
    RETURN NEW;
  END IF;

  -- Already completed, and staying completed: this UPDATE is editing something else on
  -- an earned row (a title fix, a reorder). Guarding it would make a verified phase
  -- permanently uneditable. Only the *transition into* completed is the claim.
  -- OLD is NULL on INSERT, so TG_OP is checked before OLD is read.
  IF TG_OP = 'UPDATE' AND OLD.status = 'completed' THEN
    RETURN NEW;
  END IF;

  -- The ticket. `current_setting(name, missing_ok := true)` returns NULL when the GUC
  -- was never set in this session — the one-argument form would raise instead.
  v_ticket := current_setting('app.verified_phase_id', true);

  -- IS DISTINCT FROM, never <>. `NULL <> '<uuid>'` evaluates to NULL, `IF NULL THEN`
  -- does not run its body, and the guard would fall through to RETURN NEW — allowing
  -- exactly the write it exists to reject, on every request that never set the GUC,
  -- which is all of them. IS DISTINCT FROM treats NULL as a value and rejects.
  IF v_ticket IS DISTINCT FROM NEW.id::text THEN
    RAISE EXCEPTION
      'A phase is completed by photo verification, not by writing status directly'
      USING ERRCODE = 'insufficient_privilege',
            HINT = 'Submit a photo through verify-proof; it calls set_phase_verified().';
  END IF;

  RETURN NEW;
END;
$$;

-- BEFORE, so a rejected write never reaches the row. FOR EACH ROW, so NEW.id exists and
-- a multi-row PATCH is judged one row at a time rather than in bulk.
DROP TRIGGER IF EXISTS path_phases_no_forged_completion ON public.path_phases;
CREATE TRIGGER path_phases_no_forged_completion
  BEFORE INSERT OR UPDATE ON public.path_phases
  FOR EACH ROW
  EXECUTE FUNCTION public.path_phases_block_forged_completion();

-- ── set_phase_verified — the only issuer of a ticket ────────────────────────
/*
Called by the verify-proof Edge Function, with the admin client, after Gemini returns
`progress` on a photo submitted against a phase. SECURITY DEFINER so it can issue the
ticket regardless of the caller's grants — which also means it bypasses RLS, so ownership
is checked here by hand.

`p_user_id` is the caller, resolved by verify-proof from the verified JWT. It is a
parameter and not `auth.uid()` because `service_role` has no `auth.uid()` — see the
header for why that trade is the point rather than a compromise.

Idempotent: completing an already-completed phase is a no-op that returns the row.
*/
DROP FUNCTION IF EXISTS public.set_phase_verified(uuid);

CREATE OR REPLACE FUNCTION public.set_phase_verified(p_user_id uuid, p_phase_id uuid)
RETURNS path_phases
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_phase path_phases;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- SECURITY DEFINER bypasses RLS, so the row is fetched unfiltered and checked here.
  SELECT * INTO v_phase FROM path_phases WHERE id = p_phase_id;

  IF v_phase.id IS NULL THEN
    RAISE EXCEPTION 'Phase not found';
  END IF;

  IF v_phase.user_id <> p_user_id THEN
    RAISE EXCEPTION 'That phase belongs to someone else';
  END IF;

  -- Issue the ticket for this row only, for this transaction only.
  PERFORM set_config('app.verified_phase_id', p_phase_id::text, true);

  UPDATE path_phases
     SET status = 'completed'
   WHERE id = p_phase_id
  RETURNING * INTO v_phase;

  -- Spend it. `is_local := true` already means it dies at COMMIT, but clearing it here
  -- makes the ticket single-use even inside one transaction, so a second UPDATE cannot
  -- ride along behind the first.
  PERFORM set_config('app.verified_phase_id', '', true);

  RETURN v_phase;
END;
$$;

-- REVOKE first, and from PUBLIC specifically. Postgres grants EXECUTE to PUBLIC on every
-- newly created function, so granting to one role is never the whole story — the PUBLIC
-- entry survives it, and `anon` (every unauthenticated visitor holding the publishable
-- key) keeps EXECUTE. Naming `anon` and `authenticated` as well is belt-and-braces: they
-- inherit through PUBLIC rather than holding their own entry, so the PUBLIC revoke is what
-- actually does the work, but spelling them out means a future `GRANT ... TO authenticated`
-- added by hand has to delete a line that says why it shouldn't exist.
REVOKE ALL ON FUNCTION public.set_phase_verified(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_phase_verified(uuid, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
