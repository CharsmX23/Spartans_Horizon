import { useCallback, useEffect, useState } from 'react';
import {
  Plus, X, Trash2, ChevronDown, ChevronRight, BookMarked, Clock, Users, Lock,
  Sparkles, Loader2,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { LearningPath, loadPaths, createPath, deletePath, pathProgress } from '../lib/learning';
import { bumpXp } from '../lib/xp';
import { PathAdvice, requestPathAdvice } from '../lib/pathAdvice';
import PathTimeline from './PathTimeline';

/**
 * Power Up — learning paths and the phase timeline underneath each one.
 *
 * ── What used to be here ───────────────────────────────────────────────────────
 * A path owned `modules -> tasks`, and separately a phase timeline. Two hierarchies
 * describing the same work in the same card, in two different vocabularies: a module was
 * a stage of the path, and so was a phase. Both tables are dropped
 * (`20260807120000_drop_learning_modules_tasks.sql`); the timeline is what remains,
 * because it is the one already shared with missions on the home screen.
 *
 * An expanded path is now: description, timeframe, percentage, timeline. Nothing else.
 *
 * ── Progress is self-reported, deliberately ────────────────────────────────────
 * The percentage is `completed phases / total phases`, derived on every render, stored
 * nowhere. The owner marks a phase done by clicking its status dot — no photo, no gate.
 *
 * It briefly worked the other way: a phase reached `completed` only through a photo
 * Gemini accepted, with a trigger on `path_phases` rejecting every other writer. That came
 * out in `20260808120000_manual_phase_completion.sql`. A learning path is a private plan
 * you are keeping for yourself, and needing to photograph your own to-do list to tick it
 * off is friction bought with nothing. The daily streak is the opposite case — it is shown
 * to squadmates as a claim about what happened — and it stays photo-verified.
 *
 * ── The AI advises, and cannot act ─────────────────────────────────────────────
 * The ✨ button on a card sends the whole typed timeline — titles, descriptions, dates,
 * statuses — and gets back coaching: whether these are the right topics for the goal, how
 * progress reads, whether the dates are slipping against today, and what to do next. It
 * writes nothing anywhere, and there is no branch from it to a status. See `pathAdvice.ts`.
 *
 * Squadmates' paths are visible but read-only. RLS and the column grants enforce that;
 * the UI only reflects it.
 *
 * ── One card per path ──────────────────────────────────────────────────────────
 * A collapsed row that expands in place — the same gesture and the same shape as a
 * mission card on the home screen. There is no "selected" path, only an expanded one.
 */

const ADVISOR = '#A78BFA';

const panel: React.CSSProperties = {
  background: 'rgba(255,255,255,0.045)',
  border: '1px solid rgba(255,255,255,0.10)',
  borderRadius: 16,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.10)',
  borderRadius: 10,
  padding: '8px 10px',
  color: '#fff',
  fontSize: 13,
  outline: 'none',
};

type Run = (action: () => Promise<{ error: string | null }>) => Promise<boolean>;

/** Advice for one path, success or failure. Local only — nothing here was persisted. */
type AdviceState = { pathId: string; advice: PathAdvice | null; message: string | null };

export default function PowerUpPage() {
  const { user } = useAuth();
  const myId = user?.id ?? null;

  const [paths, setPaths] = useState<LearningPath[]>([]);
  const [owners, setOwners] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [showNewPath, setShowNewPath] = useState(false);
  // Which path is open. One at a time, so the list stays scannable.
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // The advisor writes nothing, so this state is the entire lifetime of a result:
  // dismissing it, or asking again, is the only thing that ends it. One at a time —
  // advice is read in the card it belongs to.
  const [advisingId, setAdvisingId] = useState<string | null>(null);
  const [advice, setAdvice] = useState<AdviceState | null>(null);

  const load = useCallback(async () => {
    const { data, error: loadError } = await loadPaths();
    if (loadError) {
      setError(loadError);
      setLoading(false);
      return;
    }
    const rows = data ?? [];
    setPaths(rows);
    // A path that vanished (deleted here or by its owner) must not leave the page
    // holding an id that no longer resolves.
    setExpandedId((current) => (current && rows.some((p) => p.id === current) ? current : null));
    setAdvice((current) => (current && rows.some((p) => p.id === current.pathId) ? current : null));

    // Squadmates' usernames, for attribution on shared paths.
    const otherIds = [...new Set(rows.map((p) => p.user_id))].filter((id) => id !== myId);
    if (otherIds.length > 0) {
      const { data: people } = await supabase.from('users').select('id, username').in('id', otherIds);
      if (people) setOwners(Object.fromEntries(people.map((p) => [p.id, p.username as string])));
    }
    setLoading(false);
  }, [myId]);

  useEffect(() => { void load(); }, [load]);

  /** Every mutation funnels through here so failures surface instead of dying silently. */
  const run = useCallback<Run>(async (action) => {
    setBusy(true);
    setError(null);
    const { error: actionError } = await action();
    if (actionError) setError(actionError);
    else await load();
    setBusy(false);
    return !actionError;
  }, [load]);

  /**
   * Ask the advisor about a path. Opens the card first — the answer is several paragraphs
   * and belongs next to the timeline it is describing, not floating above a collapsed row.
   */
  const advise = useCallback(async (path: LearningPath) => {
    setExpandedId(path.id);
    setAdvice(null);
    setAdvisingId(path.id);
    const result = await requestPathAdvice(path);
    setAdvisingId(null);
    setAdvice({
      pathId: path.id,
      advice: result.ok ? result.advice : null,
      message: result.ok ? null : result.message,
    });
  }, []);

  if (loading) {
    return <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13, padding: 24 }}>Loading paths…</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <header style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <h1 style={{ color: '#fff', fontSize: 22, fontWeight: 700, margin: 0 }}>Power Up</h1>
          <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13, marginTop: 3 }}>
            Break a goal into phases and tick them off as you go. Ask the advisor how the plan is holding up.
          </p>
        </div>
        <button
          onClick={() => setShowNewPath(true)}
          style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px',
            borderRadius: 11, background: 'var(--accent)', color: '#fff',
            fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer', flexShrink: 0,
          }}
        >
          <Plus className="w-4 h-4" /> New Path
        </button>
      </header>

      {error && (
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: 8,
          fontSize: 12, color: '#fca5a5', background: 'rgba(239,68,68,0.10)',
          border: '1px solid rgba(239,68,68,0.30)', borderRadius: 10, padding: '8px 12px',
        }}>
          <span style={{ flex: 1 }}>{error}</span>
          <button onClick={() => setError(null)} style={{ background: 'none', border: 'none', color: '#fca5a5', cursor: 'pointer' }}>
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {showNewPath && (
        <NewPathForm
          busy={busy}
          onCancel={() => setShowNewPath(false)}
          onSubmit={async (values) => {
            // Every path starts collapsed, including a brand new one — opening a card is
            // always a deliberate press, never something the page does on your behalf.
            const ok = await run(() => createPath(values));
            if (ok) setShowNewPath(false);
          }}
        />
      )}

      {paths.length === 0 && !showNewPath && (
        <div style={{ ...panel, padding: 40, textAlign: 'center' }}>
          <BookMarked className="w-8 h-8" style={{ color: 'rgba(255,255,255,0.25)', margin: '0 auto 12px' }} />
          <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: 15, fontWeight: 600 }}>No learning paths yet</div>
          <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 12, marginTop: 4 }}>
            Create one to start tracking phases.
          </p>
        </div>
      )}

      {paths.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {paths.map((p) => (
            <PathCard
              key={p.id}
              path={p}
              isOwner={p.user_id === myId}
              ownerName={owners[p.user_id]}
              expanded={expandedId === p.id}
              onToggle={() => setExpandedId((current) => (current === p.id ? null : p.id))}
              busy={busy}
              run={run}
              advising={advisingId === p.id}
              advice={advice?.pathId === p.id ? advice : null}
              onAdvise={() => void advise(p)}
              onDismissAdvice={() => setAdvice(null)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────── Path card ───────────────────────────
 * The only representation of a path on this page. Collapsed it is a single row — chevron,
 * title, progress — and pressing anywhere on that row expands it in place to reveal the
 * rest: overview, timeframe, progress bar, and the phase timeline. Deliberately the same
 * gesture and the same anatomy as a mission card on the home screen, so moving between
 * the two teaches you nothing new.
 */

interface PathCardProps {
  path: LearningPath;
  isOwner: boolean;
  ownerName?: string;
  expanded: boolean;
  onToggle: () => void;
  busy: boolean;
  run: Run;
  advising: boolean;
  advice: AdviceState | null;
  onAdvise: () => void;
  onDismissAdvice: () => void;
}

function PathCard(props: PathCardProps) {
  const {
    path, isOwner, ownerName, expanded, onToggle, busy, run,
    advising, advice, onAdvise, onDismissAdvice,
  } = props;

  const { done, total, percent } = pathProgress(path);

  return (
    <section style={{
      ...panel,
      padding: expanded ? 16 : 12,
      background: expanded ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.04)',
      border: `1px solid ${expanded ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.10)'}`,
      transition: 'background .2s ease, border-color .2s ease',
    }}>
      {/* ── The collapsed row ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button
          onClick={onToggle}
          title={expanded ? 'Collapse path' : 'Expand path'}
          style={{
            width: 28, height: 28, borderRadius: 9, display: 'grid', placeItems: 'center',
            flexShrink: 0, cursor: 'pointer',
            background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)',
            color: 'rgba(255,255,255,0.7)',
          }}
        >
          {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </button>

        {/* The whole row is the toggle, like a mission card — the chevron is the
            affordance, not the only target. */}
        <button
          onClick={onToggle}
          style={{
            flex: 1, minWidth: 0, textAlign: 'left', background: 'none', border: 'none',
            padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
          }}
        >
          {!isOwner && <Users className="w-3.5 h-3.5" style={{ color: 'rgba(255,255,255,0.5)', flexShrink: 0 }} />}
          <span style={{
            fontSize: expanded ? 15 : 13, fontWeight: 600,
            color: expanded ? '#fff' : 'rgba(255,255,255,0.8)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            transition: 'font-size .15s ease',
          }}>
            {path.title}
          </span>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', flexShrink: 0 }}>
            {isOwner ? `${percent}%` : `@${ownerName ?? '…'}`}
          </span>
        </button>

        {isOwner && (
          <>
            {/* The advisor. Reads the timeline, returns text, changes nothing. Disabled
                with no phases because there would be no plan to have an opinion about. */}
            <button
              onClick={onAdvise}
              disabled={advising || total === 0}
              title={total === 0 ? 'Add a phase first' : 'Ask the AI advisor about this path'}
              style={{
                width: 28, height: 28, display: 'grid', placeItems: 'center', borderRadius: 9,
                background: 'rgba(139,92,246,0.12)', border: '1px solid rgba(139,92,246,0.30)',
                color: ADVISOR, flexShrink: 0,
                cursor: advising || total === 0 ? 'not-allowed' : 'pointer',
                opacity: advising || total === 0 ? 0.4 : 1,
              }}
            >
              {advising
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <Sparkles className="w-3.5 h-3.5" />}
            </button>

            <button
              onClick={async () => {
                if (!confirm(`Delete "${path.title}" and all its phases?`)) return;
                const ok = await run(() => deletePath(path.id));
                // The phases cascade-delete with the path, and each completed one revokes
                // its 100 XP on the way out — so this can move the header by a lot at once.
                if (ok) bumpXp();
              }}
              disabled={busy}
              title="Delete path"
              style={{
                width: 28, height: 28, display: 'grid', placeItems: 'center', borderRadius: 9,
                background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.25)',
                color: '#fca5a5', cursor: 'pointer', flexShrink: 0,
              }}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </>
        )}
      </div>

      {/* ── Everything else, in place ── */}
      {expanded && (
        <div style={{ display: 'flex', flexDirection: 'column', marginTop: 12 }}>
          {!isOwner && (
            <span style={{
              display: 'inline-flex', alignSelf: 'flex-start', alignItems: 'center', gap: 4,
              fontSize: 10, color: 'rgba(255,255,255,0.5)', background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.10)', borderRadius: 999, padding: '2px 8px',
            }}>
              <Lock className="w-3 h-3" /> @{ownerName ?? 'squadmate'} · read-only
            </span>
          )}

          {path.overview && (
            <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, marginTop: 6, maxWidth: 680 }}>
              {path.overview}
            </p>
          )}

          <div style={{ display: 'flex', gap: 14, marginTop: 10, fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>
            {path.total_timeline_weeks && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <Clock className="w-3.5 h-3.5" /> {path.total_timeline_weeks} weeks
              </span>
            )}
            <span>{done}/{total} phases done</span>
          </div>

          <div style={{
            height: 6, borderRadius: 999, marginTop: 12,
            background: 'rgba(255,255,255,0.07)', overflow: 'hidden',
          }}>
            <div style={{ width: `${percent}%`, height: '100%', background: 'var(--accent)', transition: 'width .3s' }} />
          </div>

          {advice && <AdvicePanel state={advice} onDismiss={onDismissAdvice} />}

          {/* Draws its own hairline separator and no chrome of its own — it reads as the
              body of this card, exactly as the phase list does on a mission card. */}
          <PathTimeline
            pathId={path.id}
            phases={path.phases}
            isOwner={isOwner}
            busy={busy}
            run={run}
          />
        </div>
      )}
    </section>
  );
}

/* ─────────────────────────── Advisor panel ───────────────────────────
 * Advice, not a record. Nothing in here was written anywhere and dismissing it is the only
 * thing that ends it — the same contract the per-phase coach had before it, stated in the
 * component so it stays true if this moves.
 */

const ON_TRACK_LABEL: Record<PathAdvice['on_track'], { text: string; color: string; background: string }> = {
  ahead:     { text: 'AHEAD',      color: '#86efac', background: 'rgba(52,211,153,0.12)' },
  on_track:  { text: 'ON TRACK',   color: '#86efac', background: 'rgba(52,211,153,0.12)' },
  behind:    { text: 'BEHIND',     color: '#FF4D2E', background: 'rgba(255,77,46,0.12)' },
  unknown:   { text: 'NO DATES',   color: 'rgba(255,255,255,0.5)', background: 'rgba(255,255,255,0.06)' },
};

function AdvicePanel({ state, onDismiss }: { state: AdviceState; onDismiss: () => void }) {
  const failed = state.advice === null;
  const badge = state.advice ? ON_TRACK_LABEL[state.advice.on_track] : null;

  return (
    <div style={{
      display: 'flex', gap: 8, marginTop: 12, padding: '11px 13px', borderRadius: 12,
      background: failed ? 'rgba(239,68,68,0.08)' : 'rgba(139,92,246,0.08)',
      border: `1px solid ${failed ? 'rgba(239,68,68,0.25)' : 'rgba(139,92,246,0.20)'}`,
    }}>
      <Sparkles
        className="w-3.5 h-3.5"
        style={{ color: failed ? '#fca5a5' : ADVISOR, flexShrink: 0, marginTop: 2 }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span className="tracked-sm" style={{
            fontSize: 9, fontWeight: 700, color: failed ? '#fca5a5' : ADVISOR,
          }}>
            {failed ? 'ADVISOR UNAVAILABLE' : 'PATH ADVISOR'}
          </span>
          {badge && (
            <span style={{
              fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', borderRadius: 999,
              padding: '2px 7px', color: badge.color, background: badge.background,
            }}>
              {badge.text}
            </span>
          )}
        </div>

        {failed ? (
          <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12, marginTop: 4, lineHeight: 1.5 }}>
            {state.message}
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 }}>
            <AdviceSection label="Topics" body={state.advice!.coverage} />
            <AdviceSection label="Progress" body={state.advice!.progress} />
            <AdviceSection label="Timing" body={state.advice!.timing} />
            <AdviceSection label="Focus next" body={state.advice!.next} />
          </div>
        )}
      </div>
      <button
        onClick={onDismiss}
        title="Dismiss"
        style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', padding: 0, alignSelf: 'flex-start' }}
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}

function AdviceSection({ label, body }: { label: string; body: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.45)' }}>{label}</div>
      <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12, marginTop: 1, lineHeight: 1.55 }}>
        {body}
      </p>
    </div>
  );
}

/* ───────────────────────────── Forms ───────────────────────────── */

function NewPathForm({ busy, onCancel, onSubmit }: {
  busy: boolean;
  onCancel: () => void;
  onSubmit: (values: { title: string; overview: string; total_timeline_weeks: number | null }) => void;
}) {
  const [title, setTitle] = useState('');
  const [overview, setOverview] = useState('');
  const [weeks, setWeeks] = useState('');

  return (
    <section style={{ ...panel, padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ color: '#fff', fontSize: 14, fontWeight: 600 }}>New learning path</div>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Goal — e.g. Learn reverse engineering"
        style={inputStyle}
        autoFocus
      />
      <textarea
        value={overview}
        onChange={(e) => setOverview(e.target.value)}
        placeholder="Overview — what you'll be able to do at the end"
        rows={2}
        style={{ ...inputStyle, resize: 'vertical' }}
      />
      <input
        value={weeks}
        onChange={(e) => setWeeks(e.target.value.replace(/[^0-9]/g, ''))}
        placeholder="Timeline in weeks (optional)"
        inputMode="numeric"
        style={{ ...inputStyle, width: 220 }}
      />
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={() => onSubmit({
            title,
            overview,
            total_timeline_weeks: weeks ? Number(weeks) : null,
          })}
          disabled={busy || !title.trim()}
          style={{
            padding: '8px 16px', borderRadius: 10, border: 'none',
            background: 'var(--accent)', color: '#fff', fontSize: 13, fontWeight: 600,
            cursor: busy || !title.trim() ? 'not-allowed' : 'pointer',
            opacity: busy || !title.trim() ? 0.5 : 1,
          }}
        >
          {busy ? 'Saving…' : 'Create Path'}
        </button>
        <button
          onClick={onCancel}
          style={{
            padding: '8px 16px', borderRadius: 10, cursor: 'pointer',
            background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)',
            color: 'rgba(255,255,255,0.6)', fontSize: 13,
          }}
        >
          Cancel
        </button>
      </div>
    </section>
  );
}
