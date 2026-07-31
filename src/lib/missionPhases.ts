import { supabase } from './supabase';

/**
 * Expandable phase timeline for a mission (paths -> phases, one level).
 *
 * Ownership is structural: `mission_phases` carries a composite FK to
 * `missions(id, user_id)`, so a phase can never belong to a mission the caller does not
 * own. Writes never send `user_id` (the column default `auth.uid()` supplies it) and
 * never send it on UPDATE either — `user_id` and `mission_id` are outside the UPDATE
 * grant, so a phase cannot be reassigned or moved from the client.
 */

export type PhaseStatus = 'pending' | 'live' | 'completed';

export interface MissionPhase {
  id: string;
  mission_id: string;
  user_id: string;
  title: string;
  description: string | null;
  status: PhaseStatus;
  target_date: string | null;
  order_index: number;
  created_at: string;
}

export interface Result<T> {
  data: T | null;
  error: string | null;
}

const COLS = 'id, mission_id, user_id, title, description, status, target_date, order_index, created_at';

/** Phases for one mission, in timeline order. */
export async function loadPhases(missionId: string): Promise<Result<MissionPhase[]>> {
  const { data, error } = await supabase
    .from('mission_phases')
    .select(COLS)
    .eq('mission_id', missionId)
    .order('order_index', { ascending: true })
    .order('created_at', { ascending: true });

  return { data: (data as MissionPhase[]) ?? null, error: error?.message ?? null };
}

export async function createPhase(input: {
  missionId: string;
  title: string;
  targetDate?: string | null;
  orderIndex?: number;
}): Promise<Result<MissionPhase>> {
  const { data, error } = await supabase
    .from('mission_phases')
    .insert({
      mission_id: input.missionId,
      title: input.title.trim(),
      target_date: input.targetDate || null,
      order_index: input.orderIndex ?? 0,
    })
    .select(COLS)
    .single();

  return { data: (data as MissionPhase) ?? null, error: error?.message ?? null };
}

export async function updatePhase(
  id: string,
  patch: { title?: string; description?: string | null; status?: PhaseStatus; target_date?: string | null; order_index?: number },
): Promise<Result<null>> {
  const clean: typeof patch = {};
  if (patch.title !== undefined) clean.title = patch.title.trim();
  if (patch.description !== undefined) clean.description = patch.description;
  if (patch.status !== undefined) clean.status = patch.status;
  if (patch.target_date !== undefined) clean.target_date = patch.target_date || null;
  if (patch.order_index !== undefined) clean.order_index = patch.order_index;

  const { error } = await supabase.from('mission_phases').update(clean).eq('id', id);
  return { data: null, error: error?.message ?? null };
}

export async function deletePhase(id: string): Promise<Result<null>> {
  const { error } = await supabase.from('mission_phases').delete().eq('id', id);
  return { data: null, error: error?.message ?? null };
}

/** pending -> live -> completed -> pending, for a single-click status dot. */
export function nextStatus(status: PhaseStatus): PhaseStatus {
  return status === 'pending' ? 'live' : status === 'live' ? 'completed' : 'pending';
}
