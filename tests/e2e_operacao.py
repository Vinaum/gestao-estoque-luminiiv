"""Teste de navegador da Operação diária (Supabase simulado; confere telas, validações e dados enviados)."""
import json, base64, subprocess, time, sys, os, re
from playwright.sync_api import sync_playwright

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); PORTA = 8778
REF = 'aiuwreyhnubprlapkxli'; COND = '11111111-1111-1111-1111-111111111111'; UID = 'aaaaaaaa-0000-0000-0000-000000000003'
I1 = 'bbbbbbbb-0000-0000-0000-000000000001'; I2 = 'bbbbbbbb-0000-0000-0000-000000000002'; L1 = 'cccccccc-0000-0000-0000-000000000001'
XSS = '<img src=x onerror=alert(1)>'
def b64(d): return base64.urlsafe_b64encode(json.dumps(d).encode()).decode().rstrip('=')
def jwt(u): return f"{b64({'alg':'HS256'})}.{b64({'sub':u,'exp':4102444800})}.x"

ITENS = [
 dict(item_id=I1, condominio_id=COND, nome='Papel toalha', categoria='Limpeza', unidade='cx', localizacao='Depósito', estoque_atual=4, status='comprar', ativo=True),
 dict(item_id=I2, condominio_id=COND, nome=XSS, categoria='Outros', unidade='un', localizacao=None, estoque_atual=0, status='sem_estoque_cadastrado', ativo=True),
]
MOVS = [
 dict(id='dddddddd-0000-0000-0000-000000000001', item_id=I1, lote_id=L1, tipo='consumo', sinal=-1, quantidade=4, motivo='Uso diário', justificativa=None, data_hora='2026-11-16T12:00:00Z', responsavel_id=UID, recebimento_item_id=None, estorno_de=None),
 dict(id='dddddddd-0000-0000-0000-000000000002', item_id=I1, lote_id=L1, tipo='entrada', sinal=1, quantidade=8, motivo='Recebimento', justificativa=None, data_hora='2026-11-15T12:00:00Z', responsavel_id=UID, recebimento_item_id='eeeeeeee-0000-0000-0000-000000000001', estorno_de=None),
]
def main():
    srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORTA), '--directory', RAIZ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(1)
    falhou = []; chamadas = []
    def ok(c, msg):
        print(('OK   ' if c else 'FALHOU'), msg)
        if not c: falhou.append(msg)
    try:
        with sync_playwright() as pw:
            nav = pw.chromium.launch(); pg = nav.new_context().new_page(); erros = []
            pg.on('pageerror', lambda e: erros.append(str(e))); pg.on('dialog', lambda d: (erros.append('ALERTA'), d.dismiss()))
            def rest(route):
                rq = route.request; u = rq.url; corpo = []
                if '/rpc/' in u:
                    chamadas.append((u.split('/rpc/')[1].split('?')[0], rq.post_data_json))
                    if 'estornar' in u and chamadas[-1][1]['p_justificativa'] == 'x': pass
                    corpo = {}
                elif '/profiles' in u and 'id=eq.' in u: corpo = {'id': UID, 'nome': 'Gestora', 'superadmin': False}
                elif '/profiles' in u: corpo = [{'id': UID, 'nome': 'Gestora'}]
                elif '/condominios' in u: corpo = [{'id': COND, 'nome': 'Cond A', 'ativo': True}]
                elif '/membros' in u: corpo = [{'condominio_id': COND, 'papel': 'gestor', 'ativo': True}]
                elif '/v_estoque_item' in u: corpo = ITENS
                elif '/v_lotes' in u: corpo = [dict(lote_id=L1, codigo='L001', saldo=4, vencimento='2027-03-01', data_entrada='2026-11-15', origem='compra')]
                elif '/movimentacoes' in u: corpo = MOVS
                elif '/lotes' in u: corpo = [{'id': L1, 'codigo': 'L001'}]
                elif '/categorias' in u: corpo = [{'id': 'f1', 'nome': 'Limpeza'}]
                elif '/unidades_medida' in u: corpo = [{'id': 'f2', 'sigla': 'un', 'nome': 'unidade'}]
                elif '/itens' in u and rq.method == 'POST': chamadas.append(('itens.insert', rq.post_data_json)); route.fulfill(status=201, body='', headers={'access-control-allow-origin': '*'}); return
                route.fulfill(status=200, content_type='application/json', body=json.dumps(corpo), headers={'access-control-allow-origin': '*'})
            pg.route(re.compile(r'https://.*supabase\.co/rest/v1/.*'), rest)
            pg.route(re.compile(r'https://.*supabase\.co/(auth|realtime).*'), lambda r: r.fulfill(status=200, content_type='application/json', body='{}', headers={'access-control-allow-origin': '*'}))
            pg.route(re.compile(r'https://fonts\..*'), lambda r: r.fulfill(status=200, body=''))
            sess = {'access_token': jwt(UID), 'refresh_token': 'r', 'expires_in': 3600, 'expires_at': 4102444800, 'token_type': 'bearer', 'user': {'id': UID, 'email': 'g@t.com', 'aud': 'authenticated'}}
            pg.add_init_script(f"localStorage.setItem('sb-{REF}-auth-token', {json.dumps(json.dumps(sess))});")
            pg.goto(f'http://localhost:{PORTA}/{os.environ.get("APP_CAMINHO", "app")}/index.html#/operacao'); pg.wait_for_selector('#lista-itens table', timeout=8000)
            ok(pg.locator('#lista-itens tbody tr').count() == 2, 'lista mostra 2 itens')
            ok(pg.locator('#lista-itens img').count() == 0 and XSS in pg.inner_text('#lista-itens'), 'nome malicioso aparece como texto')
            ok(pg.locator('.cards .card').nth(1).inner_text().strip().endswith('1'), 'cartão "Para comprar" = 1')
            ok(pg.locator('[data-acao=saida][data-id="%s"]' % I2).is_disabled(), 'saída desabilitada para item sem estoque')
            ok(pg.locator('[data-acao=estornar]').count() == 1, 'estorno só na movimentação estornável (recebimento não tem)')
            # filtro
            pg.fill('#f-texto', 'papel'); ok(pg.locator('#lista-itens tbody tr').count() == 1, 'busca filtra a lista')
            pg.fill('#f-texto', ''); pg.select_option('#f-status', 'comprar'); ok(pg.locator('#lista-itens tbody tr').count() == 1, 'filtro por situação')
            pg.select_option('#f-status', '')
            # saída: validação
            pg.click('[data-acao=saida][data-id="%s"]' % I1); pg.wait_for_selector('.modal form')
            pg.click('.modal button[type=submit]'); ok('quantidade' in pg.inner_text('.modal [data-erro]').lower(), 'saída sem quantidade é recusada na tela')
            ok(not [c for c in chamadas if c[0] == 'registrar_saida'], 'nada foi enviado ao banco com dados inválidos')
            pg.fill('#s-qtd', '1,5'); pg.fill('#s-motivo', 'Uso diário'); pg.select_option('#s-tipo', 'perda')
            pg.click('.modal button[type=submit]'); pg.wait_for_selector('.modal', state='detached')
            c = [x for x in chamadas if x[0] == 'registrar_saida']
            ok(len(c) == 1 and c[0][1]['p_quantidade'] == 1.5 and c[0][1]['p_tipo'] == 'perda' and c[0][1]['p_item_id'] == I1 and c[0][1]['p_lote_id'] is None, 'saída envia quantidade 1,5 -> 1.5, tipo, item e lote automático')
            ok(re.fullmatch(r'[0-9a-f-]{36}', c[0][1]['p_chave']) is not None, 'saída envia chave de operação (uuid)')
            # entrada
            pg.click('[data-acao=entrada][data-id="%s"]' % I1); pg.wait_for_selector('.modal form')
            pg.fill('#e-qtd', '10'); pg.fill('#e-motivo', 'Sobra de obra'); pg.fill('#e-custo', '2,50'); pg.fill('#e-venc', '2027-05-01')
            pg.click('.modal button[type=submit]'); pg.wait_for_selector('.modal', state='detached')
            c = [x for x in chamadas if x[0] == 'registrar_entrada_extraordinaria']
            ok(len(c) == 1 and c[0][1]['p_custo_unitario'] == 2.5 and c[0][1]['p_vencimento'] == '2027-05-01' and c[0][1]['p_origem'] == 'entrada_extraordinaria', 'entrada envia custo 2,50 -> 2.5, validade e origem')
            # ajuste
            pg.click('[data-acao=ajuste][data-id="%s"]' % I1); pg.wait_for_selector('.modal form')
            pg.fill('#a-qtd', '3'); pg.fill('#a-just', 'abc'); pg.click('.modal button[type=submit]')
            ok('justificativa' in pg.inner_text('.modal [data-erro]').lower(), 'ajuste com justificativa curta é recusado na tela')
            pg.fill('#a-just', 'Contagem física'); pg.click('.modal button[type=submit]'); pg.wait_for_selector('.modal', state='detached')
            c = [x for x in chamadas if x[0] == 'registrar_ajuste']
            ok(len(c) == 1 and c[0][1]['p_quantidade_fisica'] == 3 and c[0][1]['p_lote_id'] == L1, 'ajuste envia quantidade contada e lote')
            # estorno
            pg.click('[data-acao=estornar]'); pg.wait_for_selector('.modal textarea')
            pg.fill('.modal textarea', 'lançado errado'); pg.click('.modal [data-r="1"]'); pg.wait_for_selector('.modal', state='detached')
            c = [x for x in chamadas if x[0] == 'estornar_movimentacao']
            ok(len(c) == 1 and c[0][1]['p_mov_id'] == MOVS[0]['id'] and c[0][1]['p_justificativa'] == 'lançado errado', 'estorno envia a movimentação e a justificativa')
            # novo item
            pg.click('[data-acao=novo-item]'); pg.wait_for_selector('.modal form')
            pg.fill('#n-nome', 'Lâmpada 9W'); pg.fill('#n-min', '10'); pg.fill('#n-ideal', '5'); pg.click('.modal button[type=submit]')
            ok('ideal' in pg.inner_text('.modal [data-erro]').lower(), 'ideal menor que mínimo é recusado na tela')
            pg.fill('#n-ideal', '30'); pg.click('.modal button[type=submit]'); pg.wait_for_selector('.modal', state='detached')
            c = [x for x in chamadas if x[0] == 'itens.insert']
            ok(len(c) == 1 and c[0][1]['nome'] == 'Lâmpada 9W' and c[0][1]['estoque_minimo'] == 10 and c[0][1]['estoque_ideal'] == 30 and c[0][1]['condominio_id'] == COND, 'novo item enviado com condomínio, mínimo e ideal')
            ok('estoque_atual' not in json.dumps(c[0][1]), 'cadastro não envia estoque atual')
            ok(not erros, 'sem erros de script: %s' % erros)
            nav.close()
    finally: srv.terminate()
    print('RESULTADO:', 'FALHOU %s' % falhou if falhou else 'TUDO OK'); sys.exit(1 if falhou else 0)
main()
