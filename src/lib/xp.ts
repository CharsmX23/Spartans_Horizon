import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';

/**
 * XP and level, read from the `xp_events` ledger — never stored.
 *
 * `Person.level` in data.ts has been a hardcoded 24 since the app was scaffolded. This
 * module is what replaces it. There is no `level` column anywhere and there must not be
 * one: level is a pure function of the ledger, recomputed on read, so it cannot drift
 * from the events that produced it and there is no cached number to go stale when a
 * grant lands.
 *
 * That is also why the curve below could change without a migration: no stored level
 * needed rewriting, because there was none. Only the reading of an existing total moved.
 *
 * The ledger is read-only to the browser (SELECT granted, INSERT/UPDATE/DELETE revoked —
 * see 20260813130000_xp_events.sql). Every row is written by a database trigger or a
 * SECURITY DEFINER function, and UNIQUE (source_id) means one source row can only ever
 * pay out once. So a total read here is the real total; there is nothing the client can
 * do to inflate it, which is the only reason it is worth displaying.
 */

/**
 * Rising curve: each level costs 50 XP more than the one before it.
 *
 * Level 1 costs 50 to clear, level 2 costs 100, level 3 costs 150, level 4 costs 200, …
 * so the *cumulative* XP needed to reach level N is the triangular sum
 * 50 · (1 + 2 + … + (N-1)) = 25 · N · (N-1):
 *
 *   L1 0 · L2 50 · L3 150 · L4 300 · L5 500 · L6 750 · L7 1,050 · L8 1,400
 *
 * Nothing about how XP is earned or stored changes — this is only how an existing total
 * is read. The old curve was a flat 50 per level, so every existing total now reads lower.
 */
export const XP_LEVEL_STEP = 50;

/**
 * Cumulative XP needed to *reach* level `n`. 25·n·(n-1), so level 1 sits at 0.
 *
 * Exact in floating point for any level a human will ever see: 25·n·(n-1) is an integer
 * and stays far inside Number.MAX_SAFE_INTEGER, so no rounding happens here.
 */
export function xpForLevel(n: number): number {
  const level = Math.max(1, Math.floor(n));
  return (XP_LEVEL_STEP / 2) * level * (level - 1);
}

/**
 * What level `n` costs on its own — xpForLevel(n+1) − xpForLevel(n) = 50·n.
 *
 * This is the progress bar's denominator, and the reason it cannot be a constant: at
 * level 3 the rail spans 150 XP (150 → 300), not 50.
 */
export function xpToClearLevel(n: number): number {
  return XP_LEVEL_STEP * Math.max(1, Math.floor(n));
}

/**
 * The largest n where xpForLevel(n) <= total. A total of 0 is level 1, not level 0.
 *
 * Solving 25n² − 25n − total <= 0 gives n <= (1 + √(1 + total·4/25)) / 2, and the two
 * while loops after it are not belt-and-braces: Math.sqrt is correctly rounded but the
 * expression under it is not, so a total sitting exactly on a boundary can land a hair
 * under and floor to the level below. Each loop runs at most one step and costs nothing;
 * without them the curve is silently off by one at arbitrary thresholds, which is exactly
 * the class of bug nobody spots by eye.
 */
export function levelForXp(total: number): number {
  const safe = Math.max(0, Math.floor(total));
  let n = Math.floor((1 + Math.sqrt(1 + (safe * 4) / 25)) / 2);
  if (!Number.isFinite(n) || n < 1) n = 1;
  while (xpForLevel(n + 1) <= safe) n++;
  while (n > 1 && xpForLevel(n) > safe) n--;
  return n;
}

export interface XpState {
  /** Lifetime sum of every grant. */
  total: number;
  /** Largest n with 25·n·(n-1) <= total — a user with no events at all is Level 1. */
  level: number;
  /** Cumulative XP at which the current level began. */
  levelStart: number;
  /** What this level costs end to end, 50·level. The progress bar's denominator. */
  levelSpan: number;
  /** XP earned into the current level, 0..levelSpan-1. */
  intoLevel: number;
  /** XP still needed for the next level, 1..levelSpan. */
  toNext: number;
  /** intoLevel / levelSpan, as 0..1 — what the progress bar renders. */
  fraction: number;
}

export function xpState(total: number): XpState {
  const safe = Math.max(0, Math.floor(total));
  const level = levelForXp(safe);
  const levelStart = xpForLevel(level);
  const levelSpan = xpToClearLevel(level);
  const intoLevel = safe - levelStart;
  return {
    total: safe,
    level,
    levelStart,
    levelSpan,
    intoLevel,
    toNext: levelSpan - intoLevel,
    fraction: intoLevel / levelSpan,
  };
}

export interface Result<T> {
  data: T | null;
  error: string | null;
}

/**
 * Lifetime XP for the signed-in user.
 *
 * The sum is done in JS over the returned amounts rather than in SQL, because PostgREST
 * aggregate functions are disabled by default on hosted projects and silently 404 the
 * request when they are. RLS already scopes the rows to the caller, so this is one small
 * owner-only read; if the ledger ever grows past a few thousand rows, move this to a
 * SECURITY DEFINER `xp_total()` RPC rather than paginating here.
 *
 * A user with no events gets an empty array, which sums to 0 — the "brand-new user reads
 * Level 1, 0 XP" case falls out of the arithmetic rather than needing a special case.
 */
export async function loadTotalXp(): Promise<Result<number>> {
  const { data, error } = await supabase.from('xp_events').select('amount');
  if (error) return { data: null, error: error.message };

  const total = (data ?? []).reduce((sum, row) => sum + ((row.amount as number) ?? 0), 0);
  return { data: total, error: null };
}

/**
 * Every mounted useXp(), so a grant anywhere refreshes the header immediately.
 *
 * XP is granted server-side by triggers the client never sees respond — completing a goal
 * returns from the UPDATE with no mention of the 250 XP it just caused. Rather than thread
 * a context through every page for a single number, the pages that can cause a grant call
 * bumpXp() after their write and the header refetches. Deliberately a refetch and not a
 * local increment: the amount is the database's to decide, and guessing it here would
 * reintroduce exactly the client-side fiction this feature exists to remove.
 */
const listeners = new Set<() => void>();

export function bumpXp() {
  listeners.forEach((fn) => fn());
}

export function useXp() {
  const [total, setTotal] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const { data, error: loadError } = await loadTotalXp();
    if (loadError) { setError(loadError); return; }
    setError(null);
    setTotal(data ?? 0);
  }, []);

  useEffect(() => {
    void refresh();
    listeners.add(refresh);
    return () => { listeners.delete(refresh); };
  }, [refresh]);

  return {
    /** null only before the first read has landed — never a placeholder number. */
    xp: total === null ? null : xpState(total),
    error,
    refresh,
  };
}
