-- Рейтинг: прирост по метрикам относительно точки А. Начальные значения другим ученикам не показываются
-- Очки метрики = вес × прирост в процентах (от 0 до потолка cap_pct). Вес = уровень влияния метрики, правится в админке
insert into settings (key, value) values
  ('leaderboard', '{"cap_pct": 100, "weights": {"avg_check": 4, "booking_fill": 3, "clients_social": 3, "work_days": 2, "top_views_avg": 2, "followers": 1}}')
on conflict (key) do nothing;

create or replace function leaderboard() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  cfg jsonb; cap numeric; me uuid := auth.uid(); my_hidden boolean; res jsonb;
begin
  if me is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select value into cfg from settings where key = 'leaderboard';
  cap := coalesce((cfg ->> 'cap_pct')::numeric, 100);
  select coalesce((prefs ->> 'hide_top')::boolean, false) into my_hidden from profiles where id = me;

  with base as (
    -- в рейтинге только ученики: без админов, демо и закрытого доступа, без тех, кто скрылся сам
    select p.id, p.display_name from profiles p
    where p.status <> 'blocked' and not p.demo
      and not exists (select 1 from admins a where a.telegram_id = p.telegram_id)
      and not coalesce((p.prefs ->> 'hide_top')::boolean, false)
  ),
  latest as (
    select distinct on (c.user_id, v.metric_key) c.user_id, v.metric_key, v.value
    from checkpoints c join checkpoint_values v on v.checkpoint_id = c.id
    where c.submitted_at is not null and c.idx > 0 and v.value is not null
    order by c.user_id, v.metric_key, c.idx desc
  ),
  gains as (
    select b.id, m.key,
      round(case when m.better = 'up' then l.value - g.a_value else g.a_value - l.value end / abs(g.a_value) * 100, 1) as gain,
      coalesce((cfg -> 'weights' ->> m.key)::numeric, 1) as w
    from base b
    join goals g on g.user_id = b.id
    join metrics m on m.key = g.metric_key and m.active
    join latest l on l.user_id = b.id and l.metric_key = m.key
    where g.a_value is not null and g.a_value <> 0
  ),
  per_user as (
    select id, jsonb_object_agg(key, gain) as gains,
           round(sum(w * greatest(0, least(gain, cap)))) as total
    from gains group by id
  )
  select jsonb_build_object(
    'cap', cap, 'weights', coalesce(cfg -> 'weights', '{}'::jsonb), 'hidden', coalesce(my_hidden, false),
    'rows', coalesce((select jsonb_agg(jsonb_build_object('name', b.display_name, 'me', b.id = me, 'total', u.total, 'gains', u.gains)
                      order by u.total desc, b.display_name)
                      from per_user u join base b on b.id = u.id), '[]'::jsonb))
  into res;
  return res;
end $$;

revoke all on function leaderboard() from public, anon;
grant execute on function leaderboard() to authenticated;
