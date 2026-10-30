-- Этап 3. Схема, права (RLS), стартовые данные
-- Разделы ТЗ: 6 (модель данных), 6.4 (права), 7 (тарифы), 8.2 (метрики), 9 (механика), 13.2 (триггеры)

create extension if not exists pgcrypto;

-- ============ 6.1 Пользователи, тарифы, цели ============

create table public.tariffs (
  id serial primary key,
  code text unique not null,                 -- basic | barbermax | personal
  name text not null,
  weeks int not null,
  checkpoint_weeks int[] not null,           -- недели замеров, 0 = точка А, последняя = итог
  calls_included int not null default 0,
  strategy_sessions int not null default 0,
  city_strategy_sessions int not null default 0,
  support boolean not null default false,
  features jsonb not null default '{}'       -- какие блоки интерфейса включены
);

create table public.admins (
  telegram_id bigint primary key,
  note text                                  -- кто это, для себя
);

create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  telegram_id bigint unique,                 -- заполняется при первом входе
  tg_username text,
  display_name text not null,
  tariff_id int references public.tariffs(id),
  start_date date,
  invite_code text unique,                   -- одноразовый: после входа стирается
  status text not null default 'invited'
    check (status in ('invited','active','finished','paused','disabled')),  -- disabled = доступ закрыт
  ui_overrides jsonb not null default '{}',
  prefs jsonb not null default '{}',         -- настройки ученика: валюта, уведомления
  demo boolean not null default false,
  last_seen_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.metrics (
  key text primary key,
  name text not null,
  unit text not null,
  better text not null default 'up' check (better in ('up','down')),
  hint text,
  active boolean not null default true,
  ord int not null default 0
);

create table public.goals (
  user_id uuid references public.profiles(id) on delete cascade,
  metric_key text references public.metrics(key),
  a_value numeric,
  b_value numeric,
  primary key (user_id, metric_key)
);

create table public.goal_text (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  why_text text,
  updated_at timestamptz default now()
);

-- ============ 6.2 Замеры, скриншоты, программа, действия, выводы ============

create table public.checkpoints (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  idx int not null,
  kind text not null check (kind in ('baseline','biweekly','final')),
  due_date date not null,
  submitted_at timestamptz,
  note text,
  unique (user_id, idx)
);

create table public.checkpoint_values (
  checkpoint_id uuid references public.checkpoints(id) on delete cascade,
  metric_key text references public.metrics(key),
  value numeric,
  unit text,                                 -- например валюта среднего чека: ₽ или ₸
  history jsonb not null default '[]',
  primary key (checkpoint_id, metric_key)
);

create table public.screenshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  checkpoint_id uuid references public.checkpoints(id) on delete cascade,
  kind text not null,
  storage_path text not null,
  size_bytes int,
  deleted_at timestamptz,
  created_at timestamptz default now()
);

create table public.program_items (
  id uuid primary key default gen_random_uuid(),
  week int not null,
  ord int not null default 0,
  kind text not null check (kind in ('lesson','live','homework','short_task','challenge_task')),
  title text not null,
  description text,
  est_minutes int,
  xp int not null default 10,
  required boolean not null default true,
  has_notes boolean not null default false,
  tags text[] not null default '{}',
  tariffs text[] not null default '{barbermax,personal}',
  user_id uuid references public.profiles(id) on delete cascade,
  active boolean not null default true,
  deleted_at timestamptz,
  updated_at timestamptz default now()
);

create table public.completions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  item_id uuid references public.program_items(id),
  kind text not null default 'done' check (kind in ('done','notes')),
  completed_at timestamptz not null default now(),
  undone_at timestamptz
);
create unique index completions_live_uniq on public.completions (user_id, item_id, kind) where undone_at is null;

create table public.video_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  logged_on date not null default current_date,
  kind text not null check (kind in ('client','expert','life')),
  views int,
  note text,
  undone_at timestamptz
);

create table public.insights (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  entry_date date not null default current_date,
  source text not null default 'other' check (source in ('call','live','lesson','other')),
  title text,
  body text not null,
  deleted_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table public.questions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  status text not null default 'open' check (status in ('open','asked','dropped')),
  origin text not null default 'manual' check (origin in ('manual','trigger')),
  trigger_code text,
  deleted_at timestamptz,
  created_at timestamptz default now()
);

create table public.calls (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('call','strategy','city_strategy','bonus')),
  scheduled_at timestamptz,
  note text
);

-- ============ 6.3 Опыт, ачивки, челленджи, контент ============

create table public.xp_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  ref_id uuid,
  xp int not null,
  created_at timestamptz default now(),
  undone_at timestamptz
);

create table public.settings (
  key text primary key,
  value jsonb not null
);

create table public.achievements (
  code text primary key,
  name text not null,
  description text,
  counter text not null,
  tiers jsonb not null,
  secret boolean not null default false
);

create table public.user_achievements (
  user_id uuid references public.profiles(id) on delete cascade,
  code text references public.achievements(code) on delete cascade,
  tier int not null,
  earned_at timestamptz default now(),
  revoked_at timestamptz,
  primary key (user_id, code, tier)
);

create table public.challenges (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  title text not null,
  start_week int not null,
  end_week int,
  reward_text text,
  completion_xp int not null default 0,
  active boolean not null default false
);

create table public.challenge_results (
  user_id uuid references public.profiles(id) on delete cascade,
  challenge_id uuid references public.challenges(id) on delete cascade,
  completed_at timestamptz,
  reward_status text not null default 'none' check (reward_status in ('none','earned','given')),
  primary key (user_id, challenge_id)
);

create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  text text not null,
  author text not null,
  source text,
  verified boolean not null default false,
  tags text[] not null default '{}'
);

create table public.quote_shown (
  user_id uuid references public.profiles(id) on delete cascade,
  quote_id uuid references public.quotes(id) on delete cascade,
  shown_on date not null,
  primary key (user_id, quote_id)
);

create table public.movies (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  year int,
  why text not null,
  tags text[] not null default '{}',
  verified boolean not null default false
);

create table public.triggers (
  code text primary key,
  title text not null,
  question_text text not null,
  params jsonb not null default '{}',
  active boolean not null default true
);

create table public.trigger_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  trigger_code text references public.triggers(code) on delete cascade,
  shown_at timestamptz,
  dismissed_at timestamptz
);

create table public.admin_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  pinned boolean not null default false,
  created_at timestamptz default now()
);

create table public.audit_log (
  id bigserial primary key,
  actor_telegram_id bigint,
  action text not null,
  entity text not null,
  entity_id text,
  before jsonb,
  after jsonb,
  created_at timestamptz default now()
);

-- Журнал входов: кто пытался открыть приложение. Нужен, чтобы найти Telegram ID админов
-- и ограничить перебор кодов приглашений (раздел 18)
create table public.login_log (
  id bigserial primary key,
  telegram_id bigint not null,
  tg_username text,
  first_name text,
  ok boolean not null,
  reason text,                               -- ok | no_invite | bad_code | disabled | rate_limited
  created_at timestamptz not null default now()
);
create index login_log_tg_time on public.login_log (telegram_id, created_at desc);

-- Индексы под частые выборки
create index on public.checkpoints (user_id);
create index on public.screenshots (user_id);
create index on public.program_items (week, ord);
create index on public.completions (user_id);
create index on public.video_logs (user_id, logged_on);
create index on public.insights (user_id, entry_date);
create index on public.questions (user_id);
create index on public.calls (user_id);
create index on public.xp_ledger (user_id);
create index on public.trigger_log (user_id, trigger_code);
create index on public.admin_notes (user_id);

-- ============ Служебные функции ============

-- Telegram ID из токена. Кладёт его туда только функция входа (app_metadata меняет только сервер)
create or replace function public.jwt_telegram_id() returns bigint
language sql stable set search_path = public as $$
  select nullif(coalesce(auth.jwt() -> 'app_metadata' ->> 'telegram_id', ''), '')::bigint
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where telegram_id = public.jwt_telegram_id())
$$;

create or replace function public.my_tariff_code() returns text
language sql stable security definer set search_path = public as $$
  select t.code from public.profiles p join public.tariffs t on t.id = p.tariff_id where p.id = auth.uid()
$$;

create or replace function public.my_tariff_id() returns int
language sql stable security definer set search_path = public as $$
  select tariff_id from public.profiles where id = auth.uid()
$$;

-- Пересобрать сроки замеров по тарифу и дате старта (раздел 8.1).
-- Отправленные замеры не трогаем. Срок = последний день недели замера, точка А = дата старта
create or replace function public.rebuild_checkpoints(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  p public.profiles;
  t public.tariffs;
  w int;
  i int := 0;
  n int;
begin
  select * into p from public.profiles where id = p_user;
  if p.id is null or p.tariff_id is null or p.start_date is null then return; end if;
  select * into t from public.tariffs where id = p.tariff_id;
  n := coalesce(array_length(t.checkpoint_weeks, 1), 0);
  foreach w in array t.checkpoint_weeks loop
    insert into public.checkpoints (user_id, idx, kind, due_date)
    values (p_user, i,
            case when i = 0 then 'baseline' when i = n - 1 then 'final' else 'biweekly' end,
            case when w = 0 then p.start_date else p.start_date + (w * 7 - 1) end)
    on conflict (user_id, idx) do update
      set kind = excluded.kind, due_date = excluded.due_date
      where public.checkpoints.submitted_at is null;
    i := i + 1;
  end loop;
  delete from public.checkpoints where user_id = p_user and idx >= n and submitted_at is null;
end $$;

create or replace function public.profiles_rebuild_trg() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT'
     or new.tariff_id is distinct from old.tariff_id
     or new.start_date is distinct from old.start_date then
    perform public.rebuild_checkpoints(new.id);
  end if;
  return new;
end $$;

create trigger profiles_rebuild after insert or update of tariff_id, start_date on public.profiles
  for each row execute function public.profiles_rebuild_trg();

-- История правок программы и настроек (раздел 12.4)
create or replace function public.audit_trg() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  rec jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
begin
  insert into public.audit_log (actor_telegram_id, action, entity, entity_id, before, after)
  values (public.jwt_telegram_id(), lower(tg_op), tg_table_name,
          coalesce(rec ->> 'id', rec ->> 'code', rec ->> 'key'),
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['tariffs','metrics','program_items','settings','achievements','challenges',
                           'quotes','movies','triggers','admins'] loop
    execute format('create trigger %I_audit after insert or update or delete on public.%I
                    for each row execute function public.audit_trg()', t, t);
  end loop;
end $$;

-- Служебные функции не вызываются напрямую из приложения
revoke execute on function public.rebuild_checkpoints(uuid) from public, anon, authenticated;
revoke execute on function public.profiles_rebuild_trg() from public, anon, authenticated;
revoke execute on function public.audit_trg() from public, anon, authenticated;

-- ============ 6.4 Права (RLS) ============

-- Гостю без входа нельзя ничего
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;

do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Каталоги: ученик читает своё, админ всё
create policy tariffs_read on public.tariffs for select to authenticated
  using (public.is_admin() or id = public.my_tariff_id());
create policy tariffs_admin on public.tariffs for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy metrics_read on public.metrics for select to authenticated
  using (active or public.is_admin());
create policy metrics_admin on public.metrics for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy program_read on public.program_items for select to authenticated
  using (
    public.is_admin()
    or (active and deleted_at is null and (
          (user_id is null and public.my_tariff_code() = any (tariffs))
          or user_id = auth.uid()))
  );
create policy program_admin on public.program_items for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy achievements_read on public.achievements for select to authenticated
  using (public.is_admin() or not secret
         or exists (select 1 from public.user_achievements ua
                    where ua.code = achievements.code and ua.user_id = auth.uid() and ua.revoked_at is null));
create policy achievements_admin on public.achievements for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy challenges_read on public.challenges for select to authenticated using (true);
create policy challenges_admin on public.challenges for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy quotes_read on public.quotes for select to authenticated using (verified or public.is_admin());
create policy quotes_admin on public.quotes for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy movies_read on public.movies for select to authenticated using (verified or public.is_admin());
create policy movies_admin on public.movies for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy triggers_read on public.triggers for select to authenticated using (active or public.is_admin());
create policy triggers_admin on public.triggers for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy settings_read on public.settings for select to authenticated using (true);
create policy settings_admin on public.settings for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Служебное: только админ читает. Пишет только сервер
create policy admins_read on public.admins for select to authenticated using (public.is_admin());
create policy audit_read on public.audit_log for select to authenticated using (public.is_admin());
create policy login_log_read on public.login_log for select to authenticated using (public.is_admin());

-- Профиль: ученик читает себя, админ читает и правит всех
create policy profiles_self on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());
create policy profiles_admin_upd on public.profiles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Данные ученика: свои строки читает и пишет, физически не удаляет. Админ читает
create policy goals_sel on public.goals for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy goals_ins on public.goals for insert to authenticated with check (user_id = auth.uid());
create policy goals_upd on public.goals for update to authenticated
  using (user_id = auth.uid() or public.is_admin()) with check (user_id = auth.uid() or public.is_admin());

create policy goal_text_sel on public.goal_text for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy goal_text_ins on public.goal_text for insert to authenticated with check (user_id = auth.uid());
create policy goal_text_upd on public.goal_text for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Замеры создаёт сервер. Ученик заполняет свои, админ двигает сроки
create policy checkpoints_sel on public.checkpoints for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy checkpoints_upd on public.checkpoints for update to authenticated
  using (user_id = auth.uid() or public.is_admin()) with check (user_id = auth.uid() or public.is_admin());

create policy cpv_sel on public.checkpoint_values for select to authenticated
  using (public.is_admin() or exists (select 1 from public.checkpoints c where c.id = checkpoint_id and c.user_id = auth.uid()));
create policy cpv_ins on public.checkpoint_values for insert to authenticated
  with check (exists (select 1 from public.checkpoints c where c.id = checkpoint_id and c.user_id = auth.uid()));
create policy cpv_upd on public.checkpoint_values for update to authenticated
  using (exists (select 1 from public.checkpoints c where c.id = checkpoint_id and c.user_id = auth.uid()))
  with check (exists (select 1 from public.checkpoints c where c.id = checkpoint_id and c.user_id = auth.uid()));

do $$
declare t text;
begin
  -- ученик пишет свои строки, админ только читает
  foreach t in array array['screenshots','completions','video_logs','trigger_log','quote_shown'] loop
    execute format('create policy %1$s_sel on public.%1$I for select to authenticated using (user_id = auth.uid() or public.is_admin())', t);
    execute format('create policy %1$s_ins on public.%1$I for insert to authenticated with check (user_id = auth.uid())', t);
    execute format('create policy %1$s_upd on public.%1$I for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
  end loop;
  -- выводы и вопросы видит только сам ученик
  foreach t in array array['insights','questions'] loop
    execute format('create policy %1$s_sel on public.%1$I for select to authenticated using (user_id = auth.uid())', t);
    execute format('create policy %1$s_ins on public.%1$I for insert to authenticated with check (user_id = auth.uid())', t);
    execute format('create policy %1$s_upd on public.%1$I for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
  end loop;
  -- ученик только читает, пишет админ
  foreach t in array array['calls','challenge_results'] loop
    execute format('create policy %1$s_sel on public.%1$I for select to authenticated using (user_id = auth.uid() or public.is_admin())', t);
    execute format('create policy %1$s_admin on public.%1$I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t);
  end loop;
  -- ученик только читает, пишет сервер (опыт и ачивки считаются на сервере на этапе 5)
  foreach t in array array['xp_ledger','user_achievements'] loop
    execute format('create policy %1$s_sel on public.%1$I for select to authenticated using (user_id = auth.uid() or public.is_admin())', t);
  end loop;
end $$;

create policy admin_notes_admin on public.admin_notes for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ============ Хранилище скриншотов ============
-- Приватный бакет, путь user_id/checkpoint_id/<файл>. Ученик работает со своей папкой, админ читает все

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('screenshots', 'screenshots', false, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

create policy shots_sel on storage.objects for select to authenticated
  using (bucket_id = 'screenshots' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));
create policy shots_ins on storage.objects for insert to authenticated
  with check (bucket_id = 'screenshots' and (storage.foldername(name))[1] = auth.uid()::text);
create policy shots_upd on storage.objects for update to authenticated
  using (bucket_id = 'screenshots' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'screenshots' and (storage.foldername(name))[1] = auth.uid()::text);

-- ============ Стартовые данные ============

insert into public.tariffs (code, name, weeks, checkpoint_weeks, calls_included, strategy_sessions, city_strategy_sessions, support, features) values
  ('basic',     'Базовичок',            8, '{0,2,4,6,8}', 0, 0, 0, false, '{"calls":false,"support":false,"challenges":false}'),
  ('barbermax', 'Барбермаксер',         7, '{0,2,4,7}',   1, 0, 0, false, '{"calls":true,"support":false,"challenges":true}'),
  ('personal',  'Личное сопровождение', 8, '{0,2,4,6,8}', 0, 2, 1, true,  '{"calls":true,"support":true,"challenges":true}');

-- Подсказки «?» пустые: черновики на этапе 4, утверждает заказчик
insert into public.metrics (key, name, unit, better, ord) values
  ('avg_check',      'Средний чек',                          '₽',          'up',   1),
  ('booking_fill',   'Заполненность записи',                 '%',          'up',   2),
  ('work_days',      'Рабочих дней в неделю',                'дней',       'down', 3),
  ('clients_social', 'Клиентов из соцсетей за месяц',        'чел',        'up',   4),
  ('followers',      'Подписчиков',                          'шт',         'up',   5),
  ('top_views_avg',  'Просмотры трёх лучших видео, среднее', 'просмотров', 'up',   6);

insert into public.settings (key, value) values
  ('xp', '{"lesson_per_minutes":3,"lesson_max":30,"lesson_default":10,"homework":30,"notes":10,
           "video":15,"video_daily_cap":3,"checkpoint":40,"screenshots_bonus":10,"screenshots_min":3,
           "insight":5,"insight_daily_cap":3}'),
  ('level_base', '50'),
  ('ranks', '[{"level":1,"name":"Новичок"},{"level":3,"name":"Подмастерье"},{"level":5,"name":"Барбер"},
              {"level":7,"name":"Опытный барбер"},{"level":9,"name":"Профи"},{"level":12,"name":"Мастер"},
              {"level":15,"name":"Мастер кресла"},{"level":18,"name":"Эксперт"},{"level":22,"name":"Бренд"},
              {"level":26,"name":"Лидер мнений"},{"level":31,"name":"Топ-мастер"},{"level":40,"name":"Легенда"},
              {"level":50,"name":"Барбермаксер"}]'),
  ('tier_names', '["Бронза","Серебро","Золото","Платина"]'),
  ('perspective', '{"k":0.6,"w_lesson":1,"w_homework":2,"w_video":1,"w_notes":0.5,"videos_per_week":2}'),
  ('week_full_videos', '2'),
  ('checkpoint_open_days', '2'),
  ('triggers_cooldown', '{"after_show_days":7,"after_dismiss_days":14,"per_day":1}'),
  ('admin_rules', '{"item_low_share":0.5,"inactive_days":5,"metric_flat_checkpoints":2,"video_direction_low_share":0.2}'),
  ('support_chat_url', 'null'),
  ('invite_rate_limit', '{"max_failed_per_hour":10}');

-- Опыт за ступени ачивок: стартовые значения, правятся в админке
insert into public.achievements (code, name, counter, tiers) values
  ('first_video',      'Первое видео',      'videos',
     '[{"tier":1,"threshold":1,"xp":10},{"tier":2,"threshold":5,"xp":20},{"tier":3,"threshold":15,"xp":40},{"tier":4,"threshold":30,"xp":80}]'),
  ('three_directions', 'Три направления',   'videos_all_directions',
     '[{"tier":1,"threshold":1,"xp":10},{"tier":2,"threshold":3,"xp":20},{"tier":3,"threshold":6,"xp":40},{"tier":4,"threshold":10,"xp":80}]'),
  ('lessons',          'Уроки',             'lessons',
     '[{"tier":1,"threshold":3,"xp":10},{"tier":2,"threshold":8,"xp":20},{"tier":3,"threshold":15,"xp":40},{"tier":4,"threshold":25,"xp":80}]'),
  ('homework',         'Домашки',           'homework',
     '[{"tier":1,"threshold":1,"xp":10},{"tier":2,"threshold":3,"xp":20},{"tier":3,"threshold":6,"xp":40},{"tier":4,"threshold":10,"xp":80}]'),
  ('notes',            'Конспекты',         'notes',
     '[{"tier":1,"threshold":1,"xp":10},{"tier":2,"threshold":5,"xp":20},{"tier":3,"threshold":12,"xp":40},{"tier":4,"threshold":25,"xp":80}]'),
  ('checkpoints',      'Замеры вовремя',    'checkpoints_on_time',
     '[{"tier":1,"threshold":1,"xp":10},{"tier":2,"threshold":2,"xp":20},{"tier":3,"threshold":3,"xp":40},{"tier":4,"threshold":"all","xp":80}]'),
  ('insights',         'Выводы',            'insights',
     '[{"tier":1,"threshold":1,"xp":10},{"tier":2,"threshold":5,"xp":20},{"tier":3,"threshold":12,"xp":40},{"tier":4,"threshold":25,"xp":80}]'),
  ('questions',        'Вопросы',           'questions',
     '[{"tier":1,"threshold":1,"xp":10},{"tier":2,"threshold":3,"xp":20},{"tier":3,"threshold":6,"xp":40},{"tier":4,"threshold":10,"xp":80}]'),
  ('quick_booking',    'Быстрая запись',    'challenge_tasks:quick_booking',
     '[{"tier":1,"threshold":1,"xp":10},{"tier":2,"threshold":3,"xp":20},{"tier":3,"threshold":6,"xp":40},{"tier":4,"threshold":"all","xp":80}]');

insert into public.challenges (code, title, start_week, reward_text, completion_xp, active) values
  ('quick_booking', 'Быстрая запись', 5, 'Дополнительный личный созвон', 300, false);

-- Тексты вопросов черновые, утверждает заказчик
insert into public.triggers (code, title, question_text, params) values
  ('no_actions_3d',        'Ничего не отмечено 3 дня',                 'Что мешает сделать хотя бы один маленький шаг на этой неделе?', '{"days":3}'),
  ('homework_overdue',     'Неделя прошла, домашка не отмечена',       'Что остановило с домашкой: непонятно задание, не хватило времени или не видно смысла?', '{}'),
  ('lessons_skipped',      'Два урока подряд не отмечены',             'Что в этих уроках оказалось сложным или неинтересным?', '{"count":2}'),
  ('stuck_lesson',         'Урок открыт и не отмечен 5 дней',          'На каком месте урока остановился и что осталось непонятным?', '{"days":5}'),
  ('no_checkpoint',        'Срок замера прошёл',                       'Какие цифры вызывают сомнение и поэтому замер откладывается?', '{}'),
  ('metric_flat',          'Метрика не изменилась за 2 замера',        'Какие действия за период должны были повлиять на эту цифру и какие из них не делались?', '{"checkpoints":2}'),
  ('metric_dropped',       'Метрика упала',                            'Что изменилось за период в записи, ценах или графике?', '{}'),
  ('video_zero_direction', '0 видео по направлению за 2 недели',       'Что мешает снять видео этого направления?', '{"days":14}'),
  ('video_views_low',      'После 5 видео просмотры лучших не растут', 'Что менялось между роликами и что кажется слабым местом?', '{"videos":5}'),
  ('notes_none',           'После созвона нет конспекта 2 дня',        'Что важного из созвона хочется не потерять?', '{"days":2}'),
  ('insights_none',        'Выводов нет 10 дней',                      'Что изменилось в понимании своей ситуации с прошлой записи?', '{"days":10}'),
  ('perspective_gap',      'Перспектива обгоняет результат',           'Что из пройденного уже можно применить к клиентам на этой неделе?', '{"gap":0.3}'),
  ('ahead_plan',           'Сделано больше плана недели',              'Какой вопрос по следующей теме хочется задать заранее?', '{}'),
  ('price_flat',           'Средний чек не менялся 4 недели',          'Что мешает поднять цену прямо сейчас?', '{"weeks":4}'),
  ('booking_low',          'Заполненность ниже 50% два замера подряд', 'Откуда сейчас приходят новые клиенты и что можно усилить?', '{"threshold":50,"checkpoints":2}');
