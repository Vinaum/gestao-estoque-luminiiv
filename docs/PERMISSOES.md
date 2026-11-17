# Permissões por papel

Decisões do síndico (17/11/2026). A tabela abaixo é o que o sistema faz hoje; cada linha tem teste automático (`supabase/tests/02_cenarios.sql`, cenário H e "Permissões do gestor"; e os testes de navegador de menu e painel).

| Ação | Superadmin | Síndico | Gestor | Morador |
|---|---|---|---|---|
| Ver estoque, consumo, fornecedores | ✓ | ✓ | ✓ | – |
| Saída, entrada extraordinária | ✓ | ✓ | ✓ | – |
| Ajuste de inventário e estorno (com justificativa, sem aprovação) | ✓ | ✓ | ✓ | – |
| Cadastrar item, mudar mínimo/ideal | ✓ | ✓ | ✓ | – |
| Cadastrar e editar fornecedor | ✓ | ✓ | ✓ | – |
| **Ativar/desativar fornecedor** | ✓ | ✓ | – | – |
| Montar compra e enviar para aprovação | ✓ | ✓ | ✓ | – |
| **Aprovar compra** | ✓ | ✓ | – | – |
| Receber compra e anexar nota fiscal | ✓ | ✓ | ✓ | – |
| **Painel e relatório de gastos** | ✓ | ✓ | ✓ | – |
| Parâmetros do condomínio (faixas de alerta, prazos) | ✓ | ✓ | – | – |
| Usuários, convites, auditoria, diagnóstico | ✓ | ✓ | – | – |
| Torres e apartamentos: cadastrar, gerar, desativar | ✓ | ✓ | – | – |
| Ver torres e apartamentos | ✓ | ✓ | ✓ | ✓ |
| Ligar pessoa ou convite a um apartamento | ✓ | ✓ | – | – |
| Ler comunicados publicados (os do seu público) | ✓ | ✓ | ✓ | ✓ |
| Criar, editar, publicar, arquivar comunicado; ver quem leu | ✓ | ✓ | ✓ | – |
| Ver prestadores publicados e recomendar | ✓ | ✓ | ✓ | ✓ (com apartamento) |
| Indicar prestador | ✓ (publica direto) | ✓ (publica direto) | com apartamento (fica pendente) | com apartamento (fica pendente) |
| Aprovar, recusar, remover prestador; remover comentário | ✓ | ✓ | – | – |
| Criar condomínio, definir síndico, catálogos | ✓ | – | – | – |

## Em aberto
- Papel de **consulta** (comissão que só acompanha, sem alterar). Não existe; adicionar depois exige uma migration pequena e telas só de leitura.
- Papel só de saída (porteiro/zelador): decidido que **não** existe.
