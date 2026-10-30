-- Этап 3. Схема трекера Barbermaxxing: таблицы, стартовые данные, права (RLS), хранилище.
-- Применяется один раз к пустой базе. Повторный запуск безопасен для стартовых данных (on conflict do nothing).

create extension if not exists pgcrypto;

-- ============================================================
-- 6.1 Пользователи, тарифы, цели
-- ============================================================

create table if not exists tariffs (
  id serial primary key,
  code text unique not null,            -- basic | barbermax | personal
  name text not null,
  weeks int not null,
  checkpoint_weeks int[] not null,      -- недели замеров после старта, 0 = точка А
  calls_included int not null default 0,
  strategy_sessions int not null default 0,
  city_strategy_sessions int not null default 0,
  support boolean not null default false,
  features jsonb not null default '{}'  -- какие блоки интерфейса включены
);

-- Админы по Telegram ID. user_id появляется при первом входе админа
create table if not exists admins (
  telegram_id bigint primary key,
  name text,
  user_id uuid unique references auth.users on delete set null
);

create table if not exists profiles (
  id uuid primary key references auth.users on delete cascade,
  telegram_id bigint unique,            -- заполняется при первом входе
  tg_username text,
  display_name text not null,
  tariff_id int references tariffs(id),
  start_date date,                      -- от неё считаются недели
  invite_code text unique,
  status text not null default 'invited'
    check (status in ('invited','active','finished','paused','blocked')),
  ui_overrides jsonb not null default '{}', -- персональные настройки от админа
  prefs jsonb not null default '{}',        -- настройки ученика: валюта, уведомления
  onboarding jsonb not null default '{}',   -- прогресс онбординга
  demo boolean not null default false,      -- демо-ученики, удаляются одной командой
  last_seen_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists metrics (
  key text primary key,
  name text not null,
  unit text not null,
  better text not null default 'up' check (better in ('up','down')),
  hint text,
  active boolean not null default true,
  ord int not null default 0
);

create table if not exists goals (
  user_id uuid references profiles(id) on delete cascade,
  metric_key text references metrics(key),
  a_value numeric,
  b_value numeric,
  unit text,                            -- например тенге для среднего чека
  primary key (user_id, metric_key)
);

create table if not exists goal_text (
  user_id uuid primary key references profiles(id) on delete cascade,
  why_text text,
  updated_at timestamptz default now()
);

-- ============================================================
-- 6.2 Замеры, скриншоты, программа, действия, выводы
-- ============================================================

create table if not exists checkpoints (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  idx int not null,
  kind text not null check (kind in ('baseline','biweekly','final')),
  week int not null default 0,
  due_date date not null,
  due_shifted boolean not null default false, -- срок сдвинул админ, расписание его не трогает
  submitted_at timestamptz,
  note text,
  unique (user_id, idx)
);

create table if not exists checkpoint_values (
  checkpoint_id uuid references checkpoints(id) on delete cascade,
  metric_key text references metrics(key),
  value numeric,
  history jsonb not null default '[]',
  primary key (checkpoint_id, metric_key)
);

create table if not exists screenshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  checkpoint_id uuid references checkpoints(id) on delete cascade,
  kind text not null check (kind in ('video_1','video_2','video_3','instagram_profile','tiktok_profile','other')),
  storage_path text not null,
  size_bytes int,
  deleted_at timestamptz,
  created_at timestamptz default now()
);

create table if not exists program_items (
  id uuid primary key default gen_random_uuid(),
  week int not null,
  ord int not null default 0,
  kind text not null check (kind in ('lesson','live','homework','short_task','challenge_task')),
  title text not null,
  description text,
  why text,                             -- короткое задание: зачем
  how text,                             -- короткое задание: как
  result text,                          -- короткое задание: что считать результатом
  est_minutes int,
  xp int not null default 10,
  required boolean not null default true,
  has_notes boolean not null default false,
  tags text[] not null default '{}',
  tariffs text[] not null default '{barbermax,personal}',
  user_id uuid references profiles(id) on delete cascade,
  active boolean not null default true,
  deleted_at timestamptz,
  updated_at timestamptz default now()
);

create table if not exists completions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  item_id uuid references program_items(id),
  kind text not null default 'done' check (kind in ('done','notes')),
  completed_at timestamptz not null default now(),
  undone_at timestamptz
);
create unique index if not exists completions_live_uq on completions (user_id, item_id, kind) where undone_at is null;

create table if not exists video_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  logged_on date not null default current_date,
  kind text not null check (kind in ('client','expert','life')),
  views int,
  note text,
  undone_at timestamptz
);

create table if not exists insights (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  entry_date date not null default current_date,
  source text not null default 'other' check (source in ('call','live','lesson','other')),
  title text,
  body text not null,
  deleted_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists questions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  body text not null,
  status text not null default 'open' check (status in ('open','asked','dropped')),
  origin text not null default 'manual' check (origin in ('manual','trigger')),
  trigger_code text,
  deleted_at timestamptz,
  created_at timestamptz default now()
);

create table if not exists calls (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  kind text not null check (kind in ('call','strategy','city_strategy','bonus')),
  scheduled_at timestamptz,
  note text
);

-- ============================================================
-- 6.3 Опыт, ачивки, челленджи, контент
-- ============================================================

create table if not exists xp_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  kind text not null,
  ref_id uuid,
  xp int not null,
  created_at timestamptz default now(),
  undone_at timestamptz
);

create table if not exists settings (
  key text primary key,
  value jsonb not null
);

create table if not exists achievements (
  code text primary key,
  name text not null,
  description text,
  counter text not null,
  tiers jsonb not null,
  secret boolean not null default false
);

create table if not exists user_achievements (
  user_id uuid references profiles(id) on delete cascade,
  code text references achievements(code) on delete cascade,
  tier int not null,
  earned_at timestamptz default now(),
  revoked_at timestamptz,
  primary key (user_id, code, tier)
);

create table if not exists challenges (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  title text not null,
  start_week int not null,
  end_week int,
  reward_text text,
  completion_xp int not null default 0,
  active boolean not null default false
);

create table if not exists challenge_results (
  user_id uuid references profiles(id) on delete cascade,
  challenge_id uuid references challenges(id) on delete cascade,
  completed_at timestamptz,
  reward_status text not null default 'none' check (reward_status in ('none','earned','given')),
  primary key (user_id, challenge_id)
);

create table if not exists quotes (
  id uuid primary key default gen_random_uuid(),
  text text not null,
  author text not null,
  source text,
  verified boolean not null default false,
  tags text[] not null default '{}'
);

create table if not exists quote_shown (
  user_id uuid references profiles(id) on delete cascade,
  quote_id uuid references quotes(id) on delete cascade,
  shown_on date not null,
  primary key (user_id, quote_id)
);

create table if not exists movies (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  year int,
  why text not null,
  tags text[] not null default '{}',
  verified boolean not null default false
);

create table if not exists triggers (
  code text primary key,
  title text not null,
  question_text text not null,
  params jsonb not null default '{}',
  active boolean not null default true
);

create table if not exists trigger_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  trigger_code text references triggers(code) on delete cascade,
  shown_at timestamptz,
  dismissed_at timestamptz
);

create table if not exists admin_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  body text not null,
  pinned boolean not null default false,
  created_at timestamptz default now()
);

create table if not exists audit_log (
  id bigserial primary key,
  actor_telegram_id bigint,
  action text not null,
  entity text not null,
  entity_id text,
  before jsonb,
  after jsonb,
  created_at timestamptz default now()
);

-- Попытки входа: защита от перебора кодов приглашений. Пишет только функция входа
create table if not exists auth_attempts (
  id bigserial primary key,
  telegram_id bigint,
  ok boolean not null,
  reason text,
  at timestamptz not null default now()
);
create index if not exists auth_attempts_tg_at on auth_attempts (telegram_id, at);

-- Индексы под частые выборки
create index if not exists checkpoints_user on checkpoints (user_id);
create index if not exists screenshots_user on screenshots (user_id);
create index if not exists completions_user on completions (user_id);
create index if not exists video_logs_user on video_logs (user_id, logged_on);
create index if not exists insights_user on insights (user_id, entry_date);
create index if not exists questions_user on questions (user_id);
create index if not exists calls_user on calls (user_id);
create index if not exists xp_ledger_user on xp_ledger (user_id);
create index if not exists program_items_week on program_items (week, ord);
create index if not exists trigger_log_user on trigger_log (user_id, trigger_code);
create index if not exists admin_notes_user on admin_notes (user_id);

-- ============================================================
-- Вспомогательные функции
-- ============================================================

-- Telegram ID текущего пользователя. Берётся из app_metadata токена: его ставит только сервер
create or replace function public.jwt_telegram_id() returns bigint
language sql stable as $$
  select nullif(auth.jwt() -> 'app_metadata' ->> 'telegram_id', '')::bigint
$$;

-- Роль админа определяется только на сервере: Telegram ID из токена есть в таблице admins
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from admins a where a.telegram_id = public.jwt_telegram_id())
$$;

-- Код тарифа текущего ученика
create or replace function public.my_tariff_code() returns text
language sql stable security definer set search_path = public as $$
  select t.code from profiles p join tariffs t on t.id = p.tariff_id where p.id = auth.uid()
$$;

-- Пинг для еженедельного запроса, чтобы бесплатный проект не засыпал
create or replace function public.ping() returns int
language sql stable as $$ select 1 $$;

-- Расписание замеров по тарифу и дате старта.
-- Неделя 0 = точка А (срок в день старта), неделя w = последний день w-й недели.
-- Отправленные замеры и сроки, сдвинутые админом, не трогаются
create or replace function public.sync_checkpoints(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_start date;
  v_weeks int[];
  v_n int;
  i int;
  w int;
  v_kind text;
begin
  select p.start_date, t.checkpoint_weeks into v_start, v_weeks
  from profiles p join tariffs t on t.id = p.tariff_id where p.id = p_user;
  if v_start is null or v_weeks is null then return; end if;
  v_n := coalesce(array_length(v_weeks, 1), 0);
  for i in 1..v_n loop
    w := v_weeks[i];
    v_kind := case when i = 1 then 'baseline' when i = v_n then 'final' else 'biweekly' end;
    insert into checkpoints (user_id, idx, kind, week, due_date)
    values (p_user, i - 1, v_kind, w, case when w = 0 then v_start else v_start + w * 7 - 1 end)
    on conflict (user_id, idx) do update
      set kind = excluded.kind, week = excluded.week,
          due_date = case when checkpoints.due_shifted then checkpoints.due_date else excluded.due_date end
      where checkpoints.submitted_at is null;
  end loop;
  -- Лишние неотправленные замеры после смены тарифа
  delete from checkpoints where user_id = p_user and idx >= v_n and submitted_at is null;
end $$;

create or replace function public.profiles_after_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.tariff_id is distinct from old.tariff_id or new.start_date is distinct from old.start_date then
    perform public.sync_checkpoints(new.id);
  end if;
  return new;
end $$;

drop trigger if exists profiles_sync_checkpoints on profiles;
create trigger profiles_sync_checkpoints after insert or update on profiles
for each row execute function public.profiles_after_change();

-- Ученик меняет в профиле только свои настройки и онбординг
create or replace function public.profiles_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.is_admin() or auth.uid() is null then return new; end if;
  if (to_jsonb(new) - 'prefs' - 'onboarding') is distinct from (to_jsonb(old) - 'prefs' - 'onboarding') then
    raise exception 'Можно менять только свои настройки' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists profiles_guard on profiles;
create trigger profiles_guard before update on profiles
for each row execute function public.profiles_guard();

-- Ученик не меняет сроки и номер замера, только отправку и заметку
create or replace function public.checkpoints_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.is_admin() or auth.uid() is null then return new; end if;
  if (to_jsonb(new) - 'submitted_at' - 'note') is distinct from (to_jsonb(old) - 'submitted_at' - 'note') then
    raise exception 'Срок замера меняет только команда программы' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists checkpoints_guard on checkpoints;
create trigger checkpoints_guard before update on checkpoints
for each row execute function public.checkpoints_guard();

-- Исправление значения замера: прошлое значение уходит в history
create or replace function public.checkpoint_values_history() returns trigger
language plpgsql as $$
begin
  if new.value is distinct from old.value then
    new.history := coalesce(old.history, '[]'::jsonb)
      || jsonb_build_array(jsonb_build_object('value', old.value, 'changed_at', now()));
  end if;
  return new;
end $$;

drop trigger if exists checkpoint_values_history on checkpoint_values;
create trigger checkpoint_values_history before update on checkpoint_values
for each row execute function public.checkpoint_values_history();

-- Точка А после первого отправленного замера меняет только админ
create or replace function public.goals_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.is_admin() or auth.uid() is null then return new; end if;
  if new.a_value is distinct from old.a_value and exists (
    select 1 from checkpoints c where c.user_id = new.user_id and c.idx = 0 and c.submitted_at is not null
  ) then
    raise exception 'Точку А после первого замера меняет команда программы' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists goals_guard on goals;
create trigger goals_guard before update on goals
for each row execute function public.goals_guard();

-- История правок программы и настроек
create or replace function public.audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_id text;
begin
  v_id := coalesce(to_jsonb(new), to_jsonb(old)) ->> (case when tg_table_name in ('settings') then 'key' when tg_table_name in ('achievements','triggers') then 'code' else 'id' end);
  insert into audit_log (actor_telegram_id, action, entity, entity_id, before, after)
  values (public.jwt_telegram_id(), lower(tg_op), tg_table_name, v_id,
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['program_items','settings','tariffs','metrics','achievements','challenges','triggers'] loop
    execute format('drop trigger if exists audit_%1$s on %1$s', t);
    execute format('create trigger audit_%1$s after insert or update or delete on %1$s for each row execute function public.audit_row()', t);
  end loop;
end $$;

-- ============================================================
-- Права (RLS), раздел 6.4
-- ============================================================

do $$
declare t text;
begin
  foreach t in array array[
    'tariffs','admins','profiles','metrics','goals','goal_text','checkpoints','checkpoint_values','screenshots',
    'program_items','completions','video_logs','insights','questions','calls','xp_ledger','settings',
    'achievements','user_achievements','challenges','challenge_results','quotes','quote_shown','movies',
    'triggers','trigger_log','admin_notes','audit_log','auth_attempts'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
  end loop;
end $$;

-- Чтобы скрипт можно было прогнать повторно
do $$
declare r record;
begin
  for r in select policyname, tablename from pg_policies where schemaname = 'public' loop
    execute format('drop policy %I on %I', r.policyname, r.tablename);
  end loop;
end $$;

-- Анонимный доступ закрыт полностью, кроме пинга
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from anon, public;
grant execute on function public.ping() to anon, authenticated;
grant execute on function public.is_admin(), public.jwt_telegram_id(), public.my_tariff_code() to authenticated;

-- Админы: таблицу видят только админы, правят через SQL
create policy admins_read on admins for select to authenticated using (public.is_admin());

-- Профиль: ученик видит и правит свой (guard ограничивает поля), админ всё
create policy profiles_own_read on profiles for select to authenticated using (id = auth.uid());
create policy profiles_own_update on profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_admin_all on profiles for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Свои данные ученика: читать, добавлять, менять, без физического удаления.
-- Админ читает всё (кроме выводов и вопросов)
do $$
declare t text;
begin
  foreach t in array array['goals','goal_text','screenshots','completions','video_logs','quote_shown','trigger_log'] loop
    execute format('create policy %1$s_own_read on %1$I for select to authenticated using (user_id = auth.uid())', t);
    execute format('create policy %1$s_own_insert on %1$I for insert to authenticated with check (user_id = auth.uid())', t);
    execute format('create policy %1$s_own_update on %1$I for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
    execute format('create policy %1$s_admin_read on %1$I for select to authenticated using (public.is_admin())', t);
  end loop;
end $$;

-- Точку А меняет админ
create policy goals_admin_write on goals for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- Выводы и вопросы: только сам ученик, админ их не видит
do $$
declare t text;
begin
  foreach t in array array['insights','questions'] loop
    execute format('create policy %1$s_own_read on %1$I for select to authenticated using (user_id = auth.uid())', t);
    execute format('create policy %1$s_own_insert on %1$I for insert to authenticated with check (user_id = auth.uid())', t);
    execute format('create policy %1$s_own_update on %1$I for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
  end loop;
end $$;

-- Замеры: строки создаёт расписание, ученик отправляет и правит заметку, админ сдвигает сроки
create policy checkpoints_own_read on checkpoints for select to authenticated using (user_id = auth.uid());
create policy checkpoints_own_update on checkpoints for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy checkpoints_admin_all on checkpoints for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Значения замера: через свой замер
create policy cpv_own_read on checkpoint_values for select to authenticated
  using (exists (select 1 from checkpoints c where c.id = checkpoint_id and c.user_id = auth.uid()));
create policy cpv_own_insert on checkpoint_values for insert to authenticated
  with check (exists (select 1 from checkpoints c where c.id = checkpoint_id and c.user_id = auth.uid()));
create policy cpv_own_update on checkpoint_values for update to authenticated
  using (exists (select 1 from checkpoints c where c.id = checkpoint_id and c.user_id = auth.uid()))
  with check (exists (select 1 from checkpoints c where c.id = checkpoint_id and c.user_id = auth.uid()));
create policy cpv_admin_read on checkpoint_values for select to authenticated using (public.is_admin());

-- Опыт и ачивки: ученик только читает, начисляет сервер (этап 5)
create policy xp_own_read on xp_ledger for select to authenticated using (user_id = auth.uid());
create policy xp_admin_read on xp_ledger for select to authenticated using (public.is_admin());
create policy ua_own_read on user_achievements for select to authenticated using (user_id = auth.uid());
create policy ua_admin_read on user_achievements for select to authenticated using (public.is_admin());

-- Созвоны и награды челленджей: ученик читает, админ пишет
create policy calls_own_read on calls for select to authenticated using (user_id = auth.uid());
create policy calls_admin_all on calls for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy cr_own_read on challenge_results for select to authenticated using (user_id = auth.uid());
create policy cr_admin_all on challenge_results for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Заметки админа: ученик их не видит
create policy notes_admin_all on admin_notes for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Каталоги: ученик читает, админ пишет
do $$
declare t text;
begin
  foreach t in array array['tariffs','metrics','achievements','challenges','triggers','settings'] loop
    execute format('create policy %1$s_read on %1$I for select to authenticated using (true)', t);
    execute format('create policy %1$s_admin_all on %1$I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t);
  end loop;
end $$;

-- Цитаты и фильмы: ученик видит только проверенные
create policy quotes_read on quotes for select to authenticated using (verified or public.is_admin());
create policy quotes_admin_all on quotes for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy movies_read on movies for select to authenticated using (verified or public.is_admin());
create policy movies_admin_all on movies for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Секретные ачивки: ученик видит только полученные
drop policy if exists achievements_read on achievements;
create policy achievements_read on achievements for select to authenticated
  using (not secret or public.is_admin() or exists (
    select 1 from user_achievements ua where ua.code = achievements.code and ua.user_id = auth.uid() and ua.revoked_at is null));

-- Программа: ученик видит активные пункты своего тарифа и свои персональные
create policy program_read on program_items for select to authenticated using (
  public.is_admin() or (
    active and deleted_at is null
    and public.my_tariff_code() = any (tariffs)
    and (user_id is null or user_id = auth.uid())
  ));
create policy program_admin_all on program_items for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- История правок видит админ
create policy audit_admin_read on audit_log for select to authenticated using (public.is_admin());

-- auth_attempts: политик нет, доступ только у сервисного ключа

grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- ============================================================
-- Хранилище скриншотов: приватный бакет, путь user_id/checkpoint_id/файл
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('screenshots', 'screenshots', false, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists shots_own_read on storage.objects;
drop policy if exists shots_own_insert on storage.objects;
drop policy if exists shots_own_update on storage.objects;
drop policy if exists shots_admin_read on storage.objects;

create policy shots_own_read on storage.objects for select to authenticated
  using (bucket_id = 'screenshots' and (storage.foldername(name))[1] = auth.uid()::text);
create policy shots_own_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'screenshots' and (storage.foldername(name))[1] = auth.uid()::text);
create policy shots_own_update on storage.objects for update to authenticated
  using (bucket_id = 'screenshots' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'screenshots' and (storage.foldername(name))[1] = auth.uid()::text);
create policy shots_admin_read on storage.objects for select to authenticated
  using (bucket_id = 'screenshots' and public.is_admin());
