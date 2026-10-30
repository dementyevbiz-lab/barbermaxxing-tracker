# Трекер Barbermaxxing

Полное ТЗ: `docs/TZ.md`. Прочитать целиком перед работой, включая промпт в начале и Приложение А.
Заказчик не программист: объяснять просто, на «вы», вести по шагам. Секреты (токены, пароли, service_role) в чат не просить.

## Где что
- Хостинг: GitHub Pages из ветки `main`, корень. Адрес: https://dementyevbiz-lab.github.io/barbermaxxing-tracker/
- Бот: @barbermaxxing_tracker_bot. Main Mini App и Menu Button «Открыть» указывают на адрес выше
- Supabase: проект `barbermaxxing`, регион Frankfurt, https://nltremspmuuasksxbqtk.supabase.co. Открытые ключи в `config.js`
- Доступ к Supabase Management API: токен хранится как сетевой секрет окружения (Bearer, хост `api.supabase.com`), прокси сам подставляет заголовок Authorization. Токен в коде и в чате не нужен: просто вызывать `curl https://api.supabase.com/v1/projects/nltremspmuuasksxbqtk/...` (SQL через `/database/query`, функции через `/functions/deploy`, секреты функций через `/secrets`). Project ref: `nltremspmuuasksxbqtk`
- Токен бота заказчик вставит сам в секреты функций Supabase (Edge Functions → Secrets, имя `TELEGRAM_BOT_TOKEN`), в чат его не просить
- `index.html` — приложение (вход, экран ученика-заглушка, админка с приглашениями),
- `supabase/migrations/` — схема и стартовые данные, `supabase/functions/` — `tg-auth` (вход) и `admin` (приглашения, удаление, демо), `scripts/deploy.sh` — выкладка через Management API, `prototype/today.html` — демо экрана «Сегодня» (одобрен), `assets/` — фон и логотип от заказчика

## Ход работы
- Этап 1 (подготовка): готово. Mini App открывается в Telegram и пишет «Привет, имя». Проверено заказчиком на одном устройстве
- Этап 2 (экран «Сегодня» на демо-данных): показан, заказчик сказал «да», правки визуала отложены на потом
- Этап 3 (вход и данные): код готов в ветке `claude/upbeat-bell-dj2vgg`, проверен локально (Postgres 16 с заглушками auth/storage, тест прав `supabase/tests/rls_test.sql` проходит, тест подписи Telegram `supabase/tests/verify_test.ts` проходит). В Supabase ещё НЕ выложен: в той сессии токен Management API не подставлялся (401 «No access token provided»)
  - Выложить: `scripts/deploy.sh all` (миграции, функции `tg-auth` и `admin`, проверка прав)
  - Нужно от заказчика: Telegram ID двух админов (экран «Доступ по приглашению» показывает ID), секрет `TELEGRAM_BOT_TOKEN` в функциях
  - Затем: `insert into admins (telegram_id, name) values (...)`, проверка входа по ссылке, слить ветку в `main`
- Следующий после приёмки: этап 4 (онбординг и замеры)

## Принятые решения
- Хостинг GitHub Pages (репозиторий публичный, секретов в коде нет)
- Фон `assets/bg-texture.jpg` уже затемнён заказчиком, поэтому стоит в полную силу вместо 6–10% из ТЗ. Яркость обсудить при правках
- Логотип `assets/logo.webp` (белый фон) показан в скруглённой рамке с лаймовой обводкой; предложено поставить его аватаркой бота
- Вход: `tg-auth` проверяет initData и выдаёт обычную сессию Supabase через admin generateLink + verifyOtp. auth.uid() = profiles.id, Telegram ID лежит в app_metadata токена, `is_admin()` сверяет его с таблицей `admins`
- Аккаунт ученика в Supabase создаётся при приглашении с техническим адресом `bmx-<uuid>@example.com` (писем не шлём). Если Supabase не примет домен, поменять секрет функций `ACCOUNT_EMAIL_DOMAIN`
- Приглашение одноразовое: при входе код гасится. «Новая ссылка» отвязывает прошлый Telegram. Админ по чужой ссылке не привязывается
- Опыт, ачивки, награды челленджа ученик только читает, начислять будет сервер (этап 5)
- Ступени ачивок дают 10/20/40/80 опыта: в ТЗ числа не заданы, правятся в админке
- Защита от простоя: `.github/workflows/keepalive.yml` дважды в неделю вызывает `rpc/ping` (заработает после слияния в main)
