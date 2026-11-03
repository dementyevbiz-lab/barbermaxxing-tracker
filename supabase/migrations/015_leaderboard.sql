-- Рейтинг: прирост по метрикам относительно точки А. Начальные значения другим ученикам не показываются
-- Очки метрики = вес × прирост в процентах (от 0 до потолка cap_pct). Вес = уровень влияния метрики, правится в админке
insert into settings (key, value) values
  ('leaderboard', '{"cap_pct": 100, "weights": {"avg_check": 4, "booking_fill": 3, "clients_social": 3, "work_days": 2, "top_views_avg": 2, "followers": 1}}')
on conflict (key) do nothing;

-- Общий расчёт. p_all = true только для админки: видны и скрытые ученики с пометкой, у строк есть id
create or replace function _leaderboard(p_me uuid, p_all boolean) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  cfg jsonb; cap numeric; me uuid := p_me; my_hidden boolean; res jsonb;
begin
  select value into cfg from settings where key = 'leaderboard';
  cap := coalesce((cfg ->> 'cap_pct')::numeric, 100);
  select coalesce((prefs ->> 'hide_top')::boolean, false) into my_hidden from profiles where id = me;

  with base as (
    -- в рейтинге только ученики, сдавшие точку А: без админов, демо и закрытого доступа, без тех, кто скрылся сам
    select p.id, p.display_name,
      case when coalesce((p.ui_overrides ->> 'top_hidden')::boolean, false) then 'admin'
           when coalesce((p.prefs ->> 'hide_top')::boolean, false) then 'self' end as hid
    from profiles p
    where p.status <> 'blocked' and not p.demo
      and not exists (select 1 from admins a where a.telegram_id = p.telegram_id)
      and (p_all or (not coalesce((p.prefs ->> 'hide_top')::boolean, false) and not coalesce((p.ui_overrides ->> 'top_hidden')::boolean, false)))
      and exists (select 1 from checkpoints c0 where c0.user_id = p.id and c0.idx = 0 and c0.submitted_at is not null)
  ),
  latest as (
    select distinct on (c.user_id, v.metric_key) c.user_id, v.metric_key, v.value
    from checkpoints c join checkpoint_values v on v.checkpoint_id = c.id
    where c.submitted_at is not null and c.idx > 0 and v.value is not null
    order by c.user_id, v.metric_key, c.idx desc
  ),
  gains as (
    -- до первого замера после точки А прирост нулевой
    select b.id, m.key,
      round(case when m.better = 'up' then coalesce(l.value, g.a_value) - g.a_value else g.a_value - coalesce(l.value, g.a_value) end / abs(g.a_value) * 100, 1) as gain,
      coalesce((cfg -> 'weights' ->> m.key)::numeric, 1) as w
    from base b
    join goals g on g.user_id = b.id
    join metrics m on m.key = g.metric_key and m.active
    left join latest l on l.user_id = b.id and l.metric_key = m.key
    where g.a_value is not null and g.a_value <> 0
  ),
  per_user as (
    select b.id, b.hid, coalesce(jsonb_object_agg(g.key, g.gain) filter (where g.key is not null), '{}'::jsonb) as gains,
           coalesce(round(sum(g.w * greatest(0, least(g.gain, cap)))), 0) as total
    from base b left join gains g on g.id = b.id group by b.id, b.hid
  )
  select jsonb_build_object(
    'cap', cap, 'weights', coalesce(cfg -> 'weights', '{}'::jsonb), 'hidden', coalesce(my_hidden, false),
    'rows', coalesce((select jsonb_agg(jsonb_build_object('name', b.display_name, 'me', coalesce(b.id = me, false), 'total', u.total, 'gains', u.gains) || case when p_all then jsonb_build_object('id', b.id, 'hidden', b.hid) else '{}'::jsonb end
                      order by u.total desc, b.display_name)
                      from per_user u join base b on b.id = u.id), '[]'::jsonb))
  into res;
  return res;
end $$;

revoke all on function _leaderboard(uuid, boolean) from public, anon, authenticated;

create or replace function leaderboard() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  return _leaderboard(auth.uid(), false);
end $$;

create or replace function leaderboard_admin() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return _leaderboard(null, true);
end $$;

revoke all on function leaderboard() from public, anon;
grant execute on function leaderboard() to authenticated;
revoke all on function leaderboard_admin() from public, anon;
grant execute on function leaderboard_admin() to authenticated;
