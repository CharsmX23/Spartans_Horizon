Event Horizon — Spartans_Horizon

A squad-based hackathon and learning journal. Track projects and deadlines, build learning paths with AI-generated syllabi, and keep a daily proof-of-work streak verified by AI photo evaluation — all with lightweight username/password auth, no heavy OAuth.

Built for a small squad (up to a handful of people) working through hackathons and self-directed learning together, with real accountability instead of a to-do list nobody checks.

Tech Stack
Frontend: React 18, Vite 5, TypeScript, Tailwind CSS 3
Backend: Supabase — Postgres, Auth, Storage, Edge Functions
AI verification: Google Gemini (photo-based proof evaluation, pinned model version so the judging model can't silently change underneath you)
Tech feed: Hacker News — official Firebase API for the general feed, Algolia Search API for curated hacking/security and tech-industry stories (both free, no API key required)
Setup
Clone and install
bash
   git clone https://github.com/CharsmX23/Spartans_Horizon.git
   cd Spartans_Horizon
   npm install
Environment variables
bash
   cp .env.example .env

Fill in the two values from your Supabase project (Settings → API):

   VITE_SUPABASE_URL=https://your-project-ref.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-public-key

Restart the dev server after editing .env — Vite only reads it at startup.

Apply database migrations Migrations currently live in supabase/migrations/ and are applied by pasting each file into the Supabase SQL Editor, in filename/chronological order, and running it. (Migration tracking via supabase db push is a planned improvement — see Known Open Items.) After applying, if a table or function 404s unexpectedly, reload the schema cache:
sql
   NOTIFY pgrst, 'reload schema';
⚠️ Turn off "Confirm email" — required, not optional Auth uses a synthetic-email pattern (username@spartans.local) so real usernames work without a mailbox. These addresses can never receive mail, so if email confirmation is left on, every signup will either silently fail to return a session or hit an email-rate-limit error — with no obvious error pointing at the real cause. Supabase dashboard → Authentication → Sign In / Providers → Email → turn off "Confirm email." (Leave the Email provider itself enabled — you're disabling confirmation, not sign-in.)
Set up the Gemini API key (required for AI photo verification) Get a key from aistudio.google.com, then store it as a Supabase Edge Function secret — never in .env, since anything VITE_-prefixed ends up in the browser bundle.
bash
   npx supabase secrets set GEMINI_API_KEY=your-key-here
   npx supabase functions deploy verify-proof
Run it
bash
   npm run dev
Features
Auth & Squads — username + password only. Accounts create or join a squad via a 6-character join code (readable alphabet — excludes 0/O/1/I/L to avoid misreads on a code that's read aloud).
Missions — private, user-owned hackathon/project entries with deadlines and live countdowns. Each mission expands into a phase timeline (pending → live → completed) you build by hand.
Power Up (Learning Paths) — user-built learning paths with modules and checkbox tasks. Task completion is verified by AI photo proof, not just self-reported.
Habits & Streaks — daily habits (seeded with starter defaults) tracked via AI-verified photo proof. A verified habit completion also advances the day's streak, once per day regardless of how many habits you complete.
AI Photo Verification — a shared verification engine powers streaks, habits, and learning-task proof. Photos are sent as base64 directly to a Supabase Edge Function, evaluated in memory by Gemini, and never written to storage or any database table — only the pass/fail verdict and evaluation text persist.
Tech Feed — two home-screen cards curated for hacking/security and major tech industry news (via Algolia keyword + points filtering, not a random grab-bag), plus a full feed page with Top/New/Show HN/Ask HN tabs.

(Journaling and Startup Ideas were removed — an intentional scope cut, not a missing feature.)

Architecture Notes
Nothing security-relevant is client-writable. Streak counts, task completion, squad membership, and habit verification all go through SECURITY DEFINER Postgres functions (create_squad, join_squad, set_task_done, record_checkin, record_habit_completion) rather than direct table writes. Column-level grants restrict exactly what an authenticated user can touch directly — verified via has_column_privilege checks after every schema change, not assumed.
No image storage, anywhere. All AI-verified photos are processed in memory and discarded. This is a deliberate privacy choice, not a missing feature.
Known Open Items

Kept honest on purpose — this app doesn't fake progress, and neither should this list:

streak_logs.verified may still be client-writable. This is the last known potentially-forgeable path in the app (everything else — current_streak, learning_tasks.is_done, habit_completions — is locked down). Confirm current status with a privilege check before treating streaks as fully tamper-proof:
sql
  SELECT has_column_privilege('authenticated','public.streak_logs','verified','UPDATE');
  -- should be false
Migration tracking (supabase db push) is not yet set up. Migrations have been applied by hand (SQL Editor / MCP) for the life of the project so far, which has already caused at least one migration to silently not land. Setting up tracked migrations is a priority before adding more schema changes.
Goals page — verify "Add" is functional before relying on it; this was an open bug as of the last check.
Contributing / Working On This
Treat every schema change as a real migration: write it, review the actual SQL, apply it deliberately, then verify with a privilege/grant check — not just "it ran without error."
Don't fake AI states. If a verification pipeline isn't wired up yet, show an honest "not yet connected" state rather than a fake success animation.
If you drop a table or column, back up first — some of this data (journal entries, in the past) is not recoverable once gone.

"Discipline compounds." — Event Horizonse after ~7 days without API requests. Keep the project warm
  with a scheduled ping if it needs to stay reachable.
- There is no password reset or email verification flow, by design — usernames have no
  real mailbox behind them.
