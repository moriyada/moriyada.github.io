#!/usr/bin/env bash
# Runs the database policy tests against a throwaway local Postgres (16+).
#   bash tests/dayari/run-sql-tests.sh
# Builds a temporary database, loads a small Supabase stand-in (supabase-stub.sql), runs
# every sql/ file in order TWICE (they must be safe to re-run), then sql-tests.sql.
set -euo pipefail
cd "$(dirname "$0")/../.."
BIN=$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)
[ -n "$BIN" ] || BIN=$(dirname "$(command -v pg_ctl)")
DIR=$(mktemp -d)
RUN_AS=()
if [ "$(id -u)" = 0 ]; then chown postgres "$DIR"; RUN_AS=(runuser -u postgres --); fi
"${RUN_AS[@]}" "$BIN/initdb" -D "$DIR/db" -A trust -U postgres >/dev/null
"${RUN_AS[@]}" "$BIN/pg_ctl" -D "$DIR/db" -o "-p 54329 -k $DIR -c listen_addresses=''" -l "$DIR/log" start >/dev/null
trap '"${RUN_AS[@]}" "$BIN/pg_ctl" -D "$DIR/db" stop -m fast >/dev/null; rm -rf "$DIR"' EXIT
PSQL=(psql -h "$DIR" -p 54329 -U postgres -d postgres -v ON_ERROR_STOP=1 -q -X)
"${PSQL[@]}" -f tests/dayari/supabase-stub.sql
for pass in 1 2; do
  for f in sql/setup.sql $(ls sql/0*.sql | sort); do
    "${PSQL[@]}" -f "$f" >/dev/null 2>"$DIR/err" || { echo "FAILED loading $f (pass $pass)"; cat "$DIR/err"; exit 1; }
  done
done
"${PSQL[@]}" -f tests/dayari/sql-tests.sql
