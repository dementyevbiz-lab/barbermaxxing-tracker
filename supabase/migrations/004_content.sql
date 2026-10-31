-- Черновики подсказок «?» к метрикам и инструкция по скриншотам. Утверждает заказчик, правятся в админке

update metrics set hint = 'Сумма всех чеков за месяц, делённая на число клиентов. Если считать долго, возьми обычный чек за последнюю неделю' where key = 'avg_check' and hint is null;
update metrics set hint = 'Сколько процентов рабочих часов занято записью. Посмотри на ближайшие 7 дней в записи' where key = 'booking_fill' and hint is null;
update metrics set hint = 'Сколько дней в неделю ты стоишь в кресле. Считай обычную неделю' where key = 'work_days' and hint is null;
update metrics set hint = 'Сколько новых клиентов за месяц пришли из Instagram, TikTok или Reels. Спроси у клиента, откуда он о тебе узнал' where key = 'clients_social' and hint is null;
update metrics set hint = 'Подписчики в главном аккаунте, где ты ведёшь барбер-контент' where key = 'followers' and hint is null;
update metrics set hint = 'Возьми три лучших видео за последние 30 дней, сложи их просмотры и раздели на три' where key = 'top_views_avg' and hint is null;

insert into settings (key, value) values
  ('screenshot_help', '"Сделай скриншоты экрана: три лучших видео со статистикой, главную страницу Instagram, главную страницу TikTok (если ведёшь) и всё, что хочешь показать ещё. Чем яснее видно цифры, тем лучше"'),
  ('consent_text', '"Мы храним твоё имя, цели, цифры замеров и скриншоты. Видишь их ты и команда программы. Выводы и вопросы видишь только ты. Удалить всё можно по запросу команды программы"'),
  ('bot_notifications', '{"checkpoint_days_before": 2, "retry_after_days": 2, "call_hours": [24, 1]}')
on conflict (key) do nothing;
