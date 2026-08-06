import { useState, FormEvent } from 'react';
import { AtSign, Lock, LogIn, UserPlus, Loader2, ShieldCheck } from 'lucide-react';
import { useAuth } from '../lib/auth';
import CursorGlow from './CursorGlow';

type Mode = 'signin' | 'signup';

export default function AuthPage() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<Mode>('signin');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password) return;
    setSubmitting(true);
    setError(null);
    const fn = mode === 'signin' ? signIn : signUp;
    const { error } = await fn(username, password);
    setSubmitting(false);
    if (error) {
      setError(error);
    }
  }

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
  }

  return (
    // `isolate` gives the cursor glow's z-index:-1 a stacking context to sit in — above
    // this div's background, below the form.
    <div className="min-h-screen flex items-center justify-center px-4 py-10 relative overflow-hidden bg-ink isolate">
      <CursorGlow />

      {/* Ambient glow */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 60% 50% at 50% 0%, rgba(232,16,42,0.18) 0%, transparent 60%), radial-gradient(ellipse 40% 40% at 50% 100%, rgba(56,189,248,0.10) 0%, transparent 60%)',
        }}
      />
      <div className="relative w-full max-w-md">
        {/* Brand */}
        <div className="flex flex-col items-center mb-7">
          <div
            className="w-14 h-14 rounded-2xl grid place-items-center mb-3"
            style={{
              background: 'linear-gradient(135deg, #E8102A, #E8102A99)',
              boxShadow: '0 12px 40px -10px rgba(232,16,42,0.7)',
            }}
          >
            <ShieldCheck className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-white font-extrabold text-xl tracking-tight">EVENT HORIZON</h1>
          <p className="text-white/40 text-xs mt-1 tracked-sm">SPARTAN OPERATING SYSTEM</p>
        </div>

        <div className="glass p-7">
          {/* Mode toggle */}
          <div className="flex p-1 rounded-xl bg-white/5 border border-white/10 mb-6">
            <button
              type="button"
              onClick={() => switchMode('signin')}
              className="flex-1 py-2 rounded-lg text-sm font-semibold transition"
              style={
                mode === 'signin'
                  ? { background: 'var(--accent)', color: '#fff' }
                  : { color: 'rgba(255,255,255,0.55)' }
              }
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => switchMode('signup')}
              className="flex-1 py-2 rounded-lg text-sm font-semibold transition"
              style={
                mode === 'signup'
                  ? { background: 'var(--accent)', color: '#fff' }
                  : { color: 'rgba(255,255,255,0.55)' }
              }
            >
              Create Account
            </button>
          </div>

          <h2 className="text-white font-bold text-lg mb-1">
            {mode === 'signin' ? 'Welcome back, Spartan.' : 'Forge your account.'}
          </h2>
          <p className="text-white/45 text-xs mb-5">
            {mode === 'signin'
              ? 'Sign in to access your mission control.'
              : 'Create an account to start tracking your streaks and goals.'}
          </p>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <label className="text-[11px] text-white/50 font-semibold mb-1.5 block">USERNAME</label>
              <div className="relative">
                <AtSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/35" />
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="spartan_01"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  required
                  className="w-full bg-white/5 border border-white/10 rounded-xl pl-10 pr-3 py-2.5 text-sm text-white placeholder:text-white/30 outline-none focus:border-white/25 transition"
                />
              </div>
              {mode === 'signup' && (
                <p className="text-[10px] text-white/30 mt-1.5">
                  3–20 characters — lowercase letters, numbers, underscore.
                </p>
              )}
            </div>

            <div>
              <label className="text-[11px] text-white/50 font-semibold mb-1.5 block">PASSWORD</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/35" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 6 characters"
                  autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                  required
                  minLength={6}
                  className="w-full bg-white/5 border border-white/10 rounded-xl pl-10 pr-3 py-2.5 text-sm text-white placeholder:text-white/30 outline-none focus:border-white/25 transition"
                />
              </div>
            </div>

            {error && (
              <div className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || !username.trim() || password.length < 6}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ background: 'var(--accent)', boxShadow: '0 8px 24px -8px var(--accent)' }}
            >
              {submitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : mode === 'signin' ? (
                <LogIn className="w-4 h-4" />
              ) : (
                <UserPlus className="w-4 h-4" />
              )}
              {submitting ? 'Please wait…' : mode === 'signin' ? 'Sign In' : 'Create Account'}
            </button>
          </form>

          <p className="text-[11px] text-white/35 text-center mt-5">
            {mode === 'signin' ? (
              <>
                No account?{' '}
                <button onClick={() => switchMode('signup')} className="text-white/70 hover:text-white underline-offset-2 hover:underline">
                  Create one
                </button>
              </>
            ) : (
              <>
                Already have an account?{' '}
                <button onClick={() => switchMode('signin')} className="text-white/70 hover:text-white underline-offset-2 hover:underline">
                  Sign in
                </button>
              </>
            )}
          </p>
        </div>

        <p className="text-center text-[10px] text-white/25 mt-5">
          Your data is private to your account. Sign out anytime.
        </p>
      </div>
    </div>
  );
}
