import { supabase } from './supabase';
import { PathPhase, loadPhasesForPaths } from './pathPhases';

/**
 * Data access for learning paths.
 *
 * A path used to own a `modules -> tasks` hierarchy. Both tables were dropped in
 * `20260807120000_drop_learning_modules_tasks.sql`: a path is now a description plus a
 * `path_phases` timeline, the same shape as a mission on the home screen. Everything
 * modules used to carry — ordering, "why it matters", progress — is a phase's job now.
 *
 * ── Why phases are loaded here and not in the timeline component ────────────────
 * A path's percentage is `completed phases / total phases`, and that number is shown on
 * the *collapsed* row, before the timeline is mounted. So phases cannot be a detail the
 * timeline fetches for itself; they belong to the path. `loadPaths()` fetches them for
 * every visible path in one query and hands `PathTimeline` a controlled list, which also
 * means the page and the timeline can never disagree about what the phases are.
 *
 * Writes never send `user_id` — the column default `auth.uid()` supplies it.
 */

export interface FoundationalTerm {
  term: string;
  definition: string;
}

export interface LearningPath {
  id: string;
  user_id: string;
  title: string;
  overview: string;
  foundational_terms: FoundationalTerm[];
  total_timeline_weeks: number | null;
  created_at: string;
  phases: PathPhase[];
}

export interface Result<T> {
  data: T | null;
  error: string | null;
}

/** Loads every path visible to the caller — own plus squadmates', per RLS. */
export async function loadPaths(): Promise<Result<LearningPath[]>> {
  const { data: paths, error: pathError } = await supabase
    .from('learning_paths')
    .select('id, user_id, title, overview, foundational_terms, total_timeline_weeks, created_at')
    .order('created_at', { ascending: false });

  if (pathError) return { data: null, error: pathError.message };
  if (!paths || paths.length === 0) return { data: [], error: null };

  const { data: phases, error: phaseError } = await loadPhasesForPaths(paths.map((p) => p.id));
  if (phaseError) return { data: null, error: phaseError };

  const assembled: LearningPath[] = paths.map((path) => ({
    ...(path as Omit<LearningPath, 'phases' | 'foundational_terms'>),
    foundational_terms: normalizeTerms(path.foundational_terms),
    phases: (phases ?? []).filter((p) => p.path_id === path.id),
  }));

  return { data: assembled, error: null };
}

/** jsonb is `unknown` at the type level; drop anything that isn't a {term, definition}. */
function normalizeTerms(raw: unknown): FoundationalTerm[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((t): t is FoundationalTerm =>
      typeof t === 'object' && t !== null && 'term' in t && 'definition' in t)
    .map((t) => ({ term: String(t.term), definition: String(t.definition) }));
}

export async function createPath(input: {
  title: string;
  overview: string;
  total_timeline_weeks: number | null;
}): Promise<Result<{ id: string }>> {
  const { data, error } = await supabase
    .from('learning_paths')
    .insert({
      title: input.title.trim(),
      overview: input.overview.trim(),
      total_timeline_weeks: input.total_timeline_weeks,
    })
    .select('id')
    .single();

  return { data: data ?? null, error: error?.message ?? null };
}

export async function updatePath(
  id: string,
  patch: Partial<Pick<LearningPath, 'title' | 'overview' | 'foundational_terms' | 'total_timeline_weeks'>>,
): Promise<Result<null>> {
  const { error } = await supabase.from('learning_paths').update(patch).eq('id', id);
  return { data: null, error: error?.message ?? null };
}

export async function deletePath(id: string): Promise<Result<null>> {
  // Phases cascade.
  const { error } = await supabase.from('learning_paths').delete().eq('id', id);
  return { data: null, error: error?.message ?? null };
}

/**
 * A path's progress is its phases: how many are `completed`, out of how many there are.
 * Nothing here is stored — the percentage is derived on every read, so it cannot drift
 * from the timeline the user is looking at.
 *
 * Phases are marked complete by their owner, so this number IS self-reported — it is a
 * personal plan, ticked off like any to-do list. The streak on the home screen is the
 * opposite and stays photo-verified, because that one is shown to squadmates as a claim
 * about what actually happened.
 */
export function pathProgress(path: LearningPath): { done: number; total: number; percent: number } {
  const done = path.phases.filter((p) => p.status === 'completed').length;
  const total = path.phases.length;
  return { done, total, percent: total === 0 ? 0 : Math.round((done / total) * 100) };
}
