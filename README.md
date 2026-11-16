# Estoque de Manutenção do Condomínio

Sistema simples para controlar o estoque de itens de manutenção de um condomínio:
o que entra (compras, com fornecedor, nota fiscal e valor), o que sai (uso),
o consumo médio mensal e alertas de itens perto de acabar.

- **Site:** `https://Vinaum.github.io/gestao-estoque-luminiiv/`
- **Tecnologias:** HTML, CSS e JavaScript (tudo em um único `index.html`) + [Supabase](https://supabase.com) (banco de dados PostgreSQL e login)
- **Hospedagem:** GitHub Pages

## Arquivos do repositório

| Arquivo | Para que serve |
|---|---|
| `index.html` | O site inteiro: telas, regras de cálculo e conexão com o Supabase |
| `schema.sql` | Cria as tabelas, as regras de acesso por papel e o gatilho que atualiza o estoque |
| `atualizacao-superadmin.sql` | Só o bloco do papel superadmin (para projetos que já existem) |
| `README.md` | Este guia |
| `.gitignore` | Lista do que o Git não deve enviar (arquivos de sistema, segredos) |

## Papéis de usuário

| Papel | O que pode fazer |
|---|---|
| **Superadmin** | Tudo que o síndico faz, e é o único que cria ou altera síndicos e outros superadmins |
| **Síndico** | Itens, movimentações, excluir, parâmetros de alerta, e define quem é gestor ou morador |
| **Gestor / zelador** | Cadastrar e editar itens e registrar entradas e saídas. Não exclui nem muda configurações |
| **Morador** | Somente visualizar |

Quem cria uma conta entra como **morador**. Na aba **Usuários**, o síndico alterna entre gestor e morador, e o superadmin define qualquer papel. Ninguém altera o próprio papel pelo app.
As permissões são aplicadas pelo próprio banco (Row Level Security), não apenas escondidas na tela.

## Como funciona o alerta

- **Consumo médio mensal** = soma das saídas dos últimos N meses ÷ N (padrão: 6 meses).
- **Dias restantes** = estoque atual ÷ consumo médio × 30.
- **Crítico:** estoque igual ou abaixo do mínimo, ou poucos dias restantes (padrão: 7).
- **Atenção:** dias restantes abaixo do limite (padrão: 20).

O síndico pode alterar esses valores na aba **Consumo médio**.

## Como configurar do zero

1. **Crie um projeto** em [supabase.com](https://supabase.com).
2. No **SQL Editor**, cole o conteúdo de `schema.sql` e clique em **Run**. Rode **uma única vez**.
3. Em **Project Settings → API**, copie a **Project URL** e a chave **anon** (ou *publishable*).
4. No `index.html`, troque as duas constantes no começo do script, mantendo as aspas:
   ```js
   const SUPABASE_URL = 'https://SEU-PROJECT-ID.supabase.co';
   const SUPABASE_ANON_KEY = 'SUA_CHAVE_ANON_OU_PUBLISHABLE';
   ```
5. Envie os arquivos para o GitHub e ative **Settings → Pages** (branch `main`, pasta `/ (root)`).
6. No Supabase, em **Authentication → URL Configuration**, coloque o endereço do GitHub Pages em **Site URL** e também em **Redirect URLs**.
7. Abra o site, crie sua conta e promova-se a superadmin no SQL Editor:
   ```sql
   update public.profiles set papel = 'superadmin' where id =
     (select id from auth.users where email = 'seu-email@exemplo.com');
   ```
   Saia do app e entre de novo.

## Esqueci minha senha

Na tela de login, clique em **Esqueci minha senha**, informe o e-mail e abra o link
recebido para criar uma nova. Para funcionar, o endereço do site precisa estar em
**Authentication → URL Configuration** (passo 6). Se o e-mail não chegar, olhe o spam.
O envio de e-mails no plano gratuito do Supabase tem limite por hora.

## Segurança

- A chave **anon/publishable** pode ficar no `index.html`, mesmo em repositório público: quem protege os dados são as regras de acesso do `schema.sql`.
- **Nunca** coloque a chave `service_role` (ou `secret`) no código nem no GitHub. Ela ignora todas as regras.
- Senhas nunca aparecem no banco nem no código; o Supabase guarda apenas um hash.

## Cuidados com o plano gratuito

- Projetos gratuitos do Supabase são **pausados após alguns dias sem uso** e a conta tem limite de **2 projetos ativos**. Abra o app de vez em quando.
- **Faça backup:** em **Table Editor**, exporte `items` e `movements` em CSV periodicamente.

## Atualizar o site

- **Pelo navegador:** abra o `index.html` no GitHub, clique no lápis, edite e clique em **Commit changes**.
- **Pelo computador:** edite a pasta clonada, depois `git add .`, `git commit -m "descrição"` e `git push`.
- O GitHub Pages republica em 1 a 2 minutos. Use **Ctrl+F5** para ver a versão nova.

## Migrar para outro projeto Supabase

1. Crie o projeto novo e rode o `schema.sql`.
2. Troque `SUPABASE_URL` e `SUPABASE_ANON_KEY` no `index.html`.
3. Atualize **Site URL** e **Redirect URLs** no Supabase.
4. Para trazer dados antigos, importe `items` primeiro e depois `movements`, desligando antes o gatilho para o estoque não ser somado de novo:
   ```sql
   alter table public.movements disable trigger movements_atualiza_estoque;
   -- importe as movimentações
   alter table public.movements enable trigger movements_atualiza_estoque;
   ```
5. Os usuários não migram: cada pessoa cria a conta de novo e o síndico define o papel.

## Estrutura do banco

- `profiles`: nome e papel de cada usuário (criado automaticamente no cadastro)
- `items`: itens, unidade, estoque atual e estoque mínimo
- `movements`: entradas e saídas, com fornecedor, nota fiscal e valor
- `settings`: parâmetros de alerta (uma linha só)

Um gatilho (`movements_atualiza_estoque`) soma ou subtrai do estoque do item a cada
movimentação inserida e reverte o efeito quando ela é excluída.
