/**
 * Where the Picks rows come from. Every channel id was checked against the
 * Data API on 2026-10-18: it exists and uploaded within the last weeks.
 * To change a row, edit its list; a channel's id is the UC... in its URL.
 */
import type { PicksRow } from './core';

export type PicksSource =
  | { search: string; language: string; region: string }
  | { channels: string[] };

const RU_TRAVEL = [
  'UCH4KR4_UxYIfQDTHaPeMWtg', // Орёл и Решка
  'UClqc_ZRyx7vYf_zfBFXQ4Lw', // Погнали!
  'UCFGe3bs70DY3bpENODw3Ftg', // Жизнь других
  'UCgovv1nO7nnCwulSBa2Kjsw', // Про путешествия, Богдан Булычёв
  'UC7MK3ezlQh-Wix7y3WwaZYA', // Мир без границ с Сергеем Завидовым
  'UCUK5FfR5uEqRyqDejBBHWQA', // В путь. On the way
  'UCXrMdUHkl2taQq4DhPg4etg', // Samsebeskazal Denis
  'UC2pyVbpYA3deli8oR-N-IQw', // Марина Галкина
  'UCrxMZAdN2fOURIto_-fQrLQ', // Temnaya FAZA
  'UCjdbSRhN2EminWODEUbFzvQ', // Отдых от А до Я
  'UCRIxw-P7mp_IKqPWhsClGlA' // вДудь Tour
];

const RU_SHOWS = [
  'UCNqktdxgAADBj36dC7VGOgg', // LABELCOM: Что было дальше?
  'UCp0QOno_8FOaGbn8gQujRHQ', // Канал Коваля: Своя игра
  'UCj7bSQWlq2O4lhGxGll5SUA', // Вписка
  'UC7p0GCM88wBsrlv5n5eeCHw', // Шастун
  'UCn9bv143ECsDMw-kJCNN7QA', // Чикен Карри
  'UC8M5YVWQan_3Elm-URehz9w', // Utopia Show
  'UCoP3fg3CMjo8M0_vAs1H5zA' // Чирико: Ты меня знаешь?
];

const EN_TRAVEL = [
  'UCyEd6QBSgat5kkC6svyjudA', // Mark Wiens
  'UCcAd5Np7fO8SeejB1FVKcYw', // Best Ever Food Review Show
  'UCvK4bOhULCpmLabd2pDMtnA', // Yes Theory
  'UC0Ize0RLIbGdH5x4wI45G-A', // Drew Binsky
  'UCt_NLJ4McJlCyYM-dSPRo7Q', // Lost LeBlanc
  'UCJsUvAqDzczYv2UpFmu4PcA', // Nas Daily
  'UC4ijq8Cg-8zQKx8OH12dUSw', // Kara and Nate
  'UC3Vuq4Q1bKFtAiKYlwRv3oA', // Peter Santenello
  'UCw6hflfioKOlhKd1C1QOBpw' // Hugh Abroad
];

const EN_SHOWS = [
  'UCPD_bxCRGpmmeQcbe2kpPaA', // First We Feast: Hot Ones
  'UC8-Th83bH_thdKZDJCrn88g', // The Tonight Show Starring Jimmy Fallon
  'UCa6vGFO9ty8v5KZJXQxdhaw', // Jimmy Kimmel Live
  'UCqFzWxSCi39LnW1JKFR3efg', // Saturday Night Live
  'UCwWhs_6x42TyRM4Wstoq8HA', // The Daily Show
  'UCDogdKl7t7NHzQ95aEwkdMw', // Sidemen
  'UCxOzbkk0bdVl6-tH1Fcajfg', // Beta Squad
  'UCY30JRSgfhYXA6i6xX1erWg', // Smosh
  'UCJjSDX-jUChzOEyok9XYRJQ', // Jubilee
  'UC4PooiX37Pld1T8J5SYT-SQ', // Good Mythical Morning
  'UCRijo3ddMTht_IHyNSNXpNQ', // Dude Perfect
  'UCX6OQ3DkcsbYNE6H8uQQuVA' // MrBeast
];

const LV_RUSSIAN = [
  'UCJTnc26yv_zaEJWbzhqHtCQ', // Рижанин по планете
  'UCbkGcsQKpCfZAn3y9mD8gAg', // Похождения Дэна
  'UCElI6dzeIICP7jYG8dzq7UQ', // Nikita Riga
  'UCa3gjArGZZG7VA2YDUITemg', // Lena Aro
  'UCRidfJtEOquklFG0lCn4pPw', // Veronika's Life
  'UCLVXxIcDEt7y8P469Rw_8qA', // БАМА TV
  'UCflzR0bDQ49q2n0L4wH7AoA', // Эрвин и Алина
  'UCWSckqB8CTKc_m1Du20cY7g', // AlisaLifeStyle
  'UCT4wLJNdKG11F5fOKoV4g2A' // ForeverTravel
];

/** In page order; "Все" shows them all, a country only its own. */
export const PICKS: (PicksRow & { source: PicksSource })[] = [
  {
    id: 'ru-travel-search',
    country: 'ru',
    title: { ru: 'Путешествия', en: 'Russian travel' },
    order: 'views',
    perChannel: 2,
    days: 14,
    source: { search: 'путешествие', language: 'ru', region: 'RU' }
  },
  {
    id: 'ru-travel-channels',
    country: 'ru',
    title: {
      ru: 'Новое на каналах о путешествиях',
      en: 'New from Russian travel channels'
    },
    order: 'date',
    perChannel: 3,
    days: 30,
    source: { channels: RU_TRAVEL }
  },
  {
    id: 'ru-shows',
    country: 'ru',
    title: { ru: 'Шоу', en: 'Russian shows' },
    order: 'views',
    perChannel: 5,
    // Russian shows come out every week or two; a month is too short a window.
    days: 60,
    source: { channels: RU_SHOWS }
  },
  {
    id: 'lv-travel-search',
    country: 'lv',
    title: { ru: 'Ceļojumi', en: 'Latvian travel' },
    order: 'views',
    perChannel: 3,
    days: 30,
    source: { search: 'ceļojums', language: 'lv', region: 'LV' }
  },
  {
    id: 'lv-shows-search',
    country: 'lv',
    title: { ru: 'Šovi', en: 'Latvian shows' },
    order: 'views',
    perChannel: 4,
    days: 30,
    source: { search: 'šovs', language: 'lv', region: 'LV' }
  },
  {
    id: 'lv-russian-channels',
    country: 'lv',
    title: { ru: 'Латвия по-русски', en: 'Latvia in Russian' },
    order: 'date',
    perChannel: 3,
    days: 30,
    source: { channels: LV_RUSSIAN }
  },
  {
    id: 'us-travel',
    country: 'us',
    title: { ru: 'Travel', en: 'Travel' },
    order: 'views',
    perChannel: 4,
    days: 30,
    source: { channels: EN_TRAVEL }
  },
  {
    id: 'us-shows',
    country: 'us',
    title: { ru: 'Shows', en: 'Shows' },
    order: 'views',
    perChannel: 4,
    days: 21,
    source: { channels: EN_SHOWS }
  }
];
