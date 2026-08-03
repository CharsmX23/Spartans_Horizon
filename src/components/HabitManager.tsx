import { useCallback, useEffect, useState } from 'react';
import { X, Plus, Pencil, Check, RotateCcw, EyeOff } from 'lucide-react';
import {
  Habit, HABIT_ICON_NAMES, habitIcon,
  loadAllHabits, createHabit, updateHabit, setHabitActive,
} from '../lib/habits';

/**
 * Manage habits — add, rename, re-pick the icon, remove, restore.
 *
 * "Remove" is `active = false`, never a delete: habit_completions cascades off
 * habits, so a hard delete would take the verified proof history with it. Removed
 * habits stay listed here so the action is visibly reversible.
 */

interface Props {
  open: boolean;
  accent: string;
  onClose: () => void;
  /** Fired after any successful write so the page behind can refetch. */
  onChanged: () => void;
}

export default function HabitManager({ open, accent, onClose, onChanged }: Props) {
  const [habits, setHabits] = useState<Habit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newIcon, setNewIcon] = useState(HABIT_ICON_NAMES[0]);

  const load = useCallback(async () => {
    const { data, error: loadError } = await loadAllHabits();
    if (loadError) { setError(loadError); setHabits([]); return; }
    setHabits(data ?? []);
  }, []);

  useEffect(() => { if (open) void load(); }, [open, load]);

  async function run(action: () => Promise<{ error: string | null }>) {
    setBusy(true);
    setError(null);
    const { error: actionError } = await action();
    if (actionError) { setError(actionError); setBusy(false); return false; }
    await load();
    onChanged();
    setBusy(false);
    return true;
  }

  async function add() {
    if (!newTitle.trim()) return;
    const ok = await run(() => createHabit({ title: newTitle, icon: newIcon }));
    if (ok) { setNewTitle(''); setNewIcon(HABIT_ICON_NAMES[0]); }
  }

  if (!open) return null;

  const active = (habits ?? []).filter((h) => h.active);
  const removed = (habits ?? []).filter((h) => !h.active);

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 50,
        background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="glass" style={{ width: '100%', maxWidth: 460, padding: 24, position: 'relative', maxHeight: '85vh', overflowY: 'auto' }}>
        <button
          onClick={onClose}
          style={{ position: 'absolute', top: 16, right: 16, background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.5)' }}
        >
          <X className="w-5 h-5" />
        </button>

        <h2 style={{ color: '#fff', fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Manage Habits</h2>
        <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12, marginBottom: 18 }}>
          Removing a habit hides it from today — your past proof history stays intact.
        </p>

        {error && (
          <div style={{
            display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 14,
            fontSize: 12, color: '#fca5a5', background: 'rgba(239,68,68,0.10)',
            border: '1px solid rgba(239,68,68,0.30)', borderRadius: 10, padding: '8px 12px',
          }}>
            <span style={{ flex: 1 }}>{error}</span>
            <button onClick={() => setError(null)} style={{ background: 'none', border: 'none', color: '#fca5a5', cursor: 'pointer' }}>
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* ── Add ── */}
        <div style={{
          background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 12, padding: 12, marginBottom: 18,
        }}>
          <div style={{ fontSize: 10, letterSpacing: '0.12em', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', marginBottom: 9 }}>
            New habit
          </div>
          <div className="flex gap-2">
            <input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value.slice(0, 80))}
              onKeyDown={(e) => { if (e.key === 'Enter') void add(); }}
              placeholder="e.g. Read 20 pages"
              className="h-input"
              style={{ flex: 1 }}
            />
            <button
              onClick={() => void add()}
              disabled={busy || !newTitle.trim()}
              title="Add habit"
              className="w-9 h-9 grid place-items-center rounded-lg text-white shrink-0 transition hover:brightness-110 disabled:opacity-40"
              style={{ background: accent, border: 'none', cursor: 'pointer' }}
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
          <IconPicker value={newIcon} accent={accent} onPick={setNewIcon} />
        </div>

        {habits === null && (
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', padding: '8px 0' }}>Loading…</div>
        )}

        {/* ── Active ── */}
        {habits !== null && (
          <>
            <SectionLabel>Active · {active.length}</SectionLabel>
            {active.length === 0 && (
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', padding: '6px 0 10px' }}>
                No active habits — add one above.
              </div>
            )}
            <div className="flex flex-col gap-2" style={{ marginBottom: 16 }}>
              {active.map((h) => (
                <ManagerRow
                  key={h.id}
                  habit={h}
                  accent={accent}
                  busy={busy}
                  onRename={(title) => run(() => updateHabit(h.id, { title }))}
                  onPickIcon={(icon) => run(() => updateHabit(h.id, { icon }))}
                  onRemove={() => run(() => setHabitActive(h.id, false))}
                />
              ))}
            </div>

            {/* ── Removed ── */}
            {removed.length > 0 && (
              <>
                <SectionLabel>Removed · {removed.length}</SectionLabel>
                <div className="flex flex-col gap-2">
                  {removed.map((h) => {
                    const Icon = habitIcon(h.icon);
                    return (
                      <div
                        key={h.id}
                        className="flex items-center gap-3 rounded-xl px-3 py-2.5"
                        style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}
                      >
                        <span
                          className="w-7 h-7 grid place-items-center rounded-lg shrink-0"
                          style={{ background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.35)' }}
                        >
                          <Icon className="w-3.5 h-3.5" />
                        </span>
                        <span className="flex-1 min-w-0" style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>
                          {h.title}
                        </span>
                        <button
                          onClick={() => void run(() => setHabitActive(h.id, true))}
                          disabled={busy}
                          className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition hover:bg-white/10 disabled:opacity-40"
                          style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.75)', border: '1px solid rgba(255,255,255,0.10)', cursor: 'pointer' }}
                        >
                          <RotateCcw className="w-3 h-3" /> Restore
                        </button>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </>
        )}

        <style>{`
          .h-input {
            background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.12);
            border-radius: 9px; padding: 8px 11px; color: #fff; font-size: 13px;
            outline: none; transition: border-color 0.15s; font-family: inherit; min-width: 0;
          }
          .h-input:focus { border-color: var(--accent); }
        `}</style>
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 10, letterSpacing: '0.12em', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', marginBottom: 8 }}>
      {children}
    </div>
  );
}

/** An active habit: rename inline, swap its icon, or remove behind a confirm step. */
function ManagerRow({ habit, accent, busy, onRename, onPickIcon, onRemove }: {
  habit: Habit;
  accent: string;
  busy: boolean;
  onRename: (title: string) => Promise<boolean>;
  onPickIcon: (icon: string) => Promise<boolean>;
  onRemove: () => Promise<boolean>;
}) {
  const [mode, setMode] = useState<'view' | 'edit' | 'confirm'>('view');
  const [draft, setDraft] = useState(habit.title);
  const Icon = habitIcon(habit.icon);

  const shell: React.CSSProperties = {
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 12,
  };

  if (mode === 'confirm') {
    return (
      <div className="flex flex-col gap-2 px-3 py-2.5" style={shell}>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.8)' }}>
          Remove “{habit.title}”?
        </div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>
          It leaves today's list. Your past proof history stays intact, and you can restore it here.
        </div>
        <div className="flex gap-2 justify-end">
          <button
            onClick={() => setMode('view')}
            className="px-3 py-1.5 rounded-lg text-xs transition hover:bg-white/10"
            style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.7)', border: '1px solid rgba(255,255,255,0.10)', cursor: 'pointer' }}
          >
            Cancel
          </button>
          <button
            onClick={() => { void onRemove(); }}
            disabled={busy}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold transition hover:brightness-110 disabled:opacity-40"
            style={{ background: 'rgba(239,68,68,0.16)', color: '#fca5a5', border: '1px solid rgba(239,68,68,0.35)', cursor: 'pointer' }}
          >
            Remove
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 px-3 py-2.5" style={shell}>
      <div className="flex items-center gap-3">
        <span
          className="w-7 h-7 grid place-items-center rounded-lg shrink-0"
          style={{ background: `${accent}18`, color: accent }}
        >
          <Icon className="w-3.5 h-3.5" />
        </span>

        {mode === 'edit' ? (
          <input
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value.slice(0, 80))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && draft.trim()) { void onRename(draft).then(() => setMode('view')); }
              if (e.key === 'Escape') { setDraft(habit.title); setMode('view'); }
            }}
            className="h-input"
            style={{ flex: 1 }}
          />
        ) : (
          <span className="flex-1 min-w-0" style={{ color: '#fff', fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {habit.title}
          </span>
        )}

        <div className="flex gap-1 shrink-0">
          {mode === 'edit' ? (
            <>
              <button
                onClick={() => { if (draft.trim()) void onRename(draft).then(() => setMode('view')); }}
                disabled={busy || !draft.trim()}
                title="Save name"
                className="w-7 h-7 grid place-items-center rounded-md text-white transition hover:brightness-110 disabled:opacity-40"
                style={{ background: accent, border: 'none', cursor: 'pointer' }}
              >
                <Check className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => { setDraft(habit.title); setMode('view'); }}
                title="Cancel"
                className="w-7 h-7 grid place-items-center rounded-md text-white/60 transition hover:bg-white/10"
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)', cursor: 'pointer' }}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => { setDraft(habit.title); setMode('edit'); }}
                title="Rename"
                className="w-7 h-7 grid place-items-center rounded-md text-white/50 hover:text-white hover:bg-white/10 transition"
                style={{ background: 'none', border: 'none', cursor: 'pointer' }}
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setMode('confirm')}
                title="Remove habit"
                className="w-7 h-7 grid place-items-center rounded-md text-white/50 hover:text-red-300 hover:bg-red-500/10 transition"
                style={{ background: 'none', border: 'none', cursor: 'pointer' }}
              >
                <EyeOff className="w-3.5 h-3.5" />
              </button>
            </>
          )}
        </div>
      </div>

      {mode === 'edit' && (
        <IconPicker value={habit.icon} accent={accent} onPick={(icon) => { void onPickIcon(icon); }} />
      )}
    </div>
  );
}

function IconPicker({ value, accent, onPick }: {
  value: string;
  accent: string;
  onPick: (icon: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5" style={{ marginTop: 9 }}>
      {HABIT_ICON_NAMES.map((name) => {
        const Icon = habitIcon(name);
        const on = name === value;
        return (
          <button
            key={name}
            onClick={() => onPick(name)}
            title={name}
            className="w-7 h-7 grid place-items-center rounded-lg transition hover:bg-white/10"
            style={{
              background: on ? `${accent}22` : 'rgba(255,255,255,0.04)',
              border: `1px solid ${on ? `${accent}66` : 'rgba(255,255,255,0.08)'}`,
              color: on ? accent : 'rgba(255,255,255,0.5)',
              cursor: 'pointer',
            }}
          >
            <Icon className="w-3.5 h-3.5" />
          </button>
        );
      })}
    </div>
  );
}
