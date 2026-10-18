import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPicksContents,
  buildTrendsContents,
  channelFromApi,
  formatAge,
  formatDuration,
  formatSubscribers,
  formatViews,
  isUnwanted,
  pageRequestOf,
  parseIsoDuration,
  patchGuide,
  picksShelf,
  rankAcrossRegions,
  swapBrowseContents,
  picksRowsFor,
  toRememberedPage,
  topChannelIds,
  trendingChannels,
  trendsShelves,
  videoFromApi,
  withCarrier,
  type TrendVideo
} from '../src/trends/core.ts';

const video = (id: string, over: Partial<TrendVideo> = {}): TrendVideo => ({
  id,
  title: `Video ${id}`,
  channel: `Channel ${id}`,
  channelId: `UC${id}`,
  views: 1000,
  publishedAt: '2026-10-15T10:00:00Z',
  durationSec: 293,
  categoryId: '10',
  thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
  tags: [],
  forKids: false,
  ...over
});

// ---------------------------------------------------------------- formatting

test('an ISO 8601 duration becomes seconds', () => {
  assert.equal(parseIsoDuration('PT4M53S'), 293);
  assert.equal(parseIsoDuration('PT1H23M'), 4980);
  assert.equal(parseIsoDuration('PT45S'), 45);
  assert.equal(parseIsoDuration('P0D'), 0);
  assert.equal(parseIsoDuration('garbage'), null);
});

test('a duration is drawn like YouTube draws it', () => {
  assert.equal(formatDuration(293), '4:53');
  assert.equal(formatDuration(45), '0:45');
  assert.equal(formatDuration(4980), '1:23:00');
});

test('views read in Russian with the right plural', () => {
  assert.equal(formatViews(1), '1 просмотр');
  assert.equal(formatViews(3), '3 просмотра');
  assert.equal(formatViews(11), '11 просмотров');
  assert.equal(formatViews(951), '951 просмотр');
  assert.equal(formatViews(12983), '12 тыс. просмотров');
  assert.equal(formatViews(1_250_000), '1,2 млн просмотров');
  assert.equal(formatViews(39_686_964), '39 млн просмотров');
  assert.equal(formatViews(2_100_000_000), '2,1 млрд просмотров');
});

test('subscribers read in Russian with the right plural', () => {
  assert.equal(formatSubscribers(1), '1 подписчик');
  assert.equal(formatSubscribers(22), '22 подписчика');
  assert.equal(formatSubscribers(4930), '4,9 тыс. подписчиков');
  assert.equal(formatSubscribers(7_160_000), '7,1 млн подписчиков');
});

test('the age of a video reads in Russian', () => {
  const now = new Date('2026-10-18T12:00:00Z');
  assert.equal(formatAge('2026-10-18T11:59:30Z', now), 'только что');
  assert.equal(formatAge('2026-10-18T11:55:00Z', now), '5 минут назад');
  assert.equal(formatAge('2026-10-18T09:00:00Z', now), '3 часа назад');
  assert.equal(formatAge('2026-10-17T11:00:00Z', now), '1 день назад');
  assert.equal(formatAge('2026-10-15T12:00:00Z', now), '3 дня назад');
  assert.equal(formatAge('2026-10-04T12:00:00Z', now), '2 недели назад');
  assert.equal(formatAge('2026-07-18T12:00:00Z', now), '3 месяца назад');
  assert.equal(formatAge('2024-10-18T12:00:00Z', now), '2 года назад');
});

// ------------------------------------------------------------------ the data

test('a Data API video becomes a video, preferring the localized title', () => {
  const v = videoFromApi({
    id: 'abcdefghijk',
    snippet: {
      title: 'Original',
      localized: { title: 'Перевод' },
      channelTitle: 'Rockstar Games',
      channelId: 'UCrockstar',
      publishedAt: '2026-10-15T16:00:00Z',
      categoryId: '20',
      tags: ['GTA'],
      thumbnails: {
        high: { url: 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg' }
      }
    },
    contentDetails: { duration: 'PT1M31S' },
    statistics: { viewCount: '39686964' },
    status: { madeForKids: false }
  });
  assert.deepEqual(v, {
    id: 'abcdefghijk',
    title: 'Перевод',
    channel: 'Rockstar Games',
    channelId: 'UCrockstar',
    views: 39686964,
    publishedAt: '2026-10-15T16:00:00Z',
    durationSec: 91,
    categoryId: '20',
    thumbnail: 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg',
    tags: ['GTA'],
    forKids: false
  });
  assert.equal(videoFromApi({ snippet: {} }), null);
});

test('a Data API channel becomes name, avatar and subscribers', () => {
  assert.deepEqual(
    channelFromApi({
      id: 'UCx',
      snippet: {
        title: 'LABELCOM',
        thumbnails: { medium: { url: 'https://yt3/m' } }
      },
      statistics: { subscriberCount: '7160000' }
    }),
    {
      id: 'UCx',
      title: 'LABELCOM',
      avatar: 'https://yt3/m',
      subscribers: 7160000
    }
  );
  assert.equal(
    channelFromApi({
      id: 'UCy',
      snippet: { title: 'Hidden', thumbnails: { default: { url: 'u' } } },
      statistics: { subscriberCount: '5', hiddenSubscriberCount: true }
    })?.subscribers,
    null
  );
  assert.equal(
    channelFromApi({ id: 'UCz', snippet: { title: 'No picture' } }),
    null
  );
});

// ------------------------------------------------------------------ filters

test('Roblox, Minecraft, anime and cartoons are unwanted, by title, channel or tag', () => {
  assert.ok(
    isUnwanted(video('a', { title: 'ПРОДАЕМ КАРТОШКУ ФРИ В ROBLOX!' }))
  );
  assert.ok(
    isUnwanted(
      video('b', {
        title: 'ОЖИВИ ПУСТЫНЮ',
        channel: 'ВЛАДУС ИГРАЕТ',
        tags: ['майнкрафт']
      })
    )
  );
  assert.ok(
    isUnwanted(video('c', { title: 'LAST TRAILER | BLEACH', tags: ['anime'] }))
  );
  assert.ok(
    isUnwanted(
      video('d', { title: 'Разбор трейлера', channel: 'Lyre Miraculous' })
    )
  );
  assert.ok(isUnwanted(video('e', { title: 'Маша и Медведь 💥 НОВАЯ СЕРИЯ' })));
  assert.ok(isUnwanted(video('f', { forKids: true })));
});

test('of the games only trailers and announcements stay', () => {
  assert.ok(
    !isUnwanted(
      video('t', {
        categoryId: '20',
        title: 'Grand Theft Auto VI Launch Trailer'
      })
    )
  );
  assert.ok(
    !isUnwanted(
      video('u', {
        categoryId: '20',
        title: 'Cyberpunk 2 | Официальный трейлер'
      })
    )
  );
  assert.ok(
    isUnwanted(
      video('g', { categoryId: '20', title: 'Something Appeared In The Sky…' })
    )
  );
});

test('ordinary videos are kept, "animal" is not "anime"', () => {
  assert.ok(
    !isUnwanted(video('m', { title: 'Olivia Rodrigo - expectations' }))
  );
  assert.ok(
    !isUnwanted(
      video('n', { title: 'Animal rescue in Africa', categoryId: '24' })
    )
  );
});

// ------------------------------------------------------------------- trends

test('a video high in many countries outranks one high in a single country', () => {
  const de = [video('solo'), video('both'), video('x1')];
  const fr = [video('both'), video('x2'), video('x3')];
  const ranked = rankAcrossRegions([de, fr]);
  assert.deepEqual(
    ranked.map((v) => v.id),
    ['both', 'solo', 'x2', 'x1', 'x3']
  );
  assert.equal(ranked[0]!.countries, 2);
  assert.equal(ranked[1]!.countries, 1);
});

test('equal scores are broken by views', () => {
  const ranked = rankAcrossRegions([
    [video('a', { views: 10 })],
    [video('b', { views: 99 })]
  ]);
  assert.deepEqual(
    ranked.map((v) => v.id),
    ['b', 'a']
  );
});

test('trends shelves: top, channels, music, game trailers, film and entertainment; empty ones skipped', () => {
  const ranked = rankAcrossRegions([
    [
      video('m1', { categoryId: '10' }),
      video('g1', { categoryId: '20' }),
      video('e1', { categoryId: '24' }),
      video('f1', { categoryId: '1' })
    ]
  ]);
  const channels = [
    { id: 'UCm1', title: 'M', avatar: 'a', subscribers: 5, videoCount: 1 }
  ];
  const shelves = trendsShelves(ranked, channels);
  assert.deepEqual(
    shelves.map((s) => s.title),
    [
      'Топ',
      'Каналы в трендах',
      'Музыка',
      'Игры: трейлеры',
      'Кино и развлечения'
    ]
  );
  assert.deepEqual(
    trendsShelves(ranked).map((s) => s.title),
    ['Топ', 'Музыка', 'Игры: трейлеры', 'Кино и развлечения']
  );
});

test('a shelf holds at most 50 videos', () => {
  const many = Array.from({ length: 70 }, (_, i) => video(`v${i}`));
  const [top] = trendsShelves(rankAcrossRegions([many]));
  assert.equal(top!.kind === 'videos' && top!.videos.length, 50);
});

test('trending channels: strongest first, with their count of trending videos', () => {
  const ranked = rankAcrossRegions([
    [
      video('a1', { channelId: 'UCa' }),
      video('b1', { channelId: 'UCb' }),
      video('a2', { channelId: 'UCa' }),
      video('c1', { channelId: 'UCc' })
    ]
  ]);
  const ids = topChannelIds(ranked, 2);
  assert.deepEqual(ids, ['UCa', 'UCb']);
  const infos = [
    { id: 'UCb', title: 'B', avatar: 'b', subscribers: 2 },
    { id: 'UCa', title: 'A', avatar: 'a', subscribers: null }
  ];
  assert.deepEqual(trendingChannels(ranked, ids, infos), [
    { id: 'UCa', title: 'A', avatar: 'a', subscribers: null, videoCount: 2 },
    { id: 'UCb', title: 'B', avatar: 'b', subscribers: 2, videoCount: 1 }
  ]);
});

// -------------------------------------------------------------------- picks

test('a picks row drops Shorts, kids, old and repeated videos and caps each channel', () => {
  const now = new Date('2026-10-18T12:00:00Z');
  const row = {
    id: 'shows',
    country: 'ru' as const,
    title: 'Шоу',
    order: 'views' as const,
    perChannel: 2,
    days: 30
  };
  const shelf = picksShelf(
    row,
    [
      video('a1', { channelId: 'UCa', views: 900, durationSec: 3600 }),
      video('a2', { channelId: 'UCa', views: 800, durationSec: 3600 }),
      video('a3', { channelId: 'UCa', views: 700, durationSec: 3600 }),
      video('b1', { channelId: 'UCb', views: 950, durationSec: 3600 }),
      video('b1', { channelId: 'UCb', views: 950, durationSec: 3600 }),
      video('short', { views: 99999, durationSec: 59 }),
      video('kids', { views: 99999, durationSec: 3600, forKids: true }),
      video('old', {
        views: 99999,
        durationSec: 3600,
        publishedAt: '2026-08-01T00:00:00Z'
      })
    ],
    now
  );
  assert.equal(shelf.title, 'Шоу');
  assert.deepEqual(shelf.kind === 'videos' && shelf.videos.map((v) => v.id), [
    'b1',
    'a1',
    'a2'
  ]);
});

test('a picks row can put the newest first', () => {
  const now = new Date('2026-10-18T12:00:00Z');
  const shelf = picksShelf(
    {
      id: 'new',
      country: 'ru',
      title: 'Новое',
      order: 'date',
      perChannel: 5,
      days: 30
    },
    [
      video('old', {
        durationSec: 600,
        publishedAt: '2026-10-01T00:00:00Z',
        views: 9
      }),
      video('new', {
        durationSec: 600,
        publishedAt: '2026-10-17T00:00:00Z',
        views: 1
      })
    ],
    now
  );
  assert.deepEqual(shelf.kind === 'videos' && shelf.videos.map((v) => v.id), [
    'new',
    'old'
  ]);
});

// ------------------------------------------------- what the TV app renders

type AnyShelf = {
  shelfRenderer: {
    headerRenderer: {
      shelfHeaderRenderer: {
        avatarLockup: {
          avatarLockupRenderer: {
            title: { runs: { text: string }[] };
            subtitle: { runs: { text: string }[] };
          };
        };
      };
    };
    content: { horizontalListRenderer: { items: { tileRenderer: any }[] } };
  };
};

const shelvesOf = (contents: ReturnType<typeof buildTrendsContents>) =>
  contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content
    .sectionListRenderer.contents as unknown as AnyShelf[];

const headerOf = (s: AnyShelf) =>
  s.shelfRenderer.headerRenderer.shelfHeaderRenderer.avatarLockup
    .avatarLockupRenderer;

const tilesOf = (s: AnyShelf) =>
  s.shelfRenderer.content.horizontalListRenderer.items.map(
    (i) => i.tileRenderer
  );

test('a trends page starts with the country row, the chosen country marked', () => {
  const [row] = shelvesOf(buildTrendsContents('ru', [], new Date()));
  assert.equal(headerOf(row!).title.runs[0]!.text, 'Страна');
  const tiles = tilesOf(row!);
  assert.deepEqual(
    tiles.map((t) => t.metadata.tileMetadataRenderer.title.simpleText),
    ['Мир', 'Европа', 'Россия', 'Латвия', 'США']
  );
  assert.deepEqual(
    tiles.map((t) => t.onSelectCommand.browseEndpoint.browseId),
    [
      'FEytaf_trends_world',
      'FEytaf_trends_europe',
      'FEytaf_trends_ru',
      'FEytaf_trends_lv',
      'FEytaf_trends_us'
    ]
  );
  const marked = tiles.map((t) => JSON.stringify(t).includes('выбрано'));
  assert.deepEqual(marked, [false, false, true, false, false]);
  for (const t of tiles) {
    assert.ok(
      t.header.tileHeaderRenderer.thumbnail.thumbnails[0].url.startsWith(
        'data:image/svg+xml'
      )
    );
  }
});

test('a video tile plays the video and shows title, channel, views and age', () => {
  const now = new Date('2026-10-18T12:00:00Z');
  const [, top] = shelvesOf(
    buildTrendsContents(
      'ru',
      [{ kind: 'videos', title: 'Топ', videos: [video('abcdefghijk')] }],
      now
    )
  );
  assert.equal(headerOf(top!).title.runs[0]!.text, 'Топ: Россия');
  const tile = tilesOf(top!)[0];
  assert.equal(tile.onSelectCommand.watchEndpoint.videoId, 'abcdefghijk');
  assert.equal(tile.contentType, 'TILE_CONTENT_TYPE_VIDEO');
  assert.equal(
    tile.metadata.tileMetadataRenderer.title.simpleText,
    'Video abcdefghijk'
  );
  const json = JSON.stringify(tile);
  assert.ok(json.includes('Channel abcdefghijk'));
  assert.ok(json.includes('1 тыс. просмотров'));
  assert.ok(json.includes('3 дня назад'));
  assert.ok(json.includes('"4:53"'));
});

test('a channel tile opens the channel and shows subscribers and trending count', () => {
  const [, channels] = shelvesOf(
    buildTrendsContents(
      'lv',
      [
        {
          kind: 'channels',
          title: 'Каналы в трендах',
          channels: [
            {
              id: 'UCx',
              title: 'LABELCOM',
              avatar: 'https://yt3/x',
              subscribers: 7_160_000,
              videoCount: 3
            }
          ]
        }
      ],
      new Date()
    )
  );
  assert.equal(headerOf(channels!).title.runs[0]!.text, 'Каналы в трендах');
  const tile = tilesOf(channels!)[0];
  assert.equal(tile.onSelectCommand.browseEndpoint.browseId, 'UCx');
  assert.equal(tile.contentType, 'TILE_CONTENT_TYPE_CHANNEL');
  const json = JSON.stringify(tile);
  assert.ok(json.includes('7,1 млн подписчиков'));
  assert.ok(json.includes('3 видео в трендах'));
});

test('an error page keeps the country row and says what went wrong', () => {
  const shelves = shelvesOf(buildTrendsContents('lv', 'Нет сети', new Date()));
  assert.equal(shelves.length, 2);
  assert.equal(headerOf(shelves[0]!).title.runs[0]!.text, 'Страна');
  assert.equal(
    headerOf(shelves[1]!).title.runs[0]!.text,
    'Не удалось загрузить тренды'
  );
  assert.equal(headerOf(shelves[1]!).subtitle.runs[0]!.text, 'Нет сети');
});

test('a picks page starts with its own country row, then its rows', () => {
  const shelves = shelvesOf(
    buildPicksContents(
      'lv',
      [{ kind: 'videos', title: 'Ceļojumi', videos: [video('p')] }],
      new Date()
    )
  );
  assert.deepEqual(
    shelves.map((s) => headerOf(s).title.runs[0]!.text),
    ['Страна', 'Ceļojumi']
  );
  const tiles = tilesOf(shelves[0]!);
  assert.deepEqual(
    tiles.map((t) => t.metadata.tileMetadataRenderer.title.simpleText),
    ['Все', 'Россия', 'Латвия', 'США']
  );
  assert.deepEqual(
    tiles.map((t) => t.onSelectCommand.browseEndpoint.browseId),
    [
      'FEytaf_picks_all',
      'FEytaf_picks_ru',
      'FEytaf_picks_lv',
      'FEytaf_picks_us'
    ]
  );
  assert.deepEqual(
    tiles.map((t) => JSON.stringify(t).includes('выбрано')),
    [false, false, true, false]
  );
});

test('a picks page without rows keeps the country row and says why', () => {
  const shelves = shelvesOf(
    buildPicksContents('us', 'Квота кончилась', new Date())
  );
  assert.deepEqual(
    shelves.map((s) => headerOf(s).title.runs[0]!.text),
    ['Страна', 'Не удалось загрузить подборку']
  );
});

test('a country shows its own rows, All shows every row', () => {
  const rows = [
    { id: 'a', country: 'ru' as const },
    { id: 'b', country: 'lv' as const },
    { id: 'c', country: 'us' as const },
    { id: 'd', country: 'lv' as const }
  ];
  assert.deepEqual(
    picksRowsFor('lv', rows).map((r) => r.id),
    ['b', 'd']
  );
  assert.deepEqual(
    picksRowsFor('all', rows).map((r) => r.id),
    ['a', 'b', 'c', 'd']
  );
});

// ------------------------------------------------------ requests and guide

test('a browse request for our pages is recognised, any other is not', () => {
  assert.deepEqual(
    pageRequestOf('{"context":{},"browseId":"FEytaf_trends_world"}'),
    { page: 'trends', tab: 'world' }
  );
  assert.deepEqual(
    pageRequestOf('{"browseId": "FEytaf_trends_ru","params":"x"}'),
    { page: 'trends', tab: 'ru' }
  );
  assert.deepEqual(pageRequestOf('{"browseId":"FEytaf_trends"}'), {
    page: 'trends',
    tab: 'remembered'
  });
  assert.deepEqual(pageRequestOf('{"browseId":"FEytaf_picks"}'), {
    page: 'picks',
    country: 'remembered'
  });
  assert.deepEqual(pageRequestOf('{"browseId":"FEytaf_picks_lv"}'), {
    page: 'picks',
    country: 'lv'
  });
  assert.equal(pageRequestOf('{"browseId":"FEytaf_picks_world"}'), null);
  assert.equal(pageRequestOf('{"browseId":"FEytaf_trends_xx"}'), null);
  assert.equal(pageRequestOf('{"browseId":"FEtopics"}'), null);
});

test('the request is sent to a real page instead of ours', () => {
  assert.equal(
    withCarrier('{"context":{},"browseId":"FEytaf_trends_lv"}', 'FEtopics'),
    '{"context":{},"browseId":"FEtopics"}'
  );
  assert.equal(
    withCarrier('{"browseId":"FEytaf_picks"}', 'FEwhat_to_watch'),
    '{"browseId":"FEwhat_to_watch"}'
  );
});

test("the real page's contents are swapped for ours, the rest and the prefix kept", () => {
  const real = `)]}'\n${JSON.stringify({
    responseContext: { a: 1 },
    contents: { old: true },
    trackingParams: 'T'
  })}`;
  const out = swapBrowseContents(real, { ours: true });
  assert.ok(out.startsWith(")]}'\n"));
  const parsed = JSON.parse(out.slice(5));
  assert.deepEqual(parsed.responseContext, { a: 1 });
  assert.equal(parsed.trackingParams, 'T');
  assert.deepEqual(parsed.contents, { ours: true });
});

const remembered = { trends: 'us', picks: 'lv' } as const;

test('the Trends and Picks entries go straight to the remembered country page', () => {
  const command = {
    clickTrackingParams: 'C',
    browseEndpoint: { browseId: 'FEytaf_trends' }
  };
  assert.deepEqual(toRememberedPage(command, remembered), {
    clickTrackingParams: 'C',
    browseEndpoint: { browseId: 'FEytaf_trends_us' }
  });
  assert.equal(command.browseEndpoint.browseId, 'FEytaf_trends');
  assert.deepEqual(
    toRememberedPage(
      { browseEndpoint: { browseId: 'FEytaf_picks' } },
      remembered
    ),
    { browseEndpoint: { browseId: 'FEytaf_picks_lv' } }
  );
});

test('any other browse is not rewritten', () => {
  for (const browseId of ['FEytaf_trends_ru', 'FEytaf_picks_ru', 'FEtopics']) {
    assert.equal(
      toRememberedPage({ browseEndpoint: { browseId } }, remembered),
      null
    );
  }
  assert.equal(toRememberedPage({ watchEndpoint: {} }, remembered), null);
});

const guide = () => ({
  items: [
    {
      guideSectionRenderer: {
        items: [
          entry('Поиск', 'SEARCH', null),
          entry('Главная', 'WHAT_TO_WATCH', 'FEtopics'),
          entry('Подписки', 'SUBSCRIPTIONS', 'FEsubscriptions'),
          entry('Музыка', 'YOUTUBE_MUSIC', 'FEtopics_music'),
          entry('Фильмы', 'CLAPPERBOARD', 'FEtopics_movies'),
          entry('Видеоигры', 'GAMING', 'FEtopics_gaming'),
          entry('Спорт', 'TROPHY', 'FEtopics_sports')
        ]
      }
    },
    {
      guideSectionRenderer: {
        items: [entry('Настройки', 'SETTINGS', null)]
      }
    }
  ]
});

function entry(title: string, icon: string, browseId: string | null) {
  return {
    guideEntryRenderer: {
      navigationEndpoint: browseId
        ? { clickTrackingParams: 'C', browseEndpoint: { browseId } }
        : { searchEndpoint: {} },
      icon: { iconType: icon },
      trackingParams: 'T',
      formattedTitle: { simpleText: title }
    }
  };
}

const titles = (g: ReturnType<typeof guide>) =>
  g.items[0]!.guideSectionRenderer.items.map(
    (e) => e.guideEntryRenderer.formattedTitle.simpleText
  );

const browseIdAt = (g: ReturnType<typeof guide>, i: number) =>
  (
    g.items[0]!.guideSectionRenderer.items[i]!.guideEntryRenderer
      .navigationEndpoint as { browseEndpoint: { browseId: string } }
  ).browseEndpoint.browseId;

test('the guide gets Trends and Picks after Home and loses movies, games and sports', () => {
  const g = guide();
  const result = patchGuide(g);
  assert.deepEqual(titles(g), [
    'Поиск',
    'Главная',
    'Тренды',
    'Подборка',
    'Подписки',
    'Музыка'
  ]);
  assert.equal(result.homeBrowseId, 'FEtopics');
  assert.equal(browseIdAt(g, 2), 'FEytaf_trends');
  assert.equal(browseIdAt(g, 3), 'FEytaf_picks');
});

test('patching the guide twice adds the entries once', () => {
  const g = guide();
  patchGuide(g);
  patchGuide(g);
  assert.equal(titles(g).filter((t) => t === 'Тренды').length, 1);
  assert.equal(titles(g).filter((t) => t === 'Подборка').length, 1);
});

test('something that is not a guide is left alone', () => {
  const notGuide = { items: [{ foo: 1 }] };
  assert.equal(patchGuide(notGuide).patched, false);
  assert.deepEqual(notGuide, { items: [{ foo: 1 }] });
  assert.equal(patchGuide(null).patched, false);
});
