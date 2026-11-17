# Banco de dados — Fase 3 (nova estrutura)

Pasta `migrations/`: rode **um arquivo por vez, em ordem**, no Supabase > SQL Editor.
Cada arquivo pode ser repetido sem estragar nada.

| Ordem | Arquivo | O que faz |
|---|---|---|
| 1 | 0001_base | Base e funções auxiliares |
| 2 | 0002_tenancy | Condomínios, papéis, convites (**migra os usuários atuais para o novo modelo**) |
| 3 | 0003_catalogos | Categorias e unidades |
| 4 | 0004_fornecedores | Fornecedores |
| 5 | 0005_itens | Itens (sem coluna de estoque) |
| 6 | 0006_compras | Compras e itens da compra |
| 7 | 0007_estoque | Recebimentos, lotes, movimentações (imutáveis) |
| 8 | 0008_funcoes | Operações: saída, entrada, ajuste, estorno, compra, aprovação, recebimento, convites |
| 9 | 0009_views | Painéis: estoque, vencimentos, gastos, cobertura |
| 10 | 0010_auditoria | Histórico de alterações |
| 11 | 0011_rls | Regras de acesso por papel |
| 12 | 0012_storage | Notas fiscais (bucket privado) |

`pendentes/0099_remover_legado.sql` **não deve ser rodado** sem aprovação separada: apaga o modelo antigo.

## Importante
- O app atual (etapa 2.5) continua funcionando; a troca de tela é a Fase 4.
- Depois do 0011, **moradores deixam de ler o estoque antigo** (de propósito).
- Mantenha **Confirm email** ligado (Authentication > Providers > Email): convites só valem com e-mail confirmado.
- Recebimentos de compra não são estornáveis; para corrigir, use **ajuste** com justificativa.
- Só o superadmin define síndico; só o síndico aprova compras.

## Testes (rodam em Postgres local, nada é salvo)
- Tudo de uma vez: `PGHOST=… PGPORT=… PGUSER=postgres bash tests/rodar.sh` (cria um banco temporário e apaga no fim).
- `tests/02_cenarios.sql`: cenários A–H e segurança (174 verificações, todas passando).
- `tests/03_concorrencia.sh`: duas retiradas simultâneas; só uma passa.
- `tests/00_stub_supabase.sql` e `01_legado_seed.sql` simulam o Supabase e os dados antigos.
