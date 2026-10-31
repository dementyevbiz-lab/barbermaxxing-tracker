#!/usr/bin/env bash
# Один раз: секреты для бота и расписание напоминаний. Секреты генерируются здесь и нигде не печатаются.
# Токен Management API подставляет прокси окружения. Повторный запуск перевыпускает секреты и расписание
set -euo pipefail
cd "$(dirname "$0")/.."
REF=nltremspmuuasksxbqtk; API=https://api.supabase.com/v1/projects/$REF
NOTIFY=$(python3 -c 'import secrets; print(secrets.token_hex(24))'); HOOK=$(python3 -c 'import secrets; print(secrets.token_hex(24))')
echo "== секреты функций"
python3 -c 'import json,sys; print(json.dumps([{"name":"NOTIFY_SECRET","value":sys.argv[1]},{"name":"BOT_WEBHOOK_SECRET","value":sys.argv[2]}]))' "$NOTIFY" "$HOOK" \
  | curl -sS --fail-with-body -X POST "$API/secrets" -H 'Content-Type: application/json' --data-binary @- ; echo
echo "== функции"; ./scripts/deploy.sh functions >/dev/null && echo ok
echo "== расписание"
SQL=$(cat <<SQLEOF
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.unschedule(jobid) from cron.job where jobname like 'bmx-%';
select cron.schedule('bmx-notify-daily', '0 5 * * *', \$\$select net.http_post(url := 'https://$REF.supabase.co/functions/v1/notify', headers := '{"Content-Type":"application/json","x-cron-secret":"$NOTIFY"}'::jsonb, body := '{"mode":"daily"}'::jsonb)\$\$);
select cron.schedule('bmx-notify-calls', '7 * * * *', \$\$select net.http_post(url := 'https://$REF.supabase.co/functions/v1/notify', headers := '{"Content-Type":"application/json","x-cron-secret":"$NOTIFY"}'::jsonb, body := '{"mode":"calls"}'::jsonb)\$\$);
select cron.schedule('bmx-keepalive', '17 4 * * 1,4', \$\$select 1\$\$);
SQLEOF
)
python3 -c 'import json,sys; print(json.dumps({"query":sys.argv[1]}))' "$SQL" | curl -sS --fail-with-body -X POST "$API/database/query" -H 'Content-Type: application/json' --data-binary @-; echo
echo "Готово. Вебхук бота ставится кнопкой в админке (Контент → Бот) или запросом action=setup к функции bot"
