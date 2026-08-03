import { Dumbbell, Code2, BookOpen, Moon, Flame, Target, Brain, Droplet, LucideIcon } from 'lucide-react';
import { supabase } from './supabase';
import { verifyProof, ProofResult } from './proof';

/**
 * Real, private, per-user daily habits — replaces the hardcoded `HABITS` / `TODAY_ITEMS`
 * fixtures. A habit is ticked only by a passing Gemini verdict on a photo (see
 * verifyHabit), never by a client write: `habit_completions` grants the browser SELECT
 * and nothing else, so `done_today` reflects the database, not optimism.
 *
 * Writes never send `user_id` — the column default `auth.uid()` supplies it, and the
 * RLS WITH CHECK enforces it. Completions are written server-side by
 * record_habit_completion(), which also advances the streak.
 */

export interface Habit {
  id: string;
  title: string;
  icon: string;
  active: boolean;
  sort_order: number;
}

/** A habit joined with whether it has a verified completion today. */
export interface HabitToday extends Habit {
  done_today: boolean;
  today_note: string | null;
}

export interface Result<T> {
  data: T | null;
  error: string | null;
}

/** Local date, matching how `log_date` is stored (current_date, server-side). */
function todayStr() {
  return new Date().toISOString().split('T')[0];
}

/** Known lucide icons for habits; anything unmapped falls back to a flame. */
const HABIT_ICONS: Record<string, LucideIcon> = {
  Dumbbell, Code2, BookOpen, Moon, Flame, Target, Brain, Droplet,
};

export function habitIcon(name: string): LucideIcon {
  return HABIT_ICONS[name] ?? Flame;
}

/** Icon names offered when creating a habit, in a stable display order. */
export const HABIT_ICON_NAMES = Object.keys(HABIT_ICONS);

/**
 * Active habits, each annotated with today's verified state and evaluation note.
 * Two owner-scoped reads (RLS returns only your rows) joined in memory — no view needed.
 */
export async function loadHabits(): Promise<Result<HabitToday[]>> {
  const [habitsRes, compRes] = await Promise.all([
    supabase
      .from('habits')
      .select('id, title, icon, active, sort_order')
      .eq('active', true)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true }),
    supabase
      .from('habit_completions')
      .select('habit_id, verified, evaluation_text')
      .eq('log_date', todayStr()),
  ]);

  if (habitsRes.error) return { data: null, error: habitsRes.error.message };
  if (compRes.error) return { data: null, error: compRes.error.message };

  const byHabit = new Map(
    (compRes.data ?? []).map((c) => [c.habit_id as string, c]),
  );

  const rows: HabitToday[] = (habitsRes.data ?? []).map((h) => {
    const c = byHabit.get(h.id);
    return {
      ...(h as Habit),
      done_today: c?.verified ?? false,
      today_note: (c?.evaluation_text as string | null) ?? null,
    };
  });

  return { data: rows, error: null };
}

export async function createHabit(input: {
  title: string;
  icon?: string;
}): Promise<Result<Habit>> {
  const { data, error } = await supabase
    .from('habits')
    .insert({ title: input.title.trim(), icon: input.icon || 'Flame' })
    .select('id, title, icon, active, sort_order')
    .single();

  return { data: (data as Habit) ?? null, error: error?.message ?? null };
}

/** Every habit, removed ones included — the manage view needs to offer them back.
 *  Active first, then the same ordering the daily list uses. */
export async function loadAllHabits(): Promise<Result<Habit[]>> {
  const { data, error } = await supabase
    .from('habits')
    .select('id, title, icon, active, sort_order')
    .order('active', { ascending: false })
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  return { data: (data as Habit[]) ?? null, error: error?.message ?? null };
}

export async function updateHabit(
  id: string,
  patch: { title?: string; icon?: string; active?: boolean; sort_order?: number },
): Promise<Result<null>> {
  const clean: typeof patch = {};
  if (patch.title !== undefined) clean.title = patch.title.trim();
  if (patch.icon !== undefined) clean.icon = patch.icon;
  if (patch.active !== undefined) clean.active = patch.active;
  if (patch.sort_order !== undefined) clean.sort_order = patch.sort_order;

  const { error } = await supabase.from('habits').update(clean).eq('id', id);
  return { data: null, error: error?.message ?? null };
}

/**
 * Removing a habit is a soft hide, not a delete: `active = false` takes it out of the
 * daily list and out of record_habit_completion(), which validates `AND active` before
 * writing, so the block is enforced server-side rather than by the UI omitting a row.
 * Restoring is the same call with true.
 */
export async function setHabitActive(id: string, active: boolean): Promise<Result<null>> {
  return updateHabit(id, { active });
}

/**
 * Hard delete — deliberately not wired to any UI.
 *
 * habit_completions references (id, user_id) ON DELETE CASCADE, so this erases every
 * verified completion for the habit along with the model's evaluation text. The user's
 * streak counter and streak_logs survive (different tables), which makes the loss easy
 * to miss: the days stay on the grid, the proof behind them does not. `authenticated`
 * has no DELETE grant on habit_completions, so this cascade is the only way a client
 * can destroy that history — use setHabitActive(id, false) instead.
 */
export async function deleteHabit(id: string): Promise<Result<null>> {
  const { error } = await supabase.from('habits').delete().eq('id', id);
  return { data: null, error: error?.message ?? null };
}

/**
 * Verify a photo as proof of a specific habit. On a passing verdict the Edge Function
 * records the completion and advances the streak (a verified habit is the day's
 * check-in), so the returned verdict carries the new StreakState.
 */
export async function verifyHabit(input: {
  file: File;
  habit: Habit;
}): Promise<ProofResult> {
  return verifyProof({
    file: input.file,
    context: input.habit.title,
    kind: 'habit',
    habitId: input.habit.id,
  });
}
