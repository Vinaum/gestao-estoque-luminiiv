# Gestão Condominial — estoque, compras e operação

Aplicação web para o síndico e a comissão de um condomínio controlarem o estoque de manutenção, as compras, os fornecedores e acompanharem tudo em um painel. Funciona em vários condomínios, cada um isolado dos demais.

> **Estado atual:** a versão nova está em `app/` e roda em paralelo à versão antiga (raiz do repositório). A troca definitiva ("virada") é uma etapa separada — veja [`docs/VIRADA.md`](docs/VIRADA.md).

## O que o sistema faz
- **Estoque por lotes** (validade, custo, origem). O saldo de um item é sempre a soma dos saldos dos lotes; não existe número de estoque editável à mão.
- **Ferramentas e patrimônio**: itens permanentes (martelo, mangueira, escada…) continuam com quantidade e local, mas sem mínimo, ideal ou validade; não geram alerta de compra nem de vencimento e têm estado de conservação (bom, precisa de reparo, sem uso).
- **Saídas** com baixa automática do lote que vence primeiro (FEFO) ou do mais antigo (FIFO), sem permitir saldo negativo.
- **Movimentações imutáveis**: erro se corrige por estorno ou ajuste, ambos com justificativa. Nada é apagado.
- **Compras separadas do recebimento**: rascunho → aprovação do síndico → pedido → recebimento (parcial ou total, em vários lotes). Nota fiscal em PDF/JPG/PNG (até 5 MB) em armazenamento privado.
- **Serviços contratados**: prestadores fixos do condomínio (piscineiro, jardineiro, dedetização…) com contato, valor combinado, periodicidade e dia de pagamento; síndico e gestor registram os pagamentos (com comprovante), que entram nos relatórios de gastos (categoria "Serviços") e no painel. Mensais mostram se o mês está pago, a pagar ou atrasado.
- **Notas fiscais antigas**: o síndico lança gastos que já aconteceram só com data, valor total e o arquivo da nota (fornecedor, categoria e número opcionais). Entram nos gastos e no painel, mas não mexem no estoque nem passam por aprovação; o síndico pode corrigir ou excluir.
- **Painel** (síndico e gestor): itens críticos, vencimentos, compras pendentes, gastos, cobertura de estoque.
- **Relatórios** de consumo e de gastos, com gráficos.
- **Torres e apartamentos**: estrutura do condomínio e vínculo de cada morador ao seu apartamento (base da futura área dos moradores).
- **Lista de compras por categoria**: na Central de compras, um botão gera a lista do que falta, dividida por categoria (Elétrica, Limpeza…), para copiar no WhatsApp, imprimir/salvar em PDF ou baixar em planilha.
- **Comunicados**: síndico e gestor publicam avisos (para todo o condomínio ou uma torre), com anexo opcional e acompanhamento de quem já leu; o morador lê no próprio acesso.
- **Início do morador**: página de entrada com os comunicados recentes (marcação de “novo”) e atalhos para prestadores e atas.
- **Atas das assembleias**: síndico e gestor guardam a ata em PDF (data, tipo ordinária/extraordinária, resumo); todos os moradores consultam, com busca por assunto e filtro de ano.
- **Prestadores recomendados**: moradores indicam profissionais (marceneiro, pedreiro, diarista…), o síndico aprova, e os demais moradores recomendam; nome e unidade de quem indicou aparecem junto.
- **Administração**: condomínios, usuários, convites (que podem ser editados ou cancelados) e papéis; diagnóstico de consistência do estoque; histórico de auditoria.

## Papéis
| Papel | Pode |
|---|---|
| superadmin | Criar condomínios, definir síndicos, ver todos os condomínios, rodar diagnósticos |
| síndico | Tudo do condomínio, inclusive **aprovar compras** e gerenciar usuários |
| gestor (especialista em estoque) | Operar estoque, montar compras e receber, cadastrar e editar fornecedores (sem ativar/desativar), ver painel e gastos. Não aprova compras nem gerencia pessoas |
| morador | Início, Comunicados, Prestadores e Atas (sem acesso a estoque, compras, fornecedores ou gastos) |

## Como rodar localmente
O código é JavaScript puro (módulos ES), **sem build**. Precisa de um servidor local, porque o navegador não carrega módulos por `file://`:

```bash
python3 -m http.server 8000
# abra http://localhost:8000/app/
```

O endereço do projeto Supabase e a chave **publicável** ficam em `app/js/config.js`. Essa chave é feita para ficar no navegador; a segurança vem das regras de acesso (RLS) do banco. **Nunca** coloque a chave `service_role` ou qualquer senha no código ou no GitHub.

## Estrutura
```
app/            Interface (index.html, js/, assets/)
  js/lib/       Utilitários: HTML seguro, formatação, janelas, Supabase, estado
  js/modules/   Uma pasta por tela (operacao, estoque, compras, painel, relatorios, admin…)
vendor/         Bibliotecas fixas (supabase-js, Chart.js) + SHA256SUMS
supabase/       Banco: migrations/ (0001–0022), tests/, pendentes/
tests/          Testes do front e auditoria de segurança
docs/           Plano, mapa de testes e roteiro da virada
```

## Banco de dados
Rode as migrations de `supabase/migrations/` **uma por vez, em ordem**, no SQL Editor do Supabase (cada uma pode ser repetida sem dano). Detalhes em [`supabase/LEIA-ME.md`](supabase/LEIA-ME.md).

Configuração obrigatória no Supabase: manter **Confirm email** ligado em Authentication → Providers → Email.

`supabase/pendentes/0099_remover_legado.sql` apaga o modelo antigo e **só deve ser executado com aprovação explícita**, depois da virada.

## Testes
```bash
bash tests/rodar_tudo.sh
```
Roda: auditoria estática de segurança, testes de unidade, testes de navegador (Playwright, com o Supabase simulado) e, se houver um Postgres descartável configurado (`PGHOST`, `PGPORT`, `PGUSER`), os cenários SQL e o teste de concorrência. Nenhum teste toca o Supabase de verdade. Mapa completo em [`docs/TESTES.md`](docs/TESTES.md).

Requisitos dos testes: Node 18+, Python 3 com `playwright` e Chromium.

## Segurança em resumo
- Isolamento por condomínio (`condominio_id`) com RLS em todas as tabelas.
- Operações sensíveis são funções no banco, com verificação de papel, trava contra concorrência e chave de idempotência (clique duplo não duplica).
- Política de segurança de conteúdo (CSP): só scripts do próprio site, sem `eval` nem scripts em linha.
- Todo texto vindo de usuário é escapado antes de entrar na tela; a auditoria automática bloqueia HTML montado sem escape.
- Bibliotecas externas ficam na pasta `vendor/` com soma de verificação, em vez de carregadas de terceiros.
