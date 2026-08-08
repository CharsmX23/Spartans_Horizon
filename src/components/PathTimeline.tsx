import { useState, FormEvent } from 'react';
import { Plus, Check, Trash2, Pencil, ChevronDown, ChevronUp } from 'lucide-react';
import {
  PathPhase, createPathPhase, updatePathPhase,
  deletePathPhase, movePhase, nextStatus, chainStartFrom,
} from '../lib/pathPhases';
import { TimelineNode, TimelineConnector, nodeAlignedLine } from './TimelineNode';

/**
 * The phase timeline for a learning path — the same idea, and deliberately the same
 * shape, as the phases under a mission on the home screen (`PhaseTimeline` in
 * LowerSections.tsx). The dot and the rail come from `TimelineNode`, shared by both, so
 * the two stay identical by construction rather than by anyone remembering to.
 *
 * ── This owns no chrome ────────────────────────────────────────────────────────
 * It renders as a hairline-separated block *inside* the path card, not as a panel of its
 * own: no border, no background, no radius, and no expand toggle. Since the modules and
 * tasks section was removed it is the entire body of an expanded path, and giving it a
 * card of its own would put a box inside a box for no reason.
 *
 * ── It does not fetch ──────────────────────────────────────────────────────────
 * `phases` arrives as a prop and `run` reloads through the page. It used to load for
 * itself, which was fine when the timeline was one section among several; it stopped
 * being fine when the path's percentage became `completed / total` phases, because that
 * number is on the collapsed row and cannot wait for a component that only mounts when
 * the card opens. One fetch, in `loadPaths()`, and no way for the two to disagree.
 *
 * ── The dot is the whole interaction ───────────────────────────────────────────
 * pending -> live -> completed -> pending, one click each, exactly like the mission
 * timeline. For a while it was not: completion needed a photo that Gemini accepted, the
 * dot could only reach `live`, and a camera button beside each row was the only way to
 * finish a phase. That is removed — a learning path is a personal plan, and marking your
 * own plan done is a checkbox, not a claim anyone else has to trust.
 *
 * The AI moved up to the path card as an advisor (the ✨ button in `PowerUpPage`): it
 * reads this whole timeline and returns coaching text, and it cannot change a status.
 * The per-phase coach button that used to live in this file is gone with it.
 *
 * Streak and habit proofs are unaffected and still require a photo — see `proof.ts`.
 */

const WARN = '#FF4D2E';

/** Flex gap of the phase list. The connector reads it to reach the next dot's centre. */
const PHASE_GAP = 10;

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

interface PathTimelineProps {
  pathId: string;
  phases: PathPhase[];
  isOwner: boolean;
  busy: boolean;
  run: (action: () => Promise<{ error: string | null }>) => Promise<boolean>;
}

export default function PathTimeline(props: PathTimelineProps) {
  const { pathId, phases, isOwner, busy, run } = props;

  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const nextOrder = phases.length > 0 ? Math.max(...phases.map((p) => p.order_index)) + 1 : 0;
  const doneCount = phases.filter((p) => p.status === 'completed').length;

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
          TIMELINE{phases.length > 0 ? ` · ${doneCount}/${phases.length}` : ''}
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

      {phases.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: PHASE_GAP }}>
          {phases.map((phase, index) => (
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
                isLast={index === phases.length - 1}
                isOwner={isOwner}
                busy={busy}
                onCycle={() => run(() => updatePathPhase(phase.id, { status: nextStatus(phase.status) }))}
                onEdit={() => { setEditingId(phase.id); setAdding(false); }}
                onMove={(dir) => run(() => movePhase(phases, phase.id, dir))}
                onDelete={() => {
                  if (!confirm(`Delete phase "${phase.title}"?`)) return;
                  void run(() => deletePathPhase(phase.id));
                }}
              />
            )
          ))}
        </div>
      )}

      {phases.length === 0 && !adding && (
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
            startDate: chainStartFrom(phases[phases.length - 1]) ?? '',
            targetDate: '',
          }}
          submitLabel="Add phase"
          onCancel={() => setAdding(false)}
          onSubmit={async (values) => {
            const ok = await run(() => createPathPhase({
              pathId,
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

function PhaseRow({
  phase, index, isFirst, isLast, isOwner, busy, onCycle, onEdit, onMove, onDelete,
}: {
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
  const range = formatRange(phase.start_date, phase.target_date);
  // Late is derived from the date, never stored — the same rule as a mission countdown.
  const late = !done && phase.target_date != null && new Date(`${phase.target_date}T23:59:59`) < new Date();

  return (
    // Top-aligned so the connector's start is a constant offset from the row's top edge;
    // `nodeAlignedLine` puts the title line back on the dot's centre.
    <div style={{ position: 'relative', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
      {!isLast && <TimelineConnector gap={PHASE_GAP} />}

      <TimelineNode
        status={phase.status}
        disabled={busy}
        interactive={isOwner}
        title={
          isOwner
            ? `Status: ${phase.status} — click to cycle pending → live → completed`
            : `Status: ${phase.status}`
        }
        onClick={onCycle}
      />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ ...nodeAlignedLine, gap: 8, flexWrap: 'wrap' }}>
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
      style={{ display: 'flex', flexDirection: 'column', gap: 7 }}
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
