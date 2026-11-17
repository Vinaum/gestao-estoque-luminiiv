"""Teste de navegador: Consumo e Relatórios de gastos (com Chart.js local)."""
import sys, datetime; sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
from e2e_comum import *
from playwright.sync_api import sync_playwright
PORTA = 8783
CA = '11111111-1111-1111-1111-111111111111'; SIN = 'aaaaaaaa-0000-0000-0000-000000000002'
I1 = 'bbbbbbbb-0000-0000-0000-000000000001'; I2 = 'bbbbbbbb-0000-0000-0000-000000000002'; I3 = 'bbbbbbbb-0000-0000-0000-000000000003'
hoje = datetime.date.today()
def mes(delta):
    m = hoje.month - 1 - delta; a = hoje.year + m // 12; m = m % 12 + 1; return f'{a}-{m:02d}-01'
XSS = '<img src=x onerror=alert(1)>'
SAIDAS = [dict(condominio_id=CA, item_id=I1, mes=mes(0), tipo='consumo', quantidade=6), dict(condominio_id=CA, item_id=I1, mes=mes(1), tipo='consumo', quantidade=3),
          dict(condominio_id=CA, item_id=I1, mes=mes(1), tipo='perda', quantidade=1), dict(condominio_id=CA, item_id=I2, mes=mes(2), tipo='consumo', quantidade=2)]
ITENS = [dict(item_id=I1, nome='Papel toalha', unidade='cx', estoque_atual=4, categoria='Limpeza'), dict(item_id=I2, nome=XSS, unidade='un', estoque_atual=0, categoria='Elétrica'), dict(item_id=I3, nome='Sem uso', unidade='un', estoque_atual=9, categoria='Outros')]
COB = [dict(item_id=I1, cobertura_dias=20, situacao='ok'), dict(item_id=I2, cobertura_dias=0, situacao='sem_estoque'), dict(item_id=I3, cobertura_dias=None, situacao='sem_historico')]
ano = hoje.year
def vc(i, data, forn, val, st='recebido'): return dict(compra_id=i, condominio_id=CA, data_compra=data, fornecedor=forn, numero_nf='NF1' if i == 'c1' else '=cmd', status=st, valor_total=val)
COMPRAS = [vc('c1', f'{ano}-01-10', 'Higiene Total', 300), vc('c2', f'{ano}-01-20', 'Elétrica Luz', 200, 'pedido_realizado'), vc('c3', f'{ano}-01-25', None, 50), vc('c4', f'{ano}-02-10', 'Higiene Total', 100)]
LINHAS = [dict(compra_id='c1', item_id=I1, custo_total=300), dict(compra_id='c2', item_id=I2, custo_total=200), dict(compra_id='c3', item_id=I3, custo_total=50), dict(compra_id='c4', item_id=I1, custo_total=100)]
def tratar(u, q, m, corpo, acc):
    if '/profiles' in u: return [{'id': SIN, 'nome': 'Síndico', 'superadmin': False}]
    if '/condominios' in u: return [{'id': CA, 'nome': 'Cond A', 'ativo': True}]
    if '/membros' in u: return [{'condominio_id': CA, 'papel': 'sindico', 'ativo': True}]
    if '/v_saidas_mensal' in u: return SAIDAS
    if '/v_estoque_item' in u: return ITENS
    if '/v_cobertura' in u: return COB
    if '/v_compras' in u:
        st = (q.get('status') or [''])[0]; return COMPRAS if st.startswith('in.') else []
    if '/compra_itens' in u: return LINHAS
def main():
    srv = servidor(PORTA); falhou = []; ok = checador(falhou)
    try:
        with sync_playwright() as pw:
            nav, pg, erros, ch = abrir(pw, PORTA, SIN, tratar, 'consumo', '#g-item')
            esperar(pg, "window.Chart && Chart.getChart('g-item') && Chart.getChart('g-top')")
            ok(pg.evaluate("Chart.getChart('g-item').data.datasets[0].data.slice(-3)") == [0, 3, 6] or pg.evaluate("Chart.getChart('g-item').data.datasets[0].data.slice(-2)") == [3, 6], 'gráfico do item: consumo por mês (… 3, 6)')
            ok(pg.evaluate("Chart.getChart('g-item').data.labels.length") == 6, 'padrão: últimos 6 meses')
            tb = pg.inner_text('#pagina table')
            ok('Papel toalha' in tb and '9' in tb and 'cerca de 20 dias' in tb, 'resumo: total 9, cobertura de 20 dias')
            ok(pg.locator('#pagina img').count() == 0 and XSS in tb, 'nome malicioso aparece como texto')
            ok('Sem uso' not in tb, 'item sem consumo não entra no resumo')
            pg.select_option('#f-tipo', 'saidas'); pg.wait_for_timeout(300)
            ok('10' in pg.inner_text('#pagina table'), 'todas as saídas somam a perda (10)')
            pg.select_option('#f-per', '12'); esperar(pg, "Chart.getChart('g-item').data.labels.length === 12")
            ok(True, 'trocar para 12 meses redesenha o gráfico')
            ok(not erros, 'consumo sem erros de script: %s' % erros); nav.close()

            nav, pg, erros, ch = abrir(pw, PORTA, SIN, tratar, 'gastos', '#g-mes')
            esperar(pg, "window.Chart && Chart.getChart('g-mes') && Chart.getChart('g-forn') && Chart.getChart('g-cat')")
            ok(pg.evaluate("Chart.getChart('g-mes').data.datasets[0].data[0]") == 550, 'gráfico mensal: janeiro = R$ 550')
            ok('650,00' in pg.inner_text('#pagina h3 >> nth=0'), 'total do ano R$ 650,00')
            ok(pg.evaluate("Chart.getChart('g-forn').data.labels") == ['Higiene Total', 'Elétrica Luz', 'Sem fornecedor'], 'fornecedores em ordem de valor, "Sem fornecedor" incluído')
            ok(pg.evaluate("Chart.getChart('g-cat').data.labels") == ['Limpeza', 'Elétrica', 'Outros'], 'categorias vêm dos itens das compras')
            pg.select_option('#f-forn', 'Higiene Total'); pg.wait_for_timeout(300)
            ok('400,00' in pg.inner_text('#pagina h3 >> nth=0') and pg.evaluate("Chart.getChart('g-mes').data.datasets[0].data[0]") == 300, 'filtro por fornecedor atualiza total e gráfico')
            pg.select_option('#f-forn', '')
            ok(pg.locator('#f-mes option').count() == 13, 'filtro de mês: todos + 12 meses')
            pg.select_option('#f-mes', '01'); pg.wait_for_timeout(300)
            ok('550,00' in pg.inner_text('#pagina h3 >> nth=0') and 'Janeiro' in pg.inner_text('#pagina h3 >> nth=0'), 'mês janeiro: total R$ 550,00')
            ok(pg.evaluate("Chart.getChart('g-cat').data.labels") == ['Limpeza', 'Elétrica', 'Outros'] and pg.evaluate("Chart.getChart('g-cat').data.datasets[0].data")[0] == 300, 'categorias respeitam o mês (Limpeza 300, sem a compra de fevereiro)')
            ok(pg.locator('#pagina tbody tr').count() == 4, 'tabela só com as 3 compras de janeiro + total')
            pg.select_option('#f-mes', '02'); pg.wait_for_timeout(300)
            ok('100,00' in pg.inner_text('#pagina h3 >> nth=0') and pg.evaluate("Chart.getChart('g-forn').data.labels") == ['Higiene Total'], 'mês fevereiro: só Higiene Total, R$ 100,00')
            with pg.expect_download() as dm: pg.click('[data-acao=csv]')
            ok(dm.value.suggested_filename == f'gastos-{ano}-02.csv' and '100,00' in open(dm.value.path(), encoding='utf-8').read() and '300,00' not in open(dm.value.path(), encoding='utf-8').read(), 'CSV do mês: nome gastos-AAAA-MM.csv e só as compras do mês')
            pg.select_option('#f-mes', '03'); pg.wait_for_timeout(300)
            ok('0,00' in pg.inner_text('#pagina h3 >> nth=0') and pg.locator('[data-acao=csv]').is_disabled(), 'mês sem compras: total zero e CSV desabilitado')
            pg.select_option('#f-mes', '')
            with pg.expect_download() as d: pg.click('[data-acao=csv]')
            arq = d.value.path(); txt = open(arq, encoding='utf-8').read()
            ok(txt.startswith('﻿Data;Fornecedor;Nota fiscal') and "'=cmd" in txt and '300,00' in txt, 'CSV com cabeçalho, vírgula decimal e fórmula neutralizada')
            ok(d.value.suggested_filename == f'gastos-{ano}.csv', 'nome do arquivo gastos-AAAA.csv')
            ok(not erros, 'gastos sem erros de script: %s' % erros); nav.close()

            def vazio(u, q, m, corpo, acc): return [] if ('/v_' in u or '/compra_itens' in u) else tratar(u, q, m, corpo, acc)
            nav, pg, erros, ch = abrir(pw, PORTA, SIN, vazio, 'gastos', '#pagina .empty')
            ok('Nenhuma compra efetivada' in pg.inner_text('#pagina') and pg.locator('[data-acao=csv]').is_disabled(), 'gastos sem dados: aviso e CSV desabilitado'); nav.close()
            nav, pg, erros, ch = abrir(pw, PORTA, SIN, vazio, 'consumo', '#pagina .empty')
            ok('Ainda não há saídas' in pg.inner_text('#pagina') and not erros, 'consumo sem histórico: aviso, sem erro'); nav.close()
    finally: srv.terminate()
    relatorio(falhou)
main()
