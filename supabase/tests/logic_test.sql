-- Проверка серверной логики: опыт, отмена, лимиты, ачивки, челлендж, защита от накрутки. Всё в транзакции с откатом
begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'l-a@example.com'), ('00000000-0000-0000-0000-0000000000b1', 'l-b@example.com');
insert into profiles (id, telegram_id, display_name, tariff_id, start_date, status, demo) values
  ('00000000-0000-0000-0000-0000000000a1', 910000001, 'А', (select id from tariffs where code = 'barbermax'), current_date - 40, 'active', true),
  ('00000000-0000-0000-0000-0000000000b1', 910000002, 'Б', (select id from tariffs where code = 'personal'), current_date - 40, 'active', true);

insert into program_items (id, week, ord, kind, title, est_minutes, has_notes) values
  ('10000000-0000-0000-0000-000000000001', 1, 1, 'lesson', 'Урок 30 минут', 30, true),
  ('10000000-0000-0000-0000-000000000002', 1, 2, 'live', 'Эфир без длительности', null, false),
  ('10000000-0000-0000-0000-000000000003', 1, 3, 'homework', 'Домашка', 40, false),
  ('10000000-0000-0000-0000-000000000009', 1, 4, 'lesson', 'Урок 200 минут', 200, false);
insert into program_items (id, week, ord, kind, title, xp) values
  ('10000000-0000-0000-0000-000000000004', 1, 5, 'short_task', 'Короткое', 20);
insert into program_items (id, week, ord, kind, title, xp, tags) values
  ('10000000-0000-0000-0000-000000000005', 5, 1, 'challenge_task', 'Задача 1', 7, '{quick_booking}'),
  ('10000000-0000-0000-0000-000000000006', 5, 2, 'challenge_task', 'Задача 2', 8, '{quick_booking}');
insert into program_items (id, week, ord, kind, title, tariffs) values
  ('10000000-0000-0000-0000-000000000007', 1, 6, 'lesson', 'Только Личка', '{personal}');
insert into program_items (id, week, ord, kind, title, user_id) values
  ('10000000-0000-0000-0000-000000000008', 1, 7, 'lesson', 'Персонально Б', '00000000-0000-0000-0000-0000000000b1');
update challenges set active = true where code = 'quick_booking';

create or replace function public.t_xp(p_user uuid, p_kind text default null) returns int language sql security definer as $$
  select coalesce(sum(xp), 0)::int from xp_ledger where user_id = p_user and undone_at is null and (p_kind is null or kind = p_kind)
$$;
grant execute on function public.t_xp(uuid, text) to authenticated;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","app_metadata":{"telegram_id":910000001}}', true);

do $$
declare
  a constant uuid := '00000000-0000-0000-0000-0000000000a1';
  c1 uuid; c2 uuid; c3 uuid; cp uuid; s1 uuid; s2 uuid; s3 uuid; v1 uuid; n int;
begin
  -- Уроки: 30 мин = 10 опыта, без длительности 10, 200 мин = максимум 30, домашка 30, короткое по полю 20
  insert into completions (user_id, item_id) values (a, '10000000-0000-0000-0000-000000000001') returning id into c1;
  insert into completions (user_id, item_id) values (a, '10000000-0000-0000-0000-000000000002');
  insert into completions (user_id, item_id) values (a, '10000000-0000-0000-0000-000000000009');
  insert into completions (user_id, item_id) values (a, '10000000-0000-0000-0000-000000000003') returning id into c2;
  insert into completions (user_id, item_id) values (a, '10000000-0000-0000-0000-000000000004');
  assert public.t_xp(a, 'completion') = 10 + 10 + 30 + 30 + 20, 'опыт за отметки: ' || public.t_xp(a, 'completion');

  -- Конспект
  insert into completions (user_id, item_id, kind) values (a, '10000000-0000-0000-0000-000000000001', 'notes');
  assert public.t_xp(a, 'notes') = 10, 'конспект 10';
  begin
    insert into completions (user_id, item_id, kind) values (a, '10000000-0000-0000-0000-000000000003', 'notes');
    raise exception 'конспект к пункту без конспекта прошёл';
  exception when insufficient_privilege then null; end;

  -- Повторная отметка того же пункта невозможна
  begin
    insert into completions (user_id, item_id) values (a, '10000000-0000-0000-0000-000000000003');
    raise exception 'дубль отметки прошёл';
  exception when unique_violation then null; end;

  -- Отмена возвращает опыт, повторная отметка начисляет снова
  update completions set undone_at = now() where id = c2;
  assert public.t_xp(a, 'completion') = 100 - 30, 'отмена вернула опыт';
  insert into completions (user_id, item_id) values (a, '10000000-0000-0000-0000-000000000003');
  assert public.t_xp(a, 'completion') = 100, 'повторная отметка';

  -- Накрутка: чужой тариф, чужой персональный пункт, подмена пункта, подмена владельца
  begin
    insert into completions (user_id, item_id) values (a, '10000000-0000-0000-0000-000000000007'); raise exception 'пункт чужого тарифа прошёл';
  exception when insufficient_privilege then null; end;
  begin
    insert into completions (user_id, item_id) values (a, '10000000-0000-0000-0000-000000000008'); raise exception 'персональный пункт Б прошёл';
  exception when insufficient_privilege then null; end;
  begin
    update completions set item_id = '10000000-0000-0000-0000-000000000004' where id = c1; raise exception 'подмена пункта прошла';
  exception when insufficient_privilege then null; end;
  begin
    perform public.recalc_all(a); raise exception 'прямой вызов recalc_all прошёл';
  exception when insufficient_privilege then null; end;
  begin
    perform public.ledger_add(a, 'completion', gen_random_uuid(), 999); raise exception 'прямой вызов ledger_add прошёл';
  exception when insufficient_privilege then null; end;

  -- Ачивки за уроки: 3 урока = бронза «Уроки» (+10)
  assert exists (select 1 from user_achievements where user_id = a and code = 'lessons' and tier = 1 and revoked_at is null), 'ачивка Уроки';
  update completions set undone_at = now() where id = c1;
  assert exists (select 1 from user_achievements where user_id = a and code = 'lessons' and tier = 1 and revoked_at is not null), 'ачивка снята при отмене';
  assert public.t_xp(a, 'achievement') = (select coalesce(sum((e ->> 'xp')::int), 0) from user_achievements ua join achievements x on x.code = ua.code,
     lateral jsonb_array_elements(x.tiers) e where ua.user_id = a and ua.revoked_at is null and (e ->> 'tier')::int = ua.tier), 'опыт ачивок = живые ступени';

  -- Видео: опыт только за 3 в день, отмена, ачивка
  for n in 1..4 loop
    insert into video_logs (user_id, kind) values (a, (array['client', 'expert', 'life', 'client'])[n]) returning id into v1;
  end loop;
  assert public.t_xp(a, 'video') = 45, 'видео: 3 в день, было ' || public.t_xp(a, 'video');
  assert exists (select 1 from user_achievements where user_id = a and code = 'three_directions' and tier = 1), 'ачивка Три направления';
  update video_logs set undone_at = now() where user_id = a;
  assert public.t_xp(a, 'video') = 0, 'отмена видео';
  assert not exists (select 1 from user_achievements where user_id = a and code in ('first_video', 'three_directions') and revoked_at is null), 'ачивки видео сняты';
  begin
    insert into video_logs (user_id, kind, logged_on) values (a, 'client', current_date - 45); raise exception 'старая дата прошла';
  exception when datetime_field_overflow then null; end;

  -- Выводы: 5 за вывод, не больше 3 в день, корзина возвращает и отнимает
  for n in 1..4 loop insert into insights (user_id, body) values (a, 'вывод ' || n); end loop;
  assert public.t_xp(a, 'insight') = 15, 'выводы 3 в день';
  update insights set deleted_at = now() where user_id = a and body = 'вывод 1';
  assert public.t_xp(a, 'insight') = 10, 'вывод в корзине';
  update insights set deleted_at = null where user_id = a and body = 'вывод 1';
  assert public.t_xp(a, 'insight') = 15, 'вывод восстановлен';

  -- Замер: отправка 40, скриншоты 3+ = бонус 10, удаление скриншота снимает бонус
  select id into cp from checkpoints where user_id = a and idx = 1;
  begin
    insert into screenshots (user_id, checkpoint_id, kind, storage_path) values (a, cp, 'other', '00000000-0000-0000-0000-0000000000b1/x/1.jpg');
    raise exception 'чужая папка прошла';
  exception when insufficient_privilege then null; end;
  insert into screenshots (user_id, checkpoint_id, kind, storage_path) values (a, cp, 'video_1', a || '/' || cp || '/1.jpg') returning id into s1;
  insert into screenshots (user_id, checkpoint_id, kind, storage_path) values (a, cp, 'video_2', a || '/' || cp || '/2.jpg');
  insert into screenshots (user_id, checkpoint_id, kind, storage_path) values (a, cp, 'video_3', a || '/' || cp || '/3.jpg');
  assert public.t_xp(a, 'screenshots') = 0, 'бонус только после отправки';
  update checkpoints set submitted_at = now() where id = cp;
  assert public.t_xp(a, 'checkpoint') = 40, 'замер 40';
  assert public.t_xp(a, 'screenshots') = 10, 'бонус за скриншоты';
  update screenshots set deleted_at = now() where id = s1;
  assert public.t_xp(a, 'screenshots') = 0, 'бонус снят';
  update screenshots set deleted_at = null where id = s1;
  assert public.t_xp(a, 'screenshots') = 10, 'бонус вернулся';
  begin
    update checkpoints set submitted_at = null where id = cp; raise exception 'откат отправки прошёл';
  exception when insufficient_privilege then null; end;
  insert into checkpoint_values (checkpoint_id, metric_key, value) values (cp, 'avg_check', 1000);
  update checkpoint_values set value = 1200 where checkpoint_id = cp and metric_key = 'avg_check';
  assert (select jsonb_array_length(history) from checkpoint_values where checkpoint_id = cp) = 1, 'история значений';

  -- Челлендж: обе задачи = награда и опыт, отмена одной снимает
  insert into completions (user_id, item_id) values (a, '10000000-0000-0000-0000-000000000005');
  assert not exists (select 1 from challenge_results where user_id = a and completed_at is not null), 'не всё сделано';
  insert into completions (user_id, item_id) values (a, '10000000-0000-0000-0000-000000000006') returning id into c3;
  assert (select reward_status from challenge_results where user_id = a) = 'earned', 'награда получена';
  assert public.t_xp(a, 'challenge') = 300, 'опыт за челлендж';
  update completions set undone_at = now() where id = c3;
  assert (select reward_status from challenge_results where user_id = a) = 'none', 'награда снята';
  assert public.t_xp(a, 'challenge') = 0, 'опыт челленджа снят';

  -- Опыт и ачивки писать нельзя
  begin insert into xp_ledger (user_id, kind, xp) values (a, 'completion', 5); raise exception 'ledger прошёл';
  exception when insufficient_privilege then null; end;
  begin insert into user_achievements (user_id, code, tier) values (a, 'notes', 4); raise exception 'ачивка прошла';
  exception when insufficient_privilege then null; end;
end $$;

-- Недели открываются по очереди: будущая неделя недоступна и ученику, и для отметки
do $$
declare a constant uuid := '00000000-0000-0000-0000-0000000000a1'; n int;
begin
  reset role;
  insert into program_items (id, week, ord, kind, title, xp, tariffs) values
    ('10000000-0000-0000-0000-0000000000f1', 0, 1, 'material', 'Материал модуля 0', 80, '{barbermax}'),
    ('10000000-0000-0000-0000-0000000000f2', 9, 1, 'lesson', 'Будущая неделя', 10, '{barbermax}');
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","app_metadata":{"telegram_id":910000001}}', true);
  assert (select count(*) from program_items where id = '10000000-0000-0000-0000-0000000000f1') = 1, 'модуль 0 виден';
  assert (select count(*) from program_items where id = '10000000-0000-0000-0000-0000000000f2') = 0, 'будущая неделя скрыта';
  insert into completions (user_id, item_id) values (a, '10000000-0000-0000-0000-0000000000f1');
  assert public.t_xp(a, 'completion') = (select coalesce(sum(xp), 0) from xp_ledger where user_id = a and kind = 'completion' and undone_at is null), 'считается';
  assert (select coalesce(sum(xp), 0) from xp_ledger where user_id = a and kind = 'completion' and undone_at is null and ref_id = (select id from completions where item_id = '10000000-0000-0000-0000-0000000000f1' and user_id = a)) = 80, 'материал даёт опыт из поля xp';
  begin
    insert into completions (user_id, item_id) values (a, '10000000-0000-0000-0000-0000000000f2'); raise exception 'отметка будущей недели прошла';
  exception when insufficient_privilege or foreign_key_violation then null; end;
end $$;

-- Ученик Б не видит ничего из этого
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated","app_metadata":{"telegram_id":910000002}}', true);
do $$
declare b constant uuid := '00000000-0000-0000-0000-0000000000b1';
begin
  assert (select count(*) from xp_ledger) = 0, 'Б не видит чужой опыт';
  assert (select count(*) from completions) = 0 and (select count(*) from video_logs) = 0 and (select count(*) from insights) = 0, 'Б не видит чужие отметки';
  assert (select count(*) from program_items where title like 'Только Личка') = 1, 'Б видит пункт своего тарифа';
  assert (select count(*) from program_items where title = 'Персонально Б') = 1, 'Б видит свой персональный пункт';
end $$;

reset role;
select 'логика: все проверки пройдены' as result;
rollback;
