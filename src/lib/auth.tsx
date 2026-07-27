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

export interface Profile {
  id: string;
  username: string;
  squad_id: string | null;
  current_streak: number;
  last_checkin_date: string | null;
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
  signIn: (username: string, password: string) => Promise<AuthResult>;
  signUp: (username: string, password: string) => Promise<AuthResult>;
  signOut: () => Promise<void>;
  createSquad: (name: string) => Promise<AuthResult>;
  joinSquad: (joinCode: string) => Promise<AuthResult>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [squad, setSquad] = useState<Squad | null>(null);
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
      .select('id, username, squad_id, current_streak, last_checkin_date')
      .eq('id', id)
      .maybeSingle();

    setProfile((profileRow as Profile | null) ?? null);

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
        signIn,
        signUp,
        signOut,
        createSquad,
        joinSquad,
        refreshProfile,
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
