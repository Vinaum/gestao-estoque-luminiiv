"""Teste de navegador: Início do morador (comunicados recentes, "novo" e atalhos), com Supabase simulado."""
import sys; sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
from e2e_comum import *
from playwright.sync_api import sync_playwright
PORTA = 8792
CA = '11111111-1111-1111-1111-111111111111'; MOR = 'aaaaaaaa-0000-0000-0000-000000000004'
XSS = '<img src=x onerror=alert(1)>'
ID = lambda n: f'dddddddd-0000-0000-0000-0000000000{n:02d}'
def com(n, titulo, status='publicado', dia=10, **k):
    d = {'id': ID(n), 'titulo': titulo, 'corpo': 'Texto do aviso', 'tipo': 'aviso', 'fixado': False, 'status': status,
         'publicado_em': f'2026-11-{dia:02d}T12:00:00Z', 'expira_em': None, 'criado_em': '2026-11-01T12:00:00Z'}
    d.update(k); return d
def dados(lista, lidos=()):
    def t(u, q, m, corpo, acc):
        if m.startswith('RPC'): return {}
        if '/comunicado_leituras' in u: return [{'comunicado_id': i} for i in lidos]
        if '/comunicados' in u: return lista
        if '/profiles' in u and 'id=eq.' in u: return [{'id': MOR, 'nome': 'Maria', 'superadmin': False}]
        if '/condominios' in u: return [{'id': CA, 'nome': 'Cond A', 'ativo': True}]
        if '/membros' in u: return [{'condominio_id': CA, 'papel': 'morador', 'ativo': True}]
    return t
LISTA = [com(1, 'Corte de água', dia=12), com(2, XSS, dia=9, fixado=True), com(3, 'Rascunho X', 'rascunho'), com(4, 'Antigo', 'arquivado'),
         com(5, 'Vencido', expira_em='2020-01-01T00:00:00Z'), com(6, 'Obra no hall', dia=11), com(7, 'Assembleia', dia=8), com(8, 'Mais antigo', dia=2)]
def main():
    srv = servidor(PORTA); falhou = []; ok = checador(falhou)
    try:
        with sync_playwright() as pw:
            nav, pg, erros, ch = abrir(pw, PORTA, MOR, dados(LISTA, lidos=[ID(1)]), 'inicio', '[data-inicio-com]')
            ok(pg.locator('[data-inicio-com]').count() == 3, 'mostra só 3 comunicados')
            ok('Olá, Maria' in pg.inner_text('#pagina h2'), 'saudação com o nome')
            ok(pg.locator('[data-novos]').inner_text().strip() == '4 novos', 'contador: 4 novos (1 lido; rascunho, arquivado e vencido não contam)')
            ok(pg.locator('[data-inicio-com]').first.inner_text().count('Fixado') == 1, 'fixado vem primeiro')
            t = pg.inner_text('#pagina')
            ok('Rascunho X' not in t and 'Antigo' not in t and 'Vencido' not in t, 'rascunho, arquivado e vencido não aparecem')
            ok(pg.locator('[data-inicio-com] .tag-novo').count() == 2 and pg.locator('[data-inicio-com]', has_text='Corte de água').locator('.tag-novo').count() == 0, 'cartões não lidos têm "Novo"; o lido não')
            ok(pg.locator('#pagina img').count() == 0 and XSS in t, 'título malicioso aparece como texto')
            ok('Ver todos os comunicados (5)' in t, 'atalho informa o total vigente')
            ok(pg.locator('#pagina a[href="#/prestadores"]').count() == 1, 'atalho para Prestadores')
            pg.click('[data-inicio-com] >> nth=0'); pg.wait_for_function("location.hash === '#/comunicados'")
            ok(True, 'clicar num comunicado leva à lista de comunicados')
            ok(not erros, 'início sem erros de script: %s' % erros); nav.close()

            nav, pg, erros, ch = abrir(pw, PORTA, MOR, dados([]), 'inicio', '#pagina .empty')
            ok('Nenhum comunicado no momento' in pg.inner_text('#pagina') and pg.locator('[data-novos]').count() == 0, 'sem comunicados: aviso e sem contador')
            ok(pg.locator('#pagina a[href="#/prestadores"]').count() == 1, 'atalho de prestadores continua')
            ok(not erros, 'início vazio sem erros: %s' % erros); nav.close()

            nav, pg, erros, ch = abrir(pw, PORTA, MOR, dados(LISTA, lidos=[x['id'] for x in LISTA]), 'inicio', '[data-inicio-com]')
            ok(pg.locator('[data-novos]').count() == 0, 'tudo lido: sem contador de novos')
            ok('Ver todos os comunicados (5)' in pg.inner_text('#pagina'), 'continua listando os recentes'); nav.close()
    finally:
        srv.terminate()
    relatorio(falhou)
main()
