import { supabase } from './supabase';

/**
 * Private per-user missions for the "Next Missions" home section.
 *
 * Writes never send `user_id` (column default `auth.uid()` supplies it) and never send
 * `priority` / `progress` — those columns exist but are not in the UPDATE grant, so a
 * direct write would be rejected. They stay unset until they have real UI.
 */

export interface Mission {
  id: string;
  user_id: string;
  title: string;
  deadline: string | null;
  created_at: string;
}

export interface Result<T> {
  data: T | null;
  error: string | null;
}

/** Nearest deadline first; undated missions sort last rather than vanishing. */
export async function loadMissions(): Promise<Result<Mission[]>> {
  const { data, error } = await supabase
    .from('missions')
    .select('id, user_id, title, deadline, created_at')
    .order('deadline', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false });

  return { data: (data as Mission[]) ?? null, error: error?.message ?? null };
}

export async function createMission(input: {
  title: string;
  deadline: string | null;
}): Promise<Result<Mission>> {
  const { data, error } = await supabase
    .from('missions')
    .insert({ title: input.title.trim(), deadline: input.deadline || null })
    .select('id, user_id, title, deadline, created_at')
    .single();

  return { data: (data as Mission) ?? null, error: error?.message ?? null };
}

export async function updateMission(
  id: string,
  patch: { title?: string; deadline?: string | null },
): Promise<Result<null>> {
  const clean: { title?: string; deadline?: string | null } = {};
  if (patch.title !== undefined) clean.title = patch.title.trim();
  if (patch.deadline !== undefined) clean.deadline = patch.deadline || null;

  const { error } = await supabase.from('missions').update(clean).eq('id', id);
  return { data: null, error: error?.message ?? null };
}

export async function deleteMission(id: string): Promise<Result<null>> {
  const { error } = await supabase.from('missions').delete().eq('id', id);
  return { data: null, error: error?.message ?? null };
}

/**
 * Whole days from today to the deadline. Both sides are floored to local midnight so
 * "tomorrow" reads as 1 regardless of the current time of day.
 */
export function daysLeft(deadline: string | null): number | null {
  if (!deadline) return null;
  const target = new Date(`${deadline}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

/** Human label for a countdown, including overdue and same-day cases. */
export function deadlineLabel(deadline: string | null): string {
  const days = daysLeft(deadline);
  if (days === null) return 'No deadline';
  if (days < 0) return `${Math.abs(days)} ${Math.abs(days) === 1 ? 'Day' : 'Days'} Overdue`;
  if (days === 0) return 'Due Today';
  if (days === 1) return '1 Day Left';
  return `${days} Days Left`;
}

/** Urgency colour, derived from the real date — not a stored priority. */
export function deadlineColor(deadline: string | null): string {
  const days = daysLeft(deadline);
  if (days === null) return 'rgba(255,255,255,0.35)';
  if (days < 0) return '#FF4D2A';
  if (days <= 3) return '#FF4D2A';
  if (days <= 7) return '#FF8A1E';
  return '#F5C518';
}
