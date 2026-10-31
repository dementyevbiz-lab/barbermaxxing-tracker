-- Замеры открываются по времени: точка А всегда, остальные за N дней до срока (settings.checkpoint_open_days, по умолчанию 2)
create or replace function public.checkpoint_open(p_cp uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select c.idx = 0 or c.due_date - coalesce((select value::text::int from settings where key = 'checkpoint_open_days'), 2) <= current_date
  from checkpoints c where c.id = p_cp
$$;
revoke execute on function public.checkpoint_open(uuid) from public, anon, authenticated;

create or replace function public.cpv_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin() and not public.checkpoint_open(new.checkpoint_id) then
    raise exception 'Замер ещё не открыт' using errcode = '42501';
  end if;
  return new;
end $$;
revoke execute on function public.cpv_before() from public, anon, authenticated;
drop trigger if exists cpv_before on checkpoint_values;
create trigger cpv_before before insert or update on checkpoint_values for each row execute function public.cpv_before();

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
  if new.submitted_at is distinct from old.submitted_at and not public.checkpoint_open(new.id) then
    raise exception 'Замер ещё не открыт' using errcode = '42501';
  end if;
  return new;
end $$;
revoke execute on function public.checkpoints_guard() from public, anon, authenticated;

create or replace function public.screenshots_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if tg_op = 'INSERT' and auth.uid() is not null and not public.is_admin() then
    if new.checkpoint_id is null or not exists (select 1 from checkpoints c where c.id = new.checkpoint_id and c.user_id = new.user_id) then
      raise exception 'Скриншот должен быть привязан к своему замеру' using errcode = '42501';
    end if;
    if not public.checkpoint_open(new.checkpoint_id) then raise exception 'Замер ещё не открыт' using errcode = '42501'; end if;
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
revoke execute on function public.screenshots_before() from public, anon, authenticated;
