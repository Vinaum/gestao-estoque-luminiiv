# Fase 4e — Painel do síndico
Copie por cima de `app/` e `tests/`. Sem migrations novas.
Novos: modules/painel (painel.js, calculos.js).
Testes: node tests/painel.test.mjs · python3 tests/e2e_painel.py
Conferência com o banco: tests/painel_vs_banco.sql (monta cenário, exporta as views) + painel_vs_banco.mjs (compara com somas em SQL).
