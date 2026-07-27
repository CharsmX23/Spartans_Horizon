import { useEffect, useMemo, useState } from 'react';
import TopBar from './components/TopBar';
import Sidebar, { TabKey } from './components/Sidebar';
import MissionHero from './components/MissionHero';
import RightSidebar from './components/RightSidebar';
import { NextMissions, StartupIdeas } from './components/LowerSections';
import SettingsPanel from './components/SettingsPanel';
import MobileTabBar from './components/MobileTabBar';
import StreaksPage from './components/StreaksPage';
import JournalPage from './components/JournalPage';
import PowerUpPage from './components/PowerUpPage';
import GoalsPage from './components/GoalsPage';
import AuthPage from './components/AuthPage';
import SquadGate from './components/SquadGate';
import { getCurrentUser, Person } from './data';
import { ACCENTS, AccentKey, applyAccent } from './theme';
import { AuthProvider, useAuth } from './lib/auth';

function App() {
  return (
    <AuthProvider>
      <AppShell />
    </AuthProvider>
  );
}

function AppShell() {
  const { session, profile, profileReady, loading, signOut } = useAuth();
  const [accent, setAccent] = useState<AccentKey>(() => getCurrentUser().accent);
  const [tab, setTab] = useState<TabKey>('mission');
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    applyAccent(ACCENTS[accent].hex);
  }, [accent]);

  // Identity comes from the profile row; level/avatar are still demo data from
  // data.ts until those features land.
  const user: Person = useMemo(() => {
    const demo = getCurrentUser();
    if (!profile) return { ...demo, accent };
    return {
      ...demo,
      id: profile.id,
      name: profile.username,
      handle: `@${profile.username}`,
      streak: profile.current_streak,
      accent,
    };
  }, [profile, accent]);

  if (loading) {
    return <FullScreenMessage>Loading…</FullScreenMessage>;
  }

  if (!session) {
    return <AuthPage />;
  }

  if (!profileReady) {
    return <FullScreenMessage>Loading your profile…</FullScreenMessage>;
  }

  if (!profile) {
    // The signup trigger should make this unreachable; if it isn't, say so rather
    // than spinning forever.
    return (
      <FullScreenMessage>
        <div className="text-center">
          <p>This account has no profile row.</p>
          <button onClick={() => signOut()} className="mt-3 text-white/70 underline underline-offset-2">
            Sign out
          </button>
        </div>
      </FullScreenMessage>
    );
  }

  if (!profile.squad_id) {
    return <SquadGate />;
  }

  return (
    <div className="h-screen flex flex-col bg-ink text-white/80 overflow-hidden">
      <TopBar user={user} onOpenSettings={() => setSettingsOpen(true)} />

      <div className="flex flex-1 min-h-0">
        <Sidebar active={tab} onChange={setTab} />

        {tab === 'mission' ? (
          <div className="flex flex-1 min-w-0 gap-4 px-4 md:px-5 py-4 overflow-y-auto pb-20 md:pb-4">
            <div className="flex-1 min-w-0 flex flex-col gap-3">
              <MissionHero user={user} />
              <NextMissions compact />
              <StartupIdeas />
            </div>
            <div className="hidden xl:flex flex-col gap-3 w-[280px] shrink-0 overflow-y-auto">
              <RightSidebar user={user} />
            </div>
          </div>
        ) : tab === 'streaks' ? (
          <main className="flex-1 min-w-0 px-4 md:px-6 py-5 pb-24 md:pb-8 overflow-y-auto">
            <StreaksPage user={user} />
          </main>
        ) : tab === 'journal' ? (
          <main className="flex-1 min-w-0 px-4 md:px-6 py-5 pb-24 md:pb-8 overflow-hidden">
            <JournalPage />
          </main>
        ) : tab === 'powerup' ? (
          <main className="flex-1 min-w-0 px-4 md:px-6 py-5 pb-24 md:pb-8 overflow-y-auto">
            <PowerUpPage />
          </main>
        ) : tab === 'goals' ? (
          <main className="flex-1 min-w-0 px-4 md:px-6 py-5 pb-24 md:pb-8 overflow-y-auto">
            <GoalsPage />
          </main>
        ) : (
          <main className="flex-1 min-w-0 px-4 md:px-6 py-5 pb-24 md:pb-8 overflow-y-auto">
            <PlaceholderPage label={tab.charAt(0).toUpperCase() + tab.slice(1)} />
          </main>
        )}
      </div>

      <MobileTabBar active={tab} onChange={setTab} />
      <SettingsPanel
        user={user}
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onPick={setAccent}
      />
    </div>
  );
}

function FullScreenMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-screen grid place-items-center bg-ink text-white/40">
      <div className="text-sm">{children}</div>
    </div>
  );
}

function PlaceholderPage({ label }: { label: string }) {
  return (
    <div className="glass p-8 min-h-[60vh] grid place-items-center text-center">
      <div>
        <div className="text-white/80 text-lg font-semibold">{label}</div>
        <p className="text-white/40 text-sm mt-1">Coming soon — wire this tab to its data source.</p>
      </div>
    </div>
  );
}

export default App;
