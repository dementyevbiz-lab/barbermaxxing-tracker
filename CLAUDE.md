# Трекер Barbermaxxing

Полное ТЗ: `docs/TZ.md`. Прочитать целиком перед работой, включая промпт в начале и Приложение А.
Заказчик не программист: объяснять просто, на «вы», вести по шагам. Секреты (токены, пароли, service_role) в чат не просить.

## Где что
- Хостинг: GitHub Pages из ветки `main`, корень. Адрес: https://dementyevbiz-lab.github.io/barbermaxxing-tracker/
- Бот: @barbermaxxing_tracker_bot. Main Mini App и Menu Button «Открыть» указывают на адрес выше
- Supabase: проект `barbermaxxing`, регион Frankfurt, https://nltremspmuuasksxbqtk.supabase.co. Открытые ключи в `config.js`
- Доступ к Supabase Management API: токен хранится как сетевой секрет окружения (Bearer, хост `api.supabase.com`), прокси сам подставляет заголовок Authorization. Токен в коде и в чате не нужен: просто вызывать `curl https://api.supabase.com/v1/projects/nltremspmuuasksxbqtk/...` (SQL через `/database/query`, функции через `/functions/deploy`, секреты функций через `/secrets`). Project ref: `nltremspmuuasksxbqtk`
- Токен бота заказчик вставит сам в секреты функций Supabase (Edge Functions → Secrets, имя `TELEGRAM_BOT_TOKEN`), в чат его не просить
- `index.html` — приложение, `prototype/today.html` — демо экрана «Сегодня» (одобрен), `assets/` — фон и логотип от заказчика
- `supabase/migrations/` — схема и RLS, `supabase/functions/auth` — вход, `supabase/functions/admin` — действия админа, `supabase/tests/rls_check.sql` — проверка прав (данные откатываются), `supabase/deploy.sh` — выкладка через Management API
- Локальная проверка схемы: PostgreSQL 16 в контейнере + `supabase/tests/local_stub.sql` (заглушки auth/storage), затем миграция и `rls_check.sql`

## Ход работы
- Этап 1 (подготовка): готово. Mini App открывается в Telegram и пишет «Привет, имя». Проверено заказчиком на одном устройстве
- Этап 2 (экран «Сегодня» на демо-данных): показан, заказчик сказал «да», правки визуала отложены на потом
- Этап 3 (вход и данные): код написан, локально все 35 проверок прав прошли. В Supabase ещё НЕ применено: в сессии 30.10 прокси не подставлял токен Management API (401 «No access token provided»). Осталось: применить миграцию, выложить функции auth и admin, прогнать `deploy.sh check`, заказчик кладёт `TELEGRAM_BOT_TOKEN` в секреты функций, открывает приложение, находим его Telegram ID в `login_log` и добавляем в `admins` (второй админ, Саня, так же)
- Следующий после приёмки: этап 4

## Принятые решения
- Хостинг GitHub Pages (репозиторий публичный, секретов в коде нет)
- Фон `assets/bg-texture.jpg` уже затемнён заказчиком, поэтому стоит в полную силу вместо 6–10% из ТЗ. Яркость обсудить при правках
- Логотип `assets/logo.webp` (белый фон) показан в скруглённой рамке с лаймовой обводкой; предложено поставить его аватаркой бота
- Вход: функция `auth` проверяет initData и выдаёт обычную сессию Supabase через admin generateLink + verifyOtp, auth.uid() = profiles.id. Telegram ID кладётся в app_metadata (менять может только сервер), `is_admin()` читает его из токена
- Пользователь auth создаётся при добавлении ученика (почта-заглушка `student-<uuid>@users.barbermaxxing.invalid`), Telegram привязывается при первом входе по коду, код стирается. Админ без профиля ученика получает отдельного пользователя `admin-<tgid>@...`
- Админ может войти по ссылке демо-ученика своим Telegram и видеть приложение глазами ученика, админка при этом остаётся
- Перевыпуск ссылки отвязывает текущий Telegram. Статус `disabled` закрывает доступ (добавлен к статусам из ТЗ)
- `login_log`: журнал входов, по нему ограничение перебора (10 неудач в час) и поиск Telegram ID новых админов
- Опыт за ступени ачивок 10/20/40/80 (в ТЗ не задан), правится в админке
- Опыт и ачивки пишет только сервер (этап 5), ученик их только читает
