import { supabase } from './supabase';
import { LearningPath } from './learning';

/**
 * The AI advisor for a learning path — text in, text out, nothing written.
 *
 * ── What this replaced ─────────────────────────────────────────────────────────
 * Power Up used to run a per-phase coach review through the same Edge Function, and
 * separately a photo gate that was the only way a phase could reach `completed`. The gate
 * is gone (phases are ticked by hand now, see `nextStatus` in pathPhases.ts) and the coach
 * moved up a level: a single phase in isolation cannot say whether the plan actually
 * covers the goal, or whether the dates are slipping. The whole typed timeline goes in at
 * once instead.
 *
 * ── It cannot change anything, by construction ─────────────────────────────────
 * The `path_advice` branch of verify-proof returns before any of the verification
 * machinery and makes no RPC call at all, so there is no write path for this to reach even
 * by accident. Deliberately its own module rather than another export of `proof.ts`: that
 * file's job is submitting photos that cause server-side writes, and advice should not sit
 * one mistyped argument away from it.
 */

export interface PathAdvice {
  /** Are these the right topics for the stated goal? */
  coverage: string;
  /** How is progress, given what is completed vs still open? */
  progress: string;
  /** On track against the phase dates and today? */
  timing: string;
  on_track: 'ahead' | 'on_track' | 'behind' | 'unknown';
  /** The one thing to focus on next. */
  next: string;
}

export type AdviceResult =
  | { ok: true; advice: PathAdvice }
  | { ok: false; message: string };

/**
 * The caller's local date as YYYY-MM-DD.
 *
 * NOT `toISOString().slice(0, 10)`, which is UTC — west of Greenwich that reads as
 * tomorrow for part of the evening, and "you are a day behind" is exactly the kind of
 * wrong the timing advice would deliver with a straight face.
 */
function localToday(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export async function requestPathAdvice(path: LearningPath): Promise<AdviceResult> {
  try {
    const { data, error } = await supabase.functions.invoke('verify-proof', {
      body: {
        kind: 'path_advice',
        today: localToday(),
        path: {
          title: path.title,
          overview: path.overview,
          total_timeline_weeks: path.total_timeline_weeks,
        },
        // Sent in timeline order — the prompt numbers them and reasons about what comes
        // next, so the order is part of the content, not presentation.
        phases: path.phases.map((phase) => ({
          title: phase.title,
          description: phase.description,
          status: phase.status,
          start_date: phase.start_date,
          target_date: phase.target_date,
        })),
      },
    });

    type Body =
      | { status: 'advice'; advice: PathAdvice }
      | { status: 'not_configured' | 'error'; message: string }
      | null;

    let body = data as Body;

    // On any non-2xx, supabase-js sets `data` to null and hands back a FunctionsHttpError
    // carrying the raw Response on `.context`. Without reading it the function's actual
    // message is lost and every failure looks like the function is undeployed.
    if (!body && error) {
      const response = (error as { context?: Response }).context;
      if (response && typeof response.json === 'function') {
        body = await response.json().catch(() => null) as Body;
      }
    }

    if (body?.status === 'advice') return { ok: true, advice: body.advice };

    if (body && 'message' in body && body.message) {
      return { ok: false, message: body.message };
    }

    if (error) {
      return {
        ok: false,
        message:
          'Could not reach the verify-proof function. Deploy it with '
          + '`npx supabase functions deploy verify-proof`.',
      };
    }

    return { ok: false, message: 'Unexpected response from the advisor.' };
  } catch (e: unknown) {
    return { ok: false, message: e instanceof Error ? e.message : 'Path advice failed.' };
  }
}
