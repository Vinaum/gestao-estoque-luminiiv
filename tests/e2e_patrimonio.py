"""Teste de navegador: itens permanentes (Ferramentas e patrimônio, Configuração e Novo item), com Supabase simulado."""
import sys, json, re; sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
from e2e_comum import *
from playwright.sync_api import sync_playwright
PORTA = 8802
CA = '11111111-1111-1111-1111-111111111111'; GEST = 'aaaaaaaa-0000-0000-0000-000000000003'
XSS = '<img src=x onerror=alert(1)>'
ID = lambda n: f'bbbbbbbb-0000-0000-0000-0000000000{n:02d}'
NOVO = 'bbbbbbbb-0000-0000-0000-000000000099'
def item(n, nome, permanente=False, **k):
    d = dict(item_id=ID(n), condominio_id=CA, nome=nome, categoria='Ferramentas', categoria_id='c-fer', unidade='un', unidade_id='u-un',
             descricao=None, localizacao=None, ativo=True, estoque_atual=1, estoque_minimo=0, estoque_ideal=0, total_lotes=1,
             status='permanente' if permanente else 'normal', qtd_sugerida=0, qtd_em_pedido=0, permanente=permanente, conservacao='bom')
    d.update(k); return d
ITENS = [item(1, 'Serrote', True, estoque_atual=2, localizacao='Depósito'),
         item(2, 'Mangueira', True, conservacao='reparo', descricao=XSS),
         item(3, 'Escada velha', True, ativo=False, conservacao='inutilizavel'),
         item(4, 'Papel toalha', categoria='Limpeza', estoque_atual=4, estoque_minimo=5, estoque_ideal=20, status='comprar', qtd_sugerida=16),
         item(5, 'Cera', categoria='Limpeza', ativo=False)]
def dados():
    def t(u, q, m, corpo, acc):
        if m.startswith('RPC'): return None
        if '/v_estoque_item' in u: return ITENS
        if '/categorias' in u: return [{'id': 'c-lim', 'nome': 'Limpeza'}, {'id': 'c-fer', 'nome': 'Ferramentas'}]
        if '/unidades_medida' in u: return [{'id': 'u-cx', 'sigla': 'cx', 'nome': 'caixa'}, {'id': 'u-un', 'sigla': 'un', 'nome': 'unidade'}]
        if '/profiles' in u and 'id=eq.' in u: return [{'id': GEST, 'nome': 'Gestora', 'superadmin': False}]
        if '/condominios' in u: return [{'id': CA, 'nome': 'Cond A', 'ativo': True}]
        if '/membros' in u: return [{'condominio_id': CA, 'papel': 'gestor', 'ativo': True}]
    return t
def insercoes(pg):
    """POST em itens devolve o id criado (o app pede o id de volta)."""
    feitas = []
    def h(route):
        if route.request.method != 'POST': return route.fallback()
        feitas.append(route.request.post_data_json)
        route.fulfill(status=201, content_type='application/json', body=json.dumps({'id': NOVO}), headers={'access-control-allow-origin': '*'})
    pg.route(re.compile(r'https://.*supabase\.co/rest/v1/itens.*'), h)
    return feitas
def patches(ch): return [x for x in ch if x[0] == 'PATCH itens']
def linhas(pg): return pg.locator('#pt-tab tbody tr')
def main():
    srv = servidor(PORTA); falhou = []; ok = checador(falhou)
    try:
        with sync_playwright() as pw:
            # ---- tela Ferramentas e patrimônio
            nav, pg, erros, ch = abrir(pw, PORTA, GEST, dados(), 'patrimonio', '#pt-tab tbody tr')
            novos = insercoes(pg)
            ok([linhas(pg).nth(i).locator('b').inner_text() for i in range(linhas(pg).count())] == ['Mangueira', 'Serrote'], 'só permanentes ativos, em ordem')
            r = lambda k: pg.inner_text(f'[data-resumo={k}]')
            ok((r('itens'), r('unidades'), r('reparo'), r('inutilizavel')) == ('2', '3', '1', '0'), 'cartões: 2 itens, 3 unidades, 1 em reparo')
            ok(pg.locator('#pagina img').count() == 0 and XSS in pg.inner_text('#pagina'), 'descrição maliciosa aparece como texto')
            pg.select_option('#pt-cons', 'reparo'); ok(linhas(pg).count() == 1 and 'Mangueira' in linhas(pg).first.inner_text(), 'filtro de conservação')
            pg.select_option('#pt-cons', ''); pg.fill('#pt-busca', 'deposito'); pg.wait_for_timeout(100)
            ok(linhas(pg).count() == 1 and 'Serrote' in linhas(pg).first.inner_text(), 'busca pelo local, sem acento')
            pg.fill('#pt-busca', ''); pg.check('#pt-inativos'); pg.wait_for_timeout(100)
            ok(linhas(pg).count() == 3 and pg.locator('#pt-tab tr.inativo').count() == 1, 'mostrar inativos inclui a escada')
            pg.uncheck('#pt-inativos')
            # atualizar
            linhas(pg).filter(has_text='Serrote').locator('[data-acao=editar]').click(); pg.wait_for_selector('.modal form')
            pg.select_option('#pe-cons', 'reparo'); pg.fill('#pe-loc', 'Guarita'); pg.click('.modal button[type=submit]'); pg.wait_for_selector('.modal', state='detached')
            esperar_chamada(pg, ch, 'PATCH itens', 1)
            p = patches(ch)[0]
            ok(p[1] == {'conservacao': 'reparo', 'localizacao': 'Guarita', 'descricao': None, 'permanente': True} and p[2].get('id') == f'eq.{ID(1)}', 'Atualizar grava conservação e local do item certo: %s' % (p,))
            linhas(pg).filter(has_text='Mangueira').locator('[data-acao=editar]').click(); pg.wait_for_selector('.modal form')
            pg.uncheck('.modal [name=permanente]'); pg.click('.modal button[type=submit]'); pg.wait_for_selector('.modal', state='detached')
            esperar_chamada(pg, ch, 'PATCH itens', 2)
            ok(patches(ch)[1][1]['permanente'] is False, 'desmarcar devolve o item para consumo')
            # marcar itens já cadastrados
            pg.click('[data-acao=marcar]'); pg.wait_for_selector('.modal .lista-marcar')
            ok(pg.locator('.lista-marcar li').count() == 1 and 'Papel toalha' in pg.inner_text('.lista-marcar'), 'lista só itens de consumo ativos (sem permanentes nem inativos)')
            ok(pg.locator('.modal [data-confirmar]').is_disabled(), 'botão desligado sem nada marcado')
            pg.check('.lista-marcar input'); ok('Marcar 1 como permanente' in pg.inner_text('.modal [data-confirmar]'), 'botão mostra quantos')
            pg.click('.modal [data-confirmar]'); pg.wait_for_selector('.modal', state='detached')
            esperar_chamada(pg, ch, 'PATCH itens', 3)
            p = patches(ch)[2]
            ok(p[1] == {'permanente': True} and p[2].get('id') == f'in.({ID(4)})', 'marca os itens escolhidos: %s' % (p,))
            # cadastrar ferramenta com quantidade
            pg.click('[data-acao=nova]'); pg.wait_for_selector('.modal form')
            ok(pg.input_value('#pn-cat') == 'c-fer' and pg.input_value('#pn-uni') == 'u-un', 'categoria Ferramentas e unidade "un" já sugeridas')
            pg.fill('#pn-nome', 'Furadeira'); pg.fill('#pn-qtd', '-1'); pg.click('.modal button[type=submit]')
            ok('Quantidade inválida' in pg.inner_text('.modal [data-erro]') and not novos, 'quantidade inválida não cadastra')
            pg.fill('#pn-qtd', '2'); pg.select_option('#pn-cons', 'reparo'); pg.fill('#pn-loc', 'Depósito')
            pg.click('.modal button[type=submit]'); pg.wait_for_selector('.modal', state='detached')
            esperar_chamada(pg, ch, 'registrar_entrada_extraordinaria', 1)
            ok(len(novos) == 1 and novos[0]['permanente'] is True and novos[0]['conservacao'] == 'reparo' and novos[0]['nome'] == 'Furadeira' and novos[0]['localizacao'] == 'Depósito', 'cadastro como permanente: %s' % novos)
            e = [x for x in ch if x[0] == 'registrar_entrada_extraordinaria'][0][1]
            ok(e['p_item_id'] == NOVO and e['p_quantidade'] == 2 and e['p_origem'] == 'entrada_extraordinaria' and 'Inventário inicial' in e['p_motivo'], 'quantidade existente vira entrada do item novo: %s' % e)
            pg.click('[data-acao=nova]'); pg.wait_for_selector('.modal form'); pg.fill('#pn-nome', 'Trena'); pg.click('.modal button[type=submit]'); pg.wait_for_selector('.modal', state='detached')
            pg.wait_for_timeout(300)
            ok(len(novos) == 2 and len([x for x in ch if x[0] == 'registrar_entrada_extraordinaria']) == 1, 'sem quantidade: cadastra sem lançar entrada')
            pg.set_viewport_size({'width': 390, 'height': 844}); pg.wait_for_timeout(200)
            ok(not pg.evaluate("[...document.querySelectorAll('.tabela-rolagem')].some(e => e.scrollWidth > e.clientWidth)") and linhas(pg).first.locator('.status-pill').is_visible(), 'no celular: sem rolagem lateral e conservação visível')
            ok(not erros, 'patrimônio sem erros de script: %s' % erros); nav.close()

            # ---- Configuração de estoque
            nav, pg, erros, ch = abrir(pw, PORTA, GEST, dados(), 'config-estoque', '#tab tbody tr')
            serr = pg.locator('#tab tbody tr', has_text='Serrote')
            ok(serr.locator('[data-permanente]').count() == 1 and serr.locator('.inp-num').count() == 0 and 'sem mínimo nem ideal' in serr.inner_text(), 'permanente: etiqueta e sem campos de mínimo/ideal')
            ok(pg.locator('#tab tbody tr', has_text='Papel toalha').locator('.inp-num').count() == 2, 'item de consumo continua com mínimo e ideal')
            pg.locator('#tab tbody tr', has_text='Papel toalha').locator('[data-acao=editar]').click(); pg.wait_for_selector('.modal form')
            ok(not pg.is_checked('.modal [name=permanente]'), 'editar: caixa "permanente" desmarcada para item de consumo')
            pg.check('.modal [name=permanente]'); pg.click('.modal button[type=submit]'); pg.wait_for_selector('.modal [data-r="1"]')
            ok('zerados' in pg.inner_text('.modal >> nth=-1'), 'tornar permanente avisa que mínimo e ideal serão zerados')
            pg.click('.modal [data-r="1"]')
            esperar_chamada(pg, ch, 'PATCH itens', 1)
            ok(patches(ch)[0][1]['permanente'] is True, 'edição grava permanente')
            ok(not erros, 'configuração sem erros: %s' % erros); nav.close()

            # ---- Novo item (Operação diária) como permanente
            nav, pg, erros, ch = abrir(pw, PORTA, GEST, dados(), 'operacao', '#pagina table')
            novos = insercoes(pg)
            ok('Permanente' in pg.locator('#pagina tbody tr', has_text='Serrote').inner_text(), 'operação mostra a situação "Permanente"')
            pg.click('[data-acao=novo-item]'); pg.wait_for_selector('.modal form')
            ok(pg.locator('#n-min').is_visible(), 'mínimo visível para item de consumo')
            pg.fill('#n-min', '7'); pg.check('#n-perm'); ok(not pg.locator('#n-min').is_visible() and not pg.locator('#n-ideal').is_visible(), 'marcar permanente esconde mínimo e ideal')
            pg.fill('#n-nome', 'Alicate'); pg.click('.modal button[type=submit]'); pg.wait_for_selector('.modal', state='detached')
            pg.wait_for_timeout(300)
            ok(len(novos) == 1 and novos[0]['permanente'] is True and novos[0]['estoque_minimo'] == 0 and novos[0]['estoque_ideal'] == 0, 'novo item permanente vai com mínimo e ideal zero: %s' % novos)
            ok(not erros, 'operação sem erros: %s' % erros); nav.close()
    finally: srv.terminate()
    relatorio(falhou)
main()
