import { AccentKey, defaultAccentForName } from './theme';

export interface Person {
  id: string;
  name: string;
  handle: string;
  level: number;
  accent: AccentKey;
  streak: number;
  avatar: string;
  online: boolean;
}

export const PEOPLE: Person[] = [
  { id: 'u1', name: 'Charsm', handle: '@charsm', level: 24, accent: 'ember', streak: 47, avatar: 'https://i.pravatar.cc/100?img=12', online: true },
  { id: 'u2', name: 'Madhi', handle: '@madhi', level: 19, accent: 'nebula', streak: 32, avatar: 'https://i.pravatar.cc/100?img=32', online: true },
  { id: 'u3', name: 'Kade', handle: '@kade', level: 17, accent: 'ion', streak: 12, avatar: 'https://i.pravatar.cc/100?img=15', online: true },
  { id: 'u4', name: 'Rae', handle: '@rae', level: 22, accent: 'supernova', streak: 8, avatar: 'https://i.pravatar.cc/100?img=45', online: false },
  { id: 'u5', name: 'Vesh', handle: '@vesh', level: 31, accent: 'aurora', streak: 120, avatar: 'https://i.pravatar.cc/100?img=53', online: true },
  { id: 'u6', name: 'Nori', handle: '@nori', level: 14, accent: 'ion', streak: 3, avatar: 'https://i.pravatar.cc/100?img=24', online: false },
];

export const CURRENT_USER_ID = 'u1';

export function getCurrentUser() {
  const p = PEOPLE.find((x) => x.id === CURRENT_USER_ID)!;
  return { ...p, accent: (p.accent || defaultAccentForName(p.name)) as AccentKey };
}

export type DayStatus = 'done' | 'today' | 'pending' | 'deadline' | 'empty';

export interface CalDay {
  date: number;
  inMonth: boolean;
  status: DayStatus;
  eventLabel?: string;
}

export interface TodayItem {
  id: string;
  icon: string;
  label: string;
  status: 'done' | 'elapsed' | 'pending';
  meta: string;
}

export interface Deadline {
  id: string;
  title: string;
  daysLeft: number;
  progress: number;
  priority: 'Critical' | 'High' | 'Medium';
  icon: string;
}

export interface TechCard {
  id: string;
  category: string;
  readMins: number;
  headline: string;
  summary: string;
}

export interface StartupIdea {
  id: string;
  title: string;
  rating: number;
  description: string;
  tags: string[];
  upvotes: number;
  comments: number;
  views: number;
  icon: string;
}

export interface ActivityItem {
  id: string;
  personId: string;
  action: string;
  timestamp: string;
}

export const TODAY_ITEMS: TodayItem[] = [
  { id: 't1', icon: 'Code2', label: 'Refactor auth middleware', status: 'elapsed', meta: '2h 14m' },
  { id: 't2', icon: 'BookOpen', label: 'Read: SSE vs WebSockets', status: 'done', meta: 'Done · 18m' },
  { id: 't3', icon: 'Dumbbell', label: 'Morning workout', status: 'done', meta: 'Done · 45m' },
  { id: 't4', icon: 'PenLine', label: 'Daily journal', status: 'pending', meta: 'Pending' },
];

export const DEADLINES: Deadline[] = [
  { id: 'd1', title: 'Ship MVP v0.4 to beta cohort', daysLeft: 3, progress: 78, priority: 'Critical', icon: 'Rocket' },
  { id: 'd2', title: 'Reverse-engineer license check', daysLeft: 6, progress: 41, priority: 'High', icon: 'Binary' },
  { id: 'd3', title: 'Publish research note on entropy', daysLeft: 12, progress: 22, priority: 'Medium', icon: 'BookOpen' },
  { id: 'd4', title: 'Squad sync — Q3 roadmap', daysLeft: 9, progress: 60, priority: 'High', icon: 'Users' },
];

export const TECH_TODAY: TechCard = {
  id: 'tc1',
  category: 'Frontend',
  readMins: 6,
  headline: 'React 19 compiler memoization in the wild',
  summary: 'How the new compiler eliminates most useMemo/useCallback boilerplate.',
};

export const INDUSTRY_UPDATE: TechCard = {
  id: 'tc2',
  category: 'AI',
  readMins: 4,
  headline: 'OpenAI ships cheaper batch inference tier',
  summary: '50% cost reduction for async workloads up to 24h latency.',
};

export const STARTUP_IDEAS: StartupIdea[] = [
  { id: 's1', title: 'Glasshouse — solo-founder analytics', rating: 5, description: 'Privacy-first product analytics for one-person startups.', tags: ['SaaS', 'Privacy', 'Analytics'], upvotes: 142, comments: 28, views: 1840, icon: 'BarChart3' },
  { id: 's2', title: 'Driftwood — async standups', rating: 4, description: 'Voice-first async standups with auto summaries.', tags: ['Productivity', 'Voice'], upvotes: 88, comments: 12, views: 940, icon: 'Mic' },
  { id: 's3', title: 'Ember — habit forge', rating: 4, description: 'Streaks with on-chain proof of work.', tags: ['Habits', 'Crypto'], upvotes: 64, comments: 9, views: 510, icon: 'Flame' },
];

export const ACTIVITY: ActivityItem[] = [
  { id: 'a1', personId: 'u5', action: 'shipped a new edge function', timestamp: '2m ago' },
  { id: 'a2', personId: 'u2', action: 'closed 3 issues in the auth flow', timestamp: '18m ago' },
  { id: 'a3', personId: 'u3', action: 'reached a 12-day streak', timestamp: '1h ago' },
  { id: 'a4', personId: 'u4', action: 'posted a new startup idea', timestamp: '3h ago' },
  { id: 'a5', personId: 'u6', action: 'completed today\'s tech digest', timestamp: '5h ago' },
];

export interface BlueprintTrack {
  id: string;
  category: string;
  completed: number;
  total: number;
  color: string;
}

export const BLUEPRINT_TRACKS: BlueprintTrack[] = [
  { id: 'bp1', category: 'RE Curriculum', completed: 8, total: 12, color: '#E8102A' },
  { id: 'bp2', category: 'AI Security Tooling', completed: 4, total: 10, color: '#F5A524' },
  { id: 'bp3', category: 'Web3 Track', completed: 2, total: 8, color: '#34D399' },
];

export const HABITS = [
  { id: 'h1', icon: 'Dumbbell', label: 'Workout', done: true },
  { id: 'h2', icon: 'Code2', label: 'Deep work block', done: true },
  { id: 'h3', icon: 'BookOpen', label: 'Read 20 pages', done: false },
  { id: 'h4', icon: 'Moon', label: 'Sleep by 11pm', done: false },
];

// Build a 5x7 calendar grid for a given month
export function buildCalendar(year: number, month: number): CalDay[] {
  const first = new Date(year, month, 1);
  const startDay = first.getDay(); // 0 Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date();
  const isThisMonth = today.getFullYear() === year && today.getMonth() === month;
  const todayDate = isThisMonth ? today.getDate() : -1;

  const cells: CalDay[] = [];
  // leading empty cells
  for (let i = 0; i < startDay; i++) {
    cells.push({ date: 0, inMonth: false, status: 'empty' });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    let status: DayStatus = 'pending';
    let eventLabel: string | undefined;
    if (d < todayDate) status = 'done';
    if (d === todayDate) status = 'today';
    if ([7, 14, 21, 28].includes(d)) { status = d < todayDate ? 'done' : d === todayDate ? 'today' : 'deadline'; eventLabel = 'Checkpoint'; }
    if (d === 19) { status = 'deadline'; eventLabel = 'Beta review'; }
    cells.push({ date: d, inMonth: true, status, eventLabel });
  }
  while (cells.length % 7 !== 0) cells.push({ date: 0, inMonth: false, status: 'empty' });
  // ensure 5 rows = 35 cells
  while (cells.length < 35) cells.push({ date: 0, inMonth: false, status: 'empty' });
  return cells.slice(0, 35);
}

// Compact day strip — only in-month days, no padding, no leading empties
export function buildDayStrip(year: number, month: number): CalDay[] {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date();
  const isThisMonth = today.getFullYear() === year && today.getMonth() === month;
  const todayDate = isThisMonth ? today.getDate() : -1;

  const cells: CalDay[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    let status: DayStatus = 'pending';
    let eventLabel: string | undefined;
    if (d < todayDate) status = 'done';
    if (d === todayDate) status = 'today';
    if ([7, 14, 21, 28].includes(d)) {
      status = d < todayDate ? 'done' : d === todayDate ? 'today' : 'deadline';
      eventLabel = 'Checkpoint';
    }
    if (d === 19) { status = 'deadline'; eventLabel = 'Beta review'; }
    cells.push({ date: d, inMonth: true, status, eventLabel });
  }
  return cells;
}

export const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
export const DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
