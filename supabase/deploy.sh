#!/usr/bin/env bash
# Развёртывание в Supabase через Management API.
# Токен не нужен в коде: в облачной сессии его подставляет прокси (сетевой секрет окружения).
# Локально можно задать SUPABASE_ACCESS_TOKEN.
#   ./supabase/deploy.sh sql supabase/migrations/001_schema.sql   — выполнить SQL-файл
#   ./supabase/deploy.sh fn auth                                  — выложить функцию
#   ./supabase/deploy.sh check                                    — проверка прав (RLS) на живой базе, данные откатываются
set -euo pipefail
REF=nltremspmuuasksxbqtk
API=https://api.supabase.com/v1/projects/$REF
DIR="$(cd "$(dirname "$0")" && pwd)"
AUTH=()
[ -n "${SUPABASE_ACCESS_TOKEN:-}" ] && AUTH=(-H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN")

sql() {
  python3 -c 'import json,sys; print(json.dumps({"query": open(sys.argv[1]).read()}))' "$1" |
    curl -sS "${AUTH[@]}" -X POST "$API/database/query" -H 'Content-Type: application/json' --data-binary @-
  echo
}

case "${1:-}" in
  sql) sql "$2" ;;
  fn)
    curl -sS "${AUTH[@]}" -X POST "$API/functions/deploy?slug=$2" \
      -F "metadata={\"entrypoint_path\":\"index.ts\",\"name\":\"$2\",\"verify_jwt\":false};type=application/json" \
      -F "file=@$DIR/functions/$2/index.ts;filename=index.ts"
    echo ;;
  check) sql "$DIR/tests/rls_check.sql" | python3 -c 'import sys; print(sys.stdin.read().replace("\\n", "\n"))' ;;
  *) echo "usage: $0 sql <file> | fn <name> | check"; exit 1 ;;
esac
