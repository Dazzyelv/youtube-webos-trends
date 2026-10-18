/**
 * Trends tabs, wired into the YouTube TV page:
 * - the guide (left menu) gets "Тренды: мир" and "Тренды: Европа" and loses
 *   movies, games and sports (JSON.parse hook, like adblock.js);
 * - opening a tab sends the browse request for a real page instead (the TV
 *   app loads pages over XHR, not fetch) and swaps that page's contents for
 *   shelves built from the Data API `mostPopular` chart of several countries.
 */
import {
  groupIntoShelves,
  patchGuide,
  rankAcrossRegions,
  swapBrowseContents,
  trendsTabOf,
  videoFromApi,
  withCarrier,
  type RankedVideo,
  type Shelf,
  type TrendVideo,
  type TrendsTab
} from './core';

const REGIONS: Record<TrendsTab, string[]> = {
  world: ['US', 'GB', 'IN', 'BR', 'JP', 'KR', 'MX', 'DE', 'FR', 'ID'],
  europe: ['DE', 'FR', 'GB', 'IT', 'ES', 'PL', 'NL', 'SE', 'UA', 'LV']
};

const FRESH_MS = 3 * 60 * 60 * 1000;
const STORAGE_PREFIX = 'ytaf-trends-';

let carrierBrowseId = 'FEtopics';

// ------------------------------------------------------------------ the data

async function fetchRegion(region: string): Promise<TrendVideo[]> {
  const url =
    'https://www.googleapis.com/youtube/v3/videos' +
    '?part=snippet,contentDetails,statistics&chart=mostPopular&maxResults=50&hl=ru' +
    `&regionCode=${region}&key=${encodeURIComponent(__YTAF_TRENDS_KEY__)}`;
  const res = await fetch(url);
  const body = (await res.json()) as {
    items?: unknown[];
    error?: { message?: string };
  };
  if (!res.ok) throw new Error(body.error?.message ?? `HTTP ${res.status}`);
  return (body.items ?? [])
    .map(videoFromApi)
    .filter((v): v is TrendVideo => v !== null);
}

type Cached = { at: number; videos: RankedVideo[] };

function readCache(tab: TrendsTab): Cached | null {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + tab);
    return raw ? (JSON.parse(raw) as Cached) : null;
  } catch {
    return null;
  }
}

function writeCache(tab: TrendsTab, videos: RankedVideo[]) {
  try {
    localStorage.setItem(
      STORAGE_PREFIX + tab,
      JSON.stringify({ at: Date.now(), videos })
    );
  } catch {
    // Storage full or blocked: the tab still works, it just refetches.
  }
}

const inFlight = new Map<TrendsTab, Promise<Shelf[] | string>>();

/** Shelves for a tab, or the reason there are none. Never rejects. */
function loadShelves(tab: TrendsTab): Promise<Shelf[] | string> {
  const cached = readCache(tab);
  if (cached && Date.now() - cached.at < FRESH_MS) {
    return Promise.resolve(groupIntoShelves(cached.videos));
  }
  const running = inFlight.get(tab);
  if (running) return running;

  const load = (async (): Promise<Shelf[] | string> => {
    if (!__YTAF_TRENDS_KEY__) return 'В сборке нет ключа YouTube Data API';
    const results = await Promise.allSettled(REGIONS[tab].map(fetchRegion));
    const lists = results.flatMap((r) =>
      r.status === 'fulfilled' && r.value.length > 0 ? [r.value] : []
    );
    if (lists.length > 0) {
      const ranked = rankAcrossRegions(lists);
      writeCache(tab, ranked);
      return groupIntoShelves(ranked);
    }
    if (cached) return groupIntoShelves(cached.videos);
    const failure = results.find(
      (r): r is PromiseRejectedResult => r.status === 'rejected'
    );
    return String(failure?.reason?.message ?? failure?.reason ?? 'Нет данных');
  })();
  inFlight.set(tab, load);
  load.finally(() => inFlight.delete(tab));
  return load;
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
    const { patched, homeBrowseId } = patchGuide(r);
    if (homeBrowseId) carrierBrowseId = homeBrowseId;
    if (patched) {
      console.info('[trends] Guide patched, carrier', carrierBrowseId);
      // Warm both tabs so the first open is instant.
      void loadShelves('world');
      void loadShelves('europe');
    }
  }
  return r;
};

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
  const tab =
    typeof body === 'string' &&
    this.__ytafTrendsUrl?.includes('/youtubei/v1/browse')
      ? trendsTabOf(body)
      : null;
  if (!tab || typeof body !== 'string') {
    origSend.call(this, body);
    return;
  }

  const xhr = this;
  void loadShelves(tab).then((shelves) => {
    let swapped: string | null = null;
    const ours = () => {
      if (swapped === null) {
        const real = textGetter.call(xhr) as string;
        try {
          swapped =
            xhr.status === 200
              ? swapBrowseContents(real, shelves, new Date())
              : real;
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
    console.info(`[trends] Opening ${tab} through ${carrierBrowseId}`);
    origSend.call(xhr, withCarrier(body, carrierBrowseId));
  });
};
