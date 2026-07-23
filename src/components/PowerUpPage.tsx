import { useState, useEffect } from 'react';
import { Plus, X, Zap, CheckCircle, Circle, Trash2, Bot } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface Skill {
  id: string;
  name: string;
  category: string;
  deadline: string | null;
  completed_topics: string[];
  total_topics: number;
  progress: number;
  ai_feedback: string | null;
  created_at: string;
}

const AI_FEEDBACK = [
  (n: string) => `Solid foundation in ${n}. Your completed topics show depth — now focus on connecting the dots with a real project.`,
  (n: string) => `Strong progress on ${n}. The remaining topics are where experts are made. Dedicate focused 90-min sessions to each.`,
  (n: string) => `${n} mastery is within reach. Review your completed topics weekly to reinforce retention. Spaced repetition wins.`,
  (n: string) => `You're building real skill in ${n}. Consider writing a post or teaching it — teaching is the fastest way to learn.`,
  (n: string) => `Consistent progress on ${n}. Stay structured: one topic per day beats cramming. You're on track.`,
];

const CATEGORIES = ['Security', 'AI/ML', 'Web3', 'Backend', 'Frontend', 'DevOps', 'Research', 'General'];

function daysUntil(isoDate: string | null): number | null {
  if (!isoDate) return null;
  const d = new Date(isoDate); d.setHours(0,0,0,0);
  const t = new Date(); t.setHours(0,0,0,0);
  return Math.ceil((d.getTime() - t.getTime()) / 86400000);
}

function deadlineColor(days: number | null): string {
  if (days === null) return 'rgba(255,255,255,0.35)';
  if (days <= 3) return '#FF4D2E';
  if (days <= 7) return '#FF8A1E';
  return '#F5C518';
}

export default function PowerUpPage() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [reviewingId, setReviewingId] = useState<string | null>(null);

  // Form state
  const [fName, setFName] = useState('');
  const [fCategory, setFCategory] = useState('General');
  const [fDeadline, setFDeadline] = useState('');
  const [fTopics, setFTopics] = useState('');
  const [fTotal, setFTotal] = useState('10');
  const [saving, setSaving] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const { data } = await supabase.from('skills').select('*').order('created_at', { ascending: false });
    if (data) setSkills(data as Skill[]);
    setLoading(false);
  }

  async function addSkill() {
    if (!fName.trim()) return;
    setSaving(true);
    const topicLines = fTopics.split('\n').map(t => t.trim()).filter(Boolean);
    const total = Math.max(parseInt(fTotal) || 10, topicLines.length || 1);
    const prog = Math.round((topicLines.length / total) * 100);
    const { data } = await supabase
      .from('skills')
      .insert({
        name: fName.trim(),
        category: fCategory,
        deadline: fDeadline || null,
        completed_topics: topicLines,
        total_topics: total,
        progress: prog,
      })
      .select('*')
      .single();
    if (data) setSkills(prev => [data as Skill, ...prev]);
    setSaving(false);
    setShowModal(false);
    setFName(''); setFCategory('General'); setFDeadline(''); setFTopics(''); setFTotal('10');
  }

  async function toggleTopic(skill: Skill, topic: string) {
    const already = skill.completed_topics.includes(topic);
    const updated = already
      ? skill.completed_topics.filter(t => t !== topic)
      : [...skill.completed_topics, topic];
    const prog = Math.round((updated.length / skill.total_topics) * 100);
    await supabase.from('skills').update({ completed_topics: updated, progress: prog }).eq('id', skill.id);
    setSkills(prev => prev.map(s => s.id === skill.id ? { ...s, completed_topics: updated, progress: prog } : s));
  }

  async function getAIReview(skill: Skill) {
    setReviewingId(skill.id);
    await new Promise(r => setTimeout(r, 1600));
    const fn = AI_FEEDBACK[Math.floor(Math.random() * AI_FEEDBACK.length)];
    const feedback = fn(skill.name);
    await supabase.from('skills').update({ ai_feedback: feedback }).eq('id', skill.id);
    setSkills(prev => prev.map(s => s.id === skill.id ? { ...s, ai_feedback: feedback } : s));
    setReviewingId(null);
  }

  async function deleteSkill(id: string) {
    await supabase.from('skills').delete().eq('id', id);
    setSkills(prev => prev.filter(s => s.id !== id));
  }

  // All unique topics across completed + any extras implied by total_topics
  function getTopics(skill: Skill): { name: string; done: boolean }[] {
    const completed = skill.completed_topics;
    // Show completed topics + empty slots for remaining
    const remaining = Math.max(0, skill.total_topics - completed.length);
    return [
      ...completed.map(t => ({ name: t, done: true })),
      ...Array.from({ length: remaining }).map((_, i) => ({ name: `Topic ${completed.length + i + 1}`, done: false })),
    ].slice(0, 8); // show max 8 in the card
  }

  return (
    <div className="flex flex-col gap-6 max-w-5xl mx-auto py-2">

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ color: '#fff', fontSize: 22, fontWeight: 800, letterSpacing: '-0.02em' }}>Power Up</h1>
          <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13, marginTop: 3 }}>Track your skills. Let AI review your progress.</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl font-semibold text-sm text-white transition hover:opacity-90"
          style={{ background: 'var(--accent)', boxShadow: '0 4px 20px -6px var(--accent)' }}
        >
          <Plus className="w-4 h-4" /> Add Skill
        </button>
      </div>

      {/* Skills grid */}
      {loading && <div style={{ color: 'rgba(255,255,255,0.4)', textAlign: 'center', padding: 40 }}>Loading…</div>}

      {!loading && skills.length === 0 && (
        <div className="glass p-12 flex flex-col items-center gap-4 text-center">
          <Zap className="w-10 h-10 text-white/25" />
          <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 15 }}>No skills tracked yet.</p>
          <button onClick={() => setShowModal(true)} className="px-5 py-2 rounded-xl text-sm font-semibold text-white" style={{ background: 'var(--accent)' }}>
            + Add your first skill
          </button>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 14 }}>
        {skills.map(skill => {
          const days = daysUntil(skill.deadline);
          const topics = getTopics(skill);
          const isReviewing = reviewingId === skill.id;

          return (
            <div key={skill.id} className="glass glass-hover flex flex-col gap-3 p-5">
              {/* Card header */}
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ color: '#fff', fontSize: 15, fontWeight: 700 }}>{skill.name}</div>
                  <span style={{
                    display: 'inline-block', marginTop: 4,
                    fontSize: 9, fontWeight: 600, letterSpacing: '0.08em',
                    padding: '2px 8px', borderRadius: 999,
                    background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.6)',
                    border: '1px solid rgba(255,255,255,0.10)',
                  }}>
                    {skill.category}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {days !== null && (
                    <span style={{ fontSize: 10, fontWeight: 600, color: deadlineColor(days), padding: '2px 7px', borderRadius: 999, background: `${deadlineColor(days)}18`, border: `1px solid ${deadlineColor(days)}44` }}>
                      {days}d left
                    </span>
                  )}
                  <button onClick={() => deleteSkill(skill.id)} className="w-6 h-6 grid place-items-center rounded-lg hover:bg-white/10 transition text-white/30 hover:text-red-400">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Progress bar */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'rgba(255,255,255,0.5)', marginBottom: 5 }}>
                  <span>{skill.completed_topics.length} / {skill.total_topics} topics</span>
                  <span style={{ fontWeight: 700, color: 'var(--accent)' }}>{skill.progress}%</span>
                </div>
                <div style={{ height: 4, background: 'rgba(255,255,255,0.07)', borderRadius: 999, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${skill.progress}%`, background: 'var(--accent)', borderRadius: 999, transition: 'width 0.4s ease' }} />
                </div>
              </div>

              {/* Topics checklist */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 160, overflowY: 'auto' }}>
                {topics.map((t, i) => (
                  <button
                    key={i}
                    onClick={() => t.done ? toggleTopic(skill, t.name) : (t.name.startsWith('Topic ') ? null : toggleTopic(skill, t.name))}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      background: 'none', border: 'none', cursor: t.done || !t.name.startsWith('Topic ') ? 'pointer' : 'default',
                      textAlign: 'left', padding: '2px 0',
                    }}
                  >
                    {t.done
                      ? <CheckCircle className="w-3.5 h-3.5 shrink-0" style={{ color: '#34D399' }} />
                      : <Circle className="w-3.5 h-3.5 shrink-0" style={{ color: 'rgba(255,255,255,0.25)' }} />}
                    <span style={{
                      fontSize: 11, color: t.done ? '#34D399' : t.name.startsWith('Topic ') ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.65)',
                      textDecoration: t.done ? 'line-through' : 'none',
                    }}>
                      {t.name}
                    </span>
                  </button>
                ))}
                {topics.length < skill.total_topics - skill.completed_topics.length + topics.length && (
                  <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', paddingLeft: 22 }}>
                    +{skill.total_topics - topics.length} more topics
                  </span>
                )}
              </div>

              {/* AI Feedback */}
              {skill.ai_feedback && !isReviewing && (
                <div style={{
                  padding: '8px 10px', borderRadius: 8,
                  background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                  fontSize: 11, color: 'rgba(255,255,255,0.55)', fontStyle: 'italic', lineHeight: 1.5,
                }}>
                  <Bot className="w-3 h-3 inline mr-1.5 text-white/40" />
                  {skill.ai_feedback}
                </div>
              )}

              {isReviewing && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--accent)' }}>
                  <div className="w-3.5 h-3.5 rounded-full animate-spin" style={{ border: '2px solid rgba(255,255,255,0.1)', borderTopColor: 'var(--accent)' }} />
                  AI reviewing your progress…
                </div>
              )}

              {/* AI Review button */}
              <button
                onClick={() => getAIReview(skill)}
                disabled={isReviewing}
                className="flex items-center gap-1.5 text-xs transition hover:opacity-80"
                style={{ color: 'var(--accent)', background: 'none', border: 'none', cursor: isReviewing ? 'default' : 'pointer', padding: 0 }}
              >
                <Bot className="w-3.5 h-3.5" />
                {skill.ai_feedback ? 'Refresh AI Review' : 'Get AI Review'}
              </button>
            </div>
          );
        })}
      </div>

      {/* ── Add Skill Modal ── */}
      {showModal && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 50,
          background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
        }} onClick={(e) => { if (e.target === e.currentTarget) setShowModal(false); }}>
          <div className="glass" style={{ width: '100%', maxWidth: 480, padding: 28, position: 'relative' }}>
            <button onClick={() => setShowModal(false)} style={{ position: 'absolute', top: 16, right: 16, background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.5)' }}>
              <X className="w-5 h-5" />
            </button>
            <h2 style={{ color: '#fff', fontSize: 16, fontWeight: 700, marginBottom: 20 }}>Add New Skill Track</h2>

            <div className="flex flex-col gap-4">
              <Field label="Skill Name">
                <input value={fName} onChange={e => setFName(e.target.value)} placeholder="e.g. Reverse Engineering" className="field-input" />
              </Field>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <Field label="Category">
                  <select value={fCategory} onChange={e => setFCategory(e.target.value)} className="field-input">
                    {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </Field>
                <Field label="Deadline (optional)">
                  <input type="date" value={fDeadline} onChange={e => setFDeadline(e.target.value)} className="field-input" />
                </Field>
              </div>
              <Field label="Total Topics Count">
                <input type="number" value={fTotal} onChange={e => setFTotal(e.target.value)} min="1" max="100" className="field-input" />
              </Field>
              <Field label="Completed Topics (one per line)">
                <textarea
                  value={fTopics}
                  onChange={e => setFTopics(e.target.value)}
                  placeholder="Buffer overflows&#10;ROP chains&#10;ELF format internals"
                  rows={4}
                  className="field-input"
                  style={{ resize: 'none' }}
                />
              </Field>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
              <button onClick={() => setShowModal(false)} style={{ padding: '8px 18px', borderRadius: 10, background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.7)', cursor: 'pointer', fontSize: 13 }}>
                Cancel
              </button>
              <button
                onClick={addSkill}
                disabled={!fName.trim() || saving}
                style={{ padding: '8px 18px', borderRadius: 10, background: 'var(--accent)', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
              >
                {saving ? 'Saving…' : 'Add Skill'}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .field-input {
          width: 100%;
          background: rgba(255,255,255,0.05);
          border: 1px solid rgba(255,255,255,0.12);
          border-radius: 10px;
          padding: 9px 12px;
          color: #fff;
          font-size: 13px;
          outline: none;
          transition: border-color 0.15s;
          font-family: inherit;
        }
        .field-input:focus { border-color: var(--accent); }
        .field-input option { background: #1a1a1a; }
      `}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginBottom: 6, letterSpacing: '0.04em', fontWeight: 600 }}>{label}</div>
      {children}
    </div>
  );
}
