import { useEffect, useState } from 'react';
import { ArrowLeft, ExternalLink, MessageSquare, Flame, RefreshCw } from 'lucide-react';
import {
  Story, HnCategory, HN_CATEGORIES,
  fetchStories, commentsUrl, relativeTime, domainOf,
} from '../lib/hn';

/**
 * Full tech feed — the "See All" destination from both home news cards.
 *
 * Same source and same shared cache as the home cards (src/lib/hn.ts). Nothing is
 * persisted: stories are fetched live and held in memory for the tab session.
 */

const STORY_COUNT = 25;

interface Props {
  onBack: () => void;
}

export default function TechFeedPage({ onBack }: Props) {
  const [category, setCategory] = useState<HnCategory>('top');
  const [stories, setStories] = useState<Story[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let mounted = true;
    setStories(null);
    setError(null);

    fetchStories(category, STORY_COUNT)
      .then((rows) => { if (mounted) setStories(rows); })
      .catch((e: unknown) => {
        if (mounted) setError(e instanceof Error ? e.message : 'Could not reach Hacker News');
      });

    return () => { mounted = false; };
  }, [category, reloadKey]);

  return (
    <div className="max-w-3xl mx-auto flex flex-col gap-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <button
            onClick={onBack}
            title="Back to Mission Control"
            className="w-8 h-8 grid place-items-center rounded-lg shrink-0 mt-0.5 transition hover:bg-white/10"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)' }}
          >
            <ArrowLeft className="w-4 h-4 text-white/70" />
          </button>
          <div className="min-w-0">
            <h1 className="text-white font-bold text-xl leading-tight">Tech Feed</h1>
            <p className="text-white/40 text-xs mt-1">
              Live from Hacker News · nothing stored
            </p>
          </div>
        </div>

        <button
          onClick={() => setReloadKey((k) => k + 1)}
          title="Refresh"
          className="w-8 h-8 grid place-items-center rounded-lg shrink-0 transition hover:bg-white/10"
          style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)' }}
        >
          <RefreshCw className="w-3.5 h-3.5 text-white/60" />
        </button>
      </div>

      {/* Category tabs */}
      <div className="flex gap-1.5 flex-wrap">
        {HN_CATEGORIES.map((c) => {
          const active = c.key === category;
          return (
            <button
              key={c.key}
              onClick={() => setCategory(c.key)}
              className="px-3.5 py-1.5 rounded-full text-[13px] transition"
              style={active
                ? {
                    background: 'var(--accent-soft)',
                    border: '1px solid var(--accent)',
                    color: '#fff',
                    fontWeight: 600,
                  }
                : {
                    background: 'rgba(255,255,255,0.04)',
                    border: '1px solid rgba(255,255,255,0.10)',
                    color: 'rgba(255,255,255,0.6)',
                  }}
            >
              {c.label}
            </button>
          );
        })}
      </div>

      {/* Feed */}
      <div className="glass" style={{ padding: 6 }}>
        {!stories && !error && <FeedSkeleton />}

        {error && (
          <div className="px-4 py-10 text-center">
            <div className="text-white/70 text-sm font-semibold">Couldn't load the feed</div>
            <p className="text-white/40 text-xs mt-1.5">{error}</p>
            <button
              onClick={() => setReloadKey((k) => k + 1)}
              className="mt-4 px-4 py-2 rounded-lg text-xs font-semibold text-white transition hover:brightness-110"
              style={{ background: 'var(--accent)' }}
            >
              Try again
            </button>
          </div>
        )}

        {stories && stories.length === 0 && !error && (
          <p className="px-4 py-10 text-center text-white/40 text-sm">No stories right now.</p>
        )}

        {stories?.map((story, i) => (
          <StoryRow key={story.id} story={story} rank={i + 1} />
        ))}
      </div>

      <p className="text-center text-[10px] text-white/25 pb-2">
        Fetched live from the Hacker News API. Not stored in your database.
      </p>
    </div>
  );
}

function StoryRow({ story, rank }: { story: Story; rank: number }) {
  const href = story.url ?? commentsUrl(story.id);
  const domain = domainOf(story.url);
  // Ask/Show HN text posts have no outbound url — the discussion is the story.
  const source = domain ?? 'news.ycombinator.com';

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex gap-3 px-3.5 py-3 rounded-xl transition"
      style={{ textDecoration: 'none' }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.045)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      <span
        className="shrink-0 text-[11px] font-bold tabular-nums pt-0.5"
        style={{ color: rank <= 3 ? 'var(--accent)' : 'rgba(255,255,255,0.25)', width: 20 }}
      >
        {String(rank).padStart(2, '0')}
      </span>

      <div className="min-w-0 flex-1">
        <h3 className="text-white/90 text-sm font-semibold leading-snug group-hover:text-white">
          {story.title}
        </h3>

        <div className="flex items-center gap-2.5 mt-1.5 flex-wrap text-[11px]">
          <span
            className="px-2 py-0.5 rounded-full truncate"
            style={{
              maxWidth: 200,
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.10)',
              color: 'rgba(255,255,255,0.6)',
            }}
          >
            {source}
          </span>

          <span className="flex items-center gap-1" style={{ color: 'var(--accent)' }}>
            <Flame className="w-3 h-3" />
            {story.score}
          </span>

          <span className="flex items-center gap-1 text-white/40">
            <MessageSquare className="w-3 h-3" />
            {story.descendants}
          </span>

          <span className="text-white/30">{relativeTime(story.time)}</span>
          <span className="text-white/25">by {story.by}</span>
        </div>
      </div>

      <ExternalLink className="w-3.5 h-3.5 shrink-0 mt-1 text-white/20 group-hover:text-white/50 transition" />
    </a>
  );
}

/** Matches the row layout so the list doesn't jump when real data lands. */
function FeedSkeleton() {
  return (
    <div className="animate-pulse">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex gap-3 px-3.5 py-3">
          <div className="h-3 rounded bg-white/10 shrink-0" style={{ width: 20 }} />
          <div className="flex-1 flex flex-col gap-2">
            <div className="h-3.5 rounded bg-white/10" style={{ width: `${65 + ((i * 7) % 30)}%` }} />
            <div className="flex gap-2">
              <div className="h-3 w-24 rounded bg-white/[0.07]" />
              <div className="h-3 w-10 rounded bg-white/[0.07]" />
              <div className="h-3 w-10 rounded bg-white/[0.07]" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
