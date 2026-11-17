"""Teste de navegador: botão "Gerar lista de compras" (por categoria), com Supabase simulado."""
import sys, os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from e2e_comum import *
from playwright.sync_api import sync_playwright
PORTA = 8789
CA = '11111111-1111-1111-1111-111111111111'
UIDS = {'gestor': 'aaaaaaaa-0000-0000-0000-000000000003', 'sindico': 'aaaaaaaa-0000-0000-0000-000000000002'}
XSS = '<img src=x onerror=alert(1)>'
def it(n, nome, cat, un, est, minimo, sug, ped=0, status='comprar'):
    return dict(condominio_id=CA, item_id=f'bbbbbbbb-0000-0000-0000-0000000000{n:02d}', nome=nome, categoria=cat, categoria_id='c' + str(n), unidade=un, unidade_id='u1',
                ativo=True, total_lotes=1, estoque_atual=est, estoque_minimo=minimo, estoque_ideal=sug + est, qtd_sugerida=sug, qtd_em_pedido=ped, status=status, fornecedor_principal_id=None)
ITENS = [it(1, 'Saco de lixo 100L', 'Limpeza', 'pct', 2, 5, 12),
         it(2, 'Lâmpada LED 9W', 'Elétrica', 'un', 0, 10, 30, status='esgotado'),
         it(3, XSS, 'Limpeza', 'un', 1, 3, 4),
         it(4, 'Abraçadeira', None, 'un', 0, 2, 6),
         it(7, 'Verniz', 'Tintas', 'L', 0, 1, 2),
         it(5, 'Sabão', 'Limpeza', 'cx', 3, 5, 17, ped=17),          # já coberto por pedido: fora da lista
         it(6, 'Fita isolante', 'Elétrica', 'un', 8, 6, 10, status='atencao')]  # só entra com "Incluir itens em atenção"
def dados(papel, itens=ITENS):
    def t(u, q, m, corpo, acc):
        if m.startswith('RPC'): return {}
        if '/v_estoque_item' in u: return itens
        if '/v_compras' in u: return []
        if '/profiles' in u and 'id=eq.' in u: return [{'id': UIDS[papel], 'nome': 'Pessoa', 'superadmin': False}]
        if '/condominios' in u: return [{'id': CA, 'nome': 'Cond A', 'ativo': True}]
        if '/membros' in u: return [{'condominio_id': CA, 'papel': papel, 'ativo': True}]
    return t
def main():
    srv = servidor(PORTA); falhou = []; ok = checador(falhou)
    try:
        with sync_playwright() as pw:
            for papel in ('gestor', 'sindico'):
                nav, pg, erros, ch = abrir(pw, PORTA, UIDS[papel], dados(papel), 'compras', '#pagina .panel')
                ok(pg.locator('[data-acao=gerar-lista]').count() == 1, f'{papel}: botão Gerar lista de compras na Necessidade de compra')
                pg.click('[data-acao=gerar-lista]'); pg.wait_for_selector('.modal .lista-compras')
                tit = pg.locator('.modal .grupo-lista h4').all_inner_texts()
                ok(tit == ['Elétrica', 'Limpeza', 'Tintas', 'Sem categoria'], f'{papel}: divide por categoria, em ordem, "Sem categoria" por último: {tit}')
                txt = pg.inner_text('.modal')
                ok('Lâmpada LED 9W' in txt and '30 un' in pg.locator('.grupo-lista', has_text='Elétrica').inner_text(), f'{papel}: quantidade sugerida da lâmpada (30 un) em Elétrica')
                ok('Sabão' not in txt and 'Fita isolante' not in txt, f'{papel}: item já coberto por pedido e item só em atenção ficam de fora')
                ok('5 itens em 4 categorias' in txt.replace('\n', ' '), f'{papel}: resumo com a contagem')
                ok(pg.locator('.modal img').count() == 0 and XSS in txt, f'{papel}: nome malicioso aparece como texto')
                ok(not erros, f'{papel}: sem erros de script: {erros}')
                nav.close()

            nav, pg, erros, ch = abrir(pw, PORTA, UIDS['gestor'], dados('gestor'), 'compras', '#pagina .panel')
            # incluir itens em atenção
            pg.check('#inc-atencao'); pg.wait_for_timeout(200)
            pg.click('[data-acao=gerar-lista]'); pg.wait_for_selector('.modal .lista-compras')
            ok('Fita isolante' in pg.inner_text('.modal') and '6 itens em 4 categorias' in pg.inner_text('.modal').replace('\n', ' '), 'com "Incluir itens em atenção", a fita entra na lista')
            # copiar texto
            pg.evaluate("Object.defineProperty(navigator, 'clipboard', {value: {writeText: async (t) => { window.__copiado = t; }}, configurable: true})")
            pg.click('.modal [data-l=copiar]'); pg.wait_for_function('window.__copiado !== undefined')
            copiado = pg.evaluate('window.__copiado')
            ok(copiado.startswith('Lista de compras — Cond A — ') and '*Elétrica*\n- Fita isolante: 10 un\n- Lâmpada LED 9W: 30 un' in copiado, 'copiar texto: cabeçalho e itens por categoria')
            ok(copiado.count('*') == 8, 'copiar texto: 4 categorias com negrito')
            # planilha
            with pg.expect_download() as d: pg.click('.modal [data-l=csv]')
            arq = d.value; conteudo = open(arq.path(), encoding='utf-8').read()
            ok(arq.suggested_filename.startswith('lista-de-compras-') and arq.suggested_filename.endswith('.csv'), 'planilha: nome do arquivo')
            ok(conteudo.startswith('﻿Categoria;Item;Quantidade a comprar;Unidade;Estoque atual;Mínimo') and 'Elétrica;Lâmpada LED 9W;30;un;0;10' in conteudo, 'planilha: cabeçalho e linhas')
            # imprimir: marca o corpo, esconde o resto e mostra só a lista
            pg.evaluate("window.print = () => { window.__imp = document.body.classList.contains('imprimindo-lista'); }")
            pg.click('.modal [data-l=imprimir]'); pg.wait_for_function('window.__imp !== undefined')
            ok(pg.evaluate('window.__imp') is True, 'imprimir: marca o corpo da página para a impressão')
            pg.emulate_media(media='print')
            vis = pg.evaluate("""() => ({ resto: [...document.body.children].filter(e => !e.classList.contains('lista-compras-fundo') && e.tagName !== 'SCRIPT').every(e => getComputedStyle(e).display === 'none'),
                lista: getComputedStyle(document.querySelector('.lista-compras')).display !== 'none', botoes: getComputedStyle(document.querySelector('.modal .no-print')).display === 'none' })""")
            ok(vis['resto'] and vis['lista'] and vis['botoes'], f'impressão: só a lista aparece, sem menu nem botões: {vis}')
            pg.emulate_media(media='screen'); pg.evaluate("window.dispatchEvent(new Event('afterprint'))")
            ok(pg.evaluate("!document.body.classList.contains('imprimindo-lista')"), 'depois de imprimir, a página volta ao normal')
            ok(not [x for x in ch if x[0].startswith('POST') or x[0].startswith('PATCH')], 'gerar a lista não grava nada no banco')
            pg.click('.modal [data-fechar]'); pg.wait_for_selector('.modal', state='detached')
            # só os marcados
            pg.uncheck('#inc-atencao'); pg.wait_for_timeout(200)
            pg.check('[data-marca="bbbbbbbb-0000-0000-0000-000000000002"]'); pg.wait_for_timeout(200)
            pg.click('[data-acao=gerar-lista]'); pg.wait_for_selector('.modal .lista-compras')
            t2 = pg.inner_text('.modal')
            ok('só os itens marcados' in t2 and 'Lâmpada LED 9W' in t2 and 'Saco de lixo' not in t2 and pg.locator('.grupo-lista').count() == 1, 'com item marcado, a lista traz só os marcados')
            ok(not erros, f'sem erros de script: {erros}'); nav.close()

            # nada a comprar: sem botão
            nav, pg, erros, ch = abrir(pw, PORTA, UIDS['gestor'], dados('gestor', [i for i in ITENS if i['nome'] == 'Sabão']), 'compras', '#pagina .panel')
            ok(pg.locator('[data-acao=gerar-lista]').count() == 0 and 'Nenhum item precisa de compra' in pg.inner_text('#pagina'), 'sem itens para comprar não há botão')
            nav.close()
    finally: srv.terminate()
    relatorio(falhou)
main()
