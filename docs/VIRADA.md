# Roteiro da virada (NÃO executado)

Objetivo: a versão nova (`app/`) passa a ser a página principal e a antiga é aposentada. **Nada abaixo foi feito.** Só execute depois de decidir; a etapa 5 (remoção do legado) exige aprovação explícita à parte.

## Antes
1. `bash tests/rodar_tudo.sh` → TUDO OK.
2. Backup do banco (Supabase → Database → Backups) ou export das tabelas antigas.
3. Conferir no Supabase: **Confirm email** ligado; usuários reais com o papel certo (Administração → Usuários).
4. Rodar o diagnóstico de consistência (Administração) → 0 divergências.

## Passos
1. Criar uma branch: `git checkout -b virada`.
2. Mover o conteúdo de `app/` para a raiz; mover `vendor/` junto. Ajustar as duas referências relativas:
   - `index.html`: `../vendor/supabase-js-…` → `vendor/supabase-js-…`
   - `js/lib/grafico.js`: `../vendor/chart-…` → caminho equivalente a partir de `js/lib/`.
3. Mover os arquivos antigos (`index.html` antigo, `app.js`, `schema.sql`, etc.) para uma pasta `legado/` (não apagar ainda).
4. Testar: `APP_CAMINHO=. bash tests/rodar_tudo.sh` (os testes de navegador aceitam o caminho do app) e abrir o site publicado.
5. Mesclar a branch e conferir a página no GitHub Pages.

## Depois (somente com sua aprovação separada)
- Usar o sistema novo por um período (sugestão: 2 a 4 semanas) sem usar o antigo.
- Executar `supabase/pendentes/0099_remover_legado.sql`, que apaga as tabelas antigas. **Irreversível** sem backup.
- Remover `legado/` do repositório.

## Se algo der errado
Antes do 0099: voltar a branch (`git revert`) — o banco antigo continua intacto. Depois do 0099: só restaurando o backup.
