-- Задачи на конкретный день: у пункта программы может быть дата. На «Сегодня» такие пункты идут в блоке «На сегодня»
alter table program_items add column if not exists on_date date;
update program_items set on_date = '2026-11-02' where title = 'Первый эфир' and week = 1 and kind = 'live' and on_date is null;
-- Цитаты со ссылками на источник и фильмы из подборки показываем сразу (заказчик просил увидеть). Правятся и снимаются в админке
update quotes set verified = true where verified = false and source is not null;
update movies set verified = true where verified = false;
-- Фильм показывается и без совпадения метки: по одному на неделю по кругу
insert into settings (key, value) values ('movies_fallback', 'true') on conflict (key) do nothing;
