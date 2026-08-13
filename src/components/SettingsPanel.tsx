import { useRef, useState } from 'react';
import { X, Check, LogOut, Upload, Trash2, Pencil } from 'lucide-react';
import { Person } from '../data';
import { ACCENTS, ACCENT_LIST, AccentKey } from '../theme';
import { useAuth } from '../lib/auth';
import { useXp } from '../lib/xp';
import Avatar from './Avatar';

interface Props {
  user: Person;
  open: boolean;
  onClose: () => void;
  onPick: (k: AccentKey) => void;
}

export default function SettingsPanel({ user, open, onClose, onPick }: Props) {
  const { signOut, squad, profile, avatarUrl, updateUsername, updateAvatar, removeAvatar } = useAuth();
  // Same ledger the header reads, not `user.level` — data.ts's level is still the demo 24.
  const { xp } = useXp();

  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [busy, setBusy] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileNote, setProfileNote] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const accentHex = ACCENTS[user.accent].hex;

  if (!open) return null;

  async function handleSignOut() {
    await signOut();
  }

  function startRename() {
    setDraftName(profile?.username ?? '');
    setProfileError(null);
    setProfileNote(null);
    setEditingName(true);
  }

  async function saveName() {
    setBusy(true);
    setProfileError(null);
    setProfileNote(null);
    const { error } = await updateUsername(draftName);
    setBusy(false);
    if (error) { setProfileError(error); return; }
    setEditingName(false);
    // Repeats the trade-off from the field's note, because this is the moment it becomes
    // true rather than hypothetical.
    setProfileNote('Display name updated. Your login is unchanged.');
  }

  async function pickFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setProfileError(null);
    setProfileNote(null);
    const { error } = await updateAvatar(file);
    setBusy(false);
    if (fileRef.current) fileRef.current.value = '';
    if (error) { setProfileError(error); return; }
    setProfileNote('Profile picture updated.');
  }

  async function clearAvatar() {
    setBusy(true);
    setProfileError(null);
    setProfileNote(null);
    const { error } = await removeAvatar();
    setBusy(false);
    if (error) { setProfileError(error); return; }
    setProfileNote('Profile picture removed.');
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative glass p-6 w-full max-w-md">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-white font-semibold text-lg">Settings</h2>
          <button onClick={onClose} className="w-8 h-8 grid place-items-center rounded-full hover:bg-white/10 transition">
            <X className="w-4 h-4 text-white/70" />
          </button>
        </div>

        <div className="mb-2 text-[11px] tracked-sm text-white/50">PROFILE</div>
        <div className="flex items-start gap-3.5 mb-3">
          {/* Avatar + its controls. The file input is hidden and driven by the button so
              the control matches the rest of the modal instead of rendering a browser
              "Choose file" widget. */}
          <div className="flex flex-col items-center gap-2 shrink-0">
            <Avatar url={avatarUrl} name={user.name} accentHex={accentHex} size={56} />
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              className="hidden"
              onChange={(e) => { void pickFile(e.target.files?.[0]); }}
            />
            <div className="flex items-center gap-1">
              <button
                onClick={() => fileRef.current?.click()}
                disabled={busy}
                title={profile?.avatar_path ? 'Replace picture' : 'Upload picture'}
                className="w-6 h-6 grid place-items-center rounded-md text-white/60 hover:text-white hover:bg-white/10 transition disabled:opacity-40"
              >
                <Upload className="w-3.5 h-3.5" />
              </button>
              {profile?.avatar_path && (
                <button
                  onClick={() => { void clearAvatar(); }}
                  disabled={busy}
                  title="Remove picture"
                  className="w-6 h-6 grid place-items-center rounded-md text-white/60 hover:text-red-300 hover:bg-red-500/10 transition disabled:opacity-40"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          <div className="min-w-0 flex-1 pt-0.5">
            {editingName ? (
              <div className="flex flex-col gap-2">
                <input
                  value={draftName}
                  autoFocus
                  onChange={(e) => setDraftName(e.target.value.toLowerCase().slice(0, 20))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void saveName();
                    if (e.key === 'Escape') { setEditingName(false); setProfileError(null); }
                  }}
                  className="w-full bg-white/5 border border-white/12 rounded-lg px-2.5 py-1.5 text-sm text-white outline-none focus:border-white/30 transition"
                  placeholder="new_username"
                />
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => { void saveName(); }}
                    disabled={busy || !draftName.trim()}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition hover:brightness-110 disabled:opacity-40"
                    style={{ background: accentHex, border: 'none' }}
                  >
                    {busy ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    onClick={() => { setEditingName(false); setProfileError(null); }}
                    className="px-3 py-1.5 rounded-lg text-xs bg-white/6 border border-white/10 text-white/70 hover:bg-white/10 transition"
                  >
                    Cancel
                  </button>
                </div>
                {/* The trade-off, stated where the decision is made rather than
                    discovered at the next sign-in. */}
                <p className="text-[11px] text-white/35 leading-relaxed">
                  Your login stays the same — only your display name changes.
                  <br />
                  3–20 characters: lowercase letters, numbers, underscore.
                </p>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <span className="text-white font-semibold truncate">{user.name}</span>
                  <button
                    onClick={startRename}
                    title="Change username"
                    className="w-6 h-6 grid place-items-center rounded-md text-white/45 hover:text-white hover:bg-white/10 transition shrink-0"
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                </div>
                <div className="text-xs text-white/45 truncate mt-0.5">
                  {xp ? `Level ${xp.level} · ${xp.total.toLocaleString()} XP` : 'Level —'} · {user.handle}
                </div>
              </>
            )}
          </div>
        </div>

        {profileError && (
          <div className="mb-3 text-[12px] text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
            {profileError}
          </div>
        )}
        {profileNote && !profileError && (
          <div className="mb-3 text-[12px] text-white/60 bg-white/5 border border-white/10 rounded-lg px-3 py-2">
            {profileNote}
          </div>
        )}
        <div className="mb-5" />

        {squad && (
          <>
            <div className="mb-2 text-[11px] tracked-sm text-white/50">SQUAD</div>
            <div className="flex items-center gap-3 mb-5 p-3 rounded-xl bg-white/[0.03] border border-white/10">
              <div className="min-w-0 flex-1">
                <div className="text-white text-sm font-semibold truncate">{squad.name}</div>
                <div className="text-[11px] text-white/40 mt-0.5">Share this code to invite squadmates</div>
              </div>
              <span className="font-mono text-sm tracking-[0.2em] px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-white/80">
                {squad.join_code}
              </span>
            </div>
          </>
        )}

        <div className="mb-2 text-[11px] tracked-sm text-white/50">ACCENT THEME</div>
        <p className="text-[12px] text-white/45 mb-3">Pick a cosmic preset. Everything re-themes instantly.</p>
        <div className="grid grid-cols-1 gap-2">
          {ACCENT_LIST.map((a) => {
            const selected = user.accent === a.key;
            return (
              <button
                key={a.key}
                onClick={() => onPick(a.key)}
                className="flex items-center gap-3 p-3 rounded-xl border transition"
                style={{
                  background: selected ? `${a.hex}1a` : 'rgba(255,255,255,0.03)',
                  borderColor: selected ? a.hex : 'rgba(255,255,255,0.08)',
                }}
              >
                <span
                  className="w-7 h-7 rounded-full shrink-0"
                  style={{ background: a.hex, boxShadow: `0 0 16px -2px ${a.hex}80` }}
                />
                <span className="text-white text-sm font-semibold flex-1 text-left">{a.name}</span>
                <span className="text-[10px] text-white/40 font-mono">{a.hex}</span>
                {selected && (
                  <span className="w-5 h-5 grid place-items-center rounded-full" style={{ background: a.hex }}>
                    <Check className="w-3 h-3 text-white" />
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Kept the rule the removed preset caption used to sit under — it is what
            separates the theme list from the destructive action below it. */}
        <div className="mt-5 border-t border-white/5" />

        <button
          onClick={handleSignOut}
          className="mt-4 w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold text-white/80 bg-white/5 border border-white/10 hover:bg-white/10 transition"
        >
          <LogOut className="w-4 h-4" /> Sign Out
        </button>
      </div>
    </div>
  );
}
