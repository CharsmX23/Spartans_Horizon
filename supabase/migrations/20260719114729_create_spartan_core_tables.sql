/*
# Create Spartan Core Tables

This migration creates four tables to power the Journal, Power Up, Goals,
and Streaks features of the Event Horizon / Spartan dashboard.

## Tables

### 1. journal_entries
Stores user journal entries for the Journal tab.
- id: UUID primary key
- title: Entry title (e.g. "Hackathon day 1")
- content: Full text body of the journal entry
- category: Free-form tag (e.g. "Tech", "Hackathon", "Learning")
- created_at / updated_at: Timestamps

### 2. skills
Stores skill panels for the Power Up tab.
- id: UUID primary key
- name: Skill / track name (e.g. "Reverse Engineering")
- category: Category label (e.g. "Security", "AI", "Web3")
- deadline: Optional target date for completing the skill
- completed_topics: Array of completed topic strings
- total_topics: How many topics the track contains
- progress: Integer percentage 0-100
- ai_feedback: Last AI-generated feedback text
- created_at

### 3. goals
Stores long-term and short-term goals for the Goals tab.
- id: UUID primary key
- title: Goal description
- goal_type: "long_term" or "short_term"
- deadline: Target completion date (ISO date)
- status: "active" | "completed" | "paused"
- description: Optional expanded note
- created_at

### 4. streak_logs
Stores daily streak proof submissions for the Streaks tab.
- id: UUID primary key
- log_date: The calendar date of the entry (unique per day)
- photo_url: URL of the uploaded proof photo (from Supabase Storage)
- verified: Whether the AI/system accepted it as valid
- note: Optional text note alongside the photo
- created_at

## Security
All tables use RLS with open anon + authenticated policies because this
is a single-user personal dashboard (no sign-in required).
*/

-- ── journal_entries ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS journal_entries (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text NOT NULL DEFAULT 'Untitled',
  content     text NOT NULL DEFAULT '',
  category    text NOT NULL DEFAULT 'General',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "je_select" ON journal_entries;
CREATE POLICY "je_select" ON journal_entries FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "je_insert" ON journal_entries;
CREATE POLICY "je_insert" ON journal_entries FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "je_update" ON journal_entries;
CREATE POLICY "je_update" ON journal_entries FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "je_delete" ON journal_entries;
CREATE POLICY "je_delete" ON journal_entries FOR DELETE TO anon, authenticated USING (true);

-- Auto-update updated_at on edit
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS je_updated_at ON journal_entries;
CREATE TRIGGER je_updated_at
  BEFORE UPDATE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── skills ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS skills (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text NOT NULL,
  category          text NOT NULL DEFAULT 'General',
  deadline          date,
  completed_topics  text[] NOT NULL DEFAULT '{}',
  total_topics      int NOT NULL DEFAULT 10,
  progress          int NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  ai_feedback       text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE skills ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "skills_select" ON skills;
CREATE POLICY "skills_select" ON skills FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "skills_insert" ON skills;
CREATE POLICY "skills_insert" ON skills FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "skills_update" ON skills;
CREATE POLICY "skills_update" ON skills FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "skills_delete" ON skills;
CREATE POLICY "skills_delete" ON skills FOR DELETE TO anon, authenticated USING (true);

-- ── goals ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS goals (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title        text NOT NULL,
  goal_type    text NOT NULL CHECK (goal_type IN ('long_term', 'short_term')),
  deadline     date,
  status       text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'paused')),
  description  text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE goals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "goals_select" ON goals;
CREATE POLICY "goals_select" ON goals FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "goals_insert" ON goals;
CREATE POLICY "goals_insert" ON goals FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "goals_update" ON goals;
CREATE POLICY "goals_update" ON goals FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "goals_delete" ON goals;
CREATE POLICY "goals_delete" ON goals FOR DELETE TO anon, authenticated USING (true);

-- ── streak_logs ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS streak_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  log_date    date NOT NULL UNIQUE,
  photo_url   text,
  verified    boolean NOT NULL DEFAULT false,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE streak_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "streaks_select" ON streak_logs;
CREATE POLICY "streaks_select" ON streak_logs FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "streaks_insert" ON streak_logs;
CREATE POLICY "streaks_insert" ON streak_logs FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "streaks_update" ON streak_logs;
CREATE POLICY "streaks_update" ON streak_logs FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "streaks_delete" ON streak_logs;
CREATE POLICY "streaks_delete" ON streak_logs FOR DELETE TO anon, authenticated USING (true);

-- Index on date for fast today-lookup
CREATE INDEX IF NOT EXISTS streak_logs_date_idx ON streak_logs(log_date);
CREATE INDEX IF NOT EXISTS goals_type_idx ON goals(goal_type, status);
CREATE INDEX IF NOT EXISTS je_created_idx ON journal_entries(created_at DESC);
