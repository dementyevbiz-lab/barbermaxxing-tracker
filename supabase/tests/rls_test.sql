-- Проверка прав (RLS): ученик не видит чужих строк и файлов, админ не видит выводов и вопросов.
-- Всё в транзакции с откатом, в базе ничего не остаётся. Любая ошибка = тест не прошёл
begin;

-- Тестовые люди
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'rls-a@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'rls-b@example.com'),
  ('00000000-0000-0000-0000-0000000000ad', 'rls-admin@example.com');
insert into admins (telegram_id, name) values (900000003, 'rls admin');
insert into profiles (id, telegram_id, display_name, tariff_id, start_date, status, demo) values
  ('00000000-0000-0000-0000-00000000000a', 900000001, 'Ученик А', (select id from tariffs where code = 'barbermax'), current_date - 10, 'active', true),
  ('00000000-0000-0000-0000-00000000000b', 900000002, 'Ученик Б', (select id from tariffs where code = 'personal'), current_date - 10, 'active', true);
insert into insights (user_id, body) values
  ('00000000-0000-0000-0000-00000000000a', 'вывод А'), ('00000000-0000-0000-0000-00000000000b', 'вывод Б');
insert into questions (user_id, body) values ('00000000-0000-0000-0000-00000000000b', 'вопрос Б');
insert into goals (user_id, metric_key, a_value, b_value) values
  ('00000000-0000-0000-0000-00000000000a', 'avg_check', 1500, 2500), ('00000000-0000-0000-0000-00000000000b', 'avg_check', 2000, 3000);
insert into admin_notes (user_id, body) values ('00000000-0000-0000-0000-00000000000b', 'заметка');
insert into program_items (week, kind, title, tariffs) values
  (1, 'lesson', 'Только для Лички', '{personal}'),
  (1, 'lesson', 'Для всех', '{barbermax,personal}');
insert into program_items (week, kind, title, user_id) values (1, 'lesson', 'Персонально для Б', '00000000-0000-0000-0000-00000000000b');
insert into storage.objects (bucket_id, name) values
  ('screenshots', '00000000-0000-0000-0000-00000000000a/cp/1.jpg'),
  ('screenshots', '00000000-0000-0000-0000-00000000000b/cp/1.jpg');

-- Замеры созданы по тарифу: у Барбермаксера 4, у Лички 5
do $$ begin
  assert (select count(*) from checkpoints where user_id = '00000000-0000-0000-0000-00000000000a') = 4, 'замеры А';
  assert (select count(*) from checkpoints where user_id = '00000000-0000-0000-0000-00000000000b') = 5, 'замеры Б';
  assert (select due_date from checkpoints where user_id = '00000000-0000-0000-0000-00000000000a' and idx = 3)
         = current_date - 10 + 48, 'срок итогового замера = последний день 7-й недели';
end $$;

-- ===== Ученик А =====
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated","app_metadata":{"telegram_id":900000001}}', true);

do $$
declare n int;
begin
  assert not public.is_admin(), 'А не админ';
  assert (select count(*) from profiles) = 1, 'А видит только свой профиль';
  assert (select count(*) from insights) = 1, 'А видит только свой вывод';
  assert (select count(*) from questions) = 0, 'А не видит чужих вопросов';
  assert (select count(*) from goals) = 1, 'А видит только свои цели';
  assert (select count(*) from checkpoints where user_id <> auth.uid()) = 0 and (select count(*) from checkpoints) = 4, 'А видит только свои замеры';
  assert (select count(*) from admin_notes) = 0, 'А не видит заметок админа';
  assert (select count(*) from admins) = 0, 'А не видит список админов';
  assert (select count(*) from auth_attempts) = 0, 'А не видит попытки входа';
  assert (select count(*) from program_items where title in ('Только для Лички','Для всех','Персонально для Б')) = 1, 'А видит только пункты своего тарифа';
  assert (select count(*) from storage.objects where name like '00000000-0000-0000-0000-00000000000%') = 1, 'А видит только свои файлы';
  assert (select count(*) from tariffs) = 3, 'каталоги читаются';

  -- Чужое не меняется и не удаляется
  update insights set body = 'взлом' where user_id = '00000000-0000-0000-0000-00000000000b';
  get diagnostics n = row_count; assert n = 0, 'А не меняет чужой вывод';
  update profiles set display_name = 'взлом' where id = '00000000-0000-0000-0000-00000000000b';
  get diagnostics n = row_count; assert n = 0, 'А не меняет чужой профиль';
  delete from insights;
  get diagnostics n = row_count; assert n = 0, 'А ничего не удаляет физически';

  -- Своё можно
  update profiles set prefs = '{"currency":"KZT"}';
  get diagnostics n = row_count; assert n = 1, 'А меняет свои настройки';
  insert into video_logs (user_id, kind) values ('00000000-0000-0000-0000-00000000000a', 'client');

  -- Чужое не добавляется
  begin
    insert into insights (user_id, body) values ('00000000-0000-0000-0000-00000000000b', 'подброс');
    raise exception 'А смог записать вывод Б';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into storage.objects (bucket_id, name) values ('screenshots', '00000000-0000-0000-0000-00000000000b/cp/x.jpg');
    raise exception 'А смог положить файл в папку Б';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into xp_ledger (user_id, kind, xp) values ('00000000-0000-0000-0000-00000000000a', 'completion', 1000);
    raise exception 'А начислил себе опыт';
  exception when insufficient_privilege then null;
  end;
  begin
    update profiles set tariff_id = (select id from tariffs where code = 'personal');
    raise exception 'А сменил себе тариф';
  exception when insufficient_privilege then null;
  end;
  begin
    update checkpoints set due_date = due_date + 30 where idx = 1;
    raise exception 'А сдвинул срок замера';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Точка А закрывается после первого замера
update checkpoints set submitted_at = now() where idx = 0;
do $$ begin
  begin
    update goals set a_value = 100 where metric_key = 'avg_check';
    raise exception 'А поменял точку А после замера';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Подставной Telegram ID в токене не делает админом, если его нет в admins
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated","app_metadata":{"telegram_id":123}}', true);
do $$ begin assert not public.is_admin(), 'чужой ID не админ'; end $$;

-- ===== Админ =====
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000ad","role":"authenticated","app_metadata":{"telegram_id":900000003}}', true);
do $$
declare n int;
begin
  assert public.is_admin(), 'админ определяется по таблице admins';
  assert (select count(*) from profiles where id in ('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-00000000000b')) = 2, 'админ видит всех учеников';
  assert (select count(*) from insights) = 0, 'админ не видит выводы';
  assert (select count(*) from questions) = 0, 'админ не видит вопросы';
  assert (select count(*) from goals where user_id in ('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-00000000000b')) = 2, 'админ видит цели';
  assert (select count(*) from admin_notes where body = 'заметка') = 1, 'админ видит заметки';
  assert (select count(*) from program_items where title in ('Только для Лички','Для всех','Персонально для Б')) = 3, 'админ видит всю программу';
  assert (select count(*) from storage.objects where name like '00000000-0000-0000-0000-00000000000%') = 2, 'админ видит все скриншоты';
  update goals set a_value = 1600 where user_id = '00000000-0000-0000-0000-00000000000a';
  get diagnostics n = row_count; assert n = 1, 'админ меняет точку А';
  update checkpoints set due_date = due_date + 3, due_shifted = true where user_id = '00000000-0000-0000-0000-00000000000a' and idx = 1;
  get diagnostics n = row_count; assert n = 1, 'админ сдвигает срок';
  insert into program_items (week, kind, title) values (2, 'homework', 'Новая домашка');
  assert (select count(*) from audit_log where entity = 'program_items' and actor_telegram_id = 900000003 and after ->> 'title' = 'Новая домашка') = 1, 'правка попала в историю';
end $$;

reset role;
select 'RLS: все проверки пройдены' as result;
rollback;
