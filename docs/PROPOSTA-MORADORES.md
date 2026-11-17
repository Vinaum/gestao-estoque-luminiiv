# Proposta — Área dos moradores (comunicados e indicação de prestadores)

Status: **etapa 6a (torres e apartamentos) construída; 6b a 6d aguardam validação.**
Decisões já tomadas pelo síndico: comunicados publicados por síndico **e** gestor; morador pode indicar prestador, **síndico aprova**; indicação mostra **quem indicou e a unidade** (5 torres); pedido de acesso pelo próprio morador fica para **depois**.

## 1. O que o morador passa a ter

| Tela | O que faz |
|---|---|
| **Início** | Últimos comunicados, com marcação de "novo", e atalho para prestadores. |
| **Comunicados** | Lista e leitura dos avisos do condomínio (ou da torre dele). Anexo em PDF/imagem quando houver. |
| **Prestadores** | Lista de profissionais indicados por moradores, com busca por tipo de serviço, telefone/WhatsApp e quem recomenda. Botão "Indicar prestador" e "Recomendo". |

Morador continua **sem acesso** a estoque, compras, fornecedores, gastos e painel.

## 2. Torres e apartamentos (base de tudo)

Hoje o sistema só conhece a conta do morador. Para mostrar "Torre 2 · Apto 31" e para avisar uma torre só, precisamos cadastrar a estrutura:

- **Torres**: 5 (Torre 1 a Torre 5, ou os nomes que vocês usam).
- **Apartamentos**: número de cada apartamento dentro da torre. Tela para o síndico cadastrar, com **geração em lote** (ex.: andares 1 a 12 × finais 1 a 4 → 11, 12, 13, 14, 21…).
- **Vínculo**: cada morador é ligado a um apartamento. O síndico define isso ao convidar e pode corrigir depois na tela Usuários. Vários moradores podem ficar no mesmo apartamento.
- Quem não tem apartamento informado (por exemplo, o próprio síndico ou gestor) aparece com o papel no lugar da unidade ("Síndico"). **Morador sem apartamento não consegue indicar nem recomendar**, para que a unidade sempre apareça.

## 3. Comunicados

- Campos: título, texto, tipo (aviso, manutenção, assembleia, obra, outros), **destino** (todo o condomínio ou uma torre), fixar no topo, data para deixar de aparecer, anexo opcional.
- Fluxo: **rascunho → publicado → arquivado**. Nada é apagado (fica no histórico e na auditoria). Publicado pode ser corrigido e mostra "editado em".
- Quem publica e edita: **síndico e gestor**. Moradores só leem.
- Quem vê: moradores ativos do condomínio. Comunicado de uma torre só aparece para moradores daquela torre; morador sem apartamento vê apenas os de "todo o condomínio".
- **Leitura**: o sistema marca quando o morador abre. Síndico e gestor veem "lido por 38 de 52 moradores" (e quais apartamentos ainda não leram).
- **Anexo**: PDF/JPG/PNG até 5 MB, em armazenamento privado (mesmo cuidado das notas fiscais), só abre para quem é do condomínio.
- Limite conhecido: **não há aviso por e-mail ou celular**; o morador vê ao abrir o sistema. Aviso por e-mail pode vir depois (precisa de uma peça extra no Supabase).

## 4. Prestadores recomendados

- **Indicar**: morador informa nome, tipo de serviço (texto livre com sugestões dos já usados: marceneiro, pedreiro, diarista…), telefone/WhatsApp e uma observação curta. Entra como **pendente**.
- **Aprovação**: só o **síndico** aprova, recusa (com motivo, que o morador vê) ou remove. Pendentes só são visíveis a quem indicou e ao síndico. O gestor vê apenas os já publicados.
- **Recomendo**: outro morador pode recomendar um prestador publicado, com comentário opcional de até 200 caracteres. **Só existe "recomendo"**, sem nota nem avaliação negativa. Cada morador recomenda uma vez e pode retirar a sua.
- **Exibição**: "Indicado por Maria — Torre 2 · Apto 31" e "recomendado por 4 moradores" (lista com nome e unidade ao abrir).
- **Duplicidade**: se o telefone já existe publicado, o sistema sugere recomendar o existente em vez de criar outro.
- **Anti-spam**: no máximo 5 indicações pendentes por morador ao mesmo tempo.
- **Edição**: o morador edita a própria indicação enquanto pendente; depois de publicada, só o síndico altera.
- **Relação com Fornecedores**: são cadastros **separados**. Fornecedor é quem vende ao condomínio (compras, só equipe). Prestador é lista de moradores para moradores. Futuramente o síndico poderia "transformar em fornecedor" um prestador.

### Privacidade e cuidado (não sou advogado; vale confirmar com quem assessora o condomínio)
- Telefone de uma pessoa física é dado pessoal (LGPD). Ele só fica visível para quem tem conta aprovada no condomínio.
- Aviso na tela de indicação: o nome e a unidade de quem indica aparecem junto, e a indicação é opinião do morador, não do condomínio.
- Se um profissional pedir para sair da lista, o síndico remove (a remoção fica na auditoria).
- Comentário limitado, sem texto livre ilimitado, e o síndico pode remover qualquer comentário.

## 5. Quadro de permissões (acréscimo ao `PERMISSOES.md`)

| Ação | Superadmin | Síndico | Gestor | Morador |
|---|---|---|---|---|
| Ler comunicados publicados | ✓ | ✓ | ✓ | ✓ (os dele) |
| Criar, editar, publicar, arquivar comunicado | ✓ | ✓ | ✓ | – |
| Ver quem leu | ✓ | ✓ | ✓ | – |
| Ver prestadores publicados | ✓ | ✓ | ✓ | ✓ |
| Indicar prestador e recomendar | ✓ | ✓ | ✓ | ✓ (com apartamento) |
| Aprovar, recusar, remover prestador | ✓ | ✓ | – | – |
| Cadastrar torres e apartamentos | ✓ | ✓ | – | – |
| Vincular morador a apartamento | ✓ | ✓ | – | – |

## 6. Segurança (o ponto de maior atenção)

Hoje todo texto do sistema vem da equipe. Nesta área **moradores escrevem o que outros moradores leem**, então:
- Todo texto continua passando pelo escape automático, e haverá teste com conteúdo malicioso (`<script>`, aspas, links falsos) em nome, observação, comentário e título.
- Telefone vira link `tel:`/`wa.me` somente depois de reduzido a dígitos; **nenhum link digitado pelo usuário** é aceito ou clicável. Anexos abrem por endereço temporário assinado.
- Limites de tamanho nos campos, no banco (não só na tela).
- As regras de acesso abrem a leitura do morador **somente** nas tabelas novas; estoque, compras, fornecedores, gastos e auditoria continuam fechados.
- Escritas sensíveis (publicar, aprovar, recomendar, marcar leitura) por funções no banco com verificação de papel, como no resto do sistema.
- Cada regra do quadro acima terá teste automático de banco, e cada tela terá teste de navegador por papel.

## 7. Pedido de acesso pelo morador (fica para depois, mas já preparado)

A estrutura de torres/apartamentos e o vínculo do morador permitem isto sem refazer nada:
1. O síndico gera um **código/link do condomínio**.
2. O morador cria a conta, informa o código, torre e apartamento → fica como **solicitação pendente**.
3. O síndico aprova (vira morador daquele apartamento) ou recusa.
Cuidados já previstos: o código não deixa listar condomínios; e-mail confirmado continua obrigatório; limite de pedidos por conta.

## 8. Ordem de construção (cada etapa testada e validada por você antes da próxima)

| Etapa | Entrega |
|---|---|
| **6a** | Torres e apartamentos: tabelas, tela de cadastro com geração em lote, vínculo do morador (convite e tela Usuários) |
| **6b** | Comunicados: banco, anexos, telas de publicação e leitura, contagem de leitura |
| **6c** | Prestadores: banco, indicação, aprovação, recomendação, busca |
| **6d** | Início do morador, menu "Comunidade", documentação, teste de ponta a ponta com os quatro papéis |
| **Depois** | Pedido de acesso pelo morador; aviso por e-mail; "transformar em fornecedor" |

Mudanças em coisas que já existem: `convidar_membro` ganha o apartamento (parâmetro opcional); `membros` e `convites` ganham a coluna do apartamento; a tela Usuários mostra e permite alterar a unidade; novas migrations 0015 em diante, sem alterar dados existentes. A virada e a migration 0099 seguem como etapa à parte.

## 9. Respostas do síndico
- Torres: **Torre 1 a Torre 5**. Cada torre tem 5 andares (térreo ao 4º) com **4 ou 6 apartamentos por andar**, numerados 01–04 (ou 01–06), 11–14, 21–24, 31–34, 41–44.
- Padrões confirmados: prestador sem nota negativa; no máximo 5 indicações pendentes por morador; unidade obrigatória para indicar; sem aviso por e-mail no início.

## 10. Perguntas que estavam em aberto (respondidas)
1. **Numeração dos apartamentos**: quantos andares e quantos apartamentos por andar em cada torre, e como são numerados (ex.: 101, 102… ou 11, 12…)? Se as torres forem diferentes entre si, o lote é feito torre por torre.
2. **Torres**: nomes (Torre 1–5, ou letras/nomes)?
3. Confirmar os padrões assumidos acima: prestador sem nota negativa; limite de 5 pendentes; unidade obrigatória para indicar; sem aviso por e-mail no início.
