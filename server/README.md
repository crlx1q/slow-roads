# Сервер сохранений

GitHub Pages отдаёт только статику, поэтому «сохранение на сервере» живёт отдельно.
Здесь минимальный вариант на Cloudflare Worker + KV: бесплатного тарифа хватает с запасом
(снимок сохранения — единицы килобайт).

## Деплой

1. Установить CLI и залогиниться:

```bash
npm i -g wrangler
wrangler login
```

2. Создать KV-хранилище:

```bash
wrangler kv namespace create SR_SAVES
```

3. Рядом с `worker.js` создать `wrangler.toml` (id подставить из вывода прошлой команды):

```toml
name = "slow-roads-saves"
main = "worker.js"
compatibility_date = "2024-11-01"

[[kv_namespaces]]
binding = "SR_SAVES"
id = "<kv-namespace-id>"
```

4. Задеплоить:

```bash
wrangler deploy
```

## Подключение к игре

Открыть игру, в консоли браузера один раз выполнить:

```js
SRMOD.setEndpoint("https://slow-roads-saves.<аккаунт>.workers.dev")
```

URL запоминается в `localStorage`, страница перезагрузится. В центральном экране
индикатор поменяется с `local save` на `server save`.

Проверка вручную:

```bash
curl https://slow-roads-saves.<аккаунт>.workers.dev/state
```

## Слоты

Параметр `?slot=` разделяет профили: `/state?slot=main`, `/state?slot=test`.
Мод по умолчанию использует `default`.

## Приватность

Эндпоинт открыт всем, кто знает URL. Если нужен доступ только для себя — добавить в
Worker проверку заголовка с токеном и передавать его из мода (правка `remoteGet` /
`remotePut` в `mods/sr-mod.js`).
