# Mapa de testes

Tudo roda com `bash tests/rodar_tudo.sh`. Nenhum teste altera o Supabase real.

## Banco (`supabase/tests/`, Postgres descartável)
Execução: `PGHOST=… PGPORT=… PGUSER=postgres bash supabase/tests/rodar.sh`. O script cria um banco temporário, simula o Supabase (`00_stub_supabase.sql`), carrega dados do modelo antigo (`legacy_schema.sql` + `01_legado_seed.sql`), aplica as 12 migrations, roda os cenários e apaga o banco.

| Cenário | O que garante |
|---|---|
| Preparação | Migração do modelo antigo para o novo; criação de um segundo condomínio (B) |
| A | Item novo sem lotes: status correto, estoque 0, quantidade sugerida (não é necessidade confirmada) |
| B | Gestor envia compra para aprovação; compra registrada **não** altera estoque; gestor não aprova; compra não aprovada não é recebida; síndico aprova; repetir a mesma operação não duplica o recebimento |
| C/D | Chave repetida não duplica saída; estoque e saldo do lote; status "Comprar" e sugestão (ideal − atual) |
| E | Estoque só muda no recebimento; quantidade "em pedido" zera depois; status volta a Normal |
| F | Recebimento parcial em vários lotes; saída por FEFO e por FIFO; doação registrada como doação |
| G | Perda/descarte; saída acima do saldo e quantidade zero recusadas; ajuste exige justificativa e cria lote de origem "ajuste"; estorno único e com justificativa; recebimento de compra não se estorna; saldo nunca negativo; diagnóstico de consistência (só superadmin) |
| Parâmetros e relatórios | Histórico de mínimo/ideal, vencimentos, cobertura e gastos |
| Compras | Edição, mudança de status e nota fiscal |
| H | Segurança: gestor não altera papéis, não convida, não escreve direto em lotes/movimentações/compras, não apaga movimentação nem troca o condomínio de um item; isolamento entre condomínios; morador só lê catálogos; síndico lê a auditoria do próprio condomínio; superadmin vê os dois condomínios |
| Concorrência | Duas retiradas simultâneas de 8 sobre saldo 10: uma passa, outra é recusada, saldo final 2 |

## Front — unidade (`tests/*.test.mjs`)
`html` (escape e `h`), `validacao` (CNPJ, e-mail), `painel` (cálculos), `auditoria` (formatação do histórico), `relatorios` (consumo e gastos).

## Front — navegador (`tests/e2e_*.py`)
Playwright com Supabase simulado por interceptação de rede e sessão falsa.
`menu` (menu e tela inicial de cada papel), `operacao`, `config` (mínimo/ideal), `compras` (editor, aprovação, recebimento), `painel`, `relatorios`, `admin` (condomínios, usuários, diagnóstico).

## Contratos com o banco real
`tests/payloads_reais.sql` (o banco aceita exatamente o que o front envia), `colunas_views.sql` (colunas usadas existem) e `painel_vs_banco.*` (números do painel batem com somas SQL). Rodam sob demanda, contra um banco com as migrations aplicadas.

## Auditoria estática (`tests/auditoria_estatica.py`)
Falha se houver: segredo ou `service_role` no código; `eval`/`new Function`/`document.write`; atributos `onclick=` em linha; `innerHTML` com conteúdo não fixo; HTML com `${}` fora de `h```; script externo; CSP frouxa; biblioteca em `vendor/` diferente do `SHA256SUMS`; `.gitignore` sem `.env`; migration com `drop`/`truncate` fora de `pendentes/`.

## Não coberto automaticamente
Comportamento do Supabase em produção (envio de e-mail de convite, Storage de notas fiscais, tempo real) — verificado manualmente pelo usuário nas fases 3 e 4.
