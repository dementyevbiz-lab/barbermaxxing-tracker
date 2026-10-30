-- Стартовые данные из ТЗ. Всё правится в админке, повторный запуск ничего не перезаписывает

insert into tariffs (code, name, weeks, checkpoint_weeks, calls_included, strategy_sessions, city_strategy_sessions, support, features) values
  ('basic',     'Базовичок',            8, '{0,2,4,6,8}', 0, 0, 0, false, '{"challenges": false, "calls": false, "support": false}'),
  ('barbermax', 'Барбермаксер',         7, '{0,2,4,7}',   1, 0, 0, false, '{"challenges": true, "calls": true, "support": false}'),
  ('personal',  'Личное сопровождение', 8, '{0,2,4,6,8}', 0, 2, 1, true,  '{"challenges": true, "calls": true, "support": true}')
on conflict (code) do nothing;

insert into metrics (key, name, unit, better, ord) values
  ('avg_check',      'Средний чек',                          '₽',          'up',   1),
  ('booking_fill',   'Заполненность записи',                 '%',          'up',   2),
  ('work_days',      'Рабочих дней в неделю',                'дней',       'down', 3),
  ('clients_social', 'Клиентов из соцсетей за месяц',        'чел',        'up',   4),
  ('followers',      'Подписчиков',                          'шт',         'up',   5),
  ('top_views_avg',  'Просмотры трёх лучших видео, среднее', 'просмотров', 'up',   6)
on conflict (key) do nothing;

insert into settings (key, value) values
  -- 9.2 Опыт
  ('xp', '{
    "lesson_per_minutes": 3, "lesson_max": 30, "lesson_default": 10,
    "homework": 30, "notes": 10,
    "video": 15, "video_daily_max": 3,
    "checkpoint": 40, "screenshots_bonus": 10, "screenshots_min": 3,
    "insight": 5, "insight_daily_max": 3,
    "challenge_completion_default": 300
  }'),
  -- Уровень L при опыте не меньше step · (L − 1) · L
  ('level_step', '50'),
  -- 9.3 Звания
  ('ranks', '[
    {"level": 1, "name": "Новичок"}, {"level": 3, "name": "Подмастерье"}, {"level": 5, "name": "Барбер"},
    {"level": 7, "name": "Опытный барбер"}, {"level": 9, "name": "Профи"}, {"level": 12, "name": "Мастер"},
    {"level": 15, "name": "Мастер кресла"}, {"level": 18, "name": "Эксперт"}, {"level": 22, "name": "Бренд"},
    {"level": 26, "name": "Лидер мнений"}, {"level": 31, "name": "Топ-мастер"}, {"level": 40, "name": "Легенда"},
    {"level": 50, "name": "Барбермаксер"}
  ]'),
  -- 9.11 Ступени ачивок
  ('tier_names', '["Бронза", "Серебро", "Золото", "Платина"]'),
  -- 9.6 Перспектива
  ('perspective', '{"k": 0.6, "weights": {"lesson": 1, "homework": 2, "video": 1, "notes": 0.5}, "videos_per_week": 2}'),
  -- 9.4 Неделя без обязательных пунктов считается полной при стольких видео
  ('week_full_videos', '2'),
  -- 8.4 Форма замера открывается за столько дней до срока
  ('checkpoint_open_days', '2'),
  -- 13.1 Триггеры
  ('triggers_cfg', '{"per_day": 1, "silence_after_show_days": 7, "silence_after_dismiss_days": 14}'),
  -- 12.3 Пороги сводки
  ('admin_rules', '{"item_low_share": 0.5, "inactive_days": 5, "lagging_share": 0.5}'),
  -- 7 Ссылка на чат сопровождения для Лички, даёт админ
  ('support_chat_url', '""'),
  -- 8.3 Скриншоты
  ('screenshots_cfg', '{"max_per_checkpoint": 8, "max_side_px": 1600, "target_kb": 350}')
on conflict (key) do nothing;

-- 9.11 Ачивки. threshold = null значит «все»
insert into achievements (code, name, counter, tiers) values
  ('first_video',      'Видео',             'videos',            '[{"tier":1,"threshold":1,"xp":10},{"tier":2,"threshold":5,"xp":20},{"tier":3,"threshold":15,"xp":40},{"tier":4,"threshold":30,"xp":80}]'),
  ('three_directions', 'Три направления',   'videos_each_dir',   '[{"tier":1,"threshold":1,"xp":10},{"tier":2,"threshold":3,"xp":20},{"tier":3,"threshold":6,"xp":40},{"tier":4,"threshold":10,"xp":80}]'),
  ('lessons',          'Уроки',             'lessons',           '[{"tier":1,"threshold":3,"xp":10},{"tier":2,"threshold":8,"xp":20},{"tier":3,"threshold":15,"xp":40},{"tier":4,"threshold":25,"xp":80}]'),
  ('homework',         'Домашки',           'homework',          '[{"tier":1,"threshold":1,"xp":10},{"tier":2,"threshold":3,"xp":20},{"tier":3,"threshold":6,"xp":40},{"tier":4,"threshold":10,"xp":80}]'),
  ('notes',            'Конспекты',         'notes',             '[{"tier":1,"threshold":1,"xp":10},{"tier":2,"threshold":5,"xp":20},{"tier":3,"threshold":12,"xp":40},{"tier":4,"threshold":25,"xp":80}]'),
  ('checkpoints',      'Замеры в срок',     'checkpoints_ontime','[{"tier":1,"threshold":1,"xp":10},{"tier":2,"threshold":2,"xp":20},{"tier":3,"threshold":3,"xp":40},{"tier":4,"threshold":null,"xp":80}]'),
  ('insights',         'Выводы',            'insights',          '[{"tier":1,"threshold":1,"xp":10},{"tier":2,"threshold":5,"xp":20},{"tier":3,"threshold":12,"xp":40},{"tier":4,"threshold":25,"xp":80}]'),
  ('questions',        'Вопросы',           'questions_asked',   '[{"tier":1,"threshold":1,"xp":10},{"tier":2,"threshold":3,"xp":20},{"tier":3,"threshold":6,"xp":40},{"tier":4,"threshold":10,"xp":80}]'),
  ('quick_booking',    'Быстрая запись',    'challenge:quick_booking', '[{"tier":1,"threshold":1,"xp":10},{"tier":2,"threshold":3,"xp":20},{"tier":3,"threshold":6,"xp":40},{"tier":4,"threshold":null,"xp":80}]')
on conflict (code) do nothing;

-- 9.9 Челлендж выключен, пока нет задач
insert into challenges (code, title, start_week, reward_text, completion_xp, active) values
  ('quick_booking', 'Быстрая запись', 5, 'Дополнительный личный созвон', 300, false)
on conflict (code) do nothing;

-- 13.2 Триггеры вопросов. Тексты черновые, утверждает заказчик
insert into triggers (code, title, question_text, params) values
  ('no_actions_3d',        'Ничего не отмечено 3 дня',            'Что мешает сделать хотя бы один маленький шаг на этой неделе?', '{"days": 3}'),
  ('homework_overdue',     'Домашка не отмечена после недели',    'Что остановило с домашкой: непонятно задание, не хватило времени или не видно смысла?', '{}'),
  ('lessons_skipped',      'Два урока подряд не отмечены',        'Что в этих уроках оказалось сложным или неинтересным?', '{"count": 2}'),
  ('stuck_lesson',         'Урок открыт и не отмечен 5 дней',     'На каком месте урока остановился и что осталось непонятным?', '{"days": 5}'),
  ('no_checkpoint',        'Срок замера прошёл',                  'Какие цифры вызывают сомнение и поэтому замер откладывается?', '{}'),
  ('metric_flat',          'Метрика не изменилась за 2 замера',   'Какие действия за период должны были повлиять на эту цифру и какие из них не делались?', '{"checkpoints": 2}'),
  ('metric_dropped',       'Метрика упала',                       'Что изменилось за период в записи, ценах или графике?', '{}'),
  ('video_zero_direction', 'Нет видео по направлению 2 недели',   'Что мешает снять видео этого направления?', '{"days": 14}'),
  ('video_views_low',      'Просмотры не растут после 5 видео',   'Что менялось между роликами и что кажется слабым местом?', '{"videos": 5}'),
  ('notes_none',           'Нет конспекта после созвона 2 дня',   'Что важного из созвона хочется не потерять?', '{"days": 2}'),
  ('insights_none',        'Выводов нет 10 дней',                 'Что изменилось в понимании своей ситуации с прошлой записи?', '{"days": 10}'),
  ('perspective_gap',      'Перспектива обгоняет результат',      'Что из пройденного уже можно применить к клиентам на этой неделе?', '{"gap": 0.3}'),
  ('ahead_plan',           'Сделано больше плана недели',         'Какой вопрос по следующей теме хочется задать заранее?', '{}'),
  ('price_flat',           'Средний чек не менялся 4 недели',     'Что мешает поднять цену прямо сейчас?', '{"weeks": 4}'),
  ('booking_low',          'Заполненность ниже 50% два замера',   'Откуда сейчас приходят новые клиенты и что можно усилить?', '{"threshold": 50, "checkpoints": 2}')
on conflict (code) do nothing;
