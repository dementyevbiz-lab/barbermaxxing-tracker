-- Этап 4–5. Серверная логика: опыт, ачивки, челленджи, отмена. Ученик начислить себе ничего не может,
-- всё считают триггеры. Отмена (undone_at / deleted_at) возвращает опыт и снимает ачивки

-- ============================================================
-- Помощники
-- ============================================================

create or replace function public.xp_cfg(p_name text, p_default numeric) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select (value ->> p_name)::numeric from settings where key = 'xp'), p_default)
$$;

create or replace function public.item_xp(it program_items) returns int
language plpgsql stable security definer set search_path = public as $$
begin
  if it.kind in ('lesson', 'live') then
    if coalesce(it.est_minutes, 0) <= 0 then return xp_cfg('lesson_default', 10)::int; end if;
    return least(xp_cfg('lesson_max', 30), round(it.est_minutes / xp_cfg('lesson_per_minutes', 3)))::int;
  elsif it.kind = 'homework' then
    return xp_cfg('homework', 30)::int;
  end if;
  return coalesce(it.xp, 0);
end $$;

create or replace function public.ledger_add(p_user uuid, p_kind text, p_ref uuid, p_xp int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(p_xp, 0) = 0 then return; end if;
  if exists (select 1 from xp_ledger where user_id = p_user and kind = p_kind and ref_id = p_ref and undone_at is null) then return; end if;
  insert into xp_ledger (user_id, kind, ref_id, xp) values (p_user, p_kind, p_ref, p_xp);
end $$;

create or replace function public.ledger_undo(p_user uuid, p_kind text, p_ref uuid) returns void
language sql security definer set search_path = public as $$
  update xp_ledger set undone_at = now() where user_id = p_user and kind = p_kind and ref_id = p_ref and undone_at is null
$$;

-- Номер недели ученика (1..weeks), null если ещё не стартовал
create or replace function public.week_of(p_user uuid, p_on date default current_date) returns int
language sql stable security definer set search_path = public as $$
  select case when p.start_date is null or p_on < p.start_date then null
              else least(t.weeks, (p_on - p.start_date) / 7 + 1) end
  from profiles p left join tariffs t on t.id = p.tariff_id where p.id = p_user
$$;

-- Пункт доступен ученику: активен, не удалён, его тариф входит, персональный только своему
create or replace function public.item_visible(p_item program_items, p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_item.active and p_item.deleted_at is null
     and (p_item.user_id is null or p_item.user_id = p_user)
     and exists (select 1 from profiles p join tariffs t on t.id = p.tariff_id
                 where p.id = p_user and t.code = any (p_item.tariffs))
$$;

-- ============================================================
-- Челленджи
-- ============================================================

create or replace function public.recalc_challenges(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  c challenges;
  v_total int; v_done int;
  r challenge_results;
begin
  for c in select * from challenges where active loop
    select count(*) into v_total from program_items i
      where i.kind = 'challenge_task' and c.code = any (i.tags) and item_visible(i, p_user);
    select count(*) into v_done from program_items i
      where i.kind = 'challenge_task' and c.code = any (i.tags) and item_visible(i, p_user)
        and exists (select 1 from completions x where x.user_id = p_user and x.item_id = i.id and x.kind = 'done' and x.undone_at is null);
    select * into r from challenge_results where user_id = p_user and challenge_id = c.id;
    if v_total > 0 and v_done = v_total then
      insert into challenge_results (user_id, challenge_id, completed_at, reward_status)
      values (p_user, c.id, now(), 'earned')
      on conflict (user_id, challenge_id) do update
        set completed_at = coalesce(challenge_results.completed_at, now()),
            reward_status = case when challenge_results.reward_status = 'given' then 'given' else 'earned' end;
      perform ledger_add(p_user, 'challenge', c.id, c.completion_xp);
    elsif found and r.completed_at is not null then
      update challenge_results
        set completed_at = null, reward_status = case when reward_status = 'given' then 'given' else 'none' end
        where user_id = p_user and challenge_id = c.id;
      perform ledger_undo(p_user, 'challenge', c.id);
    end if;
  end loop;
end $$;

-- ============================================================
-- Ачивки
-- ============================================================

-- Текущее значение счётчика
create or replace function public.ach_counter(p_user uuid, p_counter text) returns int
language plpgsql stable security definer set search_path = public as $$
declare v int;
begin
  if p_counter = 'videos' then
    select count(*) into v from video_logs where user_id = p_user and undone_at is null;
  elsif p_counter = 'videos_each_dir' then
    select coalesce(min(n), 0) into v from (
      select k.kind, (select count(*) from video_logs l where l.user_id = p_user and l.undone_at is null and l.kind = k.kind) n
      from (values ('client'), ('expert'), ('life')) k(kind)) s;
  elsif p_counter in ('lessons', 'homework') then
    select count(*) into v from completions c join program_items i on i.id = c.item_id
      where c.user_id = p_user and c.kind = 'done' and c.undone_at is null
        and ((p_counter = 'lessons' and i.kind in ('lesson', 'live')) or (p_counter = 'homework' and i.kind = 'homework'));
  elsif p_counter = 'notes' then
    select count(*) into v from completions where user_id = p_user and kind = 'notes' and undone_at is null;
  elsif p_counter = 'checkpoints_ontime' then
    select count(*) into v from checkpoints where user_id = p_user and submitted_at is not null and submitted_at::date <= due_date;
  elsif p_counter = 'insights' then
    select count(*) into v from insights where user_id = p_user and deleted_at is null;
  elsif p_counter = 'questions_asked' then
    select count(*) into v from questions where user_id = p_user and status = 'asked' and deleted_at is null;
  elsif p_counter like 'challenge:%' then
    select count(*) into v from completions c join program_items i on i.id = c.item_id
      where c.user_id = p_user and c.kind = 'done' and c.undone_at is null
        and i.kind = 'challenge_task' and substr(p_counter, 11) = any (i.tags);
  else
    v := 0;
  end if;
  return coalesce(v, 0);
end $$;

-- «Все» для ступени без порога
create or replace function public.ach_total(p_user uuid, p_counter text) returns int
language plpgsql stable security definer set search_path = public as $$
declare v int;
begin
  if p_counter = 'checkpoints_ontime' then
    select count(*) into v from checkpoints where user_id = p_user;
  elsif p_counter like 'challenge:%' then
    select count(*) into v from program_items i
      where i.kind = 'challenge_task' and substr(p_counter, 11) = any (i.tags) and item_visible(i, p_user);
  end if;
  return coalesce(v, 0);
end $$;

create or replace function public.recalc_achievements(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  a achievements;
  t record;
  v_count int; v_thr int; v_reached boolean;
  ua user_achievements;
  v_ref uuid;
begin
  for a in select * from achievements loop
    v_count := ach_counter(p_user, a.counter);
    for t in select (e ->> 'tier')::int as tier, (e ->> 'threshold')::int as thr, coalesce((e ->> 'xp')::int, 0) as xp
             from jsonb_array_elements(a.tiers) e loop
      v_thr := coalesce(t.thr, ach_total(p_user, a.counter));
      v_reached := v_thr > 0 and v_count >= v_thr;
      v_ref := md5(p_user::text || a.code || t.tier::text)::uuid;
      select * into ua from user_achievements where user_id = p_user and code = a.code and tier = t.tier;
      if v_reached then
        if not found then
          insert into user_achievements (user_id, code, tier) values (p_user, a.code, t.tier);
          perform ledger_add(p_user, 'achievement', v_ref, t.xp);
        elsif ua.revoked_at is not null then
          update user_achievements set revoked_at = null, earned_at = now() where user_id = p_user and code = a.code and tier = t.tier;
          perform ledger_add(p_user, 'achievement', v_ref, t.xp);
        end if;
      elsif found and ua.revoked_at is null then
        update user_achievements set revoked_at = now() where user_id = p_user and code = a.code and tier = t.tier;
        perform ledger_undo(p_user, 'achievement', v_ref);
      end if;
    end loop;
  end loop;
end $$;

create or replace function public.recalc_all(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform recalc_challenges(p_user);
  perform recalc_achievements(p_user);
end $$;

-- ============================================================
-- Отметки программы (уроки, домашки, конспекты, задания)
-- ============================================================

create or replace function public.completions_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare it program_items;
begin
  if tg_op = 'INSERT' then
    select * into it from program_items where id = new.item_id;
    if not found then raise exception 'Нет такого пункта' using errcode = '23503'; end if;
    if auth.uid() is not null and not public.is_admin() then
      if not item_visible(it, new.user_id) then raise exception 'Пункт недоступен' using errcode = '42501'; end if;
      if new.kind = 'notes' and not it.has_notes then raise exception 'Для пункта нет конспекта' using errcode = '42501'; end if;
    end if;
  elsif tg_op = 'UPDATE' and auth.uid() is not null and not public.is_admin() then
    if (to_jsonb(new) - 'undone_at') is distinct from (to_jsonb(old) - 'undone_at') then
      raise exception 'Можно только отменить отметку' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

create or replace function public.completions_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare it program_items; v_kind text;
begin
  select * into it from program_items where id = new.item_id;
  v_kind := case when new.kind = 'notes' then 'notes' else 'completion' end;
  if tg_op = 'INSERT' and new.undone_at is null then
    perform ledger_add(new.user_id, v_kind, new.id,
      case when new.kind = 'notes' then xp_cfg('notes', 10)::int else item_xp(it) end);
  elsif tg_op = 'UPDATE' then
    if old.undone_at is null and new.undone_at is not null then
      perform ledger_undo(new.user_id, v_kind, new.id);
    elsif old.undone_at is not null and new.undone_at is null then
      perform ledger_add(new.user_id, v_kind, new.id,
        case when new.kind = 'notes' then xp_cfg('notes', 10)::int else item_xp(it) end);
    end if;
  end if;
  perform recalc_all(new.user_id);
  return new;
end $$;

drop trigger if exists completions_before on completions;
create trigger completions_before before insert or update on completions for each row execute function public.completions_before();
drop trigger if exists completions_after on completions;
create trigger completions_after after insert or update on completions for each row execute function public.completions_after();

-- ============================================================
-- Видео
-- ============================================================

create or replace function public.video_xp_add(v video_logs) returns void
language plpgsql security definer set search_path = public as $$
declare v_today int;
begin
  select count(*) into v_today from xp_ledger l join video_logs x on x.id = l.ref_id
    where l.user_id = v.user_id and l.kind = 'video' and l.undone_at is null and x.logged_on = v.logged_on and x.id <> v.id;
  if v_today < xp_cfg('video_daily_max', 3) then
    perform ledger_add(v.user_id, 'video', v.id, xp_cfg('video', 15)::int);
  end if;
end $$;

create or replace function public.video_logs_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    if tg_op = 'INSERT' and new.logged_on not between current_date - 2 and current_date + 1 then
      raise exception 'Дата видео вне допустимого окна' using errcode = '22008';
    end if;
    if tg_op = 'UPDATE' and (to_jsonb(new) - 'views' - 'note' - 'undone_at') is distinct from (to_jsonb(old) - 'views' - 'note' - 'undone_at') then
      raise exception 'Можно менять только просмотры и заметку' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

create or replace function public.video_logs_after() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and new.undone_at is null then
    perform video_xp_add(new);
  elsif tg_op = 'UPDATE' then
    if old.undone_at is null and new.undone_at is not null then
      perform ledger_undo(new.user_id, 'video', new.id);
    elsif old.undone_at is not null and new.undone_at is null then
      perform video_xp_add(new);
    end if;
  end if;
  perform recalc_achievements(new.user_id);
  return new;
end $$;

drop trigger if exists video_logs_before on video_logs;
create trigger video_logs_before before insert or update on video_logs for each row execute function public.video_logs_before();
drop trigger if exists video_logs_after on video_logs;
create trigger video_logs_after after insert or update on video_logs for each row execute function public.video_logs_after();

-- ============================================================
-- Выводы и вопросы
-- ============================================================

create or replace function public.insight_xp_add(i insights) returns void
language plpgsql security definer set search_path = public as $$
declare v_today int;
begin
  select count(*) into v_today from xp_ledger l join insights x on x.id = l.ref_id
    where l.user_id = i.user_id and l.kind = 'insight' and l.undone_at is null and x.created_at::date = i.created_at::date and x.id <> i.id;
  if v_today < xp_cfg('insight_daily_max', 3) then
    perform ledger_add(i.user_id, 'insight', i.id, xp_cfg('insight', 5)::int);
  end if;
end $$;

create or replace function public.insights_after() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and new.deleted_at is null then
    perform insight_xp_add(new);
  elsif tg_op = 'UPDATE' then
    if old.deleted_at is null and new.deleted_at is not null then
      perform ledger_undo(new.user_id, 'insight', new.id);
    elsif old.deleted_at is not null and new.deleted_at is null then
      perform insight_xp_add(new);
    end if;
  end if;
  perform recalc_achievements(new.user_id);
  return new;
end $$;

drop trigger if exists insights_after on insights;
create trigger insights_after after insert or update on insights for each row execute function public.insights_after();

create or replace function public.questions_after() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform recalc_achievements(new.user_id);
  return new;
end $$;

drop trigger if exists questions_after on questions;
create trigger questions_after after insert or update on questions for each row execute function public.questions_after();

-- ============================================================
-- Замеры и скриншоты
-- ============================================================

-- Бонус за 3 и больше скриншотов: есть, пока замер отправлен и живых скриншотов хватает
create or replace function public.recalc_cp_bonus(p_cp uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c checkpoints; v_n int;
begin
  select * into c from checkpoints where id = p_cp;
  if not found then return; end if;
  select count(*) into v_n from screenshots where checkpoint_id = p_cp and deleted_at is null;
  if c.submitted_at is not null and v_n >= xp_cfg('screenshots_min', 3) then
    perform ledger_add(c.user_id, 'screenshots', c.id, xp_cfg('screenshots_bonus', 10)::int);
  else
    perform ledger_undo(c.user_id, 'screenshots', c.id);
  end if;
end $$;

create or replace function public.checkpoints_after() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.submitted_at is null and new.submitted_at is not null then
    perform ledger_add(new.user_id, 'checkpoint', new.id, xp_cfg('checkpoint', 40)::int);
  elsif old.submitted_at is not null and new.submitted_at is null then
    perform ledger_undo(new.user_id, 'checkpoint', new.id);
  end if;
  if old.submitted_at is distinct from new.submitted_at then
    perform recalc_cp_bonus(new.id);
    perform recalc_achievements(new.user_id);
  end if;
  return new;
end $$;

drop trigger if exists checkpoints_after on checkpoints;
create trigger checkpoints_after after update on checkpoints for each row execute function public.checkpoints_after();

-- Отправленный замер ученик назад не откатывает, срок и номер не трогает
create or replace function public.checkpoints_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.is_admin() or auth.uid() is null then return new; end if;
  if (to_jsonb(new) - 'submitted_at' - 'note') is distinct from (to_jsonb(old) - 'submitted_at' - 'note') then
    raise exception 'Срок замера меняет только команда программы' using errcode = '42501';
  end if;
  if old.submitted_at is not null and new.submitted_at is distinct from old.submitted_at then
    raise exception 'Отправленный замер можно только исправлять' using errcode = '42501';
  end if;
  return new;
end $$;

create or replace function public.screenshots_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if tg_op = 'INSERT' and auth.uid() is not null and not public.is_admin() then
    if new.checkpoint_id is null or not exists (select 1 from checkpoints c where c.id = new.checkpoint_id and c.user_id = new.user_id) then
      raise exception 'Скриншот должен быть привязан к своему замеру' using errcode = '42501';
    end if;
    if split_part(new.storage_path, '/', 1) <> new.user_id::text then
      raise exception 'Файл должен лежать в своей папке' using errcode = '42501';
    end if;
    select count(*) into v_n from screenshots where checkpoint_id = new.checkpoint_id and deleted_at is null;
    if v_n >= xp_cfg('screenshots_max', 8) then
      raise exception 'Не больше 8 скриншотов на замер' using errcode = '54000';
    end if;
  elsif tg_op = 'UPDATE' and auth.uid() is not null and not public.is_admin() then
    if (to_jsonb(new) - 'deleted_at' - 'kind') is distinct from (to_jsonb(old) - 'deleted_at' - 'kind') then
      raise exception 'Можно менять только тип и удаление' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

create or replace function public.screenshots_after() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform recalc_cp_bonus(new.checkpoint_id);
  return new;
end $$;

drop trigger if exists screenshots_before on screenshots;
create trigger screenshots_before before insert or update on screenshots for each row execute function public.screenshots_before();
drop trigger if exists screenshots_after on screenshots;
create trigger screenshots_after after insert or update on screenshots for each row execute function public.screenshots_after();

-- Значения замера нельзя менять у чужого или без замера уже решено политиками. Здесь: только при живой строке замера
-- (история прошлых значений ведётся триггером из 001)

-- ============================================================
-- Изменения программы админом пересчитывают ачивки и челленджи тех, кого это касается
-- ============================================================

create or replace function public.program_items_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare u uuid;
begin
  if new.kind = 'challenge_task' or (tg_op = 'UPDATE' and old.kind = 'challenge_task') then
    for u in select id from profiles loop
      perform recalc_all(u);
    end loop;
  end if;
  return new;
end $$;

drop trigger if exists program_items_after on program_items;
create trigger program_items_after after insert or update on program_items for each row execute function public.program_items_after();

create or replace function public.challenges_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare u uuid;
begin
  for u in select id from profiles loop
    perform recalc_all(u);
  end loop;
  return new;
end $$;

drop trigger if exists challenges_after on challenges;
create trigger challenges_after after update of active on challenges for each row execute function public.challenges_after();

-- ============================================================
-- Уведомления бота: что уже отправлено, чтобы не слать дважды
-- ============================================================

create table if not exists notifications (
  id bigserial primary key,
  user_id uuid not null references profiles(id) on delete cascade,
  kind text not null,                   -- welcome | checkpoint_2d | checkpoint_due | checkpoint_retry | call_1d | call_1h
  ref_id uuid,
  sent_at timestamptz not null default now(),
  unique (user_id, kind, ref_id)
);
alter table notifications enable row level security;
alter table notifications force row level security;
-- политик нет: пишет и читает только сервер

-- ============================================================
-- Хранилище для итогового PDF
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('exports', 'exports', false, 5242880, array['application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists exports_own_read on storage.objects;
drop policy if exists exports_own_insert on storage.objects;
drop policy if exists exports_own_update on storage.objects;
create policy exports_own_read on storage.objects for select to authenticated
  using (bucket_id = 'exports' and (storage.foldername(name))[1] = auth.uid()::text);
create policy exports_own_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'exports' and (storage.foldername(name))[1] = auth.uid()::text);
create policy exports_own_update on storage.objects for update to authenticated
  using (bucket_id = 'exports' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'exports' and (storage.foldername(name))[1] = auth.uid()::text);

-- ============================================================
-- Права на функции: внутренние нельзя вызывать с клиента
-- ============================================================

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prokind = 'f' loop
    if f.proname not in ('ping', 'is_admin', 'jwt_telegram_id', 'my_tariff_code') then
      execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
    end if;
  end loop;
end $$;

grant select, insert, update, delete on all tables in schema public to authenticated;
revoke all on notifications from authenticated, anon;
