#!/usr/bin/env bash
# Roda os testes SQL do banco num Postgres DESCARTÁVEL (nunca no Supabase de verdade).
# Cria um banco temporário, simula o ambiente Supabase, aplica o legado + as migrations
# 0001..0012 e executa os cenários A–H e o teste de concorrência. Apaga o banco no fim.
# Uso: PGHOST=... PGPORT=... PGUSER=postgres bash supabase/tests/rodar.sh
set -u
AQUI=$(cd "$(dirname "$0")" && pwd); SUP=$(dirname "$AQUI")
DB=teste_condo_$$
psql -q -d postgres -tA -c "select 1" >/dev/null 2>&1 || { echo "Sem acesso ao Postgres de teste (defina PGHOST/PGPORT/PGUSER)."; exit 2; }
trap 'psql -q -d postgres -c "drop database if exists $DB" >/dev/null 2>&1' EXIT
psql -q -d postgres -c "create database $DB" || exit 2
P="psql -q -v ON_ERROR_STOP=1 -d $DB"
for r in anon authenticated; do psql -q -d $DB -c "do \$\$ begin create role $r nologin; exception when duplicate_object then null; end \$\$;" ; done
psql -q -d $DB -c "do \$\$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end \$\$;"
sed -e '/^create role/d' $AQUI/00_stub_supabase.sql | $P -f - || exit 3
$P -f $AQUI/legacy_schema.sql >/dev/null || exit 3
$P -f $AQUI/01_legado_seed.sql >/dev/null || exit 3
for f in $SUP/migrations/*.sql; do $P -f $f >/dev/null || { echo "FALHOU migration $(basename $f)"; exit 4; }; done
echo "migrations aplicadas: $(ls $SUP/migrations/*.sql | wc -l)"
SAIDA=$(psql -v ON_ERROR_STOP=1 -d $DB -f $AQUI/02_cenarios.sql 2>&1); RC=$?
NOK=$(echo "$SAIDA" | grep -c "NOTICE:  OK ")
NFALHA=$(echo "$SAIDA" | grep -cE "NOTICE:  (FALHA|FAIL)|ERROR:")
echo "cenários A–H: $NOK verificações OK, $NFALHA falhas"
[ $RC -ne 0 ] || [ "$NFALHA" -ne 0 ] && { echo "$SAIDA" | grep -E "FALHA|FAIL|ERROR" | head -20; echo "CENÁRIOS SQL FALHARAM"; exit 5; }
bash $AQUI/03_concorrencia.sh $DB || exit 6
echo "TESTES SQL OK"
