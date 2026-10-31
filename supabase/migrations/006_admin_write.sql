-- Админ меняет точку А и значения замеров ученика, добавляет цели
create policy goals_admin_all on goals for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy cpv_admin_all on checkpoint_values for all to authenticated using (public.is_admin()) with check (public.is_admin());
-- Скриншоты: админ читает все (политика уже есть), правит тип и удаление
create policy screenshots_admin_update on screenshots for update to authenticated using (public.is_admin()) with check (public.is_admin());
-- Итоги и заметки к замерам
grant select, insert, update, delete on all tables in schema public to authenticated;
revoke all on notifications from authenticated, anon;
