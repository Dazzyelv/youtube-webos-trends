/**
 * Trends and Picks, wired into the YouTube TV page:
 * - the guide (left menu) gets "Тренды" and "Подборка" and loses movies,
 *   games and sports (JSON.parse hook, like adblock.js);
 * - opening one of them, or a country in the Trends top row, sends the
 *   browse request for a real page instead (the TV app loads pages over XHR,
 *   not fetch) and swaps that page's contents for our shelves;
 * - Trends come from the Data API `mostPopular` chart of a country, or of
 *   several merged (world, Europe); Picks from a search and channel lists
 *   (sources.ts).
 */
import { ResolveCommandRegistry } from '../app_api';
import {
  buildPicksContents,
  buildTrendsContents,
  channelFromApi,
  isUnwanted,
  langOf,
  pageRequestOf,
  patchGuide,
  picksRowsFor,
  picksShelf,
  rankAcrossRegions,
  swapBrowseContents,
  toRememberedPage,
  topChannelIds,
  trendingChannels,
  trendsShelves,
  videoFromApi,
  withCarrier,
  type ChannelInfo,
  type Lang,
  type PageRequest,
  type PicksCountry,
  type RankedVideo,
  type Shelf,
  type TrendChannel,
  type TrendVideo,
  type TrendsTab
} from './core';
import { PICKS, type PicksSource } from './sources';

const REGIONS: Record<TrendsTab, string[]> = {
  world: ['US', 'GB', 'IN', 'BR', 'JP', 'KR', 'MX', 'DE', 'FR', 'ID'],
  europe: ['DE', 'FR', 'GB', 'IT', 'ES', 'PL', 'NL', 'SE', 'UA', 'LV'],
  ru: ['RU'],
  lv: ['LV'],
  us: ['US']
};

/** A single country is read deeper, so 50 remain after the filters. */
const PAGES_FOR_ONE_COUNTRY = 3;
const TRENDING_CHANNELS = 20;
const TRENDS_FRESH_MS = 3 * 60 * 60 * 1000;
const PICKS_FRESH_MS = 6 * 60 * 60 * 1000;

const STORAGE_PREFIX = 'ytaf-trends-v2-';
const LAST_TAB_KEY = 'ytaf-trends-last';
const LAST_PICKS_KEY = 'ytaf-picks-last';

let carrierBrowseId = 'FEtopics';

/** YouTube's interface language; our pages, titles and caches follow it. */
function uiLang(): Lang {
  const w = window as { yt?: { config_?: { HL?: string } } };
  return langOf(w.yt?.config_?.HL ?? navigator.language);
}

// ---------------------------------------------------------------- storage

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(
      key,
      typeof value === 'string' ? value : JSON.stringify(value)
    );
  } catch {
    // Storage full or blocked: the page still works, it just refetches.
  }
}

function rememberedTab(): TrendsTab {
  try {
    const tab = localStorage.getItem(LAST_TAB_KEY);
    if (tab && tab in REGIONS) return tab as TrendsTab;
  } catch {
    // Blocked storage: fall back to the world.
  }
  return 'world';
}

function rememberedPicks(): PicksCountry {
  try {
    const country = localStorage.getItem(LAST_PICKS_KEY);
    if (country === 'ru' || country === 'lv' || country === 'us')
      return country;
  } catch {
    // Blocked storage: fall back to all.
  }
  return 'all';
}

// --------------------------------------------------------------- Data API

async function api<T>(
  path: string,
  params: Record<string, string>
): Promise<T> {
  const query = Object.keys(params)
    .map((k) => `${k}=${encodeURIComponent(params[k]!)}`)
    .join('&');
  const res = await fetch(
    `https://www.googleapis.com/youtube/v3/${path}?${query}&key=${encodeURIComponent(__YTAF_TRENDS_KEY__)}`
  );
  const body = (await res.json()) as T & { error?: { message?: string } };
  if (!res.ok) throw new Error(body.error?.message ?? `HTTP ${res.status}`);
  return body;
}

type Page = { items?: unknown[]; nextPageToken?: string };

const VIDEO_PARTS = 'snippet,contentDetails,statistics,status';

const toVideos = (items: unknown[] | undefined) =>
  (items ?? []).map(videoFromApi).filter((v): v is TrendVideo => v !== null);

async function fetchRegion(
  region: string,
  pages: number
): Promise<TrendVideo[]> {
  const videos: TrendVideo[] = [];
  let pageToken = '';
  for (let i = 0; i < pages; i++) {
    const page = await api<Page>('videos', {
      part: VIDEO_PARTS,
      chart: 'mostPopular',
      maxResults: '50',
      hl: uiLang(),
      regionCode: region,
      ...(pageToken ? { pageToken } : {})
    });
    videos.push(...toVideos(page.items));
    if (!page.nextPageToken) break;
    pageToken = page.nextPageToken;
  }
  return videos;
}

async function videosByIds(ids: string[]): Promise<TrendVideo[]> {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 50) chunks.push(ids.slice(i, i + 50));
  const pages = await Promise.all(
    chunks.map((chunk) =>
      api<Page>('videos', {
        part: VIDEO_PARTS,
        id: chunk.join(','),
        hl: uiLang()
      })
    )
  );
  return pages.flatMap((p) => toVideos(p.items));
}

async function channelsByIds(ids: string[]): Promise<ChannelInfo[]> {
  if (ids.length === 0) return [];
  const page = await api<Page>('channels', {
    part: 'snippet,statistics',
    id: ids.slice(0, 50).join(',')
  });
  return (page.items ?? [])
    .map(channelFromApi)
    .filter((c): c is ChannelInfo => c !== null);
}

// ------------------------------------------------------------------ trends

type CachedTrends = {
  at: number;
  videos: RankedVideo[];
  channels: TrendChannel[];
};

const inFlight = new Map<string, Promise<Shelf[] | string>>();

/** Runs `load` once at a time per key; never rejects. */
function once(key: string, load: () => Promise<Shelf[] | string>) {
  const running = inFlight.get(key);
  if (running) return running;
  const p = load().catch((err: unknown) =>
    String((err as Error)?.message ?? err ?? 'Нет данных')
  );
  inFlight.set(key, p);
  void p.then(() => inFlight.delete(key));
  return p;
}

function loadTrends(tab: TrendsTab): Promise<Shelf[] | string> {
  const key = `${STORAGE_PREFIX}${tab}-${uiLang()}`;
  const cached = read<CachedTrends>(key);
  if (cached && Date.now() - cached.at < TRENDS_FRESH_MS) {
    return Promise.resolve(trendsShelves(cached.videos, cached.channels));
  }
  return once(key, async () => {
    if (!__YTAF_TRENDS_KEY__) return 'В сборке нет ключа YouTube Data API';
    const regions = REGIONS[tab];
    const pages = regions.length === 1 ? PAGES_FOR_ONE_COUNTRY : 1;
    const results = await Promise.allSettled(
      regions.map((r) => fetchRegion(r, pages))
    );
    const lists = results.flatMap((r) =>
      r.status === 'fulfilled' && r.value.length > 0
        ? [r.value.filter((v) => !isUnwanted(v))]
        : []
    );
    if (lists.length === 0) {
      if (cached) return trendsShelves(cached.videos, cached.channels);
      const failure = results.find(
        (r): r is PromiseRejectedResult => r.status === 'rejected'
      );
      return String(
        failure?.reason?.message ?? failure?.reason ?? 'Нет данных'
      );
    }
    const ranked = rankAcrossRegions(lists);
    const ids = topChannelIds(ranked, TRENDING_CHANNELS);
    const infos = await channelsByIds(ids).catch(() => [] as ChannelInfo[]);
    const channels = trendingChannels(ranked, ids, infos);
    write(key, { at: Date.now(), videos: ranked, channels });
    return trendsShelves(ranked, channels);
  });
}

// ------------------------------------------------------------------- picks

async function sourceVideos(
  source: PicksSource,
  days: number
): Promise<TrendVideo[]> {
  const since = new Date(Date.now() - days * 86400 * 1000).toISOString();
  if ('search' in source) {
    const found = await api<{ items?: { id?: { videoId?: string } }[] }>(
      'search',
      {
        part: 'id',
        type: 'video',
        maxResults: '50',
        q: source.search,
        relevanceLanguage: source.language,
        regionCode: source.region,
        order: 'viewCount',
        videoDuration: 'long',
        publishedAfter: since
      }
    );
    const ids = (found.items ?? []).flatMap((i) =>
      i.id?.videoId ? [i.id.videoId] : []
    );
    return videosByIds(ids);
  }
  // A channel's uploads playlist is its id with UC turned into UU.
  const uploads = await Promise.allSettled(
    source.channels.map((id) =>
      api<{
        items?: {
          contentDetails?: { videoId?: string; videoPublishedAt?: string };
        }[];
      }>('playlistItems', {
        part: 'contentDetails',
        maxResults: '15',
        playlistId: `UU${id.slice(2)}`
      })
    )
  );
  const ids = uploads.flatMap((r) =>
    r.status === 'fulfilled'
      ? (r.value.items ?? []).flatMap((i) => {
          const c = i.contentDetails;
          return c?.videoId && (c.videoPublishedAt ?? '') >= since
            ? [c.videoId]
            : [];
        })
      : []
  );
  return videosByIds(ids);
}

type CachedRow = { at: number; shelf: Shelf };

const rowsInFlight = new Map<string, Promise<Shelf>>();

/** One Picks row, from storage while fresh; rejects when its source fails. */
function loadPicksRow(row: (typeof PICKS)[number]): Promise<Shelf> {
  const key = `${STORAGE_PREFIX}row-${row.id}-${uiLang()}`;
  const cached = read<CachedRow>(key);
  if (cached && Date.now() - cached.at < PICKS_FRESH_MS) {
    return Promise.resolve(cached.shelf);
  }
  const running = rowsInFlight.get(key);
  if (running) return running;
  const load = sourceVideos(row.source, row.days).then(
    (videos) => {
      const shelf = picksShelf(row, videos, new Date());
      write(key, { at: Date.now(), shelf });
      return shelf;
    },
    (err: unknown) => {
      if (cached) return cached.shelf;
      throw err;
    }
  );
  rowsInFlight.set(key, load);
  const done = () => rowsInFlight.delete(key);
  void load.then(done, done);
  return load;
}

/** A country's Picks rows, or the reason there are none. Never rejects. */
async function loadPicks(country: PicksCountry): Promise<Shelf[] | string> {
  if (!__YTAF_TRENDS_KEY__) return 'В сборке нет ключа YouTube Data API';
  const rows = await Promise.allSettled(
    picksRowsFor(country, PICKS).map(loadPicksRow)
  );
  const shelves = rows.flatMap((r) =>
    r.status === 'fulfilled' &&
    r.value.kind === 'videos' &&
    r.value.videos.length > 0
      ? [r.value]
      : []
  );
  if (shelves.length > 0) return shelves;
  const failure = rows.find(
    (r): r is PromiseRejectedResult => r.status === 'rejected'
  );
  return failure
    ? String(failure.reason?.message ?? failure.reason)
    : 'Нет видео';
}

/** The `contents` our page shows for a request; never rejects. */
async function contentsFor(request: PageRequest): Promise<object> {
  if (request.page === 'picks') {
    const country =
      request.country === 'remembered' ? rememberedPicks() : request.country;
    write(LAST_PICKS_KEY, country);
    return buildPicksContents(
      country,
      await loadPicks(country),
      new Date(),
      uiLang()
    );
  }
  const tab = request.tab === 'remembered' ? rememberedTab() : request.tab;
  write(LAST_TAB_KEY, tab);
  return buildTrendsContents(tab, await loadTrends(tab), new Date(), uiLang());
}

// ----------------------------------------------------------------- the guide

const origParse = JSON.parse;
JSON.parse = function (...args: Parameters<typeof JSON.parse>) {
  const r: unknown = origParse.apply(this, args);
  const items = (r as { items?: unknown })?.items;
  if (
    Array.isArray(items) &&
    items.some((i) => (i as Record<string, unknown>)?.guideSectionRenderer)
  ) {
    const { patched, homeBrowseId } = patchGuide(r, uiLang());
    if (homeBrowseId) carrierBrowseId = homeBrowseId;
    if (patched) {
      console.info('[trends] Guide patched, carrier', carrierBrowseId);
      // Warm both pages so opening them is instant.
      void loadTrends(rememberedTab());
      void loadPicks(rememberedPicks());
    }
  }
  return r;
};

void ResolveCommandRegistry.getInstance().then((registry) => {
  registry.setHook('browseEndpoint', (resolveCommand, payload, extra) => {
    const rewritten = toRememberedPage(payload, {
      trends: rememberedTab(),
      picks: rememberedPicks()
    });
    if (rewritten) console.info('[trends] Guide entry ->', rewritten);
    return resolveCommand(rewritten ?? payload, extra);
  });
});

// ----------------------------------------------------------------- the pages

type TrackedXhr = XMLHttpRequest & { __ytafTrendsUrl?: string };

const proto = XMLHttpRequest.prototype;
const origOpen = proto.open;
const origSend = proto.send;
const textGetter = Object.getOwnPropertyDescriptor(proto, 'responseText')!.get!;
const responseGetter = Object.getOwnPropertyDescriptor(proto, 'response')!.get!;

proto.open = function (this: TrackedXhr, ...args: unknown[]) {
  this.__ytafTrendsUrl = String(args[1]);
  return (origOpen as (...a: unknown[]) => void).apply(this, args);
} as typeof proto.open;

proto.send = function (
  this: TrackedXhr,
  body?: Document | XMLHttpRequestBodyInit | null
) {
  const request =
    typeof body === 'string' &&
    this.__ytafTrendsUrl?.includes('/youtubei/v1/browse')
      ? pageRequestOf(body)
      : null;
  if (!request || typeof body !== 'string') {
    origSend.call(this, body);
    return;
  }

  const xhr = this;
  void contentsFor(request).then((contents) => {
    let swapped: string | null = null;
    const ours = () => {
      if (swapped === null) {
        const real = textGetter.call(xhr) as string;
        try {
          swapped =
            xhr.status === 200 ? swapBrowseContents(real, contents) : real;
        } catch (err) {
          console.warn(
            '[trends] Could not swap the page, showing the real one',
            err
          );
          swapped = real;
        }
      }
      return swapped;
    };
    Object.defineProperty(xhr, 'responseText', {
      configurable: true,
      get: () => (xhr.readyState === 4 ? ours() : textGetter.call(xhr))
    });
    Object.defineProperty(xhr, 'response', {
      configurable: true,
      get: () => {
        if (xhr.readyState !== 4) return responseGetter.call(xhr);
        if (xhr.responseType === 'json') return origParse(ours());
        if (xhr.responseType === '' || xhr.responseType === 'text')
          return ours();
        return responseGetter.call(xhr);
      }
    });
    console.info(
      `[trends] Opening ${JSON.stringify(request)} through ${carrierBrowseId}`
    );
    origSend.call(xhr, withCarrier(body, carrierBrowseId));
  });
};
