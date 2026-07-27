import { supabase } from './supabase';

/**
 * Data access for the paths -> modules -> tasks hierarchy.
 *
 * Rows are fetched as three flat queries and assembled here rather than with a nested
 * PostgREST embed: the tables are joined on composite keys `(id, user_id)`, and flat
 * queries keep the relationship explicit instead of relying on PostgREST inferring the
 * right one.
 *
 * Writes never send `user_id` (column default `auth.uid()` supplies it) and never send
 * `is_done` (not granted to `authenticated` — see `setTaskDone`).
 */

export type ProofType = 'photo' | 'link' | 'text';

export const PROOF_TYPES: ProofType[] = ['text', 'link', 'photo'];

export interface FoundationalTerm {
  term: string;
  definition: string;
}

export interface LearningTask {
  id: string;
  module_id: string;
  user_id: string;
  label: string;
  proof_type: ProofType;
  is_done: boolean;
  done_at: string | null;
  sort_order: number;
}

export interface LearningModule {
  id: string;
  path_id: string;
  user_id: string;
  title: string;
  why_it_matters: string;
  ai_leverage: string;
  estimated_days: number | null;
  sort_order: number;
  tasks: LearningTask[];
}

export interface LearningPath {
  id: string;
  user_id: string;
  title: string;
  overview: string;
  foundational_terms: FoundationalTerm[];
  total_timeline_weeks: number | null;
  created_at: string;
  modules: LearningModule[];
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

  const pathIds = paths.map((p) => p.id);

  const { data: modules, error: moduleError } = await supabase
    .from('learning_modules')
    .select('id, path_id, user_id, title, why_it_matters, ai_leverage, estimated_days, sort_order')
    .in('path_id', pathIds)
    .order('sort_order');

  if (moduleError) return { data: null, error: moduleError.message };

  const moduleIds = (modules ?? []).map((m) => m.id);
  let tasks: LearningTask[] = [];

  if (moduleIds.length > 0) {
    const { data: taskRows, error: taskError } = await supabase
      .from('learning_tasks')
      .select('id, module_id, user_id, label, proof_type, is_done, done_at, sort_order')
      .in('module_id', moduleIds)
      .order('sort_order');

    if (taskError) return { data: null, error: taskError.message };
    tasks = (taskRows ?? []) as LearningTask[];
  }

  const assembled: LearningPath[] = paths.map((path) => ({
    ...(path as Omit<LearningPath, 'modules' | 'foundational_terms'>),
    foundational_terms: normalizeTerms(path.foundational_terms),
    modules: (modules ?? [])
      .filter((m) => m.path_id === path.id)
      .map((m) => ({
        ...(m as Omit<LearningModule, 'tasks'>),
        tasks: tasks.filter((t) => t.module_id === m.id),
      })),
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
  // Modules and tasks cascade.
  const { error } = await supabase.from('learning_paths').delete().eq('id', id);
  return { data: null, error: error?.message ?? null };
}

export async function createModule(input: {
  path_id: string;
  title: string;
  why_it_matters: string;
  ai_leverage: string;
  estimated_days: number | null;
  sort_order: number;
}): Promise<Result<{ id: string }>> {
  const { data, error } = await supabase
    .from('learning_modules')
    .insert({
      path_id: input.path_id,
      title: input.title.trim(),
      why_it_matters: input.why_it_matters.trim(),
      ai_leverage: input.ai_leverage.trim(),
      estimated_days: input.estimated_days,
      sort_order: input.sort_order,
    })
    .select('id')
    .single();

  return { data: data ?? null, error: error?.message ?? null };
}

export async function updateModule(
  id: string,
  patch: Partial<Pick<LearningModule, 'title' | 'why_it_matters' | 'ai_leverage' | 'estimated_days' | 'sort_order'>>,
): Promise<Result<null>> {
  const { error } = await supabase.from('learning_modules').update(patch).eq('id', id);
  return { data: null, error: error?.message ?? null };
}

export async function deleteModule(id: string): Promise<Result<null>> {
  const { error } = await supabase.from('learning_modules').delete().eq('id', id);
  return { data: null, error: error?.message ?? null };
}

export async function createTask(input: {
  module_id: string;
  label: string;
  proof_type: ProofType;
  sort_order: number;
}): Promise<Result<{ id: string }>> {
  const { data, error } = await supabase
    .from('learning_tasks')
    .insert({
      module_id: input.module_id,
      label: input.label.trim(),
      proof_type: input.proof_type,
      sort_order: input.sort_order,
    })
    .select('id')
    .single();

  return { data: data ?? null, error: error?.message ?? null };
}

export async function updateTask(
  id: string,
  patch: Partial<Pick<LearningTask, 'label' | 'proof_type' | 'sort_order'>>,
): Promise<Result<null>> {
  const { error } = await supabase.from('learning_tasks').update(patch).eq('id', id);
  return { data: null, error: error?.message ?? null };
}

export async function deleteTask(id: string): Promise<Result<null>> {
  const { error } = await supabase.from('learning_tasks').delete().eq('id', id);
  return { data: null, error: error?.message ?? null };
}

/**
 * `is_done` is not in the `authenticated` UPDATE grant — a direct .update() gets a
 * permission error. Phase 4 adds proof verification inside this function, so the
 * client call site does not change when the AI lands.
 */
export async function setTaskDone(taskId: string, done: boolean): Promise<Result<null>> {
  const { error } = await supabase.rpc('set_task_done', { p_task_id: taskId, p_done: done });
  return { data: null, error: error?.message ?? null };
}

/** Swaps sort_order with the neighbour in `direction`. Returns false at the ends. */
export async function reorder<T extends { id: string; sort_order: number }>(
  table: 'learning_modules' | 'learning_tasks',
  items: T[],
  id: string,
  direction: -1 | 1,
): Promise<Result<null>> {
  const ordered = [...items].sort((a, b) => a.sort_order - b.sort_order);
  const index = ordered.findIndex((i) => i.id === id);
  const target = index + direction;
  if (index === -1 || target < 0 || target >= ordered.length) return { data: null, error: null };

  const a = ordered[index];
  const b = ordered[target];

  // Normalized positions, so duplicate or sparse sort_order values self-heal.
  const { error: errA } = await supabase.from(table).update({ sort_order: target }).eq('id', a.id);
  if (errA) return { data: null, error: errA.message };
  const { error: errB } = await supabase.from(table).update({ sort_order: index }).eq('id', b.id);
  return { data: null, error: errB?.message ?? null };
}

export function pathProgress(path: LearningPath): { done: number; total: number; percent: number } {
  const all = path.modules.flatMap((m) => m.tasks);
  const done = all.filter((t) => t.is_done).length;
  const total = all.length;
  return { done, total, percent: total === 0 ? 0 : Math.round((done / total) * 100) };
}
