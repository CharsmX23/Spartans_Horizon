# Spartans_Horizon

[![Open in Bolt](https://bolt.new/static/open-in-bolt.svg)](https://bolt.new/~/sb1-xfp2caqp)

A squad-based hackathon & learning-journal app: personal journals, shared project
deadlines, a calendar, daily streaks, and AI-generated learning paths.

React + Vite + Tailwind on the frontend, Supabase (Postgres, Auth, Storage, Edge
Functions) on the backend.

## Setup

### 1. Install

```bash
npm install
```

### 2. Environment

```bash
cp .env.example .env
```

Fill in both values from **Supabase Dashboard → Project Settings → API**:

| Variable | Where to find it |
| --- | --- |
| `VITE_SUPABASE_URL` | Project URL |
| `VITE_SUPABASE_ANON_KEY` | `anon` / `public` key |

The `VITE_` prefix is required — Vite only exposes prefixed variables to client code.
Restart the dev server after editing `.env`; Vite reads it at startup, not per request.

Only put publishable values here. Everything in the client bundle is public, so model
and API keys belong in Edge Function secrets (`supabase secrets set ...`) instead.

### 3. Run the migrations

Apply the files in `supabase/migrations/` **in filename order** — the timestamps sort
chronologically, and the order matters:

1. `20260719114729_create_spartan_core_tables.sql` — journal, skills, goals, streak logs
2. `20260720000000_create_profile_settings.sql` — creates the table step 3 alters
3. `20260720170623_..._fix_rls_security_issues.sql.sql` — owner-scoped RLS
4. `20260727120000_create_squads_and_users.sql` — squads, users, signup trigger, RPCs

Step 3 fails if step 2 hasn't run.

**Dashboard (simplest for a fresh project):** SQL Editor → New query → paste one file →
Run → repeat in order.

**CLI (alternative):**

```bash
npx supabase init          # only if supabase/config.toml doesn't exist yet
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```

### 4. Turn OFF email confirmation ⚠️

**Dashboard → Authentication → Sign In / Providers → Email → disable "Confirm email".**

This one is not optional and cannot be done in a migration.

Auth is username + password only. A username is mapped onto a synthetic address
(`<username>@spartans.local`) so Supabase Auth still handles sessions and password
hashing — but that address can never receive mail. With "Confirm email" on, every
signup returns **no session**, the user appears to sign up successfully and then lands
back on the login screen, and the account can never be verified. There is no error
message pointing at this.

While you're in Auth settings, keep the minimum password length at **6** to match the
signup form's `minLength`.

### 5. Deploy the photo-verification Edge Function

Photo proofs (streak check-ins and learning-task proofs) are judged by Gemini inside the
`verify-proof` Edge Function. The image is sent as base64, held in memory, and discarded
— it is never written to Storage or to a table, so there is no cleanup that can fail.

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase functions deploy verify-proof
```

Or skip linking and target the project directly:

```bash
npx supabase functions deploy verify-proof --project-ref <your-project-ref>
```

The function reads `GEMINI_API_KEY` from Edge Function secrets:

```bash
npx supabase secrets set GEMINI_API_KEY=... --project-ref <your-project-ref>
npx supabase secrets list --project-ref <your-project-ref>   # confirm the name
```

**Leave JWT verification ON** (the default — nothing to change in the dashboard). The
function forwards the caller's token to `set_task_done()` so `auth.uid()` resolves and
the task's ownership check still applies. Turning it off would let anyone invoke the
function with the public anon key and burn your Gemini quota.

Logs: `npx supabase functions logs verify-proof`. They deliberately record status codes
and error messages only — never the image payload.

### 6. Start

```bash
npm run dev
```

Sign up → create a squad (or join one with a 6-character code) → you're in. The squad's
join code is shown in Settings.

## Commands

```bash
npm run dev        # dev server
npm run build      # production build
npm run preview    # serve the build
npm run lint       # eslint
npm run typecheck  # tsc --noEmit
```

## Notes

- Free Supabase projects pause after ~7 days without API requests. Keep the project warm
  with a scheduled ping if it needs to stay reachable.
- There is no password reset or email verification flow, by design — usernames have no
  real mailbox behind them.
