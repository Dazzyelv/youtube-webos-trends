import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildBrowseContents,
  formatAge,
  formatDuration,
  formatViews,
  groupIntoShelves,
  parseIsoDuration,
  patchGuide,
  rankAcrossRegions,
  swapBrowseContents,
  trendsTabOf,
  videoFromApi,
  withCarrier,
  type TrendVideo
} from '../src/trends/core.ts';

const video = (id: string, over: Partial<TrendVideo> = {}): TrendVideo => ({
  id,
  title: `Video ${id}`,
  channel: `Channel ${id}`,
  views: 1000,
  publishedAt: '2026-10-15T10:00:00Z',
  durationSec: 293,
  categoryId: '10',
  thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
  ...over
});

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

test('a Data API item becomes a video, preferring the localized title', () => {
  const v = videoFromApi({
    id: 'abcdefghijk',
    snippet: {
      title: 'Original',
      localized: { title: 'Перевод' },
      channelTitle: 'Rockstar Games',
      publishedAt: '2026-10-15T16:00:00Z',
      categoryId: '20',
      thumbnails: {
        high: { url: 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg' }
      }
    },
    contentDetails: { duration: 'PT1M31S' },
    statistics: { viewCount: '39686964' }
  });
  assert.deepEqual(v, {
    id: 'abcdefghijk',
    title: 'Перевод',
    channel: 'Rockstar Games',
    views: 39686964,
    publishedAt: '2026-10-15T16:00:00Z',
    durationSec: 91,
    categoryId: '20',
    thumbnail: 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg'
  });
  assert.equal(videoFromApi({ snippet: {} }), null);
});

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

test('shelves: top first, then music, games, film and entertainment, the rest; empty ones skipped', () => {
  const ranked = rankAcrossRegions([
    [
      video('m1', { categoryId: '10' }),
      video('g1', { categoryId: '20' }),
      video('e1', { categoryId: '24' }),
      video('f1', { categoryId: '1' })
    ]
  ]);
  const shelves = groupIntoShelves(ranked);
  assert.deepEqual(
    shelves.map((s) => [s.title, s.videos.map((v) => v.id)]),
    [
      ['Топ', ['m1', 'g1', 'e1', 'f1']],
      ['Музыка', ['m1']],
      ['Игры', ['g1']],
      ['Кино и развлечения', ['e1', 'f1']]
    ]
  );
});

test('a shelf holds at most 30 videos', () => {
  const many = Array.from({ length: 45 }, (_, i) => video(`v${i}`));
  const shelves = groupIntoShelves(rankAcrossRegions([many]));
  assert.equal(shelves[0]!.videos.length, 30);
});

test('a tile plays the video and shows title, channel, views and age', () => {
  const now = new Date('2026-10-18T12:00:00Z');
  const contents = buildBrowseContents(
    [{ title: 'Топ', videos: rankAcrossRegions([[video('abcdefghijk')]]) }],
    now
  );
  const shelf =
    contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content
      .sectionListRenderer.contents[0]!.shelfRenderer;
  assert.equal(
    shelf.headerRenderer.shelfHeaderRenderer.avatarLockup.avatarLockupRenderer
      .title.runs[0]!.text,
    'Топ'
  );
  const tile = shelf.content.horizontalListRenderer.items[0]!.tileRenderer;
  assert.equal(tile.onSelectCommand.watchEndpoint.videoId, 'abcdefghijk');
  assert.equal(tile.contentId, 'abcdefghijk');
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

test('an error page is one shelf whose header carries the message', () => {
  const contents = buildBrowseContents('Нет сети', new Date());
  const header =
    contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content
      .sectionListRenderer.contents[0]!.shelfRenderer.headerRenderer
      .shelfHeaderRenderer.avatarLockup.avatarLockupRenderer;
  assert.equal(header.title.runs[0]!.text, 'Не удалось загрузить тренды');
  assert.equal(header.subtitle.runs[0]!.text, 'Нет сети');
});

test('a browse request for our tab is recognised, any other is not', () => {
  assert.equal(
    trendsTabOf('{"context":{},"browseId":"FEytaf_trends_world"}'),
    'world'
  );
  assert.equal(
    trendsTabOf('{"browseId": "FEytaf_trends_europe","params":"x"}'),
    'europe'
  );
  assert.equal(trendsTabOf('{"browseId":"FEtopics"}'), null);
});

test('the request is sent to a real page instead of ours', () => {
  assert.equal(
    withCarrier('{"context":{},"browseId":"FEytaf_trends_world"}', 'FEtopics'),
    '{"context":{},"browseId":"FEtopics"}'
  );
});

test("the real page's contents are swapped for ours, the rest and the prefix kept", () => {
  const real = `)]}'\n${JSON.stringify({
    responseContext: { a: 1 },
    contents: { old: true },
    trackingParams: 'T'
  })}`;
  const out = swapBrowseContents(real, 'boom', new Date());
  assert.ok(out.startsWith(")]}'\n"));
  const parsed = JSON.parse(out.slice(5));
  assert.deepEqual(parsed.responseContext, { a: 1 });
  assert.equal(parsed.trackingParams, 'T');
  assert.ok(parsed.contents.tvBrowseRenderer);
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

test('the guide gets both trends tabs after Home and loses movies, games and sports', () => {
  const g = guide();
  const result = patchGuide(g);
  assert.deepEqual(titles(g), [
    'Поиск',
    'Главная',
    'Тренды: мир',
    'Тренды: Европа',
    'Подписки',
    'Музыка'
  ]);
  assert.equal(result.homeBrowseId, 'FEtopics');
  const world = g.items[0]!.guideSectionRenderer.items[2]!.guideEntryRenderer;
  assert.equal(
    (world.navigationEndpoint as { browseEndpoint: { browseId: string } })
      .browseEndpoint.browseId,
    'FEytaf_trends_world'
  );
  assert.equal(world.icon.iconType, 'WHATS_HOT');
});

test('patching the guide twice adds the tabs once', () => {
  const g = guide();
  patchGuide(g);
  patchGuide(g);
  assert.equal(titles(g).filter((t) => t.startsWith('Тренды')).length, 2);
});

test('something that is not a guide is left alone', () => {
  const notGuide = { items: [{ foo: 1 }] };
  assert.equal(patchGuide(notGuide).patched, false);
  assert.deepEqual(notGuide, { items: [{ foo: 1 }] });
  assert.equal(patchGuide(null).patched, false);
});
