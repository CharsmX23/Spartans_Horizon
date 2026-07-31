import { useState, useEffect, useRef } from 'react';
import { Flame, Upload, CheckCircle, XCircle, Zap } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { verifyProof, validateProofFile } from '../lib/proof';
import { loadHabits, verifyHabit, habitIcon, HabitToday } from '../lib/habits';
import { useAuth } from '../lib/auth';
import { ACCENTS } from '../theme';
import { Person } from '../data';

interface StreakLog {
  id: string;
  log_date: string;
  verified: boolean;
  note: string | null;
}

interface Props { user: Person; }

type UploadState =
  | 'idle'
  | 'preview'
  | 'submitting'
  | 'verified'   // reachable only on a genuine 'progress' verdict from Gemini
  | 'rejected'   // Gemini ran and said no
  | 'error';

/** What is being proved. 'streak' is generic daily progress; otherwise a specific habit. */
type Target = { kind: 'streak' } | { kind: 'habit'; habit: HabitToday };

function todayStr() { return new Date().toISOString().split('T')[0]; }

/** What the photo is judged against for a generic daily streak check-in. */
const STREAK_CONTEXT = 'making genuine, visible daily progress on my own work or training';

export default function StreaksPage({ user }: Props) {
  const { refreshProfile } = useAuth();
  const accent = ACCENTS[user.accent];
  const [logs, setLogs] = useState<StreakLog[]>([]);
  const [habits, setHabits] = useState<HabitToday[]>([]);
  const [target, setTarget] = useState<Target>({ kind: 'streak' });
  const [uploadState, setUploadState] = useState<UploadState>('idle');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Authoritative value from users.current_streak, maintained by record_checkin().
  // Deliberately NOT recomputed from logs — two sources of truth would drift.
  const streak = user.streak;
  const todayLog = logs.find(l => l.log_date === todayStr());
  const streakDone = todayLog?.verified ?? false;

  // Resolve the current target to its done-state, label, and note.
  const targetDone = target.kind === 'streak' ? streakDone : target.habit.done_today;
  const targetLabel = target.kind === 'streak' ? 'Daily progress' : target.habit.title;
  const targetNote = target.kind === 'streak' ? (todayLog?.note ?? null) : target.habit.today_note;

  useEffect(() => {
    void loadLogs();
    void refreshHabits();
  }, []);

  async function loadLogs() {
    const { data } = await supabase
      .from('streak_logs')
      .select('id, log_date, verified, note')
      .order('log_date', { ascending: false })
      .limit(60);
    if (data) setLogs(data as StreakLog[]);
  }

  async function refreshHabits() {
    const { data } = await loadHabits();
    if (data) {
      setHabits(data);
      // Keep the selected habit's done-state fresh after a verification.
      setTarget((prev) => {
        if (prev.kind !== 'habit') return prev;
        const updated = data.find((h) => h.id === prev.habit.id);
        return updated ? { kind: 'habit', habit: updated } : { kind: 'streak' };
      });
    }
  }

  function selectTarget(next: Target) {
    setTarget(next);
    resetUpload();
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0];
    if (!selected) return;

    const invalid = validateProofFile(selected);
    if (invalid) {
      setMessage(invalid);
      setUploadState('error');
      return;
    }

    // Blob URL for the local preview only; revoked in resetUpload so the bytes are
    // released rather than lingering in the document.
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(selected);
    setPreviewUrl(URL.createObjectURL(selected));
    setMessage(null);
    setUploadState('preview');
  }

  async function handleVerify() {
    if (!file) return;
    setUploadState('submitting');
    setMessage(null);

    const result = target.kind === 'habit'
      ? await verifyHabit({ file, habit: target.habit })
      : await verifyProof({ file, context: STREAK_CONTEXT, kind: 'streak' });

    if (!result.ok) {
      setMessage(result.message);
      setUploadState('error');
      return;
    }

    if (result.verdict.verdict !== 'progress') {
      setMessage(result.verdict.evaluation_text);
      setUploadState('rejected');
      return;
    }

    // Completion + streak were recorded server-side; the client cannot write those
    // fields. Refetch rather than trust the message — the numbers on screen have to be
    // what is actually in the database.
    setMessage(result.verdict.evaluation_text);
    setUploadState('verified');
    await Promise.all([loadLogs(), refreshHabits(), refreshProfile()]);
  }

  function resetUpload() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setUploadState('idle');
    setPreviewUrl(null);
    setFile(null);
    setMessage(null);
    if (fileRef.current) fileRef.current.value = '';
  }

  // Build last-30-days grid
  const grid = Array.from({ length: 30 }).map((_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (29 - i));
    const dateStr = d.toISOString().split('T')[0];
    const log = logs.find(l => l.log_date === dateStr);
    return { date: d.getDate(), dateStr, verified: log?.verified ?? false, hasLog: !!log };
  });

  return (
    <div className="max-w-3xl mx-auto flex flex-col gap-6 py-2">

      {/* ── Streak Counter ── */}
      <div className="glass p-8 flex flex-col items-center gap-4 text-center relative overflow-hidden">
        <div style={{
          position: 'absolute', inset: 0,
          background: `radial-gradient(ellipse at 50% 80%, ${accent.hex}18 0%, transparent 65%)`,
          pointerEvents: 'none',
        }} />
        <div className="relative flex flex-col items-center gap-2">
          <div className="flex items-center gap-3">
            <Flame className="w-10 h-10" style={{ color: accent.hex }} />
            <span style={{ fontSize: 80, fontWeight: 900, color: '#fff', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
              {streak}
            </span>
          </div>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
            Day Streak
          </div>
          <div style={{ fontSize: 12, color: accent.hex, fontWeight: 600, marginTop: 4 }}>
            {streakDone ? '✓ Today\'s proof verified' : 'Upload proof to keep your streak alive'}
          </div>
        </div>
      </div>

      {/* ── Today's Habits ── real ticks, driven by verified completions ── */}
      {habits.length > 0 && (
        <div className="glass p-5 flex flex-col gap-3">
          <div style={{ fontSize: 11, letterSpacing: '0.12em', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase' }}>
            Today's Habits
          </div>
          <div className="flex flex-col gap-2">
            {habits.map((h) => {
              const Icon = habitIcon(h.icon);
              const selected = target.kind === 'habit' && target.habit.id === h.id;
              return (
                <div
                  key={h.id}
                  className="flex items-center gap-3 rounded-xl px-3 py-2.5"
                  style={{
                    background: selected ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.02)',
                    border: `1px solid ${selected ? `${accent.hex}55` : 'rgba(255,255,255,0.07)'}`,
                  }}
                >
                  <span
                    className="w-8 h-8 grid place-items-center rounded-lg shrink-0"
                    style={{
                      background: h.done_today ? `${accent.hex}22` : 'rgba(255,255,255,0.05)',
                      color: h.done_today ? accent.hex : 'rgba(255,255,255,0.6)',
                    }}
                  >
                    <Icon className="w-4 h-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div style={{ color: '#fff', fontSize: 13, fontWeight: 600 }}>{h.title}</div>
                    {h.done_today && h.today_note && (
                      <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, marginTop: 2, fontStyle: 'italic' }} className="line-clamp-1">
                        "{h.today_note}"
                      </div>
                    )}
                  </div>
                  {h.done_today ? (
                    <span className="flex items-center gap-1 shrink-0" style={{ color: '#34D399', fontSize: 12, fontWeight: 600 }}>
                      <CheckCircle className="w-4 h-4" /> Done
                    </span>
                  ) : (
                    <button
                      onClick={() => selectTarget({ kind: 'habit', habit: h })}
                      className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold transition hover:brightness-110"
                      style={{
                        background: selected ? accent.hex : 'rgba(255,255,255,0.06)',
                        color: selected ? '#fff' : 'rgba(255,255,255,0.8)',
                        border: selected ? 'none' : '1px solid rgba(255,255,255,0.10)',
                      }}
                    >
                      {selected ? 'Selected' : 'Prove'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Upload Proof ── targeted at the streak or a chosen habit ── */}
      <div className="glass p-6 flex flex-col items-center gap-5">
        <div className="w-full flex items-center justify-between">
          <div style={{ fontSize: 11, letterSpacing: '0.12em', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase' }}>
            Proof of Work
          </div>
          <div className="flex items-center gap-1.5" style={{ fontSize: 12 }}>
            <span style={{ color: 'rgba(255,255,255,0.4)' }}>Proving:</span>
            <span style={{ color: accent.hex, fontWeight: 600 }}>{targetLabel}</span>
            {target.kind === 'habit' && (
              <button
                onClick={() => selectTarget({ kind: 'streak' })}
                className="ml-1 text-white/40 hover:text-white transition"
                title="Switch to daily progress"
              >
                <XCircle className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {targetDone ? (
          <div className="flex items-center gap-4 w-full">
            <CheckCircle className="w-8 h-8 shrink-0" style={{ color: '#34D399' }} />
            <div>
              <div style={{ color: '#fff', fontWeight: 600, fontSize: 14 }}>
                {target.kind === 'streak' ? "Today's progress verified" : `"${targetLabel}" verified today`}
              </div>
              {targetNote && (
                <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, marginTop: 3, fontStyle: 'italic' }}>
                  "{targetNote}"
                </div>
              )}
            </div>
          </div>
        ) : (
          <>
            {uploadState === 'idle' && (
              <button
                onClick={() => fileRef.current?.click()}
                className="flex flex-col items-center gap-3 w-full rounded-xl border-2 border-dashed py-10 transition hover:border-white/25"
                style={{ borderColor: 'rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.02)' }}
              >
                <Upload className="w-8 h-8 text-white/40" />
                <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 14 }}>Drop a photo or click to upload</span>
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>JPG, PNG, WEBP · max 5 MB</span>
              </button>
            )}

            {uploadState === 'preview' && previewUrl && (
              <div className="flex flex-col items-center gap-4 w-full">
                <div style={{ width: '100%', maxHeight: 240, overflow: 'hidden', borderRadius: 12, border: '1px solid rgba(255,255,255,0.12)' }}>
                  <img src={previewUrl} alt="Proof" style={{ width: '100%', height: 240, objectFit: 'cover' }} />
                </div>
                <div className="flex gap-3">
                  <button onClick={resetUpload} className="px-4 py-2 rounded-lg text-sm text-white/60 hover:text-white transition" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)' }}>
                    Change photo
                  </button>
                  <button
                    onClick={handleVerify}
                    className="px-6 py-2 rounded-lg text-sm font-semibold text-white flex items-center gap-2 transition hover:opacity-90"
                    style={{ background: `linear-gradient(135deg, ${accent.hex}, ${accent.hex}bb)` }}
                  >
                    <Zap className="w-4 h-4" /> Submit for AI Verification
                  </button>
                </div>
              </div>
            )}

            {uploadState === 'submitting' && (
              <div className="flex flex-col items-center gap-4 py-8">
                <div className="relative">
                  <div className="w-16 h-16 rounded-full animate-spin" style={{ border: `3px solid rgba(255,255,255,0.08)`, borderTopColor: accent.hex }} />
                  <Zap className="w-6 h-6 absolute inset-0 m-auto" style={{ color: accent.hex }} />
                </div>
                <div style={{ color: accent.hex, fontSize: 14, fontWeight: 600, letterSpacing: '0.06em' }}>
                  SENDING FOR VERIFICATION…
                </div>
                <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12 }}>
                  Your photo is sent for analysis and never stored
                </div>
              </div>
            )}

            {uploadState === 'rejected' && (
              <div className="flex flex-col items-center gap-3 py-6 text-center">
                <XCircle className="w-10 h-10" style={{ color: '#F87171' }} />
                <div style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>No progress detected</div>
                <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', maxWidth: 420, fontStyle: 'italic' }}>
                  "{message}"
                </div>
                <button
                  onClick={resetUpload}
                  className="mt-1 px-4 py-2 rounded-lg text-sm text-white/70 hover:text-white transition"
                  style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)' }}
                >
                  Try another photo
                </button>
              </div>
            )}

            {uploadState === 'error' && (
              <div className="flex flex-col items-center gap-3 py-6 text-center">
                <XCircle className="w-10 h-10" style={{ color: '#F87171' }} />
                <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.7)', maxWidth: 420 }}>{message}</div>
                <button
                  onClick={resetUpload}
                  className="mt-1 px-4 py-2 rounded-lg text-sm text-white/70 hover:text-white transition"
                  style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)' }}
                >
                  Try again
                </button>
              </div>
            )}

            {uploadState === 'verified' && (
              <div className="flex flex-col items-center gap-4 py-6">
                <CheckCircle className="w-12 h-12" style={{ color: '#34D399' }} />
                <div style={{ fontSize: 18, fontWeight: 700, color: '#fff' }}>
                  {target.kind === 'streak' ? 'Streak Verified!' : `${targetLabel} Verified!`}
                </div>
                <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', maxWidth: 400, textAlign: 'center', fontStyle: 'italic' }}>
                  "{message}"
                </div>
                <div style={{ fontSize: 12, color: '#34D399', fontWeight: 600 }}>
                  {streakDone ? 'Streak secured for today' : '+1 streak day added'}
                </div>
              </div>
            )}

            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFileSelect} />
          </>
        )}
      </div>

      {/* ── 30-day Grid ── */}
      <div className="glass p-5">
        <div style={{ fontSize: 11, letterSpacing: '0.12em', color: 'rgba(255,255,255,0.4)', marginBottom: 12, textTransform: 'uppercase' }}>
          Last 30 Days
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(10, 1fr)', gap: 6 }}>
          {grid.map((cell, i) => (
            <div
              key={i}
              title={cell.dateStr}
              style={{
                height: 36, borderRadius: 7,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 10, fontWeight: 600,
                background: cell.verified
                  ? `${accent.hex}33`
                  : cell.hasLog
                  ? 'rgba(255,77,46,0.15)'
                  : 'rgba(255,255,255,0.04)',
                border: cell.verified
                  ? `1px solid ${accent.hex}66`
                  : cell.hasLog
                  ? '1px solid rgba(255,77,46,0.3)'
                  : '1px solid rgba(255,255,255,0.07)',
                color: cell.verified ? accent.hex : 'rgba(255,255,255,0.35)',
              }}
            >
              {cell.verified
                ? <CheckCircle className="w-3.5 h-3.5" />
                : cell.hasLog
                ? <XCircle className="w-3.5 h-3.5" style={{ color: '#FF4D2E' }} />
                : cell.date}
            </div>
          ))}
        </div>
        <div className="flex gap-4 mt-4" style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>
          <div className="flex items-center gap-1.5">
            <span style={{ width: 10, height: 10, borderRadius: 3, background: `${accent.hex}33`, border: `1px solid ${accent.hex}66`, display: 'inline-block' }} />
            Verified
          </div>
          <div className="flex items-center gap-1.5">
            <span style={{ width: 10, height: 10, borderRadius: 3, background: 'rgba(255,77,46,0.15)', border: '1px solid rgba(255,77,46,0.3)', display: 'inline-block' }} />
            Missed
          </div>
          <div className="flex items-center gap-1.5">
            <span style={{ width: 10, height: 10, borderRadius: 3, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', display: 'inline-block' }} />
            No entry
          </div>
        </div>
      </div>
    </div>
  );
}
