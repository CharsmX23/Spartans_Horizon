/**
 * verify-proof — Gemini vision evaluation for streak proofs, learning-task proofs, and
 * daily-habit proofs.
 *
 * PRIVACY CONTRACT (the reason this function exists at all):
 * The image arrives as base64 in the request body, is held in a local variable for the
 * duration of the call, and is handed to Gemini as data-in-transit. It is NEVER written
 * to Supabase Storage, never written to a table, and never logged. There is no storage
 * write, so there is no cleanup step that can silently fail — the bytes are unreachable
 * the moment this function returns.
 *
 * Do not add logging of `image_base64`. Do not add a "temporary" bucket write. The
 * error paths below deliberately log only status codes and messages, never the payload.
 *
 * AUTH: `verify_jwt` stays ON (the default). The caller's JWT is forwarded to PostgREST
 * so `set_task_done()` sees the real `auth.uid()` and its ownership check still applies
 * — this function cannot tick a task on behalf of someone else.
 *
 * Deploy:  npx supabase functions deploy verify-proof --project-ref <ref>
 * Secret:  npx supabase secrets set GEMINI_API_KEY=... --project-ref <ref>
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';

// Overridable without a code change:  npx supabase secrets set GEMINI_MODEL=...
//
// NOTE: gemini-2.5-flash was the original default and 404s with "no longer available
// to new users" — a model can appear in ListModels and still be closed to new keys, so
// `list_models` proves the catalogue, not entitlement. Use the `test_model` action to
// check a candidate before committing to it.
const GEMINI_MODEL = Deno.env.get('GEMINI_MODEL') ?? 'gemini-3.6-flash';
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

interface VerifyRequest {
  /** Raw base64, no data: prefix. */
  image_base64: string;
  mime_type: string;
  /** The goal, task, or habit label the image is judged against. */
  context: string;
  kind: 'streak' | 'task' | 'habit';
  /** Required when kind === 'task' — the task to tick on a pass. */
  task_id?: string;
  /** Required when kind === 'habit' — the habit to record a completion for on a pass. */
  habit_id?: string;
  /**
   * Diagnostics, no image involved:
   *  - 'list_models' — what the catalogue advertises for this key
   *  - 'test_model'  — whether `model` is actually callable (entitlement, not catalogue)
   */
  action?: 'list_models' | 'test_model';
  /** Candidate model id for 'test_model'. Defaults to the configured one. */
  model?: string;
}

interface Verdict {
  verdict: 'progress' | 'no_progress';
  evaluation_text: string;
}

interface StreakState {
  current_streak: number;
  last_checkin_date: string;
  already_checked_in: boolean;
}

type VerifyResponse =
  | ({ status: 'ok'; task_confirmed: boolean; habit_confirmed: boolean; streak: StreakState | null } & Verdict)
  | { status: 'not_configured'; message: string }
  | { status: 'models'; configured_model: string; available: string[] }
  | { status: 'model_test'; model: string; callable: boolean; detail: string }
  | { status: 'error'; message: string };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: VerifyResponse, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

/**
 * Asks one specific question rather than "describe this image" — a vague prompt makes
 * the model agreeable, and an agreeable judge is the same as no judge.
 */
function buildPrompt(context: string, kind: 'streak' | 'task' | 'habit'): string {
  const subject = kind === 'task'
    ? `completion of this task: "${context}"`
    : kind === 'habit'
    ? `completion of this daily habit: "${context}"`
    : `genuine progress toward this goal: "${context}"`;

  return [
    `You are verifying a photo submitted as proof of ${subject}`,
    '',
    'Answer one question: does this photo show real, specific evidence of that work?',
    '',
    'Judge strictly but fairly:',
    '- A screenshot of code, a notebook page, a whiteboard, a finished build, a terminal,',
    '  a workout, or physical work in progress can all be valid evidence.',
    '- A stock photo, a meme, a selfie with no work visible, a blank screen, a random',
    '  object, or an image unrelated to the stated work is NOT valid evidence.',
    '- If the image is too blurry or dark to tell, that is not valid evidence.',
    '',
    'Return verdict "progress" only if the photo plausibly shows the stated work.',
    'Otherwise return "no_progress".',
    '',
    'evaluation_text: two sentences max, addressed to the person, saying what you see and',
    'why it does or does not count. Be direct and specific about the image contents.',
  ].join('\n');
}

/** Calls Gemini with a response schema so the output shape is constrained, not hoped for. */
async function evaluate(
  apiKey: string,
  imageBase64: string,
  mimeType: string,
  context: string,
  kind: 'streak' | 'task' | 'habit',
): Promise<Verdict> {
  const response = await fetch(`${GEMINI_API_BASE}/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: buildPrompt(context, kind) },
          { inline_data: { mime_type: mimeType, data: imageBase64 } },
        ],
      }],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            verdict: { type: 'STRING', enum: ['progress', 'no_progress'] },
            evaluation_text: { type: 'STRING' },
          },
          required: ['verdict', 'evaluation_text'],
        },
      },
    }),
  });

  if (!response.ok) {
    // Gemini's error body describes the failure (bad model name, bad key, quota) and
    // never echoes the image, so it is safe — and necessary — to surface. Truncated
    // so a long HTML error page can't flood the response.
    const detail = (await response.text().catch(() => '')).slice(0, 300);
    throw new Error(
      `Gemini returned ${response.status} for model "${GEMINI_MODEL}"`
      + (detail ? `: ${detail}` : ''),
    );
  }

  const payload = await response.json();
  const text = payload?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== 'string') throw new Error('Gemini returned no content');

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Gemini returned malformed JSON');
  }

  // Validate rather than trust the schema was honoured. A malformed verdict fails
  // closed — it must never fall through to a pass.
  const candidate = parsed as Partial<Verdict>;
  if (candidate.verdict !== 'progress' && candidate.verdict !== 'no_progress') {
    throw new Error('Gemini returned an unrecognised verdict');
  }
  if (typeof candidate.evaluation_text !== 'string' || candidate.evaluation_text.trim() === '') {
    throw new Error('Gemini returned an empty evaluation');
  }

  return { verdict: candidate.verdict, evaluation_text: candidate.evaluation_text.trim() };
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ status: 'error', message: 'POST only' }, 405);

  let payload: VerifyRequest;
  try {
    payload = await req.json();
  } catch {
    return json({ status: 'error', message: 'Body must be JSON' }, 400);
  }

  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) {
    return json({
      status: 'not_configured',
      message: 'GEMINI_API_KEY is not set on this project.',
    }, 501);
  }

  // Diagnostic: ask the key which models it can actually use. No image involved, so
  // this is safe to call and costs nothing against generation quota.
  //   curl -X POST .../verify-proof -d '{"action":"list_models"}'
  if (payload.action === 'list_models') {
    const listed = await fetch(`${GEMINI_API_BASE}/models?key=${apiKey}`);
    if (!listed.ok) {
      const detail = (await listed.text().catch(() => '')).slice(0, 300);
      return json({ status: 'error', message: `ListModels returned ${listed.status}: ${detail}` }, 502);
    }
    const body = await listed.json();
    const available = (body?.models ?? [])
      .filter((m: { supportedGenerationMethods?: string[] }) =>
        m.supportedGenerationMethods?.includes('generateContent'))
      .map((m: { name: string }) => m.name.replace(/^models\//, ''));
    return json({ status: 'models', configured_model: GEMINI_MODEL, available }, 200);
  }

  // Diagnostic: is this model actually callable by this key? A tiny text-only prompt,
  // so it costs almost nothing and needs no image.
  //   curl ... -d '{"action":"test_model","model":"gemini-3.6-flash"}'
  if (payload.action === 'test_model') {
    const model = payload.model ?? GEMINI_MODEL;
    const probe = await fetch(
      `${GEMINI_API_BASE}/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'Reply with the single word: ok' }] }],
          generationConfig: { maxOutputTokens: 512 },
        }),
      },
    );
    const detail = (await probe.text().catch(() => '')).slice(0, 300);
    return json({
      status: 'model_test',
      model,
      callable: probe.ok,
      detail: probe.ok ? 'callable' : detail,
    }, 200);
  }

  if (!payload.image_base64 || !payload.mime_type || !payload.context) {
    return json({
      status: 'error',
      message: 'image_base64, mime_type and context are required',
    }, 400);
  }

  // base64 inflates by ~4/3; check the decoded size.
  if ((payload.image_base64.length * 3) / 4 > MAX_IMAGE_BYTES) {
    return json({ status: 'error', message: 'Image exceeds 5 MB' }, 413);
  }

  let verdict: Verdict;
  try {
    verdict = await evaluate(
      apiKey,
      payload.image_base64,
      payload.mime_type,
      payload.context,
      payload.kind === 'task' ? 'task' : payload.kind === 'habit' ? 'habit' : 'streak',
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Verification failed';
    console.error('verify-proof evaluation failed:', message);
    return json({ status: 'error', message }, 502);
  }

  // The image has served its purpose; nothing below this line touches it.

  let taskConfirmed = false;
  let habitConfirmed = false;
  let streak: StreakState | null = null;

  if (verdict.verdict === 'progress') {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return json({ status: 'error', message: 'Missing Authorization header' }, 401);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;

    // Anon key + the caller's JWT. Used both to resolve who is calling and to run
    // set_task_done() as them, so its ownership check still applies.
    const asUser = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });

    if (payload.kind === 'task' && payload.task_id) {
      const { error } = await asUser.rpc('set_task_done', {
        p_task_id: payload.task_id,
        p_done: true,
      });
      if (error) {
        console.error('set_task_done failed:', error.message);
        return json({
          status: 'error',
          message: `Verified, but could not tick the task: ${error.message}`,
        }, 500);
      }
      taskConfirmed = true;
    }

    if (payload.kind === 'habit' && payload.habit_id) {
      // Same trust boundary as the streak branch: record_habit_completion() is
      // service_role-only, so the user id must come from the verified JWT, never the
      // body. The function records the completion AND advances the streak (a verified
      // habit is the day's check-in), so a StreakState comes back nested in the result.
      const { data: userData, error: userError } = await asUser.auth.getUser();
      if (userError || !userData.user) {
        return json({ status: 'error', message: 'Could not identify the caller' }, 401);
      }

      const admin = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
      const { data, error } = await admin.rpc('record_habit_completion', {
        p_user_id: userData.user.id,
        p_habit_id: payload.habit_id,
        p_note: verdict.evaluation_text,
      });

      if (error) {
        console.error('record_habit_completion failed:', error.message);
        return json({
          status: 'error',
          message: `Verified, but could not record the habit: ${error.message}`,
        }, 500);
      }
      habitConfirmed = true;
      streak = (data as { streak: StreakState } | null)?.streak ?? null;
    }

    if (payload.kind === 'streak') {
      // record_checkin() is service_role-only, so auth.uid() is null inside it and the
      // user id must be passed in. Resolve it from the verified JWT — never from the
      // request body, or a crafted payload could check in as somebody else.
      const { data: userData, error: userError } = await asUser.auth.getUser();
      if (userError || !userData.user) {
        return json({ status: 'error', message: 'Could not identify the caller' }, 401);
      }

      const admin = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
      const { data, error } = await admin.rpc('record_checkin', {
        p_user_id: userData.user.id,
        p_note: verdict.evaluation_text,
      });

      if (error) {
        console.error('record_checkin failed:', error.message);
        return json({
          status: 'error',
          message: `Verified, but could not record the check-in: ${error.message}`,
        }, 500);
      }
      streak = data as StreakState;
    }
  }

  return json({
    status: 'ok',
    task_confirmed: taskConfirmed,
    habit_confirmed: habitConfirmed,
    streak,
    ...verdict,
  }, 200);
});
