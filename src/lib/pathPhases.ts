import { supabase } from './supabase';

/**
 * Hand-entered phases for a learning path — the Power Up counterpart to
 * `missionPhases.ts`, and deliberately the same shape so the two timelines behave
 * identically. See that file first if you are changing either.
 *
 * The one addition here is `start_date`. A mission phase only needs a target, because a
 * mission is a countdown; a path phase is a stretch of work ("Prototyping", six weeks),
 * so it can carry both ends. Both are optional — a phase with neither still holds its
 * place in the order.
 *
 * Writes never send `user_id` (the column default `auth.uid()` supplies it) and never
 * send `path_id` on UPDATE — both are outside the UPDATE grant, so a phase cannot be
 * reassigned or moved to another path from the client.
 *
 * ── `completed` is an ordinary write, and used not to be ────────────────────────
 * For a while a phase could only reach `completed` through a photo that Gemini accepted:
 * `set_phase_verified()` issued a ticket and a BEFORE trigger on `path_phases` rejected
 * the transition from every other writer, so this file typed `status` as everything
 * *except* `completed`.
 *
 * That is gone (`20260808120000_manual_phase_completion.sql`). A phase is a to-do item its
 * owner ticks off, so all three statuses are plain column writes now, scoped to your own
 * rows by RLS and to the safe columns by the UPDATE grant. `user_id` and `path_id` remain
 * outside that grant, so a phase still cannot be reassigned or moved from the client.
 *
 * The streak and habit proofs are unaffected and stay photo-gated — see `proof.ts`.
 */

export type PhaseStatus = 'pending' | 'live' | 'completed';

export interface PathPhase {
  id: string;
  path_id: string;
  user_id: string;
  title: string;
  description: string | null;
  status: PhaseStatus;
  start_date: string | null;
  target_date: string | null;
  order_index: number;
  created_at: string;
}

export interface Result<T> {
  data: T | null;
  error: string | null;
}

const COLS =
  'id, path_id, user_id, title, description, status, start_date, target_date, order_index, created_at';

/** Phases for one path, in timeline order. */
export async function loadPathPhases(pathId: string): Promise<Result<PathPhase[]>> {
  const { data, error } = await supabase
    .from('path_phases')
    .select(COLS)
    .eq('path_id', pathId)
    .order('order_index', { ascending: true })
    .order('created_at', { ascending: true });

  return { data: (data as PathPhase[]) ?? null, error: error?.message ?? null };
}

/**
 * Phases for several paths in one round trip, in timeline order.
 *
 * `loadPaths()` uses this to attach phases to every visible path up front, because a
 * path's percentage is computed from them and is shown on the collapsed row — before
 * any timeline is mounted. Callers filter by `path_id`.
 */
export async function loadPhasesForPaths(pathIds: string[]): Promise<Result<PathPhase[]>> {
  if (pathIds.length === 0) return { data: [], error: null };

  const { data, error } = await supabase
    .from('path_phases')
    .select(COLS)
    .in('path_id', pathIds)
    .order('order_index', { ascending: true })
    .order('created_at', { ascending: true });

  return { data: (data as PathPhase[]) ?? null, error: error?.message ?? null };
}

export async function createPathPhase(input: {
  pathId: string;
  title: string;
  description?: string | null;
  startDate?: string | null;
  targetDate?: string | null;
  orderIndex?: number;
}): Promise<Result<PathPhase>> {
  const { data, error } = await supabase
    .from('path_phases')
    .insert({
      path_id: input.pathId,
      title: input.title.trim(),
      description: input.description?.trim() || null,
      start_date: input.startDate || null,
      target_date: input.targetDate || null,
      order_index: input.orderIndex ?? 0,
    })
    .select(COLS)
    .single();

  return { data: (data as PathPhase) ?? null, error: error?.message ?? null };
}

export async function updatePathPhase(
  id: string,
  patch: {
    title?: string;
    description?: string | null;
    status?: PhaseStatus;
    start_date?: string | null;
    target_date?: string | null;
    order_index?: number;
  },
): Promise<Result<null>> {
  const clean: typeof patch = {};
  if (patch.title !== undefined) clean.title = patch.title.trim();
  if (patch.description !== undefined) clean.description = patch.description?.trim() || null;
  if (patch.status !== undefined) clean.status = patch.status;
  if (patch.start_date !== undefined) clean.start_date = patch.start_date || null;
  if (patch.target_date !== undefined) clean.target_date = patch.target_date || null;
  if (patch.order_index !== undefined) clean.order_index = patch.order_index;

  const { error } = await supabase.from('path_phases').update(clean).eq('id', id);
  return { data: null, error: error?.message ?? null };
}

export async function deletePathPhase(id: string): Promise<Result<null>> {
  const { error } = await supabase.from('path_phases').delete().eq('id', id);
  return { data: null, error: error?.message ?? null };
}

/**
 * pending -> live -> completed -> pending, for a single-click status dot.
 *
 * Identical to `nextStatus` in `missionPhases.ts`, which is the point: the two timelines
 * look the same, so clicking a dot has to mean the same thing in both. It briefly did not
 * — while completion needed a photo this cycled pending <-> live only — and that is the
 * state this returns from.
 */
export function nextStatus(status: PhaseStatus): PhaseStatus {
  return status === 'pending' ? 'live' : status === 'live' ? 'completed' : 'pending';
}

/**
 * Swaps `order_index` with the neighbour in `direction`, so phases can be resequenced
 * without a drag layer. No-op at the ends.
 */
export async function movePhase(
  phases: PathPhase[],
  id: string,
  direction: -1 | 1,
): Promise<Result<null>> {
  const ordered = [...phases].sort((a, b) => a.order_index - b.order_index);
  const index = ordered.findIndex((p) => p.id === id);
  const target = index + direction;
  if (index === -1 || target < 0 || target >= ordered.length) return { data: null, error: null };

  // Normalized positions, so duplicate or sparse order_index values self-heal.
  const { error: errA } = await updatePathPhase(ordered[index].id, { order_index: target });
  if (errA) return { data: null, error: errA };
  return updatePathPhase(ordered[target].id, { order_index: index });
}

/**
 * A phase inherits its start from where the previous one ends, so a chain entered with
 * only target dates still reads as continuous. Returns the day after the previous
 * phase's target, or null when there is nothing to chain from.
 */
export function chainStartFrom(previous: PathPhase | undefined): string | null {
  if (!previous?.target_date) return null;
  const day = new Date(`${previous.target_date}T00:00:00`);
  day.setDate(day.getDate() + 1);
  return day.toISOString().slice(0, 10);
}
