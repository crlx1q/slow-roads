# slow-roads — детальный разбор

Заметки по устройству репозитория `crlx1q/slow-roads`. Хранятся в репозитории намеренно: рабочая песочница недолговечна, GitHub — единственный надёжный носитель.

## 1. Происхождение

- Форк `TheGreatMaximus98/slow-roads` (описание апстрима: «slowroads.io but unblocked ;)»).
- Вся история коммитов унаследована от апстрима, свои коммиты в форке начинаются с этой документации.
- История апстрима показывает, что билд заливали вручную через веб-интерфейс: `Create index.html`, `Add files via upload`, `static files`, `Delete static directory`, `new static files`, `404 fix`, `Create CNAME` → `Delete CNAME`, `Create LICENSE` → `Delete LICENSE`.
- Следствие: это не репозиторий разработки, а снапшот чужого production-билда. Ни `package.json`, ни конфигов сборки, ни сорсмапов.

## 2. Сборка и рантайм

### index.html

- CRA-шаблон: `<div id="root">`, `<noscript>`, `theme-color`, ссылка на манифест.
- Инлайн webpack-runtime, глобальный jsonp-массив `webpackJsonpslowroads.io` — прямое доказательство, что бандл собран из проекта `slowroads.io`.
- `a.p = "./"` — relative publicPath. Критично для Pages: сайт не привязан к корню домена и работает из `/slow-roads/`.
- Таблица чанков в рантайме: `{3: "37460af1"}` → ожидается `static/js/3.37460af1.chunk.js`. **В репозитории этого файла нет.** Таймаут загрузки чанка — 120 с, затем `ChunkLoadError`.
- Синхронно грузятся ровно два скрипта: `static/js/2.feea8a5f.chunk.js` и `static/js/main.ca6b3355.chunk.js`.

### Разделение кода

| Чанк | Размер | Содержимое |
|---|---|---|
| `2.feea8a5f.chunk.js` | 664 КБ | vendor: React/ReactDOM + WebGL-движок сцены (загрузчики `.obj`, работа с текстурами и звуком) |
| `main.ca6b3355.chunk.js` | 694 КБ | игровая логика: генерация трассы, физика авто, UI, настройки |
| `main.8b77de6a.chunk.css` | 37 КБ | вся вёрстка оверлеев и меню |

Файлы минифицированы и превышают лимит индексации GitHub Code Search (поиск по ним не работает), сорсмапов нет — поэтому внутренняя структура восстанавливается по рантайму, именам ассетов и CSS.

### Генерация мира

- `alea.min.js` — Alea PRNG (вариант Johannes Baagøe): `s0/s1/s2 + c`, инициализация от строкового сида, `next()` / `int32()` / `double()`, экспорт `state()` для сериализации.
- Подключён глобально, а не через бандл — значит игра дергает `window.alea(seed)` и получает воспроизводимый мир по сиду.
- `topo-square.png`, `topo-square-25.png`, `topo_square.png` — топографические карты высот/шума для рельефа; `crossfade_fine/finest.webp` — маски смешивания материалов на стыках биомов.

## 3. Инвентарь ассетов (`static/media`, ~110 файлов)

- **Модели (.obj):** `roadster-07-int` (салон), `roadster_wheel_02`, `steering_wheel`, `dashboard`, `sign`, `vergemarker`, `wallcap`.
- **Текстуры авто:** `roadster-07b_map.jpg`.
- **Дорожное полотно:** `road_03.webp`, `road_03_base.webp` (148 Б — почти плоский базовый цвет), `road-despawns.webp`.
- **Барьеры:** `wall_barrier_02` + `_n`, `wall_barrier_wood` + `_n` (normal-карты).
- **Поверхности:** `grass_spring_01`, `grass_summer_01`, `gravel_01`, `sand_01`, `heather_01`, `drystone_04`, `rock_06` + `_bump`, `concrete_01` (webp + jpg), `sea_waves`.
- **Растительность:** `foliage_bush_spring/summer`, `foliage_grass_spring/summer`, `trees_spring_near/far` (+ `b`-варианты), `trees_summer_near/far_04` (+ `b`), `forest_summer_01`.
- **Небо:** `clouds_01b`, `clouds_sunrise_b`, `clouds_autumn_sunset`.
- **Offworld (Марс):** `mars_surface` + `_bump`, `mars_cliff_bump`, `mars_rock_bump`, `mars_rubble_bump`, `mars_shale_bump`.
- **Превью локаций:** `loc_hills_lines.png`, `loc_offworld.png`.
- **Зима:** `flake.webp` (352 Б — частица снега).
- **Звук:** ambience (`ambiance_spring`, `ambiance_summer_low`), катание (`rolling_06`, `rolling_offroad_04` и `_int`-версии для салона), `veh_accel_06`, `veh_brake_02`, `tyres_01_m` (+ `_int`), `veh_scrape_01` (+ `_int`), удары `hit_01..03` (+ `_int`), `sus_01` (подвеска), `wind_02`, `surface_hit.wav`, `achievement.mp3`, `auto_on` / `auto_off`.
- **UI-иконки (.svg):** `config`, `v_config_1`, `controls`, `panorama`, `globe`, `refresh`, `cycle_timer`, `lock_open`, `vol_high`, `vol_off`, сезоны `s_spring/s_summer/s_autumn/s_winter`, транспорт `veh_car/veh_bus/veh_bike`, `ico_kofi`, `anslo_ico`, `favicon_circle_white`.
- **Прочее:** шрифты `Jura.ttf`, `ShareTech.ttf`, `splash-logo-placeholder-7b.png`.

Выводы по фичам: 4 сезона, минимум 2 локации (включая внеземную), 3 класса транспорта, вид из салона с работающей приборной панелью, автопилот, система достижений, полноценный звуковой слой с раздельными наборами «снаружи/внутри».

## 4. Пригодность к GitHub Pages

Плюсы:

- Полностью статический контент, сборка не нужна.
- Относительные пути (`./`) — работает из подкаталога `/slow-roads/`.
- Объём ~6.6 МБ, крупнейший файл 694 КБ: лимиты Pages (1 ГБ на сайт, 100 МБ на файл) далеко.
- Типы `.webp/.mp3/.wav/.ttf/.obj` Pages отдаёт нормально; `.obj` уходит как поток и грузится через XHR/fetch.

Что добавлено для деплоя:

- `.nojekyll` — минует Jekyll-обработку, ускоряет сборку и защищает от игнора служебных путей.
- `404.html` — возвращает пользователя в корень сайта; защита от цикла редиректов через параметр `sr404`.
- `.github/workflows/pages.yml` — деплой через Actions, шаг `actions/configure-pages@v5` c `enablement: true` включает Pages сам.

Ограничения, которые нельзя закрыть из API:

- В форках GitHub Actions отключены по умолчанию — нужен один клик во вкладке Actions.
- Альтернатива без Actions: Settings → Pages → Deploy from a branch → `main` / `(root)`.

## 5. Рекомендации

1. Донести `static/js/3.37460af1.chunk.js` из оригинального билда либо убедиться, что ленивый чанк не используется.
2. Починить мета-теги: добавить `img.jpg` (или заменить `og:image`), поправить `og:url`/`twitter:url` на адрес деплоя.
3. Зафиксировать статус-кво в README относительно авторства Anslo; без лицензии форк остаётся зеркалом проприетарного контента.
4. При желании офлайна — добавить service worker; сейчас манифест без него декоративен.
