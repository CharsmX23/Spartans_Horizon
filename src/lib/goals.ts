import { supabase } from './supabase';

/**
 * Shared goal types and colour-coding.
 *
 * `GoalsPage` still owns its own CRUD inline (per the per-page pattern); this module
 * exists so the home-screen summary and the Goals page agree on the shape, the
 * still-relevant filter, and the long/short colour pair rather than each hardcoding them.
 */

export type GoalType = 'long_term' | 'short_term';
export type GoalStatus = 'active' | 'completed' | 'paused';

export interface Goal {
  id: string;
  title: string;
  goal_type: GoalType;
  deadline: string | null;
  status: GoalStatus;
  description: string | null;
  created_at: string;
}

export interface Result<T> {
  data: T | null;
  error: string | null;
}

/** Type colour-coding — blue for long-term, green for short-term. */
export const GOAL_TYPE_COLOR: Record<GoalType, string> = {
  long_term: '#38BDF8',
  short_term: '#34D399',
};

export const GOAL_TYPE_LABEL: Record<GoalType, string> = {
  long_term: 'Long-term',
  short_term: 'Short-term',
};

/**
 * Goals still worth showing on the home screen. `status` is one of active / completed /
 * paused (enforced by goals_status_check), so "still relevant" is exactly 'active' —
 * completed is done and paused is deliberately set aside.
 *
 * Nearest deadline first; undated goals sort last rather than vanishing, matching how
 * loadMissions() orders.
 */
export async function loadActiveGoals(): Promise<Result<Goal[]>> {
  const { data, error } = await supabase
    .from('goals')
    .select('id, title, goal_type, deadline, status, description, created_at')
    .eq('status', 'active')
    .order('deadline', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false });

  return { data: (data as Goal[]) ?? null, error: error?.message ?? null };
}
