import { supabase } from './supabase';

/**
 * Client half of the photo-verification flow.
 *
 * The file is read to base64 in the browser and posted straight to the `verify-proof`
 * Edge Function. It is never uploaded to Storage and never written to a table — there
 * is no persisted copy to clean up.
 */

export const MAX_PROOF_BYTES = 5 * 1024 * 1024;

export interface StreakState {
  current_streak: number;
  last_checkin_date: string;
  already_checked_in: boolean;
}

export interface ProofVerdict {
  verdict: 'progress' | 'no_progress';
  evaluation_text: string;
  /** True when the function successfully ticked the task via set_task_done(). */
  task_confirmed: boolean;
  /** True when the function recorded a habit completion via record_habit_completion(). */
  habit_confirmed: boolean;
  /**
   * Server-computed streak after a passing check-in; null otherwise. Set for both
   * 'streak' proofs and 'habit' proofs — a verified habit is the day's check-in.
   */
  streak: StreakState | null;
}

export type ProofResult =
  | { ok: true; verdict: ProofVerdict }
  | { ok: false; message: string };

/** Rejects non-images and oversized files before any work happens. */
export function validateProofFile(file: File): string | null {
  if (!file.type.startsWith('image/')) return 'That file is not an image.';
  if (file.size > MAX_PROOF_BYTES) {
    return `That image is ${(file.size / 1024 / 1024).toFixed(1)} MB — the limit is 5 MB.`;
  }
  return null;
}

function toBase64(file: File): Promise<{ base64: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that file'));
    reader.onload = () => {
      const result = String(reader.result);
      const comma = result.indexOf(',');
      resolve({ base64: comma === -1 ? result : result.slice(comma + 1), mimeType: file.type });
    };
    reader.readAsDataURL(file);
  });
}

export async function verifyProof(input: {
  file: File;
  /** The goal, task, or habit label the photo is judged against. */
  context: string;
  kind: 'streak' | 'task' | 'habit';
  /** Required for kind 'task' — the function ticks this on a pass. */
  taskId?: string;
  /** Required for kind 'habit' — the function records a completion for this on a pass. */
  habitId?: string;
}): Promise<ProofResult> {
  try {
    const { base64, mimeType } = await toBase64(input.file);

    const { data, error } = await supabase.functions.invoke('verify-proof', {
      body: {
        image_base64: base64,
        mime_type: mimeType,
        context: input.context,
        kind: input.kind,
        task_id: input.taskId,
        habit_id: input.habitId,
      },
    });

    type Body =
      | ({ status: 'ok' } & ProofVerdict)
      | { status: 'not_configured' | 'error'; message: string }
      | null;

    let body = data as Body;

    // On any non-2xx, supabase-js sets `data` to null and hands back a
    // FunctionsHttpError carrying the raw Response on `.context`. Without reading it
    // the function's actual message ("could not record the check-in", "not_configured")
    // is lost and every failure looks like the function is undeployed.
    if (!body && error) {
      const response = (error as { context?: Response }).context;
      if (response && typeof response.json === 'function') {
        body = await response.json().catch(() => null) as Body;
      }
    }

    if (body?.status === 'ok') {
      return {
        ok: true,
        verdict: {
          verdict: body.verdict,
          evaluation_text: body.evaluation_text,
          task_confirmed: body.task_confirmed,
          habit_confirmed: body.habit_confirmed,
          streak: body.streak ?? null,
        },
      };
    }

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

    return { ok: false, message: 'Unexpected response from the verifier.' };
  } catch (e: unknown) {
    return { ok: false, message: e instanceof Error ? e.message : 'Verification failed.' };
  }
}
