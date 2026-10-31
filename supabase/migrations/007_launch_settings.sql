-- Настройки запуска потока: старт у всех 2 ноября 2026, календарь выводов открыт до конца января 2027,
-- Базовичок скрыт из выбора (тариф заведён, но не продаётся), первый эфир первой недели
insert into settings (key, value) values ('calendar_until', '"2027-01-31"'), ('default_start_date', '"2026-11-02"') on conflict (key) do nothing;
update tariffs set features = features || '{"hidden": true}'::jsonb where code = 'basic';
insert into program_items (week, ord, kind, title, description, required, has_notes, tariffs)
select 1, 1, 'live', 'Первый эфир', 'Старт обучения 2 ноября', true, true, '{barbermax,personal}'
where not exists (select 1 from program_items where week = 1 and kind = 'live' and title = 'Первый эфир');
