import { useState, useEffect } from 'react';
import { Plus, X, Target, CheckCircle, Clock, Pause, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface Goal {
  id: string;
  title: string;
  goal_type: 'long_term' | 'short_term';
  deadline: string | null;
  status: 'active' | 'completed' | 'paused';
  description: string | null;
  created_at: string;
}

type GoalType = 'long_term' | 'short_term';

function daysUntil(isoDate: string | null): number | null {
  if (!isoDate) return null;
  const d = new Date(isoDate); d.setHours(0,0,0,0);
  const t = new Date(); t.setHours(0,0,0,0);
  return Math.ceil((d.getTime() - t.getTime()) / 86400000);
}

function deadlineLabel(days: number | null): { text: string; color: string } {
  if (days === null) return { text: 'No deadline', color: 'rgba(255,255,255,0.35)' };
  if (days < 0) return { text: `${Math.abs(days)}d overdue`, color: '#FF4D2E' };
  if (days === 0) return { text: 'Due today', color: '#FF4D2E' };
  if (days <= 3) return { text: `${days}d left`, color: '#FF4D2E' };
  if (days <= 7) return { text: `${days}d left`, color: '#FF8A1E' };
  if (days <= 30) return { text: `${days}d left`, color: '#F5C518' };
  return { text: new Date(new Date().getTime() + days * 86400000).toLocaleDateString(undefined, { month: 'short', year: 'numeric' }), color: 'rgba(255,255,255,0.45)' };
}

const STATUS_CYCLE: Record<Goal['status'], Goal['status']> = {
  active: 'completed',
  completed: 'active',
  paused: 'active',
};

export default function GoalsPage() {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [modalType, setModalType] = useState<GoalType>('long_term');

  // Form state
  const [fTitle, setFTitle] = useState('');
  const [fDesc, setFDesc] = useState('');
  const [fDeadline, setFDeadline] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const { data } = await supabase.from('goals').select('*').order('deadline', { ascending: true, nullsFirst: false });
    if (data) setGoals(data as Goal[]);
    setLoading(false);
  }

  function openModal(type: GoalType) {
    setModalType(type);
    setFTitle(''); setFDesc(''); setFDeadline('');
    setShowModal(true);
  }

  async function addGoal() {
    if (!fTitle.trim()) return;
    setSaving(true);
    const { data } = await supabase
      .from('goals')
      .insert({ title: fTitle.trim(), goal_type: modalType, deadline: fDeadline || null, description: fDesc || null, status: 'active' })
      .select('*')
      .single();
    if (data) setGoals(prev => [...prev, data as Goal].sort((a, b) => {
      if (!a.deadline && !b.deadline) return 0;
      if (!a.deadline) return 1;
      if (!b.deadline) return -1;
      return a.deadline.localeCompare(b.deadline);
    }));
    setSaving(false);
    setShowModal(false);
  }

  async function cycleStatus(goal: Goal) {
    const next = STATUS_CYCLE[goal.status];
    await supabase.from('goals').update({ status: next }).eq('id', goal.id);
    setGoals(prev => prev.map(g => g.id === goal.id ? { ...g, status: next } : g));
  }

  async function deleteGoal(id: string) {
    await supabase.from('goals').delete().eq('id', id);
    setGoals(prev => prev.filter(g => g.id !== id));
  }

  const longGoals = goals.filter(g => g.goal_type === 'long_term');
  const shortGoals = goals.filter(g => g.goal_type === 'short_term');

  return (
    <div className="flex flex-col gap-5 py-2">
      <div>
        <h1 style={{ color: '#fff', fontSize: 22, fontWeight: 800, letterSpacing: '-0.02em' }}>Goals</h1>
        <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13, marginTop: 3 }}>
          Long-term vision meets short-term action.
        </p>
      </div>

      {loading && <div style={{ color: 'rgba(255,255,255,0.4)', textAlign: 'center', padding: 40 }}>Loading…</div>}

      {!loading && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          <GoalColumn
            title="Long-Term Goals"
            subtitle="Vision · Milestones · Years"
            accent="#38BDF8"
            goals={longGoals}
            onAdd={() => openModal('long_term')}
            onCycle={cycleStatus}
            onDelete={deleteGoal}
          />
          <GoalColumn
            title="Short-Term Goals"
            subtitle="This week · This sprint"
            accent="#34D399"
            goals={shortGoals}
            onAdd={() => openModal('short_term')}
            onCycle={cycleStatus}
            onDelete={deleteGoal}
          />
        </div>
      )}

      {/* ── Add Goal Modal ── */}
      {showModal && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 50,
            background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
          }}
          onClick={e => { if (e.target === e.currentTarget) setShowModal(false); }}
        >
          <div className="glass" style={{ width: '100%', maxWidth: 440, padding: 28, position: 'relative' }}>
            <button onClick={() => setShowModal(false)} style={{ position: 'absolute', top: 16, right: 16, background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.5)' }}>
              <X className="w-5 h-5" />
            </button>
            <h2 style={{ color: '#fff', fontSize: 16, fontWeight: 700, marginBottom: 6 }}>
              Add {modalType === 'long_term' ? 'Long-Term' : 'Short-Term'} Goal
            </h2>
            <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12, marginBottom: 20 }}>
              {modalType === 'long_term' ? 'Think big picture — months to years.' : 'Concrete, achievable within weeks.'}
            </p>

            <div className="flex flex-col gap-4">
              <GField label="Goal Title">
                <input value={fTitle} onChange={e => setFTitle(e.target.value)} placeholder="e.g. Launch my first startup" className="g-input" />
              </GField>
              <GField label="Deadline (optional)">
                <input type="date" value={fDeadline} onChange={e => setFDeadline(e.target.value)} className="g-input" />
              </GField>
              <GField label="Description (optional)">
                <textarea value={fDesc} onChange={e => setFDesc(e.target.value)} placeholder="What does success look like?" rows={3} className="g-input" style={{ resize: 'none' }} />
              </GField>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
              <button onClick={() => setShowModal(false)} style={{ padding: '8px 18px', borderRadius: 10, background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.7)', cursor: 'pointer', fontSize: 13 }}>
                Cancel
              </button>
              <button
                onClick={addGoal}
                disabled={!fTitle.trim() || saving}
                style={{ padding: '8px 18px', borderRadius: 10, background: 'var(--accent)', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
              >
                {saving ? 'Saving…' : 'Add Goal'}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .g-input {
          width: 100%; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.12);
          border-radius: 10px; padding: 9px 12px; color: #fff; font-size: 13px;
          outline: none; transition: border-color 0.15s; font-family: inherit;
        }
        .g-input:focus { border-color: var(--accent); }
      `}</style>
    </div>
  );
}

function GoalColumn({ title, subtitle, accent, goals, onAdd, onCycle, onDelete }: {
  title: string; subtitle: string; accent: string;
  goals: Goal[];
  onAdd: () => void;
  onCycle: (g: Goal) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      {/* Column header */}
      <div style={{
        padding: '14px 18px',
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 14,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div>
          <div style={{ color: '#fff', fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: accent, display: 'inline-block' }} />
            {title}
            <span style={{ fontSize: 12, fontWeight: 600, color: accent, background: `${accent}22`, padding: '1px 8px', borderRadius: 999, border: `1px solid ${accent}44` }}>
              {goals.filter(g => g.status === 'active').length}
            </span>
          </div>
          <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11, marginTop: 3, paddingLeft: 16 }}>{subtitle}</div>
        </div>
        <button
          onClick={onAdd}
          className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg transition hover:opacity-80"
          style={{ background: `${accent}22`, color: accent, border: `1px solid ${accent}44` }}
        >
          <Plus className="w-3.5 h-3.5" /> Add
        </button>
      </div>

      {/* Goal cards */}
      <div className="flex flex-col gap-2.5">
        {goals.length === 0 && (
          <div style={{ padding: '24px 0', textAlign: 'center', color: 'rgba(255,255,255,0.25)', fontSize: 13 }}>
            No goals yet. Add one above.
          </div>
        )}

        {goals.map(goal => {
          const dl = deadlineLabel(daysUntil(goal.deadline));
          return (
            <div key={goal.id} className="glass glass-hover p-4 flex flex-col gap-2.5" style={{ opacity: goal.status === 'completed' ? 0.65 : 1 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                {/* Status icon + title */}
                <button onClick={() => onCycle(goal)} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'flex-start', gap: 8, padding: 0, flex: 1, textAlign: 'left' }}>
                  {goal.status === 'completed'
                    ? <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: '#34D399' }} />
                    : goal.status === 'paused'
                    ? <Pause className="w-4 h-4 shrink-0 mt-0.5" style={{ color: '#94A3B8' }} />
                    : <Target className="w-4 h-4 shrink-0 mt-0.5" style={{ color: accent }} />}
                  <span style={{
                    color: goal.status === 'completed' ? 'rgba(255,255,255,0.45)' : '#fff',
                    fontSize: 13, fontWeight: 600, lineHeight: '18px',
                    textDecoration: goal.status === 'completed' ? 'line-through' : 'none',
                  }}>
                    {goal.title}
                  </span>
                </button>
                <button onClick={() => onDelete(goal.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.25)', flexShrink: 0 }}>
                  <Trash2 className="w-3.5 h-3.5 hover:text-red-400" />
                </button>
              </div>

              {goal.description && (
                <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', lineHeight: '16px', paddingLeft: 24 }}>
                  {goal.description}
                </p>
              )}

              {/* Deadline + status */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 24 }}>
                <Clock className="w-3 h-3" style={{ color: dl.color, flexShrink: 0 }} />
                <span style={{ fontSize: 11, fontWeight: 600, color: dl.color }}>{dl.text}</span>
                <span style={{
                  marginLeft: 'auto', fontSize: 9, fontWeight: 700,
                  letterSpacing: '0.06em', padding: '2px 7px', borderRadius: 999,
                  background: goal.status === 'completed' ? '#34D39922' : goal.status === 'paused' ? 'rgba(255,255,255,0.06)' : `${accent}18`,
                  color: goal.status === 'completed' ? '#34D399' : goal.status === 'paused' ? 'rgba(255,255,255,0.4)' : accent,
                  border: `1px solid ${goal.status === 'completed' ? '#34D39944' : goal.status === 'paused' ? 'rgba(255,255,255,0.10)' : `${accent}44`}`,
                }}>
                  {goal.status.toUpperCase()}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function GField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginBottom: 6, fontWeight: 600 }}>{label}</div>
      {children}
    </div>
  );
}
