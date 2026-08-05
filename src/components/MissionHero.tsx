import { ChevronLeft, ChevronRight, Check, Circle } from 'lucide-react';
import { useState, useEffect } from 'react';
import { Person, buildDayStrip, MONTH_NAMES, CalDay } from '../data';
import { Mission, loadMissions, daysLeft } from '../lib/missions';
import { HabitToday, loadHabits, habitIcon } from '../lib/habits';
import { ACCENTS } from '../theme';
import ThunderBackground from './SpiralBackground';

interface Props { user: Person; }

const WARN = '#FF4D2E';
const CELL_H = 44;
const CELL_GAP = 5;

export default function MissionHero({ user }: Props) {
  const accent = ACCENTS[user.accent];
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [missions, setMissions] = useState<Mission[] | null>(null);
  const [habits, setHabits] = useState<HabitToday[] | null>(null);

  const days = buildDayStrip(year, month);
  const todayDate = now.getDate();
  const isThisMonth = now.getFullYear() === year && now.getMonth() === month;
  const firstDow = new Date(year, month, 1).getDay();

  const shift = (dir: number) => {
    let m = month + dir, y = year;
    if (m < 0) { m = 11; y--; }
    if (m > 11) { m = 0; y++; }
    setMonth(m); setYear(y);
  };

  useEffect(() => {
    let mounted = true;
    loadMissions().then(({ data }) => { if (mounted && data) setMissions(data); });
    loadHabits().then(({ data }) => { if (mounted) setHabits(data ?? []); });
    return () => { mounted = false; };
  }, []);

  // Real missions, nearest deadline first. loadMissions() already sorts; undated ones
  // have nothing to count down to, so they are left out of this panel.
  const deadlineItems = (missions ?? []).filter(m => m.deadline).slice(0, 5);

  return (
    <section className="glass" style={{ position: 'relative', padding: '22px 24px 26px' }}>
      {/* Thunder background, self-clipping */}
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', borderRadius: 18, zIndex: 0 }}>
        <ThunderBackground accent={accent.hex} accentKey={user.accent} />
      </div>

      {/* Content: left column + right Today panel side-by-side */}
      <div style={{ position: 'relative', zIndex: 10, display: 'flex', gap: 16, alignItems: 'flex-start' }}>

        {/* ── LEFT column ── */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Welcome */}
          <div style={{ marginBottom: 16 }}>
            <h1 style={{ fontSize: 28, fontWeight: 800, color: '#fff', lineHeight: 1, letterSpacing: '-0.02em', margin: 0 }}>
              Welcome back, <span style={{ color: accent.hex }}>{user.name}</span>.
            </h1>
            <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 13, marginTop: 6 }}>
              Every day is another mission.
            </p>
          </div>

          {/* Month nav + legend */}
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button onClick={() => shift(-1)} className="w-6 h-6 grid place-items-center rounded-md hover:bg-white/10 transition">
                <ChevronLeft className="w-3.5 h-3.5 text-white/60" />
              </button>
              <span style={{ color: '#fff', fontWeight: 600, fontSize: 12, letterSpacing: '0.05em', minWidth: 110, textAlign: 'center' }}>
                {MONTH_NAMES[month]} {year}
              </span>
              <button onClick={() => shift(1)} className="w-6 h-6 grid place-items-center rounded-md hover:bg-white/10 transition">
                <ChevronRight className="w-3.5 h-3.5 text-white/60" />
              </button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 10, color: 'rgba(255,255,255,0.55)' }}>
              <Legend color={accent.hex} label="Done" />
              <Legend color={accent.hex} label="Today" ring />
              <Legend color="rgba(255,255,255,0.3)" label="Pending" />
              <Legend color={WARN} label="Deadline" />
            </div>
          </div>

          {/* DOW headers */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: CELL_GAP, marginBottom: 4 }}>
            {['S','M','T','W','T','F','S'].map((d, i) => (
              <div key={i} style={{ textAlign: 'center', fontSize: 9, color: 'rgba(255,255,255,0.3)', fontWeight: 600, letterSpacing: '0.05em' }}>{d}</div>
            ))}
          </div>

          {/* Day cells — 7-column grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: CELL_GAP }}>
            {Array.from({ length: firstDow }).map((_, i) => <div key={`e${i}`} style={{ height: CELL_H }} />)}
            {days.map((d) => (
              <DayBlock key={d.date} day={d} accent={accent.hex} todayDate={isThisMonth ? todayDate : -1} />
            ))}
          </div>
        </div>

        {/* ── RIGHT: Today panel (full-height beside welcome) ── */}
        <div style={{
          width: 228, flexShrink: 0,
          background: 'rgba(255,255,255,0.06)',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 14,
          padding: '14px 14px',
          display: 'flex', flexDirection: 'column', gap: 10,
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.10)',
          overflowY: 'auto',
          maxHeight: 340,
        }}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <span style={{ color: '#fff', fontWeight: 600, fontSize: 13 }}>Today</span>
            <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11 }}>
              {now.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
            </span>
          </div>

          {/* Today's habits — real ticks from verified completions, not fixtures */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {habits === null && (
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>Loading…</div>
            )}
            {habits !== null && habits.length === 0 && (
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>No habits yet.</div>
            )}
            {(habits ?? []).map((h) => {
              const Icon = habitIcon(h.icon);
              return (
                <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                  <span style={{
                    width: 20, height: 20, display: 'grid', placeItems: 'center',
                    borderRadius: 6, flexShrink: 0,
                    background: 'rgba(255,255,255,0.05)',
                    color: h.done_today ? '#34D399' : 'rgba(255,255,255,0.55)',
                  }}>
                    {h.done_today ? <Check className="w-3 h-3" /> : <Icon className="w-3 h-3" />}
                  </span>
                  <span style={{ flex: 1, color: 'rgba(255,255,255,0.75)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {h.title}
                  </span>
                  {h.done_today
                    ? <Check className="w-3 h-3" style={{ color: '#34D399', flexShrink: 0 }} />
                    : <Circle className="w-3 h-3" style={{ color: 'rgba(255,255,255,0.25)', flexShrink: 0 }} />}
                </div>
              );
            })}
          </div>

          {/* Deadlines — real missions, nearest first */}
          <div style={{ paddingTop: 4 }}>
            <div style={{ fontSize: 9, letterSpacing: '0.12em', color: 'rgba(255,255,255,0.38)', marginBottom: 8 }}>DEADLINES</div>
            {missions === null && (
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>Loading…</div>
            )}
            {missions !== null && deadlineItems.length === 0 && (
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>
                No missions with a deadline yet.
              </div>
            )}
            {deadlineItems.map((m) => {
              const days = daysLeft(m.deadline) ?? 0;
              const color = days < 0 ? '#FF4D2E'
                : days <= 3 ? '#FF4D2E'
                : days <= 7 ? '#FF8A1E'
                : 'rgba(255,255,255,0.55)';
              return (
                <div key={m.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.65)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 8 }}>
                    {m.title}
                  </span>
                  <span style={{ fontSize: 10, fontWeight: 600, color, flexShrink: 0 }}>{days}d</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

function Legend({ color, label, ring }: { color: string; label: string; ring?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <span style={ring
        ? { width: 7, height: 7, borderRadius: '50%', border: `1.5px solid ${color}`, display: 'inline-block', flexShrink: 0 }
        : { width: 7, height: 7, borderRadius: '50%', background: color, display: 'inline-block', flexShrink: 0 }} />
      {label}
    </div>
  );
}

function DayBlock({ day, accent, todayDate }: { day: CalDay; accent: string; todayDate: number }) {
  const isToday = day.date === todayDate;
  const isDone = day.status === 'done';
  const isDeadline = day.status === 'deadline';
  const hasDot = Boolean(day.eventLabel);
  const dotColor = isDeadline ? WARN : accent;

  return (
    <div style={{
      position: 'relative', height: CELL_H, borderRadius: 8,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 12, fontWeight: isToday ? 700 : 500,
      color: isToday ? '#fff' : isDone ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.70)',
      background: isToday ? 'rgba(255,255,255,0.10)' : isDone ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.045)',
      border: isToday ? `1.5px solid ${accent}` : '1px solid rgba(255,255,255,0.08)',
      boxShadow: isToday ? `0 0 18px -3px ${accent}70` : undefined,
      cursor: 'default', userSelect: 'none', transition: 'background 0.15s',
    }}>
      {String(day.date).padStart(2, '0')}
      {hasDot && (
        <span style={{
          position: 'absolute', top: 4, right: 4,
          width: 4, height: 4, borderRadius: '50%',
          background: dotColor, boxShadow: `0 0 6px ${dotColor}`,
        }} />
      )}
      {isDone && (
        <span style={{
          position: 'absolute', left: '12%', right: '12%', top: '50%',
          height: 1, background: 'rgba(255,255,255,0.22)',
          transform: 'rotate(-12deg)', pointerEvents: 'none',
        }} />
      )}
    </div>
  );
}
