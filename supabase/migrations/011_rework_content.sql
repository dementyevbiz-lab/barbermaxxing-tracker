-- По замечаниям заказчика:
-- 1) убраны мои короткие задания и задачи челленджа: инструкции даёт только преподаватель
-- 2) убраны абстрактные цитаты философов и пословицы, оставлены и добавлены конкретные: клиент, цена, контент, дисциплина
-- 3) ачивки открываются постепенно: порядок ord
-- 4) видео можно записать задним числом (до 30 дней назад), просмотры и заметку можно добавить позже

-- 1
create temp table _drop_items on commit drop as
  select id from program_items where user_id is null and ((kind = 'short_task' and ord between 101 and 121) or (kind = 'challenge_task' and ord between 201 and 207));
delete from xp_ledger where kind in ('completion', 'notes') and ref_id in (select id from completions where item_id in (select id from _drop_items));
delete from completions where item_id in (select id from _drop_items);
delete from program_items where id in (select id from _drop_items);
delete from challenge_results;
delete from xp_ledger where kind = 'challenge';
update challenges set rules = null, active = false where code = 'quick_booking';

-- 2
delete from quotes where author in ('Сенека','Марк Аврелий','Эпиктет','Гиппократ','Плиний Старший','Гораций','Овидий','Вергилий','Сократ','Аристотель','Конфуций','Лао-цзы',
  'Фрэнсис Бэкон','Вольтер','Блез Паскаль','Бальтасар Грасиан','Уильям Шекспир','Иоганн Гёте','Лев Толстой','Козьма Прутков','Антуан де Сент-Экзюпери','Сэмюэл Беккет',
  'Фридрих Ницше','Борис Пастернак','Эрнест Хемингуэй','Константин Станиславский','Генри Торо','Исаак Ньютон','Иван Павлов','Миямото Мусаси','Николай Островский',
  'Октавиан Август','Цицерон','Мишель де Монтень','Артур Шопенгауэр','Русская пословица','Японская пословица','Сэмюэл Джонсон')
  or text in ('Кто умеет терпеть, получит что хочет','Или пиши то, что стоит прочесть, или делай то, о чём стоит написать','Любишь жизнь? Тогда не трать время впустую: из него она сделана',
              'Заслуга принадлежит тому, кто на арене: чьё лицо покрыто пылью, потом и кровью','Краткость — сестра таланта');
insert into quotes (text, author, source, verified, tags)
select * from (values
 ('Мы — леди и джентльмены, обслуживающие леди и джентльменов', 'Девиз Ritz-Carlton', 'Кредо сети отелей Ritz-Carlton', true, '{booking_low}'::text[]),
 ('Мы будем неустанно сосредоточены на клиентах', 'Джефф Безос', 'Письмо акционерам Amazon, 1997', true, '{booking_low}'::text[]),
 ('Начинать нужно с опыта клиента и двигаться к технологии', 'Стив Джобс', 'Выступление на WWDC, 1997', true, '{booking_low}'::text[]),
 ('Простое сделать труднее, чем сложное: нужно упорно работать, чтобы мысли стали чистыми', 'Стив Джобс', 'Интервью Businessweek, 1998', true, '{video_views_low}'::text[]),
 ('Делайте то, что не масштабируется', 'Пол Грэм', 'Эссе «Do Things That Don''t Scale», 2013', true, '{booking_low}'::text[]),
 ('Если нужно съесть двух лягушек, начни с самой страшной', 'Брайан Трейси', 'Съешь лягушку, 2001', true, '{homework_overdue,no_actions_3d}'::text[]),
 ('Создай, измерь, узнай', 'Эрик Рис', 'Бизнес с нуля, 2011', true, '{no_checkpoint,metric_flat}'::text[]),
 ('Хотите собрать мёд, не пинайте улей', 'Дейл Карнеги', 'Как завоёвывать друзей и оказывать влияние на людей, 1936', true, '{booking_low}'::text[]),
 ('Критика бесполезна: она заставляет человека защищаться и обычно заставляет его оправдываться', 'Дейл Карнеги', 'Как завоёвывать друзей и оказывать влияние на людей, 1936', true, '{booking_low}'::text[]),
 ('Привычки — это сложный процент самосовершенствования', 'Джеймс Клир', 'Атомные привычки, 2018', true, '{no_actions_3d,metric_flat}'::text[]),
 ('Если становиться лучше на один процент каждый день, за год станешь лучше примерно в тридцать семь раз', 'Джеймс Клир', 'Атомные привычки, 2018', true, '{metric_flat,no_actions_3d}'::text[]),
 ('Сначала старайся понять, потом быть понятым', 'Стивен Кови', '7 навыков высокоэффективных людей, 1989', true, '{booking_low}'::text[])
) v(text, author, source, verified, tags)
where not exists (select 1 from quotes q where q.text = v.text);

-- 3
alter table achievements add column if not exists ord int not null default 100;
update achievements set ord = case code
  when 'first_video' then 1 when 'lessons' then 2 when 'checkpoints' then 3 when 'homework' then 4 when 'notes' then 5
  when 'insights' then 6 when 'three_directions' then 7 when 'questions' then 8 when 'quick_booking' then 9 else ord end;

-- 4
create or replace function public.video_logs_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    if tg_op = 'INSERT' and new.logged_on not between current_date - 30 and current_date + 1 then
      raise exception 'Дата видео вне допустимого окна' using errcode = '22008';
    end if;
    if tg_op = 'UPDATE' and (to_jsonb(new) - 'views' - 'note' - 'undone_at') is distinct from (to_jsonb(old) - 'views' - 'note' - 'undone_at') then
      raise exception 'Можно менять только просмотры и заметку' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.video_logs_before() from public, anon, authenticated;
