"""Teste de navegador: atas das assembleias (morador, gestor e síndico), com Supabase simulado."""
import sys, json, re; sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
from e2e_comum import *
from playwright.sync_api import sync_playwright
PORTA = 8795
CA = '11111111-1111-1111-1111-111111111111'
UIDS = {'morador': 'aaaaaaaa-0000-0000-0000-000000000004', 'gestor': 'aaaaaaaa-0000-0000-0000-000000000003', 'sindico': 'aaaaaaaa-0000-0000-0000-000000000002'}
XSS = '<img src=x onerror=alert(1)>'
ID = lambda n: f'eeeeeeee-0000-0000-0000-0000000000{n:02d}'
def ata(n, titulo, data, tipo='ordinaria', resumo=None, pdf=True):
    return {'id': ID(n), 'data_assembleia': data, 'tipo': tipo, 'titulo': titulo, 'resumo': resumo,
            'arquivo_path': f'{CA}/{ID(n)}/a.pdf' if pdf else None, 'arquivo_nome': 'ata.pdf' if pdf else None, 'criado_em': data + 'T12:00:00Z'}
LISTA = [ata(1, 'AGO 2025', '2025-03-10', resumo='Aprovação das contas e eleição do síndico'),
         ata(2, 'AGE da fachada', '2026-06-01', 'extraordinaria'),
         ata(3, XSS, '2026-03-12', resumo='<script>alert(1)</script>'),
         ata(4, 'AGE piscina (sem PDF)', '2026-04-02', 'extraordinaria', pdf=False)]
def dados(papel, lista=None):
    lista = LISTA if lista is None else lista
    def t(u, q, m, corpo, acc):
        if m == 'RPC:salvar_ata': return corpo['p_id'] or ID(9)
        if m == 'RPC:excluir_ata': return f'{CA}/{corpo["p_id"]}/a.pdf'
        if m.startswith('RPC'): return None
        if '/atas' in u: return [a for a in lista if papel != 'morador' or a['arquivo_path']]   # como a regra do banco
        if '/profiles' in u and 'id=eq.' in u: return [{'id': UIDS[papel], 'nome': 'Pessoa', 'superadmin': False}]
        if '/condominios' in u: return [{'id': CA, 'nome': 'Cond A', 'ativo': True}]
        if '/membros' in u: return [{'condominio_id': CA, 'papel': papel, 'ativo': True}]
    return t
def storage(pg, assinadas, enviados):
    def h(route):
        u = route.request.url
        if '/object/sign/' in u:
            assinadas.append(u); return route.fulfill(status=200, content_type='application/json', body=json.dumps({'signedURL': '/object/sign/atas/x.pdf?token=t'}), headers={'access-control-allow-origin': '*'})
        if route.request.method == 'POST' and '/object/atas/' in u: enviados.append(u)
        route.fulfill(status=200, content_type='application/json', body='{"Key":"x"}', headers={'access-control-allow-origin': '*'})
    pg.route(re.compile(r'https://.*supabase\.co/storage/.*'), h)
PDF = {'name': 'Ata AGO.pdf', 'mimeType': 'application/pdf', 'buffer': b'%PDF-1.4 teste'}
def linhas(pg): return pg.locator('#pagina tbody tr')
def main():
    srv = servidor(PORTA); falhou = []; ok = checador(falhou)
    try:
        with sync_playwright() as pw:
            # ---- morador
            nav, pg, erros, ch = abrir(pw, PORTA, UIDS['morador'], dados('morador'), 'atas', '#pagina tbody tr')
            assinadas, enviados = [], []; storage(pg, assinadas, enviados)
            ok(linhas(pg).count() == 3, 'morador vê as 3 atas com PDF')
            ok(pg.locator('[data-acao=nova], [data-acao=editar], [data-acao=excluir], [data-sem-pdf]').count() == 0, 'morador não vê Nova, Editar, Excluir nem atas sem PDF')
            ok([linhas(pg).nth(i).locator('td').first.inner_text() for i in range(3)] == ['01/06/2026', '12/03/2026', '10/03/2025'], 'mais recente primeiro')
            ok(pg.locator('#pagina img, #pagina script').count() == 0 and XSS in pg.inner_text('#pagina'), 'título e resumo maliciosos aparecem como texto')
            pg.fill('#at-busca', 'eleicao sindico'); pg.wait_for_timeout(100)
            ok(linhas(pg).count() == 1 and 'AGO 2025' in linhas(pg).first.inner_text(), 'busca no resumo, sem acento')
            ok(pg.evaluate("document.activeElement.id") == 'at-busca', 'foco continua na busca ao digitar')
            pg.fill('#at-busca', 'nada disso'); pg.wait_for_timeout(100)
            ok('Nenhuma ata encontrada' in pg.inner_text('#pagina'), 'busca sem resultado avisa')
            pg.fill('#at-busca', ''); pg.select_option('#at-ano', '2025'); pg.wait_for_timeout(100)
            ok(linhas(pg).count() == 1, 'filtro por ano')
            ok(pg.locator('#at-ano option').all_inner_texts() == ['Todos os anos', '2026', '2025'], 'anos disponíveis')
            pg.select_option('#at-ano', '')
            pg.context.route(re.compile(r'.*token=t.*'), lambda r: r.fulfill(status=200, content_type='text/html', body='<p>pdf</p>'))   # PDF real viraria download no navegador sem tela
            with pg.context.expect_page() as nova:
                linhas(pg).first.locator('[data-acao=pdf]').click()
            try: nova.value.wait_for_url(re.compile('token=t'), timeout=5000, wait_until='commit')
            except Exception: pass
            ok(len(assinadas) == 1 and f'/atas/{CA}/{ID(2)}/a.pdf' in assinadas[0] and 'token=t' in nova.value.url, 'Abrir PDF gera link temporário da ata certa e abre em nova aba: %s %s' % (assinadas, nova.value.url))
            pg.set_viewport_size({'width': 390, 'height': 844}); pg.wait_for_timeout(200)
            ok(not pg.evaluate("[...document.querySelectorAll('.tabela-rolagem')].some(e => e.scrollWidth > e.clientWidth)") and linhas(pg).first.locator('[data-acao=pdf]').is_visible(), 'no celular: sem rolagem lateral e botão Abrir PDF visível')
            ok(not erros, 'morador sem erros de script: %s' % erros); nav.close()

            # ---- gestor
            nav, pg, erros, ch = abrir(pw, PORTA, UIDS['gestor'], dados('gestor'), 'atas', '#pagina tbody tr')
            assinadas, enviados = [], []; storage(pg, assinadas, enviados)
            ok(linhas(pg).count() == 4 and pg.locator('[data-sem-pdf]').count() == 1, 'gestor vê também a ata sem PDF, marcada')
            ok(pg.locator('[data-acao=excluir]').count() == 0 and pg.locator('[data-acao=editar]').count() == 4, 'gestor edita mas não exclui')
            pg.click('[data-acao=nova]'); pg.wait_for_selector('.modal form')
            pg.fill('#at-titulo', 'AGO 2026'); pg.fill('#at-data', '2026-03-12'); pg.click('.modal [data-salvar]')
            ok('Selecione o PDF' in pg.inner_text('.modal [data-erro]'), 'nova ata exige o PDF')
            pg.set_input_files('#at-pdf', files=[{'name': 'foto.jpg', 'mimeType': 'image/jpeg', 'buffer': b'x'}]); pg.click('.modal [data-salvar]')
            ok('precisa ser um arquivo PDF' in pg.inner_text('.modal [data-erro]'), 'só PDF')
            pg.set_input_files('#at-pdf', files=[PDF]); pg.fill('#at-data', '2099-01-01'); pg.click('.modal [data-salvar]')
            ok('futuro' in pg.inner_text('.modal [data-erro]'), 'data no futuro é recusada')
            ok(not [x for x in ch if x[0] == 'salvar_ata'], 'nada enviado ao banco com dados inválidos')
            pg.fill('#at-data', '2026-03-12'); pg.select_option('#at-tipo', 'extraordinaria'); pg.fill('#at-resumo', 'Contas aprovadas')
            pg.click('.modal [data-salvar]'); pg.wait_for_selector('.modal', state='detached')
            esperar_chamada(pg, ch, 'definir_arquivo_ata', 1)
            s = [x for x in ch if x[0] == 'salvar_ata'][0][1]
            ok(s == {'p_condominio_id': CA, 'p_id': None, 'p_dados': {'titulo': 'AGO 2026', 'data_assembleia': '2026-03-12', 'tipo': 'extraordinaria', 'resumo': 'Contas aprovadas'}}, 'salvar_ata com os dados certos: %s' % s)
            d = [x for x in ch if x[0] == 'definir_arquivo_ata'][0][1]
            ok(re.fullmatch(f'{CA}/{ID(9)}/[0-9a-f-]{{36}}\\.pdf', d['p_path']) and d['p_nome'] == 'Ata AGO.pdf', 'PDF no caminho condomínio/ata/arquivo.pdf e com o nome original: %s' % d)
            ok(len(enviados) == 1 and d['p_path'] in enviados[0].replace('%2F', '/'), 'PDF enviado ao armazenamento de atas')
            # editar sem trocar o PDF
            pg.locator('tbody tr', has_text='AGE da fachada').locator('[data-acao=editar]').click(); pg.wait_for_selector('.modal form')
            ok(pg.input_value('#at-titulo') == 'AGE da fachada' and pg.input_value('#at-data') == '2026-06-01' and pg.input_value('#at-tipo') == 'extraordinaria', 'editor vem preenchido')
            pg.fill('#at-titulo', 'AGE da fachada (aprovada)'); pg.click('.modal [data-salvar]'); pg.wait_for_selector('.modal', state='detached')
            esperar_chamada(pg, ch, 'salvar_ata', 2)
            s = [x for x in ch if x[0] == 'salvar_ata'][1][1]
            ok(s['p_id'] == ID(2) and s['p_dados']['titulo'] == 'AGE da fachada (aprovada)', 'edição salva a ata certa')
            ok(len([x for x in ch if x[0] == 'definir_arquivo_ata']) == 1 and len(enviados) == 1, 'editar sem novo PDF não reenvia arquivo')
            # ata sem PDF: completar enviando o PDF
            pg.locator('tbody tr', has_text='sem PDF').locator('[data-acao=editar]').click(); pg.wait_for_selector('.modal form')
            pg.click('.modal [data-salvar]')
            ok('Selecione o PDF' in pg.inner_text('.modal [data-erro]'), 'ata sem PDF: editar pede o PDF')
            pg.keyboard.press('Escape')
            ok(not erros, 'gestor sem erros de script: %s' % erros); nav.close()

            # ---- síndico: excluir
            nav, pg, erros, ch = abrir(pw, PORTA, UIDS['sindico'], dados('sindico'), 'atas', '#pagina tbody tr')
            assinadas, enviados = [], []; storage(pg, assinadas, enviados)
            pg.locator('tbody tr', has_text='AGO 2025').locator('[data-acao=excluir]').click(); pg.wait_for_selector('.modal [data-r="0"]')
            ok('AGO 2025' in pg.inner_text('.modal'), 'confirmação cita a ata')
            pg.click('.modal [data-r="0"]')
            ok(not [x for x in ch if x[0] == 'excluir_ata'], 'cancelar não exclui')
            pg.locator('tbody tr', has_text='AGO 2025').locator('[data-acao=excluir]').click(); pg.wait_for_selector('.modal [data-r="1"]'); pg.click('.modal [data-r="1"]')
            esperar_chamada(pg, ch, 'excluir_ata', 1)
            ok([x for x in ch if x[0] == 'excluir_ata'][0][1] == {'p_id': ID(1)}, 'confirmar exclui a ata certa')
            ok(not erros, 'síndico sem erros de script: %s' % erros); nav.close()

            # ---- vazio
            nav, pg, erros, ch = abrir(pw, PORTA, UIDS['morador'], dados('morador', []), 'atas', '#pagina .empty')
            ok('Nenhuma ata cadastrada' in pg.inner_text('#pagina') and 'Nova ata' not in pg.inner_text('#pagina'), 'sem atas: aviso simples para o morador')
            ok(not erros, 'vazio sem erros: %s' % erros); nav.close()
    finally: srv.terminate()
    relatorio(falhou)
main()
