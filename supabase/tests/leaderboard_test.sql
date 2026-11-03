-- Проверка рейтинга: только ученики, без админов, демо и скрывшихся; прирост считается от точки А. Всё в транзакции с откатом
begin;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000c1', 'lb-a@example.com'), ('00000000-0000-0000-0000-0000000000c2', 'lb-b@example.com'),
  ('00000000-0000-0000-0000-0000000000c3', 'lb-adm@example.com'), ('00000000-0000-0000-0000-0000000000c4', 'lb-demo@example.com'),
  ('00000000-0000-0000-0000-0000000000c5', 'lb-hid@example.com'), ('00000000-0000-0000-0000-0000000000c6', 'lb-new@example.com'), ('00000000-0000-0000-0000-0000000000c7', 'lb-onlya@example.com'), ('00000000-0000-0000-0000-0000000000c8', 'lb-twink@example.com');
insert into admins (telegram_id, name) values (920000003, 'lb admin');
insert into profiles (id, telegram_id, display_name, tariff_id, start_date, status, demo, prefs) values
  ('00000000-0000-0000-0000-0000000000c1', 920000001, 'Ученик А', (select id from tariffs where code = 'barbermax'), current_date - 20, 'active', false, '{}'),
  ('00000000-0000-0000-0000-0000000000c2', 920000002, 'Ученик Б', (select id from tariffs where code = 'barbermax'), current_date - 20, 'active', false, '{}'),
  ('00000000-0000-0000-0000-0000000000c3', 920000003, 'Админ', (select id from tariffs where code = 'barbermax'), current_date - 20, 'active', false, '{}'),
  ('00000000-0000-0000-0000-0000000000c4', 920000004, 'Демо', (select id from tariffs where code = 'barbermax'), current_date - 20, 'active', true, '{}'),
  ('00000000-0000-0000-0000-0000000000c5', 920000005, 'Скрытый', (select id from tariffs where code = 'barbermax'), current_date - 20, 'active', false, '{"hide_top": true}'),
  ('00000000-0000-0000-0000-0000000000c6', 920000006, 'Без точки А', (select id from tariffs where code = 'barbermax'), current_date - 20, 'active', false, '{}'),
  ('00000000-0000-0000-0000-0000000000c7', 920000007, 'Только А', (select id from tariffs where code = 'barbermax'), current_date - 20, 'active', false, '{}');
insert into profiles (id, telegram_id, display_name, tariff_id, start_date, status, demo, ui_overrides) values
  ('00000000-0000-0000-0000-0000000000c8', 920000008, 'Твинк', (select id from tariffs where code = 'barbermax'), current_date - 20, 'active', false, '{"top_hidden": true}');

-- точка А и первый замер: у А чек 1500 -> 1800 (+20%), рабочих дней 6 -> 5 (+16,7%), подписчики 100 -> 1000 (+900%, потолок 100)
-- у Б чек 2000 -> 2100 (+5%). У остальных те же цифры, чтобы проверить исключения
do $$
declare u uuid; cp uuid;
begin
  foreach u in array array['00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000c2','00000000-0000-0000-0000-0000000000c3','00000000-0000-0000-0000-0000000000c4','00000000-0000-0000-0000-0000000000c5','00000000-0000-0000-0000-0000000000c6','00000000-0000-0000-0000-0000000000c7','00000000-0000-0000-0000-0000000000c8']::uuid[] loop
    insert into goals (user_id, metric_key, a_value, b_value) values
      (u, 'avg_check', case when u = '00000000-0000-0000-0000-0000000000c2' then 2000 else 1500 end, 3000), (u, 'work_days', 6, 4), (u, 'followers', 100, 5000);
    if u = '00000000-0000-0000-0000-0000000000c6' then continue; end if;
    update checkpoints set submitted_at = now() where user_id = u and idx = 0;
    if u = '00000000-0000-0000-0000-0000000000c7' then continue; end if;
    select id into cp from checkpoints where user_id = u and idx = 1;
    insert into checkpoint_values (checkpoint_id, metric_key, value) values
      (cp, 'avg_check', case when u = '00000000-0000-0000-0000-0000000000c2' then 2100 else 1800 end), (cp, 'work_days', 5), (cp, 'followers', 1000);
    update checkpoints set submitted_at = now() where id = cp;
  end loop;
end $$;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated","app_metadata":{"telegram_id":920000001}}', true);
do $$
declare r jsonb; a jsonb;
begin
  r := public.leaderboard();
  assert jsonb_array_length(r -> 'rows') = 3, 'в рейтинге три ученика: ' || (r -> 'rows')::text;
  assert not (r -> 'rows')::text like '%Админ%', 'админов нет';
  assert not (r -> 'rows')::text like '%Демо%', 'демо нет';
  assert not (r -> 'rows')::text like '%Скрытый%', 'скрывшийся не виден';
  assert not (r -> 'rows')::text like '%Твинк%', 'скрытый админом не виден';
  assert not (r -> 'rows')::text like '%Без точки А%', 'без точки А в таблице нет';
  assert exists (select 1 from jsonb_array_elements(r -> 'rows') x where x ->> 'name' = 'Только А' and (x ->> 'total')::int = 0 and (x -> 'gains' ->> 'avg_check')::numeric = 0), 'после точки А виден с нулевым приростом';
  a := (r -> 'rows') -> 0;
  assert a ->> 'name' = 'Ученик А' and (a ->> 'me')::boolean, 'первый А и это я';
  assert (a -> 'gains' ->> 'avg_check')::numeric = 20.0, 'прирост чека +20%';
  assert (a -> 'gains' ->> 'work_days')::numeric = 16.7, 'меньше рабочих дней = прирост';
  assert (a -> 'gains' ->> 'followers')::numeric = 900.0, 'прирост подписчиков виден целиком';
  assert (a ->> 'total')::int = round(4 * 20 + 2 * 16.7 + 1 * 100), 'очки: вес × прирост, подписчики срезаны потолком 100: ' || (a ->> 'total');
  assert not (a::text like '%1500%' or a::text like '%1800%'), 'начальные и текущие значения не отдаются';
  assert not (((r -> 'rows') -> 1 ->> 'me')::boolean), 'второй не я';
  -- админ тоже получает таблицу без админа
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c3","role":"authenticated","app_metadata":{"telegram_id":920000003}}', true);
  assert jsonb_array_length(public.leaderboard() -> 'rows') = 3, 'админ видит тех же троих';
  -- админский рейтинг: все ученики, скрытые с пометкой, без админов и демо; ученику закрыт
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c3","role":"authenticated","app_metadata":{"telegram_id":920000003}}', true);
  r := public.leaderboard_admin();
  assert jsonb_array_length(r -> 'rows') = 5, 'админ видит пятерых с точкой А: ' || (r -> 'rows')::text;
  assert exists (select 1 from jsonb_array_elements(r -> 'rows') x where x ->> 'name' = 'Твинк' and x ->> 'hidden' = 'admin' and x ? 'id'), 'скрытый админом виден админу с пометкой';
  assert exists (select 1 from jsonb_array_elements(r -> 'rows') x where x ->> 'name' = 'Скрытый' and x ->> 'hidden' = 'self'), 'скрывшийся сам виден админу с пометкой';
  assert not (r -> 'rows')::text like '%Админ"%' and not (r -> 'rows')::text like '%Демо%', 'админов и демо нет и в админском рейтинге';
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated","app_metadata":{"telegram_id":920000001}}', true);
  begin perform public.leaderboard_admin(); raise exception 'ученик получил админский рейтинг'; exception when insufficient_privilege then null; end;
  -- скрывшийся видит пометку и не попадает в список
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c5","role":"authenticated","app_metadata":{"telegram_id":920000005}}', true);
  assert (public.leaderboard() ->> 'hidden')::boolean, 'скрывшийся видит, что скрыт';
  -- без входа функция закрыта
  perform set_config('request.jwt.claims', '', true); reset role; set local role anon;
  begin perform public.leaderboard(); raise exception 'аноним получил рейтинг'; exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'рейтинг: все проверки пройдены' as result;
rollback;
