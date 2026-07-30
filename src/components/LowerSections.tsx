import { useCallback, useEffect, useState, FormEvent } from 'react';
import { Rocket, Plus, X, Trash2, Pencil, Check } from 'lucide-react';
import {
  Mission, loadMissions, createMission, updateMission, deleteMission,
  deadlineLabel, deadlineColor,
} from '../lib/missions';

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

  return (
    <div className="glass glass-hover p-3.5 flex items-center gap-2.5 group">
      <span
        className="w-8 h-8 rounded-lg grid place-items-center shrink-0"
        style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
      >
        <Rocket className="w-3.5 h-3.5 text-white/70" />
      </span>

      <div className="min-w-0 flex-1">
        <h3 className="text-white text-xs font-semibold leading-snug line-clamp-1">{mission.title}</h3>
        <span className="text-[10px] font-semibold" style={{ color }}>
          {deadlineLabel(mission.deadline)}
        </span>
      </div>

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
