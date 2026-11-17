#!/usr/bin/env bash
# Concorrência: duas sessões tentam retirar 8 de um item com saldo 10.
# Resultado esperado: exatamente uma conclui, a outra recebe "Saldo insuficiente"; saldo final = 2.
# Uso: PGHOST=... PGPORT=... PGUSER=... bash 03_concorrencia.sh <banco_ja_com_migrations>
set -u
DB=${1:?informe o banco}
P="psql -v ON_ERROR_STOP=1 -q -t -A -d $DB"
$P <<'SQL' >/dev/null
insert into auth.users (id,email,email_confirmed_at) values ('00000000-0000-0000-0000-0000000000d1','conc@teste.com',now()) on conflict do nothing;
do $$ declare c uuid; i uuid; cat uuid; un uuid; begin
  select id into c from public.condominios order by criado_em limit 1;
  insert into public.membros (condominio_id,user_id,papel) values (c,'00000000-0000-0000-0000-0000000000d1','gestor') on conflict do nothing;
  select id into cat from categorias limit 1; select id into un from unidades_medida limit 1;
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000d1',true);
  insert into public.itens (condominio_id,nome,categoria_id,unidade_id,criado_por) values (c,'Conc',cat,un,'00000000-0000-0000-0000-0000000000d1') returning id into i;
  perform public.registrar_entrada_extraordinaria(i,10,'entrada_extraordinaria','Teste',gen_random_uuid());
end $$;
SQL
ITEM=$($P -c "select id from itens where nome='Conc'")
run(){ $P -c "select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000d1',false); set role authenticated; select count(*) from public.registrar_saida('$ITEM','consumo',8,'Conc',gen_random_uuid());" 2>&1 | tr '\n' ' '; echo; }
run > /tmp/conc1.txt & run > /tmp/conc2.txt & wait
cat /tmp/conc1.txt /tmp/conc2.txt
OK=$(cat /tmp/conc1.txt /tmp/conc2.txt | grep -c "Saldo insuficiente")
SALDO=$($P -c "select sum(saldo) from lotes where item_id='$ITEM'")
echo "saldo final: $SALDO | recusas: $OK"
[ "$SALDO" = "2" ] && [ "$OK" = "1" ] && echo "CONCORRÊNCIA OK" || { echo "CONCORRÊNCIA FALHOU"; exit 1; }
