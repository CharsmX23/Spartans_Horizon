# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install
npm run dev        # Vite dev server
npm run build      # production build
npm run preview    # serve the build
npm run lint       # eslint (flat config, eslint.config.js)
npm run typecheck  # tsc --noEmit -p tsconfig.app.json
```

There is no test framework in this project — no test runner, no test files.

Copy `.env.example` to `.env` first — `src/lib/supabase.ts` throws at module load if `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` are missing, so the app will not boot without them.

SQL in `supabase/migrations/` is applied via the Supabase dashboard/CLI against a hosted project — there is no local Supabase config or `supabase start` setup here.

Migrations are meant to replay cleanly into a fresh project. `20260720000000_create_profile_settings.sql` exists only because the RLS-fix migration alters a table the repo never created; `profile_settings` is otherwise dead and unreferenced by the frontend.

Two Supabase dashboard settings are load-bearing and not expressible in migrations:
- **Auth → disable "Confirm email".** Logins use synthetic `@spartans.local` addresses that can never receive mail, so with confirmation on, `signUp` returns no session and the account is permanently unverifiable.
- Password minimum stays at 6 to match the `minLength` on the signup form.

**Renaming is a display-name change only.** `updateUsername()` writes `public.users.username` and nothing else; `auth.users.email` keeps the `<username>@spartans.local` address fixed at signup, so you always sign in under the name you registered with. The two identities drift apart by design — the Settings rename field says so inline. Do not "fix" this by adding an `auth.updateUser({ email })` call: that path was built and removed, because "Secure email change" returns success while parking the address in `new_email` awaiting a confirmation click that can never arrive.

## Architecture

Vite + React 18 + TypeScript SPA ("Event Horizon / Spartan" personal dashboard), originally scaffolded in Bolt.new. Supabase provides both auth and the entire backend; there is no server code of our own.

**Routing is state, not URLs.** There is no router. `App.tsx` holds a single `tab: TabKey` state and picks a page through a ternary chain. `TabKey` is declared in `components/Sidebar.tsx` and is the source of truth for the nav — adding a tab means extending that union, adding it to `NAV` there (and optionally `MobileTabBar`), then adding a branch in `App.tsx`. Tabs in the union without a branch (`startup`, `squad`, `settings`) fall through to the inline `PlaceholderPage`. Nothing is deep-linkable and tab state resets on reload.

**Two data worlds coexist, and this is the main thing to understand about the codebase.**

- `src/data.ts` is hardcoded demo data: `PEOPLE`, `CURRENT_USER_ID = 'u1'`, `DEADLINES`, `STARTUP_IDEAS`, `HABITS`, `TECH_TODAY`, plus the calendar builders. `getCurrentUser()` returns a fake `Person`. `App` now overlays the real profile onto that shape — username, handle, and streak are live; **level and avatar are still demo values**, and the `Sidebar` squad roster still renders `PEOPLE` rather than actual squadmates. Anything reading a `Person` is therefore part-real, part-fixture.
- Four pages are genuinely live against Supabase, each self-contained with its own `useState` + `load()` + inline CRUD, no cache, no query library: `JournalPage` (`journal_entries`), `PowerUpPage` (`learning_paths`/`learning_modules`/`learning_tasks`), `GoalsPage` (`goals`), `StreaksPage` (`streak_logs`). `MissionHero` is the hybrid — it queries active `goals` and falls back to the static `DEADLINES` when the query returns nothing.

`PowerUpPage` is the exception to "inline CRUD": it goes through [`src/lib/learning.ts`](src/lib/learning.ts), which owns the types and every read/write for the three-table hierarchy. Add learning-path queries there, not in the component.

**The `skills` table is superseded and dead.** `PowerUpPage` used to read it; learning paths replaced it in Phase 2. The table and its RLS still exist so no data is destroyed, but nothing references it.

Elsewhere, follow the per-page pattern already in `GoalsPage` rather than introducing a store or fetch abstraction, unless deliberately refactoring.

**"AI" features are simulated.** `PowerUpPage.getAIReview` and `StreaksPage.handleVerify` pick from hardcoded string arrays (`AI_FEEDBACK`, `AI_MESSAGES`) after a `setTimeout` delay. No model is called. The generated text *is* persisted (`skills.ai_feedback`, `streak_logs.note`), so the DB looks like it holds real model output.

**Auth is username-only, faked onto email.** `lib/auth.tsx` maps `<username>` → `<username>@spartans.local` and calls the ordinary Supabase password flow, so sessions/refresh/hashing come for free while the UI never mentions email. Consequences worth knowing before touching it: usernames are normalized to lowercase and constrained to `^[a-z0-9_]{3,20}$` in *both* `USERNAME_RE` and a Postgres CHECK — change one and you must change the other; and there is no password reset or email verification path, by design.

Identity is split across two tables. `auth.users` holds credentials; `public.users` holds the profile (username, squad, streak) and is created by the `on_auth_user_created` trigger reading `raw_user_meta_data.username` — *not* by the client, so a crash mid-signup can't leave an account without a profile. `public.users` deliberately has no `password_hash` despite the build brief listing one; Supabase Auth owns the password, and a second copy would be a duplicate secret with no reader.

**`App` renders three gates in order:** no session → `AuthPage`; profile loaded but `squad_id` null → `SquadGate`; otherwise the app. Everything downstream is squad-scoped, so new squad-wide features can assume `profile.squad_id` is non-null.

**RLS plus column grants is the security model.** The 20260720 migration converted the original four tables from open `USING (true)` anon policies to owner-scoped `auth.uid() = user_id`, with `user_id uuid NOT NULL DEFAULT auth.uid()`. Client inserts therefore never pass `user_id` — the column default supplies it and the `WITH CHECK` passes. Adding an explicit `user_id` to an insert, or a new table without the same default + policy set, breaks writes silently (rows just don't appear).

`users` and `squads` add a second layer: RLS decides *which rows*, and column-level `GRANT` decides *which columns*. `authenticated` holds `UPDATE (username)` on `users` and nothing else — `squad_id`, `current_streak`, and `last_checkin_date` are ungranted, and all writes to `squads` are revoked. Membership therefore has to go through the SECURITY DEFINER RPCs `create_squad()` / `join_squad()`, and streak math will have to go through a similar server-side path. **If a write mysteriously fails with a permission error, check the grants, not just the policies.** Anything that needs to touch those columns belongs in a function, not a client `.update()`.

Policies on `users` must not read `users` directly or they recurse — use the `current_squad_id()` helper, which is SECURITY DEFINER and so escapes RLS. `shares_squad_with(user_id)` is the same trick for the squad-read policies on `learning_*`.

**Learning paths are a `paths -> modules -> tasks` hierarchy** that mirrors the Phase 4 generator's output exactly, so the AI can insert without reshaping. Two structural details:

- `user_id` is denormalized onto all three tables so RLS stays single-predicate instead of joining up to the owner. Divergence is prevented structurally, not by convention: children carry composite foreign keys to `(id, user_id)` of their parent, so a module whose owner differs from its path's owner cannot be represented.
- **`is_done` is not client-writable.** Ticking a checkbox calls `set_task_done()`, not an UPDATE. Phase 4 adds proof verification inside that function; no grants or client call sites move. Reads are squad-wide (progress visibility), writes are owner-only. Journals stay fully private.

## Styling

Tailwind, plus a small hand-rolled layer in `src/index.css`: `.glass` / `.glass-hover` (the card look used everywhere), `.tracked` / `.tracked-sm`, and the ring/twinkle keyframes. The accent color is a CSS variable trio (`--accent`, `--accent-soft`, `--accent-glow`) set imperatively by `theme.ts:applyAccent`, which `App` calls on accent change — accent-colored elements use inline `style={{ color: 'var(--accent)' }}`, not Tailwind classes. Only `ink` and the two spin animations are extended in `tailwind.config.js`.

Icons come from `lucide-react` only (it is deliberately in Vite's `optimizeDeps.exclude`). Per `.bolt/prompt`, do not add UI/icon/theme packages.

Component styling is inconsistent by page: the older components use Tailwind classes, while `PowerUpPage`, `GoalsPage`, `JournalPage`, and `StreaksPage` use large inline `style` objects. Match whichever file you are editing.

TypeScript runs `strict` with `noUnusedLocals` and `noUnusedParameters`, so unused imports and parameters fail `npm run typecheck` even though the dev server tolerates them.
