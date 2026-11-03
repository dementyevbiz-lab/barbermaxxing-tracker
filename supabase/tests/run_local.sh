#!/usr/bin/env bash
# Локальная проверка на чистом Postgres: заглушки Supabase, миграции, тесты. Нужен запущенный кластер (pg_ctlcluster 16 main start)
set -euo pipefail
cd "$(dirname "$0")/.."
su postgres -c "dropdb --if-exists bmx; createdb bmx"
cat tests/local_stub.sql migrations/*.sql | su postgres -c "psql -v ON_ERROR_STOP=1 -q -d bmx" 2>&1 | grep -v NOTICE || true
for t in tests/rls_test.sql tests/logic_test.sql tests/leaderboard_test.sql; do
  [ -f "$t" ] || continue
  echo "== $t"; su postgres -c "psql -v ON_ERROR_STOP=1 -q -d bmx" < "$t" 2>&1 | grep -E 'ERROR|пройдены|CONTEXT' || true
done
