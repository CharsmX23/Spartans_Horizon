import { useEffect, useState } from 'react';
import { Flame, Check, Circle, Camera, ArrowRight, Sparkles, ExternalLink } from 'lucide-react';
import { Person } from '../data';
import { HabitToday, loadHabits, habitIcon } from '../lib/habits';
import { ACCENTS } from '../theme';
import { Story, CuratedTopic, fetchCurated, commentsUrl, relativeTime, domainOf } from '../lib/hn';

interface Props {
  user: Person;
  onOpenStreaks: () => void;
  onOpenTechFeed: () => void;
}

export default function RightSidebar({ user, onOpenStreaks, onOpenTechFeed }: Props) {
  const accent = ACCENTS[user.accent];
  const [habits, setHabits] = useState<HabitToday[]>([]);

  useEffect(() => {
    let mounted = true;
    loadHabits().then(({ data }) => { if (mounted && data) setHabits(data); });
    return () => { mounted = false; };
  }, []);

  const ringPct = Math.min(user.streak / 60, 1);
  const r = 26;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - ringPct);

  return (
    <div className="flex flex-col gap-4">
      {/* Current Streak */}
      <div className="glass p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Flame className="w-4 h-4" style={{ color: accent.hex }} />
            <span className="text-[10px] tracked-sm text-white/50">CURRENT STREAK</span>
          </div>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-3xl font-extrabold text-white leading-none">{user.streak}<span className="text-base text-white/50 ml-1">Days</span></div>
            <p className="text-[11px] text-white/45 mt-1.5 leading-snug">Keep the chain alive.<br />One proof a day.</p>
          </div>
          <svg width="64" height="64" viewBox="0 0 64 64">
            <circle cx="32" cy="32" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="4" />
            <circle
              cx="32" cy="32" r={r} fill="none"
              stroke={accent.hex} strokeWidth="4" strokeLinecap="round"
              strokeDasharray={circ}
              strokeDashoffset={offset}
              transform="rotate(-90 32 32)"
              className="ring-anim"
              style={{ ['--ring-circ' as string]: circ, ['--ring-offset' as string]: offset, filter: `drop-shadow(0 0 6px ${accent.hex}80)` } as React.CSSProperties}
            />
          </svg>
        </div>
        {habits.length > 0 && (
          <div className="mt-3 pt-3 border-t border-white/5 flex flex-col gap-2">
            {habits.slice(0, 3).map((h) => {
              const Icon = habitIcon(h.icon);
              return (
                <div key={h.id} className="flex items-center gap-2 text-xs">
                  <span className="w-5 h-5 grid place-items-center rounded-md bg-white/5 text-white/60">
                    <Icon className="w-3 h-3" />
                  </span>
                  <span className="flex-1 text-white/70">{h.title}</span>
                  {h.done_today
                    ? <Check className="w-3.5 h-3.5" style={{ color: '#34D399' }} />
                    : <Circle className="w-3.5 h-3.5 text-white/20" />}
                </div>
              );
            })}
          </div>
        )}
        {/* Also the desktop entry point to Streaks, which no longer has a nav link. */}
        <button
          onClick={onOpenStreaks}
          className="mt-3 w-full py-2.5 rounded-full text-sm font-semibold flex items-center justify-center gap-2 transition hover:brightness-110"
          style={{ background: `linear-gradient(135deg, ${accent.hex}, ${accent.hex}99)`, color: 'white', boxShadow: `0 8px 24px -8px ${accent.hex}80` }}
        >
          <Camera className="w-4 h-4" /> Upload Proof
        </button>
      </div>

      {/* Curated Hacker News — each card searches its own subject */}
      <NewsPanel title="Today's Tech" topic="security" onSeeAll={onOpenTechFeed} />
      <NewsPanel title="Industry Update" topic="industry" onSeeAll={onOpenTechFeed} />

      {/* Insights — app-generated stats about your own work, not news */}
      <div className="glass p-4">
        <div className="flex items-center gap-2 mb-2">
          <Sparkles className="w-4 h-4" style={{ color: accent.hex }} />
          <span className="text-[10px] tracked-sm text-white/50">INSIGHTS</span>
        </div>
        <p className="text-sm text-white/75 leading-relaxed">
          Your streak trend is up <span style={{ color: '#34D399' }}>+18%</span> vs last week. You logged <span className="text-white font-semibold">14h 22m</span> of deep work — your strongest day was Tuesday.
        </p>
      </div>
    </div>
  );
}

function NewsPanel({ title, topic, onSeeAll }: {
  title: string;
  topic: CuratedTopic;
  onSeeAll: () => void;
}) {
  const [story, setStory] = useState<Story | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    fetchCurated(topic, 1)
      .then((rows) => { if (mounted) setStory(rows[0] ?? null); })
      .catch((e: unknown) => {
        if (mounted) setError(e instanceof Error ? e.message : 'Could not reach Hacker News');
      });
    return () => { mounted = false; };
  }, [topic]);

  const loading = !story && !error;
  const href = story ? (story.url ?? commentsUrl(story.id)) : null;
  const domain = story ? domainOf(story.url) : null;

  return (
    <div className="glass p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[10px] tracked-sm text-white/50">{title.toUpperCase()}</span>
        <button
          onClick={onSeeAll}
          className="text-[11px] text-white/50 hover:text-white transition flex items-center gap-1"
        >
          See All <ArrowRight className="w-3 h-3" />
        </button>
      </div>

      {loading && (
        <div className="animate-pulse flex flex-col gap-2">
          <div className="h-3 w-20 rounded bg-white/10" />
          <div className="h-3.5 w-full rounded bg-white/10" />
          <div className="h-3.5 w-4/5 rounded bg-white/10" />
        </div>
      )}

      {!loading && error && (
        <p className="text-[12px] text-white/40 leading-snug">
          Couldn't load Hacker News — {error}
        </p>
      )}

      {!loading && !error && !story && (
        <p className="text-[12px] text-white/40">No stories right now.</p>
      )}

      {!loading && !error && story && (
        <>
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-white/70">
              {domain ?? 'discussion'}
            </span>
            <span className="text-[10px] text-white/40">
              {story.score} pts · {relativeTime(story.time)}
            </span>
          </div>
          <h3 className="text-white font-semibold text-sm leading-snug">{story.title}</h3>
          <p className="text-[12px] text-white/55 mt-1 leading-snug">
            {story.descendants} comment{story.descendants === 1 ? '' : 's'} · by {story.by}
          </p>
          {href && (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[12px] mt-2 flex items-center gap-1"
              style={{ color: 'var(--accent)' }}
            >
              Read <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </>
      )}
    </div>
  );
}
