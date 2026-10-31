-- Модуль 0 (предобучение), тип пункта «материал», закрытые будущие недели на стороне сервера

-- 1. Тип пункта «материал»: книга, банк видео, консультация, фильм. Опыт задаётся полем xp
alter table program_items drop constraint if exists program_items_kind_check;
alter table program_items add constraint program_items_kind_check check (kind in ('lesson','live','homework','material','short_task','challenge_task'));

create or replace function public.item_xp(it program_items) returns int
language plpgsql stable security definer set search_path = public as $$
begin
  if it.kind in ('lesson', 'live') then
    if coalesce(it.est_minutes, 0) <= 0 then return xp_cfg('lesson_default', 10)::int; end if;
    return least(xp_cfg('lesson_max', 30), round(it.est_minutes / xp_cfg('lesson_per_minutes', 3)))::int;
  elsif it.kind = 'homework' then
    return xp_cfg('homework', 30)::int;
  end if;
  return coalesce(it.xp, 0);   -- material, short_task, challenge_task
end $$;
revoke execute on function public.item_xp(program_items) from public, anon, authenticated;

-- материалы идут в счётчик «уроков» ачивки
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
        and ((p_counter = 'lessons' and i.kind in ('lesson', 'live', 'material')) or (p_counter = 'homework' and i.kind = 'homework'));
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
revoke execute on function public.ach_counter(uuid, text) from public, anon, authenticated;
update achievements set name = 'Уроки и материалы' where code = 'lessons';

-- 2. До какой недели ученику открыта программа: модуль 0 до старта, потом по неделям. Будущие недели закрыты
create or replace function public.max_week(p_user uuid) returns int
language sql stable security definer set search_path = public as $$
  select coalesce(public.week_of(p_user), 0)
$$;
grant execute on function public.max_week(uuid) to authenticated;

create or replace function public.item_visible(p_item program_items, p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_item.active and p_item.deleted_at is null
     and p_item.week <= public.max_week(p_user)
     and (p_item.user_id is null or p_item.user_id = p_user)
     and exists (select 1 from profiles p join tariffs t on t.id = p.tariff_id
                 where p.id = p_user and t.code = any (p_item.tariffs))
$$;
revoke execute on function public.item_visible(program_items, uuid) from public, anon, authenticated;

drop policy if exists program_read on program_items;
create policy program_read on program_items for select to authenticated using (
  public.is_admin() or (
    active and deleted_at is null
    and week <= public.max_week(auth.uid())
    and public.my_tariff_code() = any (tariffs)
    and (user_id is null or user_id = auth.uid())
  ));

-- 3. Названия недель и текст модуля 0
insert into settings (key, value) values
  ('week_titles', '{"0": "Модуль 0. Предобучение"}'),
  ('module0_text', '"Это самое начало. Время войти в темп и подготовиться без большой нагрузки. Основная программа стартует с первым эфиром"')
on conflict (key) do nothing;

-- 4. Модуль 0: материалы. Опыт пропорционален времени и усилиям
insert into program_items (week, ord, kind, title, description, est_minutes, xp, required, has_notes, tariffs)
select * from (values
 (0, 1, 'material', 'Книга: Клиенты на всю жизнь', 'Карл Сьюэлл. Книга о сервисе и постоянных клиентах', 360, 80, true, true, '{barbermax,personal}'::text[]),
 (0, 2, 'material', 'Банк 30 форматов видео для барбера', null, 120, 40, true, true, '{barbermax,personal}'),
 (0, 3, 'material', 'Консультация клиента: парень', null, 40, 20, true, true, '{barbermax,personal}'),
 (0, 4, 'material', 'Консультация клиента: девушка', null, 40, 20, true, true, '{barbermax,personal}'),
 (0, 5, 'material', 'Фильм: Дзиро мечтает о суши', null, 81, 25, true, false, '{barbermax,personal}')
) v(week, ord, kind, title, description, est_minutes, xp, required, has_notes, tariffs)
where not exists (select 1 from program_items p where p.title = v.title and p.week = 0);
