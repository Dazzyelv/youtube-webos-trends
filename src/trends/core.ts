/**
 * Trends and Picks pages: everything that does not touch the browser, so it
 * can be tested under node. YouTube retired its Trending page in July 2025;
 * Trends is rebuilt from the Data API `mostPopular` chart (one country, or
 * several merged), Picks from searches and hand-picked channels.
 *
 * This file must not import anything at runtime (the tests load it directly).
 */

export type TrendsTab = 'world' | 'europe' | 'ru' | 'lv' | 'us';

export type TrendVideo = {
  id: string;
  title: string;
  channel: string;
  channelId: string;
  views: number | null;
  publishedAt: string;
  durationSec: number | null;
  categoryId: string;
  thumbnail: string;
  tags: string[];
  forKids: boolean;
};

export type RankedVideo = TrendVideo & { score: number; countries: number };

export type ChannelInfo = {
  id: string;
  title: string;
  avatar: string;
  subscribers: number | null;
};

export type TrendChannel = ChannelInfo & { videoCount: number };

export type Shelf =
  | { kind: 'videos'; title: string; videos: TrendVideo[] }
  | { kind: 'channels'; title: string; channels: TrendChannel[] };

/** One Picks row: how its videos are chosen once fetched. */
export type PicksRow = {
  title: string;
  order: 'views' | 'date';
  perChannel: number;
  days: number;
};

/** The guide entry opens the country chosen last; each country has its own id. */
export const TRENDS_BROWSE_ID = 'FEytaf_trends';
export const PICKS_BROWSE_ID = 'FEytaf_picks';

/** In the order the country row shows them. */
export const TAB_TITLES: Record<TrendsTab, string> = {
  world: 'Мир',
  europe: 'Европа',
  ru: 'Россия',
  lv: 'Латвия',
  us: 'США'
};

const TAB_IDS = Object.keys(TAB_TITLES) as TrendsTab[];

const HIDDEN_BROWSE_IDS = [
  'FEtopics_movies',
  'FEtopics_gaming',
  'FEtopics_sports'
];

export const SHELF_SIZE = 50;

/** Shorter than this is a Short or a clip, not a show or a trip. */
const MIN_PICKS_SECONDS = 240;

const CATEGORY_SHELVES: { title: string; categoryIds: string[] | null }[] = [
  { title: 'Музыка', categoryIds: ['10'] },
  { title: 'Игры: трейлеры', categoryIds: ['20'] },
  { title: 'Кино и развлечения', categoryIds: ['1', '24', '30', '44'] },
  { title: 'Разное', categoryIds: null }
];

// ---------------------------------------------------------------- formatting

/** "1 просмотр", "3 просмотра", "11 просмотров". */
function plural(n: number, one: string, few: string, many: string) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

export function parseIsoDuration(iso: string): number | null {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(iso);
  if (!m) return null;
  const [, d, h, min, s] = m.map((x) => Number(x ?? 0));
  return (((d ?? 0) * 24 + (h ?? 0)) * 60 + (min ?? 0)) * 60 + (s ?? 0);
}

export function formatDuration(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Rounded down like YouTube: one decimal below 10, none above. */
function compact(n: number, unit: number, suffix: string) {
  const v = n / unit;
  const shown =
    v < 10
      ? (Math.floor(v * 10) / 10).toString().replace('.', ',')
      : String(Math.floor(v));
  return `${shown} ${suffix}`;
}

function countText(n: number, one: string, few: string, many: string) {
  if (n >= 1e9) return `${compact(n, 1e9, 'млрд')} ${many}`;
  if (n >= 1e6) return `${compact(n, 1e6, 'млн')} ${many}`;
  if (n >= 1e3) return `${compact(n, 1e3, 'тыс.')} ${many}`;
  return `${n} ${plural(n, one, few, many)}`;
}

export const formatViews = (n: number) =>
  countText(n, 'просмотр', 'просмотра', 'просмотров');

export const formatSubscribers = (n: number) =>
  countText(n, 'подписчик', 'подписчика', 'подписчиков');

export function formatAge(publishedAt: string, now: Date): string {
  const sec = Math.max(0, (now.getTime() - Date.parse(publishedAt)) / 1000);
  const ago = (n: number, one: string, few: string, many: string) =>
    `${n} ${plural(n, one, few, many)} назад`;
  const min = Math.floor(sec / 60);
  const hours = Math.floor(sec / 3600);
  const days = Math.floor(sec / 86400);
  if (min < 1) return 'только что';
  if (hours < 1) return ago(min, 'минуту', 'минуты', 'минут');
  if (days < 1) return ago(hours, 'час', 'часа', 'часов');
  if (days < 7) return ago(days, 'день', 'дня', 'дней');
  if (days < 30) return ago(Math.floor(days / 7), 'неделю', 'недели', 'недель');
  if (days < 365)
    return ago(Math.floor(days / 30), 'месяц', 'месяца', 'месяцев');
  return ago(Math.floor(days / 365), 'год', 'года', 'лет');
}

// ------------------------------------------------------------------ the data

type ApiVideo = {
  id?: unknown;
  snippet?: {
    title?: string;
    localized?: { title?: string };
    channelTitle?: string;
    channelId?: string;
    publishedAt?: string;
    categoryId?: string;
    tags?: string[];
    thumbnails?: Record<string, { url?: string } | undefined>;
  };
  contentDetails?: { duration?: string };
  statistics?: { viewCount?: string };
  status?: { madeForKids?: boolean };
};

/** One `videos.list` item, or null when it lacks what a tile needs. */
export function videoFromApi(raw: unknown): TrendVideo | null {
  const item = raw as ApiVideo;
  const s = item?.snippet;
  if (typeof item?.id !== 'string' || !s?.title) return null;
  const views = Number(item.statistics?.viewCount);
  const duration = item.contentDetails?.duration;
  return {
    id: item.id,
    title: s.localized?.title || s.title,
    channel: s.channelTitle ?? '',
    channelId: s.channelId ?? '',
    views: Number.isFinite(views) ? views : null,
    publishedAt: s.publishedAt ?? '',
    durationSec: duration ? parseIsoDuration(duration) : null,
    categoryId: s.categoryId ?? '',
    thumbnail:
      s.thumbnails?.high?.url ??
      `https://i.ytimg.com/vi/${item.id}/hqdefault.jpg`,
    tags: s.tags ?? [],
    forKids: item.status?.madeForKids === true
  };
}

type ApiChannel = {
  id?: unknown;
  snippet?: {
    title?: string;
    thumbnails?: Record<string, { url?: string } | undefined>;
  };
  statistics?: { subscriberCount?: string; hiddenSubscriberCount?: boolean };
};

/** One `channels.list` item, or null when it lacks a name or a picture. */
export function channelFromApi(raw: unknown): ChannelInfo | null {
  const item = raw as ApiChannel;
  const t = item?.snippet?.thumbnails;
  const avatar = t?.high?.url ?? t?.medium?.url ?? t?.default?.url;
  if (typeof item?.id !== 'string' || !item.snippet?.title || !avatar)
    return null;
  const subs = Number(item.statistics?.subscriberCount);
  return {
    id: item.id,
    title: item.snippet.title,
    avatar,
    subscribers:
      item.statistics?.hiddenSubscriberCount || !Number.isFinite(subs)
        ? null
        : subs
  };
}

// ------------------------------------------------------------------ filters

/** Kids' games, cartoons and anime; matched in title, channel and tags. */
const CARTOONISH = new RegExp(
  [
    'roblox',
    'роблокс',
    'minecraft',
    'майнкрафт',
    'brookhaven',
    'брукхейвен',
    '\\bfnaf\\b',
    'фнаф',
    'skibidi',
    'скибиди',
    'toca boca',
    'аниме',
    '\\banime\\b',
    'мультфильм',
    'мультик',
    'мультсериал',
    'cartoon',
    'леди баг',
    'miraculous',
    'маша и медведь',
    'peppa',
    'пеппа',
    'bluey',
    'три кота',
    'фиксики',
    'смешарики',
    'барбоскины',
    'лунтик'
  ].join('|'),
  'i'
);

/** Of the games, only trailers and announcements stay. */
const GAME_TRAILER =
  /трейлер|trailer|тизер|teaser|анонс|announce|reveal|showcase|презентац/i;

export function isUnwanted(v: TrendVideo): boolean {
  if (v.forKids) return true;
  if (CARTOONISH.test([v.title, v.channel, ...v.tags].join(' '))) return true;
  return v.categoryId === '20' && !GAME_TRAILER.test(v.title);
}

// ------------------------------------------------------------------- trends

/**
 * One list per country, best first. A video earns (n - rank) / n from each
 * list it is in, so being near the top in many countries wins; ties go to
 * the one with more views.
 */
export function rankAcrossRegions(lists: TrendVideo[][]): RankedVideo[] {
  const byId = new Map<string, RankedVideo>();
  for (const list of lists) {
    list.forEach((v, rank) => {
      const points = (list.length - rank) / list.length;
      const seen = byId.get(v.id);
      if (seen) {
        seen.score += points;
        seen.countries += 1;
      } else {
        byId.set(v.id, { ...v, score: points, countries: 1 });
      }
    });
  }
  return [...byId.values()].sort(
    (a, b) => b.score - a.score || (b.views ?? 0) - (a.views ?? 0)
  );
}

/** Channels behind the ranked videos, strongest first. */
export function topChannelIds(ranked: RankedVideo[], limit: number): string[] {
  const score = new Map<string, number>();
  for (const v of ranked) {
    if (v.channelId)
      score.set(v.channelId, (score.get(v.channelId) ?? 0) + v.score);
  }
  return [...score.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id]) => id);
}

/** The channels of `ids`, in that order, with how many trending videos each has. */
export function trendingChannels(
  ranked: RankedVideo[],
  ids: string[],
  infos: ChannelInfo[]
): TrendChannel[] {
  return ids.flatMap((id) => {
    const info = infos.find((c) => c.id === id);
    if (!info) return [];
    const videoCount = ranked.filter((v) => v.channelId === id).length;
    return [{ ...info, videoCount }];
  });
}

export function trendsShelves(
  ranked: RankedVideo[],
  channels: TrendChannel[] = []
): Shelf[] {
  const named = CATEGORY_SHELVES.flatMap((c) => c.categoryIds ?? []);
  const shelves: Shelf[] = [
    { kind: 'videos', title: 'Топ', videos: ranked.slice(0, SHELF_SIZE) },
    { kind: 'channels', title: 'Каналы в трендах', channels }
  ];
  for (const { title, categoryIds } of CATEGORY_SHELVES) {
    const videos = ranked
      .filter((v) =>
        categoryIds
          ? categoryIds.includes(v.categoryId)
          : !named.includes(v.categoryId)
      )
      .slice(0, SHELF_SIZE);
    shelves.push({ kind: 'videos', title, videos });
  }
  return shelves.filter((s) =>
    s.kind === 'videos' ? s.videos.length > 0 : s.channels.length > 0
  );
}

// -------------------------------------------------------------------- picks

/**
 * A Picks row from whatever its source returned: no kids' stuff, no Shorts,
 * nothing older than `days`, each video once, at most `perChannel` per
 * channel, most viewed or newest first.
 */
export function picksShelf(
  row: PicksRow,
  videos: TrendVideo[],
  now: Date
): Shelf {
  const oldest = now.getTime() - row.days * 86400 * 1000;
  const seen = new Set<string>();
  const fresh = videos.filter((v) => {
    if (seen.has(v.id)) return false;
    seen.add(v.id);
    return (
      !isUnwanted(v) &&
      (v.durationSec ?? 0) >= MIN_PICKS_SECONDS &&
      Date.parse(v.publishedAt) >= oldest
    );
  });
  fresh.sort((a, b) =>
    row.order === 'views'
      ? (b.views ?? 0) - (a.views ?? 0)
      : Date.parse(b.publishedAt) - Date.parse(a.publishedAt)
  );
  const perChannel = new Map<string, number>();
  const chosen = fresh.filter((v) => {
    const n = perChannel.get(v.channelId) ?? 0;
    perChannel.set(v.channelId, n + 1);
    return n < row.perChannel;
  });
  return {
    kind: 'videos',
    title: row.title,
    videos: chosen.slice(0, SHELF_SIZE)
  };
}

// ------------------------------------------------- what the TV app renders

const text = (s: string) => ({ simpleText: s });
const runs = (s: string) => ({ runs: [{ text: s }] });
const line = (...items: object[]) => ({
  lineRenderer: { items: items.map((t) => ({ lineItemRenderer: { text: t } })) }
});

function buildVideoTile(v: TrendVideo, now: Date) {
  const stats = [
    v.views === null ? null : formatViews(v.views),
    v.publishedAt ? formatAge(v.publishedAt, now) : null
  ].filter((x): x is string => x !== null);
  const statsLine = stats.flatMap((s, i) =>
    i === 0 ? [text(s)] : [text('•'), text(s)]
  );
  return {
    tileRenderer: {
      style: 'TILE_STYLE_YTLR_DEFAULT',
      header: {
        tileHeaderRenderer: {
          thumbnail: {
            thumbnails: [{ url: v.thumbnail, width: 480, height: 360 }]
          },
          thumbnailOverlays:
            v.durationSec === null
              ? []
              : [
                  {
                    thumbnailOverlayTimeStatusRenderer: {
                      text: text(formatDuration(v.durationSec)),
                      style: 'DEFAULT'
                    }
                  }
                ]
        }
      },
      metadata: {
        tileMetadataRenderer: {
          title: text(v.title),
          lines: [line(runs(v.channel)), line(...statsLine)]
        }
      },
      onSelectCommand: { watchEndpoint: { videoId: v.id } },
      contentId: v.id,
      contentType: 'TILE_CONTENT_TYPE_VIDEO'
    }
  };
}

function buildChannelTile(c: TrendChannel) {
  const lines = [
    c.subscribers === null ? null : formatSubscribers(c.subscribers),
    `${countText(c.videoCount, 'видео', 'видео', 'видео')} в трендах`
  ].filter((x): x is string => x !== null);
  return {
    tileRenderer: {
      style: 'TILE_STYLE_YTLR_ROUND',
      header: {
        tileHeaderRenderer: {
          thumbnail: {
            thumbnails: [{ url: c.avatar, width: 240, height: 240 }]
          }
        }
      },
      metadata: {
        tileMetadataRenderer: {
          title: text(c.title),
          lines: lines.map((l) => line(text(l)))
        }
      },
      onSelectCommand: { browseEndpoint: { browseId: c.id } },
      contentId: c.id,
      contentType: 'TILE_CONTENT_TYPE_CHANNEL'
    }
  };
}

// Flags as inline SVG, 16:9 like a video thumbnail; no image host needed.
const star = (cx: number, cy: number, r: number) =>
  Array.from({ length: 10 }, (_, i) => {
    const a = (-90 + i * 36) * (Math.PI / 180);
    const d = i % 2 === 0 ? r : r * 0.4;
    return `${(cx + d * Math.cos(a)).toFixed(1)},${(cy + d * Math.sin(a)).toFixed(1)}`;
  }).join(' ');

const FLAGS: Record<TrendsTab, string> = {
  world:
    '<rect width="160" height="90" fill="#0b3d91"/>' +
    '<g fill="none" stroke="#fff" stroke-width="2.5">' +
    '<circle cx="80" cy="45" r="32" fill="#1a73e8"/>' +
    '<ellipse cx="80" cy="45" rx="14" ry="32"/>' +
    '<path d="M48 45H112M53 29H107M53 61H107"/></g>',
  europe:
    '<rect width="160" height="90" fill="#003399"/>' +
    Array.from({ length: 12 }, (_, i) => {
      const a = (i * 30 * Math.PI) / 180;
      return `<polygon fill="#fc0" points="${star(80 + 27 * Math.sin(a), 45 - 27 * Math.cos(a), 5)}"/>`;
    }).join(''),
  ru:
    '<rect width="160" height="30" fill="#fff"/>' +
    '<rect y="30" width="160" height="30" fill="#0039a6"/>' +
    '<rect y="60" width="160" height="30" fill="#d52b1e"/>',
  lv:
    '<rect width="160" height="90" fill="#9e3039"/>' +
    '<rect y="36" width="160" height="18" fill="#fff"/>',
  us:
    Array.from(
      { length: 13 },
      (_, i) =>
        `<rect y="${((i * 90) / 13).toFixed(2)}" width="160" height="${(90 / 13).toFixed(2)}" fill="${i % 2 ? '#fff' : '#b22234'}"/>`
    ).join('') +
    '<rect width="64" height="48.5" fill="#3c3b6e"/>' +
    Array.from(
      { length: 30 },
      (_, i) =>
        `<circle cx="${6 + (i % 6) * 10.4}" cy="${5 + Math.floor(i / 6) * 9.6}" r="1.8" fill="#fff"/>`
    ).join('')
};

export function flagImage(tab: TrendsTab): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 90">${FLAGS[tab]}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function buildCountryTile(tab: TrendsTab, selected: boolean) {
  return {
    tileRenderer: {
      style: 'TILE_STYLE_YTLR_DEFAULT',
      header: {
        tileHeaderRenderer: {
          thumbnail: {
            thumbnails: [{ url: flagImage(tab), width: 480, height: 270 }]
          }
        }
      },
      metadata: {
        tileMetadataRenderer: {
          title: text(TAB_TITLES[tab]),
          lines: selected ? [line(text('выбрано'))] : []
        }
      },
      onSelectCommand: {
        browseEndpoint: { browseId: `${TRENDS_BROWSE_ID}_${tab}` }
      },
      contentType: 'TILE_CONTENT_TYPE_UNSPECIFIED'
    }
  };
}

function buildShelf(title: string, subtitle: string, items: object[]) {
  return {
    shelfRenderer: {
      content: {
        horizontalListRenderer: {
          items,
          collapsedItemCount: 3,
          visibleItemCount: 3
        }
      },
      headerRenderer: {
        shelfHeaderRenderer: {
          avatarLockup: {
            avatarLockupRenderer: {
              title: runs(title),
              subtitle: runs(subtitle),
              size: 'AVATAR_LOCKUP_SIZE_SMALL'
            }
          }
        }
      }
    }
  };
}

function renderShelf(s: Shelf, now: Date, title = s.title) {
  return s.kind === 'videos'
    ? buildShelf(
        title,
        `${s.videos.length} видео`,
        s.videos.map((v) => buildVideoTile(v, now))
      )
    : buildShelf(
        title,
        `${countText(s.channels.length, 'канал', 'канала', 'каналов')}`,
        s.channels.map(buildChannelTile)
      );
}

const page = (shelves: object[]) => ({
  tvBrowseRenderer: {
    content: {
      tvSurfaceContentRenderer: {
        content: { sectionListRenderer: { contents: shelves } }
      }
    }
  }
});

/**
 * The `contents` of a Trends page: the country row, then the chosen
 * country's shelves or the reason there are none.
 */
export function buildTrendsContents(
  tab: TrendsTab,
  shelvesOrError: Shelf[] | string,
  now: Date
) {
  const countries = buildShelf(
    'Страна',
    'Выберите, чьи тренды показать',
    TAB_IDS.map((t) => buildCountryTile(t, t === tab))
  );
  const rest =
    typeof shelvesOrError === 'string'
      ? [buildShelf('Не удалось загрузить тренды', shelvesOrError, [])]
      : shelvesOrError.map((s) =>
          renderShelf(
            s,
            now,
            s.title === 'Топ' ? `Топ: ${TAB_TITLES[tab]}` : s.title
          )
        );
  return page([countries, ...rest]);
}

/** The `contents` of the Picks page. */
export function buildPicksContents(
  shelvesOrError: Shelf[] | string,
  now: Date
) {
  return page(
    typeof shelvesOrError === 'string'
      ? [buildShelf('Не удалось загрузить подборку', shelvesOrError, [])]
      : shelvesOrError.map((s) => renderShelf(s, now))
  );
}

// ------------------------------------------------------ requests and guide

export type PageRequest =
  | { page: 'trends'; tab: TrendsTab | 'remembered' }
  | { page: 'picks' };

/** Which of our pages a browse request asks for, if any. */
export function pageRequestOf(requestBody: string): PageRequest | null {
  const m = /"browseId"\s*:\s*"FEytaf_(trends|picks)(?:_(\w+))?"/.exec(
    requestBody
  );
  if (!m) return null;
  if (m[1] === 'picks') return m[2] === undefined ? { page: 'picks' } : null;
  if (m[2] === undefined) return { page: 'trends', tab: 'remembered' };
  return (TAB_IDS as string[]).includes(m[2])
    ? { page: 'trends', tab: m[2] as TrendsTab }
    : null;
}

/**
 * The TV app caches a page per browse id, so the guide entry would always
 * show the country it opened first. Its command is therefore rewritten, at
 * the moment it is chosen, into the remembered country's own page.
 */
export function toRememberedCountry(
  command: Record<string, unknown>,
  tab: TrendsTab
): Record<string, unknown> | null {
  const browse = command.browseEndpoint as { browseId?: unknown } | undefined;
  if (browse?.browseId !== TRENDS_BROWSE_ID) return null;
  return {
    ...command,
    browseEndpoint: { ...browse, browseId: `${TRENDS_BROWSE_ID}_${tab}` }
  };
}

/** The same request, asking for a real page we then fill with our shelves. */
export function withCarrier(requestBody: string, carrierBrowseId: string) {
  return requestBody.replace(
    /"browseId"\s*:\s*"FEytaf_\w+"/,
    `"browseId":"${carrierBrowseId}"`
  );
}

const JSON_PREFIX = ")]}'\n";

/** The real response with its `contents` replaced; everything else kept. */
export function swapBrowseContents(realText: string, contents: object): string {
  const prefix = realText.startsWith(JSON_PREFIX) ? JSON_PREFIX : '';
  const real = JSON.parse(realText.slice(prefix.length)) as Record<
    string,
    unknown
  >;
  real.contents = contents;
  return prefix + JSON.stringify(real);
}

type GuideEntry = {
  guideEntryRenderer?: {
    navigationEndpoint?: { browseEndpoint?: { browseId?: string } };
    icon?: { iconType?: string };
  };
};

const browseIdOf = (e: GuideEntry) =>
  e?.guideEntryRenderer?.navigationEndpoint?.browseEndpoint?.browseId;

const OUR_ENTRIES: GuideEntry[] = [
  { browseId: TRENDS_BROWSE_ID, icon: 'WHATS_HOT', title: 'Тренды' },
  { browseId: PICKS_BROWSE_ID, icon: 'EXPLORE', title: 'Подборка' }
].map(({ browseId, icon, title }) => ({
  guideEntryRenderer: {
    navigationEndpoint: { browseEndpoint: { browseId } },
    icon: { iconType: icon },
    formattedTitle: { simpleText: title }
  } as NonNullable<GuideEntry['guideEntryRenderer']>
}));

/**
 * Adds Trends and Picks after Home and drops the hidden topics. Returns the
 * Home browse id: a page this account can surely open, used as the carrier.
 */
export function patchGuide(guide: unknown): {
  patched: boolean;
  homeBrowseId: string | null;
} {
  const sections = (guide as { items?: unknown })?.items;
  const lists = Array.isArray(sections)
    ? sections
        .map(
          (s) =>
            (s as { guideSectionRenderer?: { items?: unknown } })
              ?.guideSectionRenderer
        )
        .filter((s): s is { items: GuideEntry[] } => Array.isArray(s?.items))
    : [];
  if (lists.length === 0) return { patched: false, homeBrowseId: null };

  let homeBrowseId: string | null = null;
  for (const section of lists) {
    section.items = section.items.filter(
      (e) => !HIDDEN_BROWSE_IDS.includes(browseIdOf(e) ?? '')
    );
    const home = section.items.findIndex(
      (e) => e?.guideEntryRenderer?.icon?.iconType === 'WHAT_TO_WATCH'
    );
    if (home === -1) continue;
    homeBrowseId = browseIdOf(section.items[home]!) ?? null;
    if (section.items.some((e) => browseIdOf(e)?.startsWith('FEytaf_')))
      continue;
    section.items.splice(home + 1, 0, ...OUR_ENTRIES.map((e) => ({ ...e })));
  }
  return { patched: true, homeBrowseId };
}
