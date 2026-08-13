import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from './supabase';

/**
 * Auth is username + password (no OAuth, no real email). We map a username onto a
 * synthetic email so Supabase Auth still handles sessions, refresh, and hashing —
 * see EMAIL_DOMAIN below. `Profile` is the public.users row; auth.users holds the
 * credentials and is joined on id.
 */

const EMAIL_DOMAIN = 'spartans.local';

export const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

export function normalizeUsername(username: string) {
  return username.trim().toLowerCase();
}

export function usernameToEmail(username: string) {
  return `${normalizeUsername(username)}@${EMAIL_DOMAIN}`;
}

/** Private bucket; every object lives at `<user_id>/avatar`. */
const AVATAR_BUCKET = 'avatars';
const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
const AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

/**
 * Signed-URL lifetime. Long, because the only cost of a long one here is that a squadmate
 * who leaves the squad keeps a working link to an avatar for up to this long — and short
 * ones break the image in a tab left open over lunch, which is the failure people
 * actually hit. Re-minted on every profile load regardless.
 */
const AVATAR_URL_TTL_SECONDS = 60 * 60 * 24 * 7;

export interface Profile {
  id: string;
  username: string;
  squad_id: string | null;
  current_streak: number;
  last_checkin_date: string | null;
  /** Object path in the private bucket, or null. Not a URL — see avatarUrl. */
  avatar_path: string | null;
}

export interface Squad {
  id: string;
  name: string;
  join_code: string;
  created_by: string | null;
}

interface AuthResult {
  error: string | null;
}

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  squad: Squad | null;
  loading: boolean;
  /** False until the profile fetch for the current session has completed (even if empty). */
  profileReady: boolean;
  /**
   * A freshly signed URL for `profile.avatar_path`, or null when no avatar is set.
   * Minted on every profile load because signed URLs expire; never persisted.
   */
  avatarUrl: string | null;
  signIn: (username: string, password: string) => Promise<AuthResult>;
  signUp: (username: string, password: string) => Promise<AuthResult>;
  signOut: () => Promise<void>;
  createSquad: (name: string) => Promise<AuthResult>;
  joinSquad: (joinCode: string) => Promise<AuthResult>;
  refreshProfile: () => Promise<void>;
  updateUsername: (username: string) => Promise<AuthResult>;
  updateAvatar: (file: File) => Promise<AuthResult>;
  removeAvatar: () => Promise<AuthResult>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [squad, setSquad] = useState<Squad | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileLoadedFor, setProfileLoadedFor] = useState<string | null>(null);

  const userId = session?.user.id ?? null;

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setLoading(false);
    });

    // No awaits on supabase calls inside this callback — supabase-js can deadlock if
    // the handler re-enters the client. Profile loading is a separate effect keyed on
    // the user id instead.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      setLoading(false);
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const loadProfile = useCallback(async (id: string) => {
    const { data: profileRow } = await supabase
      .from('users')
      .select('id, username, squad_id, current_streak, last_checkin_date, avatar_path')
      .eq('id', id)
      .maybeSingle();

    setProfile((profileRow as Profile | null) ?? null);

    // The bucket is private, so the <img> needs a signed URL rather than a public one.
    // Minted here — on every load — because these expire; storing one on the row would
    // guarantee a broken image later. A failure is not surfaced: a missing avatar falls
    // back to the monogram, which is a fine outcome for a decorative field.
    const path = (profileRow as Profile | null)?.avatar_path ?? null;
    if (path) {
      const { data: signed } = await supabase
        .storage.from(AVATAR_BUCKET)
        .createSignedUrl(path, AVATAR_URL_TTL_SECONDS);
      setAvatarUrl(signed?.signedUrl ?? null);
    } else {
      setAvatarUrl(null);
    }

    if (profileRow?.squad_id) {
      const { data: squadRow } = await supabase
        .from('squads')
        .select('id, name, join_code, created_by')
        .eq('id', profileRow.squad_id)
        .maybeSingle();
      setSquad((squadRow as Squad | null) ?? null);
    } else {
      setSquad(null);
    }
    setProfileLoadedFor(id);
  }, []);

  useEffect(() => {
    if (!userId) {
      setProfile(null);
      setSquad(null);
      setAvatarUrl(null);
      setProfileLoadedFor(null);
      return;
    }
    void loadProfile(userId);
  }, [userId, loadProfile]);

  const refreshProfile = useCallback(async () => {
    if (userId) await loadProfile(userId);
  }, [userId, loadProfile]);

  async function signIn(username: string, password: string): Promise<AuthResult> {
    const name = normalizeUsername(username);
    if (!USERNAME_RE.test(name)) {
      return { error: 'Usernames are 3-20 characters: lowercase letters, numbers, underscore.' };
    }
    const { error } = await supabase.auth.signInWithPassword({
      email: usernameToEmail(name),
      password,
    });
    if (!error) return { error: null };
    // Supabase reports an unknown username and a wrong password identically.
    return {
      error: error.message.toLowerCase().includes('invalid login')
        ? 'Incorrect username or password.'
        : error.message,
    };
  }

  async function signUp(username: string, password: string): Promise<AuthResult> {
    const name = normalizeUsername(username);
    if (!USERNAME_RE.test(name)) {
      return { error: 'Usernames are 3-20 characters: lowercase letters, numbers, underscore.' };
    }

    // Fail fast with a clear message. The unique index is the real guard against the
    // gap between this check and the insert.
    const { data: available, error: checkError } = await supabase.rpc('username_available', {
      p_username: name,
    });
    if (!checkError && available === false) {
      return { error: 'That username is taken.' };
    }

    const { error } = await supabase.auth.signUp({
      email: usernameToEmail(name),
      password,
      options: { data: { username: name } },
    });

    if (!error) return { error: null };
    // The profile trigger runs inside the signup transaction, so a unique-username
    // collision surfaces here as a generic database error.
    return {
      error: error.message.toLowerCase().includes('database error')
        ? 'That username is taken.'
        : error.message,
    };
  }

  async function signOut() {
    await supabase.auth.signOut();
    setProfile(null);
    setSquad(null);
    setAvatarUrl(null);
  }

  /**
   * Change your display name.
   *
   * One write: `public.users.username`, through the grant `UPDATE (username) ON users`
   * and the owner-scoped RLS policy that have both existed since the table did. Nothing
   * server-side was added for this.
   *
   * ── The login credential deliberately does NOT move ──────────────────────────────
   * Sign-in maps `<username>@spartans.local` onto `auth.users.email`, and that address is
   * fixed at signup. This function does not touch it, so after a rename you still sign in
   * under the name you registered with — this is a display-name change and nothing more.
   *
   * That is a deliberate simplification, not an oversight. Keeping the two in step meant
   * a second write to `auth.users` plus a revert if it failed, and Supabase's "Secure
   * email change" made even the success path unreliable: it returns OK while parking the
   * address in `new_email` pending a confirmation click that a `@spartans.local` address
   * can never receive. One write that always does exactly what it says beats two writes
   * that sometimes silently half-apply.
   *
   * The cost is that the login and the display name drift apart, so `SettingsPanel` says
   * so at the rename field rather than leaving it to be discovered at the next sign-in.
   *
   * Validation is deliberately the same regex as signup (`USERNAME_RE`), which is itself
   * the same rule as the Postgres CHECK. Three copies of one rule is two too many, but
   * they are already there and this is not the change that unifies them.
   */
  async function updateUsername(username: string): Promise<AuthResult> {
    if (!profile) return { error: 'Not signed in.' };

    const name = normalizeUsername(username);
    if (name === profile.username) return { error: null };
    if (!USERNAME_RE.test(name)) {
      return { error: 'Usernames are 3-20 characters: lowercase letters, numbers, underscore.' };
    }

    const { error: rowError } = await supabase
      .from('users')
      .update({ username: name })
      .eq('id', profile.id);

    if (rowError) {
      // 23505 = users_username_key, 23514 = the format CHECK. Both are expected outcomes
      // of ordinary input, so they get sentences rather than a raw Postgres string.
      if (rowError.code === '23505') return { error: 'That username is taken.' };
      if (rowError.code === '23514') {
        return { error: 'Usernames are 3-20 characters: lowercase letters, numbers, underscore.' };
      }
      return { error: rowError.message };
    }

    await refreshProfile();
    return { error: null };
  }

  /** Shared by updateAvatar and the SettingsPanel's pre-flight message. */
  function validateAvatar(file: File): string | null {
    if (!AVATAR_TYPES.includes(file.type)) return 'Pick a JPEG, PNG, WebP or GIF image.';
    if (file.size > AVATAR_MAX_BYTES) return 'That image is over 2 MB — pick a smaller one.';
    return null;
  }

  /**
   * Upload or replace your avatar.
   *
   * One object per user at a fixed path, `upsert: true`, so replacing overwrites rather
   * than accumulating orphans. The bucket's own size and mime limits reject a crafted
   * upload server-side; the check above is only there to fail fast with a readable
   * message instead of a 400 from Storage.
   *
   * The row write is second: an `avatar_path` pointing at an object that failed to upload
   * would render as a permanently broken image, whereas an uploaded object with no row
   * pointing at it is merely 40 KB of waste.
   */
  async function updateAvatar(file: File): Promise<AuthResult> {
    if (!profile) return { error: 'Not signed in.' };

    const invalid = validateAvatar(file);
    if (invalid) return { error: invalid };

    const path = `${profile.id}/avatar`;

    const { error: uploadError } = await supabase.storage
      .from(AVATAR_BUCKET)
      .upload(path, file, { upsert: true, contentType: file.type });

    if (uploadError) return { error: uploadError.message };

    const { error: rowError } = await supabase
      .from('users')
      .update({ avatar_path: path })
      .eq('id', profile.id);

    if (rowError) return { error: rowError.message };

    await refreshProfile();
    return { error: null };
  }

  /**
   * Clear the avatar. The row is cleared first and the object removed second: if the
   * delete fails, the result is an unreferenced object, which is invisible. The other
   * order would leave the row pointing at nothing, which renders as a broken image.
   */
  async function removeAvatar(): Promise<AuthResult> {
    if (!profile) return { error: 'Not signed in.' };
    if (!profile.avatar_path) return { error: null };

    const path = profile.avatar_path;

    const { error: rowError } = await supabase
      .from('users')
      .update({ avatar_path: null })
      .eq('id', profile.id);

    if (rowError) return { error: rowError.message };

    await supabase.storage.from(AVATAR_BUCKET).remove([path]);
    await refreshProfile();
    return { error: null };
  }

  async function createSquad(name: string): Promise<AuthResult> {
    const { error } = await supabase.rpc('create_squad', { p_name: name.trim() });
    if (error) return { error: error.message };
    await refreshProfile();
    return { error: null };
  }

  async function joinSquad(joinCode: string): Promise<AuthResult> {
    const { error } = await supabase.rpc('join_squad', {
      p_join_code: joinCode.trim().toUpperCase(),
    });
    if (error) return { error: error.message };
    await refreshProfile();
    return { error: null };
  }

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        profile,
        squad,
        loading,
        profileReady: userId !== null && profileLoadedFor === userId,
        avatarUrl,
        signIn,
        signUp,
        signOut,
        createSquad,
        joinSquad,
        refreshProfile,
        updateUsername,
        updateAvatar,
        removeAvatar,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
