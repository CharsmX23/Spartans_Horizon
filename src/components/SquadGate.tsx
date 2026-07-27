import { useState, FormEvent } from 'react';
import { Users, KeyRound, Loader2, Plus, LogOut } from 'lucide-react';
import { useAuth } from '../lib/auth';

type Mode = 'join' | 'create';

/**
 * Shown after sign-in when the account has no squad yet. Everything downstream
 * (projects, the calendar, the squad roster) is scoped to a squad, so this is a
 * hard gate rather than a dismissible prompt.
 */
export default function SquadGate() {
  const { profile, createSquad, joinSquad, signOut } = useAuth();
  const [mode, setMode] = useState<Mode>('join');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = mode === 'join' ? code.trim().length === 6 : name.trim().length >= 2;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    const { error } = mode === 'join' ? await joinSquad(code) : await createSquad(name);
    setSubmitting(false);
    if (error) setError(error);
    // On success the profile refresh flips squad_id and this gate unmounts.
  }

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10 relative overflow-hidden bg-ink">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 60% 50% at 50% 0%, rgba(232,16,42,0.18) 0%, transparent 60%), radial-gradient(ellipse 40% 40% at 50% 100%, rgba(56,189,248,0.10) 0%, transparent 60%)',
        }}
      />
      <div className="relative w-full max-w-md">
        <div className="flex flex-col items-center mb-7">
          <div
            className="w-14 h-14 rounded-2xl grid place-items-center mb-3"
            style={{
              background: 'linear-gradient(135deg, #E8102A, #E8102A99)',
              boxShadow: '0 12px 40px -10px rgba(232,16,42,0.7)',
            }}
          >
            <Users className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-white font-extrabold text-xl tracking-tight">FIND YOUR SQUAD</h1>
          {profile && (
            <p className="text-white/40 text-xs mt-1">
              Signed in as <span className="text-white/70">@{profile.username}</span>
            </p>
          )}
        </div>

        <div className="glass p-7">
          <div className="flex p-1 rounded-xl bg-white/5 border border-white/10 mb-6">
            <button
              type="button"
              onClick={() => switchMode('join')}
              className="flex-1 py-2 rounded-lg text-sm font-semibold transition"
              style={
                mode === 'join'
                  ? { background: 'var(--accent)', color: '#fff' }
                  : { color: 'rgba(255,255,255,0.55)' }
              }
            >
              Join a Squad
            </button>
            <button
              type="button"
              onClick={() => switchMode('create')}
              className="flex-1 py-2 rounded-lg text-sm font-semibold transition"
              style={
                mode === 'create'
                  ? { background: 'var(--accent)', color: '#fff' }
                  : { color: 'rgba(255,255,255,0.55)' }
              }
            >
              Create One
            </button>
          </div>

          <h2 className="text-white font-bold text-lg mb-1">
            {mode === 'join' ? 'Enter your squad code.' : 'Start a new squad.'}
          </h2>
          <p className="text-white/45 text-xs mb-5">
            {mode === 'join'
              ? 'Ask a squadmate for the 6-character join code.'
              : "You'll get a join code to share with the rest of the squad."}
          </p>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {mode === 'join' ? (
              <div>
                <label className="text-[11px] text-white/50 font-semibold mb-1.5 block">JOIN CODE</label>
                <div className="relative">
                  <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/35" />
                  <input
                    type="text"
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 6))}
                    placeholder="A1B2C3"
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    required
                    className="w-full bg-white/5 border border-white/10 rounded-xl pl-10 pr-3 py-2.5 text-sm text-white font-mono tracking-[0.25em] placeholder:text-white/30 placeholder:tracking-normal outline-none focus:border-white/25 transition"
                  />
                </div>
              </div>
            ) : (
              <div>
                <label className="text-[11px] text-white/50 font-semibold mb-1.5 block">SQUAD NAME</label>
                <div className="relative">
                  <Users className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/35" />
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value.slice(0, 40))}
                    placeholder="The 300"
                    autoComplete="off"
                    required
                    minLength={2}
                    className="w-full bg-white/5 border border-white/10 rounded-xl pl-10 pr-3 py-2.5 text-sm text-white placeholder:text-white/30 outline-none focus:border-white/25 transition"
                  />
                </div>
              </div>
            )}

            {error && (
              <div className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || !canSubmit}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ background: 'var(--accent)', boxShadow: '0 8px 24px -8px var(--accent)' }}
            >
              {submitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : mode === 'join' ? (
                <KeyRound className="w-4 h-4" />
              ) : (
                <Plus className="w-4 h-4" />
              )}
              {submitting ? 'Please wait…' : mode === 'join' ? 'Join Squad' : 'Create Squad'}
            </button>
          </form>

          <button
            onClick={() => signOut()}
            className="mt-5 w-full flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-semibold text-white/60 bg-white/5 border border-white/10 hover:bg-white/10 hover:text-white/80 transition"
          >
            <LogOut className="w-3.5 h-3.5" /> Sign Out
          </button>
        </div>
      </div>
    </div>
  );
}
