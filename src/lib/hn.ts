/**
 * Hacker News feed — the official Firebase API.
 *
 * https://hacker-news.firebaseio.com/v0/ — no key, no signup, no rate limit.
 * Two hops by design: `topstories.json` returns ~500 ids, then each item is fetched
 * individually. We only ever hydrate the handful we render.
 *
 * Nothing here touches the database. Stories are fetched live and cached in memory for
 * the tab session; news is not ours to store.
 */

const BASE = 'https://hacker-news.firebaseio.com/v0';
const CACHE_TTL_MS = 5 * 60 * 1000;

/** HN exposes one id-list endpoint per category; the item shape is identical. */
export type HnCategory = 'top' | 'new' | 'show' | 'ask';

export const HN_CATEGORIES: { key: HnCategory; label: string }[] = [
  { key: 'top', label: 'Top' },
  { key: 'new', label: 'New' },
  { key: 'show', label: 'Show HN' },
  { key: 'ask', label: 'Ask HN' },
];

const ENDPOINTS: Record<HnCategory, string> = {
  top: 'topstories',
  new: 'newstories',
  show: 'showstories',
  ask: 'askstories',
};

export interface Story {
  id: number;
  title: string;
  url: string | null;
  score: number;
  by: string;
  time: number;
  descendants: number;
}

interface RawItem {
  id: number;
  title?: string;
  url?: string;
  score?: number;
  by?: string;
  time?: number;
  descendants?: number;
  type?: string;
  dead?: boolean;
  deleted?: boolean;
}

// Cache and in-flight dedupe are per category, so switching tabs back and forth does
// not refetch and the two home cards still share a single request.
const cache = new Map<HnCategory, { at: number; stories: Story[] }>();
const inFlight = new Map<HnCategory, Promise<Story[]>>();

/**
 * Hydrated stories for a category. Concurrent callers share one fetch — the two home
 * cards mount together, and there is no reason for them to each hit the API.
 */
export async function fetchStories(category: HnCategory, count: number): Promise<Story[]> {
  const cached = cache.get(category);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS && cached.stories.length >= count) {
    return cached.stories.slice(0, count);
  }

  const pending = inFlight.get(category);
  // A smaller in-flight request can't satisfy a larger one; fall through and issue our own.
  if (pending) {
    const rows = await pending;
    if (rows.length >= count) return rows.slice(0, count);
  }

  const request = loadStories(category, count).finally(() => { inFlight.delete(category); });
  inFlight.set(category, request);
  return request;
}

/** Convenience wrapper for the home cards. */
export function fetchTopStories(count = 6): Promise<Story[]> {
  return fetchStories('top', count);
}

async function loadStories(category: HnCategory, count: number): Promise<Story[]> {
  const idsResponse = await fetch(`${BASE}/${ENDPOINTS[category]}.json`);
  if (!idsResponse.ok) throw new Error(`Hacker News returned ${idsResponse.status}`);

  const ids = (await idsResponse.json()) as number[];
  if (!Array.isArray(ids) || ids.length === 0) throw new Error('Hacker News returned no stories');

  // Over-fetch a little: dead/deleted/text-only posts get filtered out below.
  const slice = ids.slice(0, count * 2);
  const items = await Promise.all(slice.map(fetchItem));

  const stories = items
    .filter((item): item is RawItem => item !== null)
    .filter((item) => !item.dead && !item.deleted && item.type === 'story' && !!item.title)
    .map<Story>((item) => ({
      id: item.id,
      title: item.title as string,
      url: item.url ?? null,
      score: item.score ?? 0,
      by: item.by ?? 'unknown',
      time: item.time ?? 0,
      descendants: item.descendants ?? 0,
    }));

  if (stories.length === 0) throw new Error('No usable stories returned');

  cache.set(category, { at: Date.now(), stories });
  return stories;
}

async function fetchItem(id: number): Promise<RawItem | null> {
  try {
    const response = await fetch(`${BASE}/item/${id}.json`);
    if (!response.ok) return null;
    return (await response.json()) as RawItem;
  } catch {
    // One bad item shouldn't sink the whole panel.
    return null;
  }
}

/* ── Curated topic search (Algolia) ─────────────────────────────────────────
 * The Firebase endpoints above return whatever is trending; these two home cards
 * want a subject. Algolia's HN search supports query + tags + numericFilters on the
 * same corpus, free and keyless, so no new data source is involved.
 *
 * Each topic fans out across several queries because one term is too narrow — a day
 * with no "CVE" story still has "breach" and "exploit" stories. Results are merged,
 * deduped by id, and sorted newest-first.
 */

const ALGOLIA = 'https://hn.algolia.com/api/v1/search_by_date';

export type CuratedTopic = 'security' | 'industry';

interface TopicSpec {
  queries: string[];
  /** Floor on points, to keep low-signal posts out. */
  minPoints: number;
}

const TOPICS: Record<CuratedTopic, TopicSpec> = {
  // Hacking / security.
  security: {
    queries: ['hacking', 'security breach', 'vulnerability', 'exploit', 'cyberattack', 'CVE'],
    minPoints: 15,
  },
  // Major industry movement. Higher floor: these terms match a lot of small posts,
  // and industry news that matters trends well above 30 anyway.
  industry: {
    queries: ['OpenAI', 'Google', 'Microsoft', 'Apple', 'AI', 'acquisition', 'funding', 'chip', 'regulation'],
    minPoints: 30,
  },
};

interface AlgoliaHit {
  objectID: string;
  title?: string;
  url?: string | null;
  points?: number;
  num_comments?: number;
  created_at_i?: number;
  author?: string;
}

const curatedCache = new Map<CuratedTopic, { at: number; stories: Story[] }>();
const curatedInFlight = new Map<CuratedTopic, Promise<Story[]>>();

export async function fetchCurated(topic: CuratedTopic, count = 5): Promise<Story[]> {
  const cached = curatedCache.get(topic);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS && cached.stories.length >= count) {
    return cached.stories.slice(0, count);
  }

  const pending = curatedInFlight.get(topic);
  if (pending) {
    const rows = await pending;
    if (rows.length >= count) return rows.slice(0, count);
  }

  const request = loadCurated(topic).finally(() => { curatedInFlight.delete(topic); });
  curatedInFlight.set(topic, request);
  return (await request).slice(0, count);
}

async function loadCurated(topic: CuratedTopic): Promise<Story[]> {
  const spec = TOPICS[topic];

  const results = await Promise.all(
    spec.queries.map(async (query): Promise<AlgoliaHit[]> => {
      const url = `${ALGOLIA}?query=${encodeURIComponent(query)}`
        + `&tags=story&numericFilters=${encodeURIComponent(`points>${spec.minPoints}`)}`
        + '&hitsPerPage=8';
      try {
        const response = await fetch(url);
        if (!response.ok) return [];
        const body = await response.json();
        return (body?.hits ?? []) as AlgoliaHit[];
      } catch {
        // One failing query shouldn't sink the topic.
        return [];
      }
    }),
  );

  const byId = new Map<number, Story>();
  for (const hit of results.flat()) {
    if (!hit.title) continue;
    const id = Number(hit.objectID);
    if (!Number.isFinite(id) || byId.has(id)) continue;
    byId.set(id, {
      id,
      title: hit.title,
      url: hit.url ?? null,
      score: hit.points ?? 0,
      by: hit.author ?? 'unknown',
      time: hit.created_at_i ?? 0,
      descendants: hit.num_comments ?? 0,
    });
  }

  const stories = [...byId.values()].sort((a, b) => b.time - a.time);
  if (stories.length === 0) throw new Error('No matching stories right now');

  curatedCache.set(topic, { at: Date.now(), stories });
  return stories;
}

/** Discussion permalink — used when a story is a text post with no outbound url. */
export function commentsUrl(id: number) {
  return `https://news.ycombinator.com/item?id=${id}`;
}

export function relativeTime(unixSeconds: number): string {
  const seconds = Math.max(0, Math.floor(Date.now() / 1000) - unixSeconds);
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

/** Rough read time from the headline's domain — HN gives us no body to measure. */
export function domainOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}
