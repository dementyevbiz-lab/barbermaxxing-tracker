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

## Ход работы
- Этап 1 (подготовка): готово. Mini App открывается в Telegram и пишет «Привет, имя». Проверено заказчиком на одном устройстве
- Этап 2 (экран «Сегодня» на демо-данных): показан, заказчик сказал «да», правки визуала отложены на потом
- Следующий: этап 3 (схема, RLS, функция входа, приглашения, админы, демо-ученики)

## Принятые решения
- Хостинг GitHub Pages (репозиторий публичный, секретов в коде нет)
- Фон `assets/bg-texture.jpg` уже затемнён заказчиком, поэтому стоит в полную силу вместо 6–10% из ТЗ. Яркость обсудить при правках
- Логотип `assets/logo.webp` (белый фон) показан в скруглённой рамке с лаймовой обводкой; предложено поставить его аватаркой бота
- Вход: функция проверяет initData и выдаёт обычную сессию Supabase (например через admin generateLink + verifyOtp), чтобы auth.uid() = profiles.id и работал RLS. Окончательно решить на этапе 3
