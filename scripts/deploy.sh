#!/usr/bin/env bash
# Выкладка в Supabase через Management API: миграции и функции.
# Токен Management API подставляет прокси окружения (или задайте SUPABASE_ACCESS_TOKEN).
# Запуск: scripts/deploy.sh [sql|functions|test|all]
set -euo pipefail
cd "$(dirname "$0")/.."
REF=nltremspmuuasksxbqtk
API=https://api.supabase.com/v1/projects/$REF
AUTH=()
[ -n "${SUPABASE_ACCESS_TOKEN:-}" ] && AUTH=(-H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN")

sql_file() { # выполнить SQL-файл
  python3 -c 'import json,sys; print(json.dumps({"query": open(sys.argv[1]).read()}))' "$1" \
    | curl -sS --fail-with-body "${AUTH[@]}" -X POST "$API/database/query" -H 'Content-Type: application/json' --data-binary @-
  echo
}

deploy_fn() { # выложить функцию вместе с общим кодом, без проверки JWT на входе (проверяем сами)
  local name=$1
  local files=()
  for f in supabase/functions/$name/*.ts supabase/functions/_shared/*.ts; do
    files+=(-F "file=@$f;filename=${f#supabase/functions/}")
  done
  curl -sS --fail-with-body "${AUTH[@]}" -X POST "$API/functions/deploy?slug=$name" \
    -F "metadata={\"name\":\"$name\",\"entrypoint_path\":\"$name/index.ts\",\"verify_jwt\":false};type=application/json" \
    "${files[@]}"
  echo
}

what=${1:-all}
if [ "$what" = sql ] || [ "$what" = all ]; then
  for f in supabase/migrations/*.sql; do echo "== $f"; sql_file "$f"; done
fi
if [ "$what" = functions ] || [ "$what" = all ]; then
  for n in tg-auth admin bot notify; do echo "== функция $n"; deploy_fn "$n"; done
fi
if [ "$what" = test ] || [ "$what" = all ]; then
  echo "== проверка прав"; sql_file supabase/tests/rls_test.sql
fi
