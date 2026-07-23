import { useState, useEffect, useRef } from 'react';
import { Plus, BookOpen, Trash2, Save, X } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface Entry {
  id: string;
  title: string;
  content: string;
  category: string;
  created_at: string;
  updated_at: string;
}

const CATEGORIES = ['General', 'Tech', 'Hackathon', 'Learning', 'Ideas', 'Reflection'];
const CAT_COLORS: Record<string, string> = {
  General: '#94A3B8', Tech: '#38BDF8', Hackathon: '#E8102A',
  Learning: '#34D399', Ideas: '#F5A524', Reflection: '#A78BFA',
};

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

type Mode = 'view' | 'edit' | 'new';

export default function JournalPage() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [selected, setSelected] = useState<Entry | null>(null);
  const [mode, setMode] = useState<Mode>('view');
  const [isFlipping, setIsFlipping] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Form state
  const [fTitle, setFTitle] = useState('');
  const [fContent, setFContent] = useState('');
  const [fCategory, setFCategory] = useState('General');

  const contentRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { loadEntries(); }, []);

  async function loadEntries() {
    setLoading(true);
    const { data } = await supabase
      .from('journal_entries')
      .select('*')
      .order('created_at', { ascending: false });
    if (data) {
      setEntries(data as Entry[]);
      if (data.length > 0 && !selected) {
        setSelected(data[0] as Entry);
      }
    }
    setLoading(false);
  }

  function openNew() {
    setFTitle(''); setFContent(''); setFCategory('General');
    setMode('new');
    flip(() => setSelected(null));
  }

  function openEntry(entry: Entry) {
    if (selected?.id === entry.id) return;
    flip(() => setSelected(entry));
    setMode('view');
  }

  function startEdit() {
    if (!selected) return;
    setFTitle(selected.title);
    setFContent(selected.content);
    setFCategory(selected.category);
    setMode('edit');
    setTimeout(() => contentRef.current?.focus(), 50);
  }

  function flip(callback: () => void) {
    setIsFlipping(true);
    setTimeout(() => { callback(); setIsFlipping(false); }, 220);
  }

  async function saveEntry() {
    if (!fTitle.trim()) return;
    setSaving(true);
    try {
      if (mode === 'new') {
        const { data } = await supabase
          .from('journal_entries')
          .insert({ title: fTitle.trim(), content: fContent, category: fCategory })
          .select('*')
          .single();
        if (data) {
          const e = data as Entry;
          setEntries(prev => [e, ...prev]);
          flip(() => setSelected(e));
          setMode('view');
        }
      } else if (mode === 'edit' && selected) {
        await supabase
          .from('journal_entries')
          .update({ title: fTitle.trim(), content: fContent, category: fCategory })
          .eq('id', selected.id);
        const updated = { ...selected, title: fTitle.trim(), content: fContent, category: fCategory };
        setEntries(prev => prev.map(e => e.id === selected.id ? updated : e));
        flip(() => setSelected(updated));
        setMode('view');
      }
    } finally { setSaving(false); }
  }

  async function deleteEntry() {
    if (!selected) return;
    await supabase.from('journal_entries').delete().eq('id', selected.id);
    const remaining = entries.filter(e => e.id !== selected.id);
    setEntries(remaining);
    flip(() => setSelected(remaining[0] ?? null));
    setMode('view');
  }

  const cat = selected?.category ?? fCategory;
  const catColor = CAT_COLORS[cat] ?? '#94A3B8';

  const isEditing = mode === 'edit' || mode === 'new';

  return (
    <div style={{
      display: 'flex', height: 'calc(100vh - 128px)', gap: 0,
      borderRadius: 20, overflow: 'hidden',
      boxShadow: '0 20px 80px -20px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,255,255,0.08)',
    }}>

      {/* ═══ LEFT SPINE / ENTRY LIST ═══ */}
      <div style={{
        width: 264, flexShrink: 0,
        background: 'linear-gradient(180deg, #0e0b08 0%, #12100d 100%)',
        borderRight: '1px solid rgba(255,255,255,0.06)',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{ padding: '18px 16px 14px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div className="flex items-center gap-2">
              <BookOpen className="w-4 h-4" style={{ color: '#E8102A', opacity: 0.9 }} />
              <span style={{ color: '#fff', fontWeight: 700, fontSize: 13, letterSpacing: '0.04em' }}>JOURNAL</span>
            </div>
            <button
              onClick={openNew}
              className="w-7 h-7 grid place-items-center rounded-lg hover:opacity-80 transition"
              style={{ background: '#E8102A', color: '#fff' }}
              title="New entry"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Entry list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 8px' }}>
          {loading && (
            <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12, textAlign: 'center', padding: 24 }}>Loading…</div>
          )}
          {!loading && entries.length === 0 && (
            <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12, textAlign: 'center', padding: 24 }}>
              No entries yet.<br />Create your first journal.
            </div>
          )}
          {entries.map(e => (
            <button
              key={e.id}
              onClick={() => { openEntry(e); }}
              style={{
                width: '100%', textAlign: 'left',
                padding: '10px 10px', borderRadius: 10, marginBottom: 2,
                background: selected?.id === e.id ? 'rgba(255,255,255,0.07)' : 'transparent',
                border: selected?.id === e.id ? '1px solid rgba(255,255,255,0.10)' : '1px solid transparent',
                cursor: 'pointer', transition: 'background 0.15s',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: CAT_COLORS[e.category] ?? '#94A3B8', flexShrink: 0, marginTop: 5 }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ color: selected?.id === e.id ? '#fff' : 'rgba(255,255,255,0.75)', fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {e.title}
                  </div>
                  <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 10, marginTop: 2 }}>{fmt(e.created_at)}</div>
                  <div style={{ color: 'rgba(255,255,255,0.25)', fontSize: 10, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {e.content.slice(0, 40) || 'Empty entry'}
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* ═══ RIGHT PAGE ═══ */}
      <div style={{
        flex: 1, minWidth: 0,
        background: '#f5f0e8',
        backgroundImage: `repeating-linear-gradient(transparent, transparent 27px, rgba(0,0,0,0.07) 27px, rgba(0,0,0,0.07) 28px)`,
        backgroundPosition: '0 52px',
        display: 'flex', flexDirection: 'column',
        position: 'relative',
        overflow: 'hidden',
      }}>

        {/* Page top binding */}
        <div style={{
          height: 52, flexShrink: 0, display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', padding: '0 28px',
          background: '#ede8df',
          borderBottom: '1px solid rgba(0,0,0,0.08)',
        }}>
          {(selected || mode === 'new') ? (
            <div className="flex items-center gap-3">
              {isEditing ? (
                <input
                  value={fTitle}
                  onChange={e => setFTitle(e.target.value)}
                  placeholder="Entry title…"
                  style={{
                    background: 'transparent', border: 'none', outline: 'none',
                    fontSize: 17, fontWeight: 700, color: '#2a2118',
                    fontFamily: 'Georgia, serif', width: 280,
                  }}
                />
              ) : (
                <h2 style={{ fontSize: 17, fontWeight: 700, color: '#2a2118', fontFamily: 'Georgia, serif', margin: 0 }}>
                  {selected?.title || 'Untitled'}
                </h2>
              )}
              <span style={{ padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 600, color: '#fff', background: catColor, letterSpacing: '0.06em' }}>
                {isEditing ? fCategory : cat}
              </span>
            </div>
          ) : (
            <span style={{ color: '#9a9080', fontSize: 14, fontStyle: 'italic' }}>Open a journal entry</span>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2">
            {mode === 'view' && selected && (
              <>
                <button onClick={startEdit} style={{ fontSize: 11, color: '#6b5e4e', padding: '4px 10px', borderRadius: 7, background: 'rgba(0,0,0,0.06)', border: '1px solid rgba(0,0,0,0.10)', cursor: 'pointer' }}>
                  Edit
                </button>
                <button onClick={deleteEntry} style={{ width: 28, height: 28, display: 'grid', placeItems: 'center', borderRadius: 7, background: 'rgba(255,0,0,0.08)', border: '1px solid rgba(255,0,0,0.15)', cursor: 'pointer', color: '#c0392b' }}>
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </>
            )}
            {isEditing && (
              <>
                <select
                  value={fCategory}
                  onChange={e => setFCategory(e.target.value)}
                  style={{ fontSize: 11, color: '#6b5e4e', padding: '4px 8px', borderRadius: 7, background: 'rgba(0,0,0,0.06)', border: '1px solid rgba(0,0,0,0.10)', cursor: 'pointer' }}
                >
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <button
                  onClick={saveEntry}
                  disabled={saving || !fTitle.trim()}
                  style={{ fontSize: 11, fontWeight: 600, color: '#fff', padding: '4px 12px', borderRadius: 7, background: '#E8102A', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}
                >
                  <Save className="w-3.5 h-3.5" />{saving ? 'Saving…' : 'Save'}
                </button>
                <button onClick={() => { setMode(selected ? 'view' : 'view'); }} style={{ width: 28, height: 28, display: 'grid', placeItems: 'center', borderRadius: 7, background: 'rgba(0,0,0,0.06)', border: '1px solid rgba(0,0,0,0.10)', cursor: 'pointer', color: '#6b5e4e' }}>
                  <X className="w-3.5 h-3.5" />
                </button>
              </>
            )}
          </div>
        </div>

        {/* Page content — animated on flip */}
        <div
          style={{
            flex: 1, overflowY: 'auto',
            padding: '24px 48px',
            transition: 'opacity 0.2s ease, transform 0.22s ease',
            opacity: isFlipping ? 0 : 1,
            transform: isFlipping ? 'translateX(24px) rotateY(-3deg)' : 'translateX(0) rotateY(0)',
          }}
        >
          {!selected && mode === 'view' && !loading && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 16, opacity: 0.5 }}>
              <BookOpen className="w-12 h-12" style={{ color: '#9a9080' }} />
              <p style={{ color: '#9a9080', fontFamily: 'Georgia, serif', fontSize: 16 }}>
                Select an entry, or create a new one.
              </p>
              <button
                onClick={openNew}
                style={{ fontSize: 13, color: '#fff', padding: '8px 20px', borderRadius: 9, background: '#E8102A', border: 'none', cursor: 'pointer', fontWeight: 600 }}
              >
                + New Entry
              </button>
            </div>
          )}

          {/* View mode */}
          {mode === 'view' && selected && (
            <div>
              <div style={{ color: '#7a6e62', fontSize: 11, marginBottom: 24, fontFamily: 'Georgia, serif' }}>
                {fmt(selected.created_at)}
                {selected.updated_at !== selected.created_at && ` · edited ${fmt(selected.updated_at)}`}
              </div>
              <div style={{
                color: '#2a2118', fontSize: 15, lineHeight: '28px',
                fontFamily: 'Georgia, serif', whiteSpace: 'pre-wrap', minHeight: 200,
              }}>
                {selected.content || <span style={{ color: '#b0a898', fontStyle: 'italic' }}>No content yet. Click Edit to start writing.</span>}
              </div>
            </div>
          )}

          {/* Edit / New mode */}
          {isEditing && (
            <textarea
              ref={contentRef}
              value={fContent}
              onChange={e => setFContent(e.target.value)}
              placeholder="Start writing your thoughts…"
              autoFocus
              style={{
                width: '100%', minHeight: 'calc(100vh - 280px)',
                background: 'transparent', border: 'none', outline: 'none', resize: 'none',
                color: '#2a2118', fontSize: 15, lineHeight: '28px',
                fontFamily: 'Georgia, serif',
              }}
            />
          )}
        </div>

        {/* Bottom page curl effect */}
        <div style={{
          position: 'absolute', bottom: 0, right: 0,
          width: 40, height: 40,
          background: 'linear-gradient(135deg, transparent 50%, rgba(0,0,0,0.10) 50%)',
          pointerEvents: 'none',
        }} />
      </div>
    </div>
  );
}
