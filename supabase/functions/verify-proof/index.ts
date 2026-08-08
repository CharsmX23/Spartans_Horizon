/**
 * verify-proof — Gemini for streak proofs, daily-habit proofs, and learning-path advice.
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
 * ── Two shapes of request, and only one of them writes ─────────────────────────
 *   'streak' / 'habit'  — a photo is judged. On `progress`, and only then, a
 *                         service_role RPC records the check-in or the habit completion.
 *                         These are claims about reality, so they stay photo-gated.
 *   'path_advice'       — no image at all. The typed timeline of a learning path goes in,
 *                         coaching text comes out. It writes NOTHING: there is no RPC
 *                         call on this branch and no code path from it to the database.
 *
 * ── What used to be here: `phase_review` ───────────────────────────────────────
 * A photo submitted against a learning-path phase was judged like any other proof, and on
 * a pass the function called `set_phase_verified()` to mark the phase completed — the only
 * route by which a phase could reach `completed`, with a trigger on `path_phases`
 * rejecting every other writer.
 *
 * Path phases are now completed by hand: the owner clicks the status dot, like the mission
 * timeline. So the branch, the RPC call, and `phase_confirmed` in the response are gone,
 * along with the trigger and the function itself
 * (`20260808120000_manual_phase_completion.sql`). The AI on that page advises instead of
 * gating, which is the `path_advice` branch below.
 *
 * The streak and habit branches were deliberately left byte-for-byte as they were.
 *
 * AUTH: `verify_jwt` stays ON (the default). Every write below goes through a
 * `service_role`-only RPC that takes the acting user as a parameter, and that parameter
 * is always read from the verified JWT (`asUser.auth.getUser()`) and never from the
 * request body — so a crafted payload cannot tick a habit or check in on behalf of
 * someone else. The RPCs re-check ownership themselves, because `service_role` bypasses
 * RLS.
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

/** Bounds on the advice payload, so a crafted body cannot build an unbounded prompt. */
const MAX_ADVICE_PHASES = 60;
const MAX_FIELD_CHARS = 400;

/** The kinds that judge a photo. `path_advice` is not one of them — it has no verdict. */
type ProofKind = 'streak' | 'habit';
type RequestKind = ProofKind | 'path_advice';

interface AdvicePhase {
  title: string;
  description?: string | null;
  status?: 'pending' | 'live' | 'completed';
  start_date?: string | null;
  target_date?: string | null;
}

interface VerifyRequest {
  /** Raw base64, no data: prefix. Required for 'streak' and 'habit'. */
  image_base64?: string;
  mime_type?: string;
  /** The goal or habit the photo is judged against. Not used by 'path_advice'. */
  context?: string;
  kind: RequestKind;
  /** Required when kind === 'habit' — the habit to record a completion for on a pass. */
  habit_id?: string;

  // ── kind === 'path_advice' only ──
  path?: {
    title: string;
    overview?: string | null;
    total_timeline_weeks?: number | null;
  };
  phases?: AdvicePhase[];
  /**
   * The caller's local date as YYYY-MM-DD, for "am I on track". Deliberately the client's
   * date rather than the server's: "behind schedule" is a statement about the user's
   * calendar, and this branch writes nothing, so a wrong date costs a wrong sentence of
   * advice and nothing else. Never use a client-supplied date on a branch that writes.
   */
  today?: string;

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

/** Coaching on a whole path. Four fields because four questions were asked of it. */
interface PathAdvice {
  /** Are these the right topics for the stated goal? */
  coverage: string;
  /** How is progress, given what is completed vs still open? */
  progress: string;
  /** On track against the dates and today? */
  timing: string;
  on_track: 'ahead' | 'on_track' | 'behind' | 'unknown';
  /** What to focus on next. */
  next: string;
}

type VerifyResponse =
  | ({ status: 'ok'; habit_confirmed: boolean; streak: StreakState | null } & Verdict)
  // Deliberately its own status rather than an `ok` with a null verdict: advice has no
  // verdict to accidentally read as a pass, and a client that has not been taught about
  // this branch falls into its error handling instead of its success handling.
  | { status: 'advice'; advice: PathAdvice }
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
function buildPrompt(context: string, kind: ProofKind): string {
  const subject = kind === 'habit'
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

function clip(value: unknown, limit = MAX_FIELD_CHARS): string {
  return typeof value === 'string' ? value.slice(0, limit) : '';
}

/** The timeline as the model sees it: one line per phase, in order, statuses included. */
function renderTimeline(phases: AdvicePhase[]): string {
  return phases.map((phase, index) => {
    const status = phase.status ?? 'pending';
    const dates = phase.start_date && phase.target_date
      ? ` (${phase.start_date} → ${phase.target_date})`
      : phase.target_date
      ? ` (due ${phase.target_date})`
      : phase.start_date
      ? ` (from ${phase.start_date})`
      : ' (no dates set)';
    const description = clip(phase.description) ? ` — ${clip(phase.description)}` : '';
    return `${index + 1}. [${status}] ${clip(phase.title, 160)}${description}${dates}`;
  }).join('\n');
}

/**
 * Path advice: no image, no verdict, no write.
 *
 * Replaces the per-phase coach review that used to hang off `phase_review`, and answers a
 * bigger question than that one could — a single phase in isolation cannot say whether the
 * plan covers the goal or whether the dates are slipping. The whole typed timeline goes in
 * at once.
 *
 * The prompt is written so a refusal is impossible to mistake for a completion: it is
 * asked for advice, it returns advice, and the caller has nowhere to put it but the screen.
 */
async function advise(
  apiKey: string,
  path: { title: string; overview?: string | null; total_timeline_weeks?: number | null },
  phases: AdvicePhase[],
  today: string,
): Promise<PathAdvice> {
  const done = phases.filter((p) => (p.status ?? 'pending') === 'completed').length;

  const prompt = [
    'You are coaching someone on a self-directed learning path. Below is the plan exactly',
    'as they typed it, with the status of each phase and today\'s date.',
    '',
    `GOAL: ${clip(path.title, 200)}`,
    path.overview ? `WHAT THEY WANT TO BE ABLE TO DO: ${clip(path.overview)}` : '',
    path.total_timeline_weeks ? `PLANNED LENGTH: ${path.total_timeline_weeks} weeks` : '',
    `TODAY: ${today}`,
    `PROGRESS: ${done} of ${phases.length} phases marked completed`,
    '',
    'PHASES, in order:',
    renderTimeline(phases),
    '',
    'Answer four things, each in two or three sentences, addressed directly to them:',
    '',
    'coverage — are these the right topics to actually reach that goal? Name anything',
    '  important that is missing, and anything here that is not worth the time. Be specific',
    '  about this subject matter; generic study advice is useless.',
    '',
    'progress — how are they doing, judging by what is completed against what is left?',
    '',
    'timing — are they on track? Reason from the phase dates against today. Say plainly if',
    '  they are behind, and by roughly how much. If there are no dates, say that instead of',
    '  guessing.',
    '',
    'next — the single thing to focus on next, and why that one.',
    '',
    'Also return on_track as exactly one of: ahead, on_track, behind, unknown.',
    'Use unknown when there are not enough dates to judge.',
    '',
    'Be honest rather than encouraging. If the plan is thin or the pace has slipped, say',
    'so. Do not invent detail that is not in the plan above.',
  ].filter(Boolean).join('\n');

  const response = await fetch(`${GEMINI_API_BASE}/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.6,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            coverage: { type: 'STRING' },
            progress: { type: 'STRING' },
            timing: { type: 'STRING' },
            on_track: { type: 'STRING', enum: ['ahead', 'on_track', 'behind', 'unknown'] },
            next: { type: 'STRING' },
          },
          required: ['coverage', 'progress', 'timing', 'on_track', 'next'],
        },
      },
    }),
  });

  if (!response.ok) {
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

  const candidate = parsed as Partial<PathAdvice>;
  for (const field of ['coverage', 'progress', 'timing', 'next'] as const) {
    if (typeof candidate[field] !== 'string' || candidate[field]!.trim() === '') {
      throw new Error(`Gemini returned an empty ${field}`);
    }
  }
  const onTrack = candidate.on_track;
  return {
    coverage: candidate.coverage!.trim(),
    progress: candidate.progress!.trim(),
    timing: candidate.timing!.trim(),
    // Unrecognised falls back to `unknown` rather than throwing: the three paragraphs are
    // the substance and a bad enum should not throw them away. This is advice, so
    // degrading is correct here — a verdict would have to fail closed instead.
    on_track: onTrack === 'ahead' || onTrack === 'on_track' || onTrack === 'behind'
      ? onTrack
      : 'unknown',
    next: candidate.next!.trim(),
  };
}

/** Calls Gemini with a response schema so the output shape is constrained, not hoped for. */
async function evaluate(
  apiKey: string,
  imageBase64: string,
  mimeType: string,
  context: string,
  kind: ProofKind,
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

  // ── Path advice: text in, text out, nothing written ────────────────────────
  // Returns before any of the verification machinery below is reached. There is no RPC
  // call on this branch and nothing for one to fall through into — advice must never be
  // able to complete work.
  if (payload.kind === 'path_advice') {
    const path = payload.path;
    const phases = payload.phases;
    if (!path?.title || !Array.isArray(phases)) {
      return json({ status: 'error', message: 'path and phases are required' }, 400);
    }
    if (phases.length === 0) {
      return json({ status: 'error', message: 'Add a phase before asking for advice.' }, 400);
    }
    if (phases.length > MAX_ADVICE_PHASES) {
      return json({ status: 'error', message: `At most ${MAX_ADVICE_PHASES} phases.` }, 413);
    }

    // A malformed date would end up in the prompt verbatim; keep it to the one shape the
    // prompt claims it is, and fall back to the server's date rather than rejecting.
    const today = /^\d{4}-\d{2}-\d{2}$/.test(payload.today ?? '')
      ? payload.today!
      : new Date().toISOString().slice(0, 10);

    try {
      const advice = await advise(apiKey, path, phases, today);
      return json({ status: 'advice', advice }, 200);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Path advice failed';
      console.error('verify-proof path advice failed:', message);
      return json({ status: 'error', message }, 502);
    }
  }

  if (!payload.context) {
    return json({ status: 'error', message: 'context is required' }, 400);
  }

  if (!payload.image_base64 || !payload.mime_type) {
    return json({
      status: 'error',
      message: 'image_base64 and mime_type are required',
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
      payload.kind === 'habit' ? 'habit' : 'streak',
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Verification failed';
    console.error('verify-proof evaluation failed:', message);
    return json({ status: 'error', message }, 502);
  }

  // The image has served its purpose; nothing below this line touches it.

  let habitConfirmed = false;
  let streak: StreakState | null = null;

  if (verdict.verdict === 'progress') {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return json({ status: 'error', message: 'Missing Authorization header' }, 401);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;

    // Anon key + the caller's JWT. Used only to resolve *who is calling*; every write
    // below runs through the admin client, because the RPCs are service_role-only.
    const asUser = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });

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
    habit_confirmed: habitConfirmed,
    streak,
    ...verdict,
  }, 200);
});
