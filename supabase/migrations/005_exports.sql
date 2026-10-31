-- В хранилище итогов разрешаем и JSON (экспорт своих данных ученика)
update storage.buckets set allowed_mime_types = array['application/pdf', 'application/json'] where id = 'exports';
