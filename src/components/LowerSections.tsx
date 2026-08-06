import { useCallback, useEffect, useState, FormEvent } from 'react';
import { Rocket, Plus, X, Trash2, Pencil, Check, ChevronDown } from 'lucide-react';
import {
  Mission, loadMissions, createMission, updateMission, deleteMission,
  deadlineLabel, deadlineColor,
} from '../lib/missions';
import {
  MissionPhase, loadPhases, createPhase, updatePhase, deletePhase, nextStatus,
} from '../lib/missionPhases';
import { TimelineNode, TimelineConnector, nodeAlignedLine } from './TimelineNode';

/* ── Next Missions ──────────────────────────────────────────────────────── */
/**
 * Real, private, user-entered missions. Title + deadline only.
 *
 * No priority badge and no progress bar: those columns exist but hold nothing, and
 * rendering a fabricated "78% CRITICAL" would be a signal that means nothing. The
 * coloured countdown is derived from the actual date, so it is real.
 */
export function NextMissions({ compact }: { compact?: boolean }) {
  const [missions, setMissions] = useState<Mission[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error: loadError } = await loadMissions();
    if (loadError) { setError(loadError); setMissions([]); return; }
    setMissions(data ?? []);
  }, []);

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

  const gridCols = compact
    ? 'grid-cols-1 sm:grid-cols-2'
    : 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-4';

  return (
    <section>
      <div className="flex items-center justify-between mb-2.5">
        <h2 className="text-white font-semibold text-sm">Next Missions</h2>
        <button
          onClick={() => { setAdding(true); setEditingId(null); }}
          className="text-[11px] text-white/50 hover:text-white transition flex items-center gap-1"
        >
          <Plus className="w-3 h-3" /> Add
        </button>
      </div>

      {error && (
        <div
          className="flex items-start gap-2 text-[11px] rounded-lg px-3 py-2 mb-2.5"
          style={{ color: '#fca5a5', background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.30)' }}
        >
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} style={{ color: 'inherit' }}>
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {adding && (
        <MissionForm
          busy={busy}
          onCancel={() => setAdding(false)}
          onSubmit={async (values) => {
            const ok = await run(() => createMission(values));
            if (ok) setAdding(false);
          }}
        />
      )}

      {missions === null && <MissionSkeleton cols={gridCols} />}

      {missions?.length === 0 && !adding && (
        <button
          onClick={() => setAdding(true)}
          className="glass glass-hover w-full p-6 flex flex-col items-center gap-1.5 text-center"
          style={{ borderStyle: 'dashed' }}
        >
          <Rocket className="w-5 h-5 text-white/30" />
          <span className="text-white/70 text-xs font-semibold">No missions yet</span>
          <span className="text-white/35 text-[11px]">Add your first mission and its deadline.</span>
        </button>
      )}

      {missions && missions.length > 0 && (
        <div className={`grid gap-2.5 ${gridCols}`}>
          {missions.map((m) => (
            editingId === m.id ? (
              <MissionForm
                key={m.id}
                busy={busy}
                initial={m}
                onCancel={() => setEditingId(null)}
                onSubmit={async (values) => {
                  const ok = await run(() => updateMission(m.id, values));
                  if (ok) setEditingId(null);
                }}
              />
            ) : (
              <MissionCard
                key={m.id}
                mission={m}
                busy={busy}
                onEdit={() => { setEditingId(m.id); setAdding(false); }}
                onDelete={() => {
                  if (!confirm(`Delete "${m.title}"?`)) return;
                  void run(() => deleteMission(m.id));
                }}
              />
            )
          ))}
        </div>
      )}
    </section>
  );
}

function MissionCard({ mission, busy, onEdit, onDelete }: {
  mission: Mission;
  busy: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const color = deadlineColor(mission.deadline);
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="glass glass-hover p-3.5 flex flex-col gap-2.5 group">
      <div className="flex items-center gap-2.5">
        <button
          onClick={() => setExpanded((v) => !v)}
          title={expanded ? 'Hide phases' : 'Show phases'}
          className="w-8 h-8 rounded-lg grid place-items-center shrink-0 transition hover:bg-white/10"
          style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
        >
          {expanded
            ? <ChevronDown className="w-3.5 h-3.5 text-white/70" />
            : <Rocket className="w-3.5 h-3.5 text-white/70" />}
        </button>

        <button className="min-w-0 flex-1 text-left" onClick={() => setExpanded((v) => !v)}>
          <h3 className="text-white text-xs font-semibold leading-snug line-clamp-1">{mission.title}</h3>
          <span className="text-[10px] font-semibold" style={{ color }}>
            {deadlineLabel(mission.deadline)}
          </span>
        </button>

        <div className="flex gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition">
          <button
            onClick={onEdit}
            disabled={busy}
            title="Edit mission"
            className="w-6 h-6 grid place-items-center rounded-md text-white/50 hover:text-white hover:bg-white/10 transition"
          >
            <Pencil className="w-3 h-3" />
          </button>
          <button
            onClick={onDelete}
            disabled={busy}
            title="Delete mission"
            className="w-6 h-6 grid place-items-center rounded-md text-white/50 hover:text-red-300 hover:bg-red-500/10 transition"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>

      {expanded && <PhaseTimeline missionId={mission.id} />}
    </div>
  );
}

/* ── Phase timeline ─────────────────────────────────────────────────────────
 * An expandable per-mission list of phases. Status is a single-click cycle
 * (pending -> live -> completed) that writes through updatePhase; user_id / mission_id
 * are never sent, so a phase cannot be reassigned or moved from here.
 *
 * The dot and the line between dots come from TimelineNode, shared with the learning
 * path timeline in Power Up — the two read as one component because they are one.
 */

/** Flex gap of the phase list. The connector reads it to reach the next dot's centre. */
const PHASE_GAP = 8;

function PhaseTimeline({ missionId }: { missionId: string }) {
  const [phases, setPhases] = useState<MissionPhase[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    const { data, error: loadError } = await loadPhases(missionId);
    if (loadError) { setError(loadError); setPhases([]); return; }
    setPhases(data ?? []);
  }, [missionId]);

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

  const nextOrder = phases && phases.length > 0
    ? Math.max(...phases.map((p) => p.order_index)) + 1
    : 0;

  return (
    <div className="pt-2.5 border-t border-white/5 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] tracked-sm text-white/40">PHASES</span>
        <button
          onClick={() => setAdding(true)}
          className="text-[10px] text-white/50 hover:text-white transition flex items-center gap-1"
        >
          <Plus className="w-3 h-3" /> Add phase
        </button>
      </div>

      {error && (
        <div
          className="flex items-start gap-2 text-[10px] rounded-lg px-2.5 py-1.5"
          style={{ color: '#fca5a5', background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.30)' }}
        >
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} style={{ color: 'inherit' }}><X className="w-3 h-3" /></button>
        </div>
      )}

      {phases === null && <div className="text-[11px] text-white/30 py-1">Loading phases…</div>}

      {phases && phases.length > 0 && (
        <div className="flex flex-col" style={{ gap: PHASE_GAP }}>
          {phases.map((p, index) => (
            <PhaseRow
              key={p.id}
              phase={p}
              isLast={index === phases.length - 1}
              busy={busy}
              onCycle={() => run(() => updatePhase(p.id, { status: nextStatus(p.status) }))}
              onDelete={() => run(() => deletePhase(p.id))}
            />
          ))}
        </div>
      )}

      {phases && phases.length === 0 && !adding && (
        <div className="text-[11px] text-white/35 py-1">No phases yet — break this mission into steps.</div>
      )}

      {adding && (
        <PhaseForm
          busy={busy}
          onCancel={() => setAdding(false)}
          onSubmit={async (values) => {
            const ok = await run(() => createPhase({
              missionId,
              title: values.title,
              targetDate: values.targetDate,
              orderIndex: nextOrder,
            }));
            if (ok) setAdding(false);
          }}
        />
      )}
    </div>
  );
}

function PhaseRow({ phase, isLast, busy, onCycle, onDelete }: {
  phase: MissionPhase;
  isLast: boolean;
  busy: boolean;
  onCycle: () => void;
  onDelete: () => void;
}) {
  const done = phase.status === 'completed';
  const targetLabel = phase.target_date
    ? new Date(`${phase.target_date}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : null;

  return (
    // Top-aligned, not centred: the connector's start is measured from the row's top
    // edge, so the dot has to sit at a fixed offset there. `nodeAlignedLine` puts the
    // text back on the dot's centre line.
    <div className="relative flex items-start gap-2.5 group/phase">
      {!isLast && <TimelineConnector gap={PHASE_GAP} />}

      <TimelineNode
        status={phase.status}
        disabled={busy}
        title={`Status: ${phase.status} — click to advance`}
        onClick={onCycle}
      />

      <div className="min-w-0 flex-1" style={nodeAlignedLine}>
        <span
          className="text-[11px] leading-snug line-clamp-1"
          style={{ color: done ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.85)', textDecoration: done ? 'line-through' : 'none' }}
        >
          {phase.title}
        </span>
      </div>

      {targetLabel && (
        <span className="text-[9px] text-white/35 shrink-0" style={nodeAlignedLine}>{targetLabel}</span>
      )}

      <button
        onClick={onDelete}
        disabled={busy}
        title="Delete phase"
        className="w-5 h-5 grid place-items-center rounded-md text-white/40 hover:text-red-300 hover:bg-red-500/10 transition shrink-0 opacity-0 group-hover/phase:opacity-100"
      >
        <Trash2 className="w-3 h-3" />
      </button>
    </div>
  );
}

function PhaseForm({ busy, onCancel, onSubmit }: {
  busy: boolean;
  onCancel: () => void;
  onSubmit: (values: { title: string; targetDate: string | null }) => void;
}) {
  const [title, setTitle] = useState('');
  const [targetDate, setTargetDate] = useState('');

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    onSubmit({ title, targetDate: targetDate || null });
  }

  const field: React.CSSProperties = {
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.10)',
    borderRadius: 8,
    padding: '5px 8px',
    color: '#fff',
    fontSize: 11,
    outline: 'none',
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-2 pl-1">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value.slice(0, 120))}
        placeholder="Phase title"
        autoFocus
        style={field}
      />
      <div className="flex gap-2">
        <input
          type="date"
          value={targetDate}
          onChange={(e) => setTargetDate(e.target.value)}
          style={{ ...field, flex: 1, colorScheme: 'dark' }}
        />
        <button
          type="submit"
          disabled={busy || !title.trim()}
          title="Save phase"
          className="w-7 h-7 grid place-items-center rounded-lg text-white transition hover:brightness-110 disabled:opacity-40"
          style={{ background: 'var(--accent)' }}
        >
          <Check className="w-3 h-3" />
        </button>
        <button
          type="button"
          onClick={onCancel}
          title="Cancel"
          className="w-7 h-7 grid place-items-center rounded-lg text-white/60 transition hover:bg-white/10"
          style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)' }}
        >
          <X className="w-3 h-3" />
        </button>
      </div>
    </form>
  );
}

function MissionForm({ busy, initial, onCancel, onSubmit }: {
  busy: boolean;
  initial?: Mission;
  onCancel: () => void;
  onSubmit: (values: { title: string; deadline: string | null }) => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [deadline, setDeadline] = useState(initial?.deadline ?? '');

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    onSubmit({ title, deadline: deadline || null });
  }

  const field: React.CSSProperties = {
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.10)',
    borderRadius: 9,
    padding: '6px 9px',
    color: '#fff',
    fontSize: 12,
    outline: 'none',
  };

  return (
    <form onSubmit={submit} className="glass p-3.5 flex flex-col gap-2 mb-2.5">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value.slice(0, 120))}
        placeholder="Mission title"
        autoFocus
        style={field}
      />
      <div className="flex gap-2">
        <input
          type="date"
          value={deadline}
          onChange={(e) => setDeadline(e.target.value)}
          style={{ ...field, flex: 1, colorScheme: 'dark' }}
        />
        <button
          type="submit"
          disabled={busy || !title.trim()}
          title="Save"
          className="w-8 h-8 grid place-items-center rounded-lg text-white transition hover:brightness-110 disabled:opacity-40"
          style={{ background: 'var(--accent)' }}
        >
          <Check className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={onCancel}
          title="Cancel"
          className="w-8 h-8 grid place-items-center rounded-lg text-white/60 transition hover:bg-white/10"
          style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)' }}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </form>
  );
}

function MissionSkeleton({ cols }: { cols: string }) {
  return (
    <div className={`grid gap-2.5 ${cols} animate-pulse`}>
      {Array.from({ length: 2 }).map((_, i) => (
        <div key={i} className="glass p-3.5 flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-white/10 shrink-0" />
          <div className="flex-1 flex flex-col gap-1.5">
            <div className="h-3 rounded bg-white/10" style={{ width: `${60 + i * 15}%` }} />
            <div className="h-2.5 w-16 rounded bg-white/[0.07]" />
          </div>
        </div>
      ))}
    </div>
  );
}
