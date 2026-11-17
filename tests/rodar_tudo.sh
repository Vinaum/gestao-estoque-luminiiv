#!/usr/bin/env bash
# Roda TODOS os testes do front (e do banco, se houver Postgres de teste).
# Uso, na pasta do projeto:   bash tests/rodar_tudo.sh
# Requisitos: node 18+, python3 com playwright (e Chromium). Banco: PGHOST/PGPORT/PGUSER de um Postgres descartável (opcional).
cd "$(dirname "$0")/.." || exit 1
FALHAS=0; PASSOS=0
passo(){ PASSOS=$((PASSOS+1)); printf '\n=== %s\n' "$1"; shift; if "$@" >/tmp/passo_$$.log 2>&1; then echo "    OK  ($(tail -1 /tmp/passo_$$.log))"; else echo "    FALHOU"; tail -25 /tmp/passo_$$.log; FALHAS=$((FALHAS+1)); fi; }
passo "Auditoria estática de segurança" python3 tests/auditoria_estatica.py
for t in tests/*.test.mjs; do passo "Unidade: $(basename $t)" node "$t"; done
for t in tests/e2e_*.py; do [ "$(basename $t)" = e2e_comum.py ] && continue; passo "Navegador: $(basename $t)" python3 "$t"; done
passo "Navegador: e2e_painel.py (como gestor)" env PAPEL_TESTE=gestor python3 tests/e2e_painel.py
if psql -d postgres -tAc 'select 1' >/dev/null 2>&1; then passo "Banco: cenários A–H e concorrência" bash supabase/tests/rodar.sh
else printf '\n=== Banco: PULADO (sem Postgres de teste; defina PGHOST/PGPORT/PGUSER)\n'; fi
rm -f /tmp/passo_$$.log
printf '\n%s passos, %s falha(s)\n' "$PASSOS" "$FALHAS"; [ "$FALHAS" -eq 0 ] && echo "TUDO OK" || echo "HÁ FALHAS"; exit $((FALHAS>0))
