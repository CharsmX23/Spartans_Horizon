import { useCallback, useEffect, useState, FormEvent } from 'react';
import { Plus, X, Check, Trash2, Pencil, ChevronDown, ChevronUp } from 'lucide-react';
import { LearningPath } from '../lib/learning';
import {
  PathPhase, PhaseStatus, loadPathPhases, createPathPhase, updatePathPhase,
  deletePathPhase, movePhase, nextStatus, chainStartFrom,
} from '../lib/pathPhases';

/**
 * The phase timeline for a learning path — the same idea, and deliberately the same
 * shape, as the phases under a mission on the home screen (`PhaseTimeline` in
 * LowerSections.tsx). What it adds is a date range, a note, reordering, and editing in
 * place rather than only add and delete.
 *
 * ── This owns no chrome ────────────────────────────────────────────────────────
 * It renders as a hairline-separated block *inside* the path card, not as a panel of its
 * own: no border, no background, no radius, and no expand toggle. `PathRow` decides when
 * it is mounted, so when a path is collapsed nothing here exists — no load, no error
 * banner, no Add-phase button. Give it a card of its own and it stops reading as part of
 * the path and starts competing with it.
 *
 * Phases are typed in by hand, in order: "Prototyping", "Evaluation". Each new one picks
 * up where the last one left off — `chainStartFrom` prefills its start as the day after
 * the previous phase's target — so a chain entered as a series of end dates still reads
 * as continuous work rather than as disconnected milestones.
 *
 * Status is a single-click cycle on the dot (pending -> live -> completed), the same
 * gesture as a mission phase, so there is nothing new to learn moving between the two.
 * Squadmates can see a path's phases but not touch them; `isOwner` hides the controls
 * and the grants in the migration are what actually enforce it.
 */

const PHASE_COLORS: Record<PhaseStatus, string> = {
  pending: 'rgba(255,255,255,0.25)',
  live: 'var(--accent)',
  completed: '#34D399',
};

const WARN = '#FF4D2E';

const field: React.CSSProperties = {
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.10)',
  borderRadius: 9,
  padding: '7px 9px',
  color: '#fff',
  fontSize: 12,
  outline: 'none',
};

interface PhaseValues {
  title: string;
  description: string;
  startDate: string;
  targetDate: string;
}

export default function PathTimeline({ path, isOwner }: { path: LearningPath; isOwner: boolean }) {
  const [phases, setPhases] = useState<PathPhase[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error: loadError } = await loadPathPhases(path.id);
    if (loadError) { setError(loadError); setPhases([]); return; }
    setPhases(data ?? []);
  }, [path.id]);

  useEffect(() => { void load(); }, [load]);

  async function run(action: () => Promise<{ error: string | null }>) {
    setBusy(true);
    setError(null);
    const { error: actionError } = await action();
    if (actionError) setError(actionError);
    else await load();
    setBusy(false);
    return !actionError;
  }

  const list = phases ?? [];
  const nextOrder = list.length > 0 ? Math.max(...list.map((p) => p.order_index)) + 1 : 0;
  const doneCount = list.filter((p) => p.status === 'completed').length;

  return (
    <div style={{
      marginTop: 12,
      paddingTop: 10,
      borderTop: '1px solid rgba(255,255,255,0.06)',
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span className="tracked-sm" style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>
          TIMELINE{list.length > 0 ? ` · ${doneCount}/${list.length}` : ''}
        </span>
        {isOwner && !adding && (
          <button
            onClick={() => { setAdding(true); setEditingId(null); }}
            style={{
              display: 'flex', alignItems: 'center', gap: 5, background: 'none', border: 'none',
              color: 'rgba(255,255,255,0.5)', fontSize: 10, cursor: 'pointer', padding: 0,
            }}
          >
            <Plus className="w-3 h-3" /> Add phase
          </button>
        )}
      </div>

      {error && (
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 11,
          color: '#fca5a5', background: 'rgba(239,68,68,0.10)',
          border: '1px solid rgba(239,68,68,0.30)', borderRadius: 10, padding: '7px 10px',
        }}>
          <span style={{ flex: 1 }}>{error}</span>
          <button onClick={() => setError(null)} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }}>
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {phases === null && (
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>Loading phases…</div>
      )}

      {list.length > 0 && (
        <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 10, paddingLeft: 2 }}>
          {/* The rail that makes the phases read as one chain rather than a list. */}
          <span style={{
            position: 'absolute', left: 10, top: 8, bottom: 8, width: 1,
            background: 'rgba(255,255,255,0.10)',
          }} />

          {list.map((phase, index) => (
            editingId === phase.id ? (
              <PhaseForm
                key={phase.id}
                busy={busy}
                initial={{
                  title: phase.title,
                  description: phase.description ?? '',
                  startDate: phase.start_date ?? '',
                  targetDate: phase.target_date ?? '',
                }}
                submitLabel="Save"
                onCancel={() => setEditingId(null)}
                onSubmit={async (values) => {
                  const ok = await run(() => updatePathPhase(phase.id, {
                    title: values.title,
                    description: values.description,
                    start_date: values.startDate || null,
                    target_date: values.targetDate || null,
                  }));
                  if (ok) setEditingId(null);
                }}
              />
            ) : (
              <PhaseRow
                key={phase.id}
                phase={phase}
                index={index}
                isFirst={index === 0}
                isLast={index === list.length - 1}
                isOwner={isOwner}
                busy={busy}
                onCycle={() => run(() => updatePathPhase(phase.id, { status: nextStatus(phase.status) }))}
                onEdit={() => { setEditingId(phase.id); setAdding(false); }}
                onMove={(dir) => run(() => movePhase(list, phase.id, dir))}
                onDelete={() => {
                  if (!confirm(`Delete phase "${phase.title}"?`)) return;
                  void run(() => deletePathPhase(phase.id));
                }}
              />
            )
          ))}
        </div>
      )}

      {phases !== null && list.length === 0 && !adding && (
        <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11 }}>
          {isOwner
            ? 'No phases yet — break this path into stages like Prototyping, then Evaluation.'
            : 'No phases yet.'}
        </p>
      )}

      {adding && isOwner && (
        <PhaseForm
          busy={busy}
          // Picks up where the last phase ends, so a chain stays continuous without
          // retyping dates. Still editable before saving.
          initial={{
            title: '',
            description: '',
            startDate: chainStartFrom(list[list.length - 1]) ?? '',
            targetDate: '',
          }}
          submitLabel="Add phase"
          onCancel={() => setAdding(false)}
          onSubmit={async (values) => {
            const ok = await run(() => createPathPhase({
              pathId: path.id,
              title: values.title,
              description: values.description,
              startDate: values.startDate || null,
              targetDate: values.targetDate || null,
              orderIndex: nextOrder,
            }));
            if (ok) setAdding(false);
          }}
        />
      )}
    </div>
  );
}

/* ────────────────────────── Phase row ────────────────────────── */

function PhaseRow({ phase, index, isFirst, isLast, isOwner, busy, onCycle, onEdit, onMove, onDelete }: {
  phase: PathPhase;
  index: number;
  isFirst: boolean;
  isLast: boolean;
  isOwner: boolean;
  busy: boolean;
  onCycle: () => void;
  onEdit: () => void;
  onMove: (direction: -1 | 1) => void;
  onDelete: () => void;
}) {
  const done = phase.status === 'completed';
  const dotColor = PHASE_COLORS[phase.status];
  const range = formatRange(phase.start_date, phase.target_date);
  // Late is derived from the date, never stored — the same rule as a mission countdown.
  const late = !done && phase.target_date != null && new Date(`${phase.target_date}T23:59:59`) < new Date();

  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
      <button
        onClick={onCycle}
        disabled={busy || !isOwner}
        title={isOwner ? `Status: ${phase.status} — click to advance` : `Status: ${phase.status}`}
        style={{
          position: 'relative', zIndex: 1, width: 19, height: 19, borderRadius: '50%',
          display: 'grid', placeItems: 'center', flexShrink: 0, marginTop: 1,
          cursor: isOwner ? 'pointer' : 'default',
          background: phase.status === 'pending' ? '#14141a' : dotColor,
          border: `1.5px solid ${phase.status === 'pending' ? 'rgba(255,255,255,0.25)' : dotColor}`,
          boxShadow: phase.status === 'live' ? `0 0 9px -1px ${dotColor}` : undefined,
        }}
      >
        {done && <Check className="w-2.5 h-2.5" style={{ color: 'rgba(0,0,0,0.8)' }} />}
      </button>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', fontWeight: 700 }}>
            {String(index + 1).padStart(2, '0')}
          </span>
          <span style={{
            fontSize: 13,
            color: done ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.85)',
            textDecoration: done ? 'line-through' : 'none',
          }}>
            {phase.title}
          </span>
          {range && (
            <span style={{
              fontSize: 10, color: late ? WARN : 'rgba(255,255,255,0.4)',
              background: late ? 'rgba(255,77,46,0.10)' : 'rgba(255,255,255,0.05)',
              border: `1px solid ${late ? 'rgba(255,77,46,0.30)' : 'rgba(255,255,255,0.08)'}`,
              borderRadius: 999, padding: '2px 8px',
            }}>
              {range}{late ? ' · late' : ''}
            </span>
          )}
        </div>

        {phase.description && (
          <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12, marginTop: 4, lineHeight: 1.5 }}>
            {phase.description}
          </p>
        )}
      </div>

      {isOwner && (
        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
          <RowButton title="Move up" disabled={busy || isFirst} onClick={() => onMove(-1)}>
            <ChevronUp className="w-3 h-3" />
          </RowButton>
          <RowButton title="Move down" disabled={busy || isLast} onClick={() => onMove(1)}>
            <ChevronDown className="w-3 h-3" />
          </RowButton>
          <RowButton title="Edit phase" disabled={busy} onClick={onEdit}>
            <Pencil className="w-3 h-3" />
          </RowButton>
          <RowButton title="Delete phase" danger disabled={busy} onClick={onDelete}>
            <Trash2 className="w-3 h-3" />
          </RowButton>
        </div>
      )}
    </div>
  );
}

/* ────────────────────────── Phase form ────────────────────────── */

function PhaseForm({ busy, initial, submitLabel, onCancel, onSubmit }: {
  busy: boolean;
  initial: PhaseValues;
  submitLabel: string;
  onCancel: () => void;
  onSubmit: (values: PhaseValues) => void;
}) {
  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description);
  const [startDate, setStartDate] = useState(initial.startDate);
  const [targetDate, setTargetDate] = useState(initial.targetDate);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    onSubmit({ title, description, startDate, targetDate });
  }

  return (
    <form
      onSubmit={submit}
      // No container of its own — the fields sit directly in the card, like the phase
      // form on a mission card.
      style={{ display: 'flex', flexDirection: 'column', gap: 7, paddingLeft: 2 }}
    >
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value.slice(0, 120))}
        placeholder="Phase — e.g. Prototyping"
        autoFocus
        style={field}
      />
      <input
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="What happens in this phase (optional)"
        style={field}
      />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <label style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>
          Starts
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            style={{ ...field, colorScheme: 'dark', marginLeft: 6, width: 148 }}
          />
        </label>
        <label style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>
          Ends
          <input
            type="date"
            value={targetDate}
            onChange={(e) => setTargetDate(e.target.value)}
            style={{ ...field, colorScheme: 'dark', marginLeft: 6, width: 148 }}
          />
        </label>
        <div style={{ flex: 1 }} />
        <button
          type="submit"
          disabled={busy || !title.trim()}
          style={{
            display: 'flex', alignItems: 'center', gap: 5, padding: '7px 13px',
            borderRadius: 9, border: 'none', background: 'var(--accent)', color: '#fff',
            fontSize: 12, fontWeight: 600,
            cursor: busy || !title.trim() ? 'not-allowed' : 'pointer',
            opacity: busy || !title.trim() ? 0.5 : 1,
          }}
        >
          <Check className="w-3 h-3" /> {busy ? 'Saving…' : submitLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          style={{
            padding: '7px 12px', borderRadius: 9, cursor: 'pointer',
            background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)',
            color: 'rgba(255,255,255,0.6)', fontSize: 12,
          }}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function RowButton({ children, onClick, disabled, danger, title }: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  title: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        width: 24, height: 24, display: 'grid', placeItems: 'center', borderRadius: 7,
        cursor: disabled ? 'not-allowed' : 'pointer',
        background: danger ? 'rgba(239,68,68,0.10)' : 'rgba(255,255,255,0.05)',
        border: `1px solid ${danger ? 'rgba(239,68,68,0.25)' : 'rgba(255,255,255,0.10)'}`,
        color: danger ? '#fca5a5' : 'rgba(255,255,255,0.55)',
        opacity: disabled ? 0.35 : 1,
      }}
    >
      {children}
    </button>
  );
}

/** "3 Mar → 12 Apr", or just one end when that is all there is. */
function formatRange(start: string | null, target: string | null): string | null {
  const fmt = (iso: string) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

  if (start && target) return `${fmt(start)} → ${fmt(target)}`;
  if (target) return `by ${fmt(target)}`;
  if (start) return `from ${fmt(start)}`;
  return null;
}
