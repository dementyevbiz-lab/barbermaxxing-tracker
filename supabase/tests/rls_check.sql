-- Проверка прав (раздел 6.4 и приёмка этапа 3: чужие данные недоступны).
-- Создаёт двух учеников и админа, от имени каждого пробует читать и писать чужое.
-- В конце выбрасывает исключение с отчётом, поэтому все тестовые данные откатываются.
do $$
declare
  a uuid := '00000000-0000-4000-8000-00000000000a';
  b uuid := '00000000-0000-4000-8000-00000000000b';
  c uuid := '00000000-0000-4000-8000-00000000000c';
  cp_b uuid;
  item_b uuid;
  n int;
  ok boolean;
  report text := '';
  fails int := 0;

begin
  -- данные
  insert into auth.users (id, email, aud, role, raw_app_meta_data) values
    (a, 'rls-a@test.invalid', 'authenticated', 'authenticated', '{"telegram_id":900000001}'),
    (b, 'rls-b@test.invalid', 'authenticated', 'authenticated', '{"telegram_id":900000002}'),
    (c, 'rls-c@test.invalid', 'authenticated', 'authenticated', '{"telegram_id":900000003}');
  insert into public.admins (telegram_id, note) values (900000003, 'rls test');
  insert into public.profiles (id, display_name, tariff_id, start_date, telegram_id, status)
    select a, 'Тест А', id, current_date, 900000001, 'active' from public.tariffs where code = 'barbermax';
  insert into public.profiles (id, display_name, tariff_id, start_date, telegram_id, status)
    select b, 'Тест Б', id, current_date, 900000002, 'active' from public.tariffs where code = 'personal';
  insert into public.insights (user_id, body) values (a, 'вывод А'), (b, 'вывод Б');
  insert into public.questions (user_id, body) values (a, 'вопрос А'), (b, 'вопрос Б');
  insert into public.program_items (week, kind, title, tariffs) values (1, 'lesson', 'Только для лички', '{personal}');
  insert into public.program_items (week, kind, title, user_id) values (1, 'short_task', 'Персонально Б', b) returning id into item_b;
  insert into public.completions (user_id, item_id) values (b, item_b);
  select id into cp_b from public.checkpoints where user_id = b and idx = 0;
  insert into public.checkpoint_values (checkpoint_id, metric_key, value) values (cp_b, 'avg_check', 2000);
  insert into public.screenshots (user_id, checkpoint_id, kind, storage_path) values (b, cp_b, 'video_1', b || '/' || cp_b || '/1.jpg');
  insert into storage.objects (bucket_id, name, owner) values
    ('screenshots', a || '/x/1.jpg', a), ('screenshots', b || '/' || cp_b || '/1.jpg', b);
  insert into public.admin_notes (user_id, body) values (b, 'заметка');
  insert into public.login_log (telegram_id, ok, reason) values (1, false, 'test');

  -- ===== ученик А =====
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated',
    'app_metadata', json_build_object('telegram_id', 900000001))::text, true);
  execute 'set local role authenticated';

  select count(*) into n from public.profiles;                 ok := n = 1;
  report := report || format(E'\n%s А видит только свой профиль (%s)', case when ok then 'OK ' else 'FAIL' end, n); fails := fails + (not ok)::int;
  select count(*) into n from public.insights where user_id = b; ok := n = 0;
  report := report || format(E'\n%s А не видит выводы Б (%s)', case when ok then 'OK ' else 'FAIL' end, n); fails := fails + (not ok)::int;
  select count(*) into n from public.questions where user_id = b; ok := n = 0;
  report := report || format(E'\n%s А не видит вопросы Б (%s)', case when ok then 'OK ' else 'FAIL' end, n); fails := fails + (not ok)::int;
  select count(*) into n from public.checkpoints where user_id = b; ok := n = 0;
  report := report || format(E'\n%s А не видит замеры Б (%s)', case when ok then 'OK ' else 'FAIL' end, n); fails := fails + (not ok)::int;
  select count(*) into n from public.checkpoint_values;          ok := n = 0;
  report := report || format(E'\n%s А не видит цифры Б (%s)', case when ok then 'OK ' else 'FAIL' end, n); fails := fails + (not ok)::int;
  select count(*) into n from public.completions;                ok := n = 0;
  report := report || format(E'\n%s А не видит отметки Б (%s)', case when ok then 'OK ' else 'FAIL' end, n); fails := fails + (not ok)::int;
  select count(*) into n from public.screenshots;                ok := n = 0;
  report := report || format(E'\n%s А не видит записи о скриншотах Б (%s)', case when ok then 'OK ' else 'FAIL' end, n); fails := fails + (not ok)::int;
  select count(*) into n from storage.objects where name like b || '/%'; ok := n = 0;
  report := report || format(E'\n%s А не видит файлы Б (%s)', case when ok then 'OK ' else 'FAIL' end, n); fails := fails + (not ok)::int;
  select count(*) into n from storage.objects where name like a || '/%'; ok := n = 1;
  report := report || format(E'\n%s А видит свои файлы (%s)', case when ok then 'OK ' else 'FAIL' end, n); fails := fails + (not ok)::int;
  select count(*) into n from public.program_items;              ok := n = 0;
  report := report || format(E'\n%s А не видит пункты чужого тарифа и чужие персональные (%s)', case when ok then 'OK ' else 'FAIL' end, n); fails := fails + (not ok)::int;
  select count(*) into n from public.tariffs;                    ok := n = 1;
  report := report || format(E'\n%s А видит только свой тариф (%s)', case when ok then 'OK ' else 'FAIL' end, n); fails := fails + (not ok)::int;
  select count(*) into n from public.admin_notes;                ok := n = 0;
  report := report || format(E'\n%s А не видит заметки админа (%s)', case when ok then 'OK ' else 'FAIL' end, n); fails := fails + (not ok)::int;
  select count(*) into n from public.admins;                     ok := n = 0;
  report := report || format(E'\n%s А не видит список админов (%s)', case when ok then 'OK ' else 'FAIL' end, n); fails := fails + (not ok)::int;
  select count(*) into n from public.login_log;                  ok := n = 0;
  report := report || format(E'\n%s А не видит журнал входов (%s)', case when ok then 'OK ' else 'FAIL' end, n); fails := fails + (not ok)::int;
  select count(*) into n from public.metrics;                    ok := n = 6;
  report := report || format(E'\n%s А видит каталог метрик (%s)', case when ok then 'OK ' else 'FAIL' end, n); fails := fails + (not ok)::int;

  update public.insights set body = 'взлом' where user_id = b;  get diagnostics n = row_count; ok := n = 0;
  report := report || format(E'\n%s А не может изменить выводы Б (%s)', case when ok then 'OK ' else 'FAIL' end, n); fails := fails + (not ok)::int;
  update public.profiles set display_name = 'взлом';            get diagnostics n = row_count; ok := n = 0;
  report := report || format(E'\n%s А не может менять профили, даже свой (%s)', case when ok then 'OK ' else 'FAIL' end, n); fails := fails + (not ok)::int;
  delete from public.insights where user_id = a;                get diagnostics n = row_count; ok := n = 0;
  report := report || format(E'\n%s А не удаляет физически даже свои выводы (%s)', case when ok then 'OK ' else 'FAIL' end, n); fails := fails + (not ok)::int;

  begin insert into public.insights (user_id, body) values (b, 'подброс'); ok := false;
  exception when others then ok := true; end;
  report := report || format(E'\n%s А не может записать вывод от имени Б', case when ok then 'OK ' else 'FAIL' end); fails := fails + (not ok)::int;
  begin insert into public.xp_ledger (user_id, kind, xp) values (a, 'completion', 100000); ok := false;
  exception when others then ok := true; end;
  report := report || format(E'\n%s А не может начислить себе опыт', case when ok then 'OK ' else 'FAIL' end); fails := fails + (not ok)::int;
  begin insert into public.program_items (week, kind, title) values (1, 'lesson', 'взлом'); ok := false;
  exception when others then ok := true; end;
  report := report || format(E'\n%s А не может менять программу', case when ok then 'OK ' else 'FAIL' end); fails := fails + (not ok)::int;
  begin insert into public.admins (telegram_id) values (900000001); ok := false;
  exception when others then ok := true; end;
  report := report || format(E'\n%s А не может сделать себя админом', case when ok then 'OK ' else 'FAIL' end); fails := fails + (not ok)::int;
  begin insert into storage.objects (bucket_id, name, owner) values ('screenshots', b || '/x/evil.jpg', a); ok := false;
  exception when others then ok := true; end;
  report := report || format(E'\n%s А не может положить файл в папку Б', case when ok then 'OK ' else 'FAIL' end); fails := fails + (not ok)::int;

  execute 'reset role';

  -- ===== ученик Б: свой персональный пункт и пункты своего тарифа =====
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated',
    'app_metadata', json_build_object('telegram_id', 900000002))::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.program_items;              ok := n = 2;
  report := report || format(E'\n%s Б видит пункт своего тарифа и свой персональный (%s)', case when ok then 'OK ' else 'FAIL' end, n); fails := fails + (not ok)::int;
  execute 'reset role';

  -- ===== админ =====
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated',
    'app_metadata', json_build_object('telegram_id', 900000003))::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.profiles where id in (a, b); ok := n = 2;
  report := report || format(E'\n%s Админ видит обоих учеников (%s)', case when ok then 'OK ' else 'FAIL' end, n); fails := fails + (not ok)::int;
  select count(*) into n from public.insights;                   ok := n = 0;
  report := report || format(E'\n%s Админ не видит выводы учеников (%s)', case when ok then 'OK ' else 'FAIL' end, n); fails := fails + (not ok)::int;
  select count(*) into n from public.questions;                  ok := n = 0;
  report := report || format(E'\n%s Админ не видит вопросы учеников (%s)', case when ok then 'OK ' else 'FAIL' end, n); fails := fails + (not ok)::int;
  select count(*) into n from public.checkpoint_values;          ok := n >= 1;
  report := report || format(E'\n%s Админ видит цифры замеров (%s)', case when ok then 'OK ' else 'FAIL' end, n); fails := fails + (not ok)::int;
  select count(*) into n from storage.objects where bucket_id = 'screenshots' and (name like a || '/%' or name like b || '/%'); ok := n = 2;
  report := report || format(E'\n%s Админ видит файлы учеников (%s)', case when ok then 'OK ' else 'FAIL' end, n); fails := fails + (not ok)::int;
  select count(*) into n from public.admin_notes;                ok := n >= 1;
  report := report || format(E'\n%s Админ видит заметки (%s)', case when ok then 'OK ' else 'FAIL' end, n); fails := fails + (not ok)::int;
  update public.checkpoints set due_date = due_date + 1 where user_id = b and idx = 0; get diagnostics n = row_count; ok := n = 1;
  report := report || format(E'\n%s Админ сдвигает срок замера (%s)', case when ok then 'OK ' else 'FAIL' end, n); fails := fails + (not ok)::int;
  begin insert into public.program_items (week, kind, title) values (2, 'lesson', 'Урок от админа'); ok := true;
  exception when others then ok := false; end;
  report := report || format(E'\n%s Админ добавляет урок', case when ok then 'OK ' else 'FAIL' end); fails := fails + (not ok)::int;
  execute 'reset role';

  -- ===== гость без входа =====
  execute 'set local role anon';
  begin perform 1 from public.profiles limit 1; ok := false;
  exception when others then ok := true; end;
  report := report || format(E'\n%s Гость без входа ничего не читает', case when ok then 'OK ' else 'FAIL' end); fails := fails + (not ok)::int;
  execute 'reset role';

  -- сроки замеров создались по тарифу
  select count(*) into n from public.checkpoints where user_id = a; ok := n = 4;
  report := report || format(E'\n%s У Барбермаксера 4 замера (%s)', case when ok then 'OK ' else 'FAIL' end, n); fails := fails + (not ok)::int;
  select count(*) into n from public.checkpoints where user_id = b; ok := n = 5;
  report := report || format(E'\n%s У Лички 5 замеров (%s)', case when ok then 'OK ' else 'FAIL' end, n); fails := fails + (not ok)::int;

  raise exception 'RLS_REPORT fails=%:%', fails, report;
end $$;
