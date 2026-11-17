# Mapa de testes

Tudo roda com `bash tests/rodar_tudo.sh`. Nenhum teste altera o Supabase real.

## Banco (`supabase/tests/`, Postgres descartável)
Execução: `PGHOST=… PGPORT=… PGUSER=postgres bash supabase/tests/rodar.sh`. O script cria um banco temporário, simula o Supabase (`00_stub_supabase.sql`), carrega dados do modelo antigo (`legacy_schema.sql` + `01_legado_seed.sql`), aplica as 15 migrations, roda os cenários e apaga o banco.

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
| Convites | Síndico cancela e altera convites comuns; e-mail cancelado pode ser convidado de novo e quem criar conta depois não entra; gestor, morador e síndico de outro condomínio são bloqueados; convite de síndico só o superadmin gerencia; convite já usado não muda; nada se apaga direto na tabela; tudo fica na auditoria |
| Permissões do gestor | Cadastra e edita fornecedor, mas não ativa/desativa (nem cria já inativo) nem apaga; vê as mesmas compras, gastos e custos que o síndico; continua sem aprovar; morador não vê compras, gastos nem fornecedores |
| Comunicados | Rascunho/publicado/arquivado; só síndico e gestor escrevem; morador vê só publicado, dentro da validade e do seu público (torre); validade no passado recusada; "editado em" só ao mudar título/texto de publicado; anexo só no caminho do próprio comunicado; leitura marcada uma vez e só para quem é do público; "quem leu" só para a equipe; bucket privado com leitura restrita a quem vê o comunicado; auditoria |
| Prestadores | Tabelas fechadas (só funções leem); indicação pendente, telefone só com dígitos, validações; apartamento obrigatório (exceto síndico); limite de 5 pendentes; telefone repetido (publicado: sugere recomendar; pendente: recusa); quem vê pendentes, recusados e removidos; só o síndico decide; recusa exige motivo; edição pelo autor e volta a pendente; recomendar uma vez, atualizar comentário, não recomendar a própria indicação nem pendente/removido; síndico limpa comentário; unidade de quem indicou e recomendou; outro condomínio bloqueado; auditoria |
| Torres e apartamentos | Lote de torres e geração de apartamentos (numeração 01–04, 11–14… e 6 por andar), sem duplicar ao repetir; limites e entradas inválidas; só o síndico escreve; gestor e morador só leem; síndico de outro condomínio bloqueado; apartamento de outro condomínio recusado pela função **e** pela própria tabela; vínculo de morador e de convite; convite leva o apartamento ao criar a conta; não desativa torre ou apartamento com gente vinculada; auditoria |
| Concorrência | Duas retiradas simultâneas de 8 sobre saldo 10: uma passa, outra é recusada, saldo final 2 |

## Front — unidade (`tests/*.test.mjs`)
`html` (escape e `h`), `comunicados` (ordenação, validade, validações), `prestadores` (telefone, busca, abas), `validacao` (CNPJ, e-mail), `painel` (cálculos), `auditoria` (formatação do histórico), `relatorios` (consumo e gastos).

## Front — navegador (`tests/e2e_*.py`)
Playwright com Supabase simulado por interceptação de rede e sessão falsa.
`menu` (menu e tela inicial de cada papel), `torres` (cadastro de torres e apartamentos), `comunicados` (lista, leitura, editor, anexo, quem leu), `prestadores` (indicar, recomendar, aprovação do síndico), `operacao`, `config` (mínimo/ideal), `compras` (editor, aprovação, recebimento), `painel`, `relatorios`, `admin` (condomínios, usuários, diagnóstico).

## Contratos com o banco real
`tests/payloads_reais.sql` (o banco aceita exatamente o que o front envia), `colunas_views.sql` (colunas usadas existem) e `painel_vs_banco.*` (números do painel batem com somas SQL). Rodam sob demanda, contra um banco com as migrations aplicadas.

## Auditoria estática (`tests/auditoria_estatica.py`)
Falha se houver: segredo ou `service_role` no código; `eval`/`new Function`/`document.write`; atributos `onclick=` em linha; `innerHTML` com conteúdo não fixo; HTML com `${}` fora de `h```; script externo; CSP frouxa; biblioteca em `vendor/` diferente do `SHA256SUMS`; `.gitignore` sem `.env`; migration com `drop`/`truncate` fora de `pendentes/`.

## Não coberto automaticamente
Comportamento do Supabase em produção (envio de e-mail de convite, Storage de notas fiscais, tempo real) — verificado manualmente pelo usuário nas fases 3 e 4.
