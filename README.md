# slow-roads (fork)

Статический production-билд браузерной игры **slowroads.io** (студия Anslo), выложенный «как есть».
Форк `TheGreatMaximus98/slow-roads` («slowroads.io but unblocked»). Исходников проекта здесь нет — только собранный webpack-бандл.

| | |
|---|---|
| Тип | статический сайт (Create React App production build) |
| Ветка | `main` (единственная), HEAD `31001cf` |
| Размер репозитория | ~6.6 МБ (~110 медиа-файлов) |
| Апстрим-активность | последний коммит апстрима — 12.05.2024 |
| Лицензия | отсутствует (LICENSE был создан и удалён в апстриме) |
| GitHub Pages | настраивается этим репозиторием, см. ниже |

## Карта файлов

```
index.html                        # точка входа + инлайн webpack-runtime
alea.min.js                       # Alea PRNG (детерминированный генератор, seed -> трасса/рельеф)
favicon_circle.svg
manifest.json                     # PWA-манифест (standalone), service worker НЕ регистрируется
404.html                          # фолбэк для Pages (добавлен в этом форке)
.nojekyll                         # отключает Jekyll на Pages (добавлен в этом форке)
static/css/main.8b77de6a.chunk.css   # 37 КБ — весь UI
static/js/2.feea8a5f.chunk.js        # 664 КБ — vendor-чанк (React, WebGL-движок)
static/js/main.ca6b3355.chunk.js     # 694 КБ — код игры
static/media/                        # текстуры .webp/.jpg/.png, модели .obj, звук .mp3/.wav, шрифты .ttf
docs/ARCHITECTURE.md                 # детальный разбор устройства проекта
```

## Как это работает

1. `index.html` подключает инлайн webpack-runtime (`webpackJsonpslowroads.io`) с `publicPath = "./"` — **все пути относительные**, поэтому сайт корректно работает из подкаталога вида `/slow-roads/`. Это главное условие совместимости с project-сайтом GitHub Pages, и оно выполнено.
2. Дальше грузятся `2.*.chunk.js` (библиотеки) и `main.*.chunk.js` (игра), рендер идёт в `<div id="root">` через WebGL-канвас.
3. `alea.min.js` подключён отдельным `<script>` в глобальную область: детерминированный PRNG на сиде — из него растут бесконечная дорога, рельеф и расстановка объектов.
4. Ассеты подтягиваются лениво по мере смены сезона / локации / машины — отсюда большой `static/media`.

## Что нашлось в ассетах (функциональность игры)

- **Сезоны:** spring / summer / autumn / winter (иконки + отдельные ambience-треки и наборы листвы).
- **Локации:** `loc_hills_lines` (холмы) и `loc_offworld` — полный набор марсианских текстур с bump-картами (`mars_surface`, `mars_cliff`, `mars_shale`, `mars_rubble`).
- **Транспорт:** car / bus / bike (иконки) + 3D-модели `roadster-07-int.obj`, `roadster_wheel_02.obj`, `steering_wheel.obj`, `dashboard.obj` — есть вид из салона.
- **Звук:** двойные наборы «снаружи/в салоне» (`rolling_06` / `rolling_06_int`, `hit_0x` / `hit_0x_int`, `veh_scrape_01` / `_int`), разгон, тормоз, шины, подвеска (`sus_01`), ветер, `achievement.mp3`, звуки автопилота (`auto_on` / `auto_off`).
- **Окружение:** дорога и обочина (`road_03`, `vergemarker.obj`, `sign.obj`, `wallcap.obj`), барьеры (бетон/дерево + normal-карты), биомы (трава, гравий, песок, вереск, камень, сухая кладка, лес, морские волны), облака для разного времени суток, снежинка для зимы.
- **Служебное:** топографические шумовые карты `topo-square*.png` (генерация рельефа), маски `crossfade_*` (смешивание текстур), шрифты Jura и ShareTech, иконка Ko-fi и логотип Anslo.

## Известные проблемы форка

1. **Отсутствует async-чанк.** Runtime в `index.html` описывает чанк `static/js/3.37460af1.chunk.js`, но в `static/js/` его нет. Любая функция, вынесенная в этот ленивый чанк, упадёт с `ChunkLoadError`. Файл нужно донести из оригинального билда.
2. **Битый og:image.** `index.html` ссылается на `./img.jpg`, которого в репозитории нет; `og:url` и `twitter:url` указывают на `https://slowroads.io/`, а не на этот деплой.
3. **PWA наполовину.** `manifest.json` есть, service worker не регистрируется — офлайн-режима нет.
4. **Правовой момент.** Это зеркало проприетарного билда slowroads.io со всеми оригинальными ассетами, без лицензии. Публикация через Pages = публичное распространение чужого контента.

## GitHub Pages

Репозиторий уже подготовлен к деплою: корень репозитория и есть корень сайта, добавлены `.nojekyll` и `404.html`, относительные пути совместимы с подкаталогом.

Вариант A — GitHub Actions (workflow `.github/workflows/pages.yml`):

1. Вкладка **Actions** → включить workflow'ы (в форках Actions выключены по умолчанию).
2. Запустить **Deploy to GitHub Pages** (или сделать любой push в `main`) — шаг `configure-pages` включит Pages сам.

Вариант B — без Actions: **Settings → Pages → Source: Deploy from a branch → `main` / `(root)` → Save**.

Итоговый адрес: `https://crlx1q.github.io/slow-roads/`

Подробный разбор — в [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
