"""Teste de navegador: lançamento de nota fiscal antiga (síndico) e reflexo nos gastos, com Supabase simulado."""
import sys, json, re, datetime; sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
from e2e_comum import *
from playwright.sync_api import sync_playwright
PORTA = 8805
CA = '11111111-1111-1111-1111-111111111111'
UIDS = {'sindico': 'aaaaaaaa-0000-0000-0000-000000000002', 'gestor': 'aaaaaaaa-0000-0000-0000-000000000003'}
NOVA = 'cccccccc-0000-0000-0000-000000000099'; R1 = 'cccccccc-0000-0000-0000-000000000001'; C2 = 'cccccccc-0000-0000-0000-000000000002'
ANO = datetime.date.today().year
XSS = '<img src=x onerror=alert(1)>'
def vc(i, data, valor, retro=False, **k):
    d = dict(compra_id=i, condominio_id=CA, data_compra=data, fornecedor='Elétrica Luz', fornecedor_id='f1', categoria=None, categoria_id=None,
             numero_nf=None, nf_arquivo_path=None, status='recebido', responsavel_id=UIDS['sindico'], aprovada_por=UIDS['sindico'],
             aprovada_em=f'{data}T12:00:00Z', observacoes=None, valor_total=valor, qtd_itens=0 if retro else 1, retroativa=retro)
    d.update(k); return d
COMPRAS = [vc(R1, f'{ANO}-02-10', 1234.56, True, categoria='Elétrica', categoria_id='cat-ele', numero_nf='000123',
              nf_arquivo_path=f'{CA}/{R1}/n.pdf', observacoes=XSS),
           vc(C2, f'{ANO}-02-20', 100, status='recebido')]
def dados(papel):
    def t(u, q, m, corpo, acc):
        if m == 'RPC:salvar_compra_retroativa': return corpo['p_id'] or NOVA
        if m == 'RPC:excluir_compra_retroativa': return f'{CA}/{R1}/n.pdf'
        if m.startswith('RPC'): return None
        if '/v_compras' in u:
            if 'compra_id' in q: return [c for c in COMPRAS if q['compra_id'][0] == 'eq.' + c['compra_id']]
            return COMPRAS
        if '/compra_itens' in u: return [{'compra_id': C2, 'item_id': 'i1', 'custo_total': 100, 'id': 'ci1', 'qtd_solicitada': 1, 'qtd_recebida': 1, 'custo_unitario': 100, 'vencimento_previsto': None}]
        if '/v_estoque_item' in u: return [{'item_id': 'i1', 'categoria': 'Limpeza', 'nome': 'Sabão', 'unidade': 'un', 'ativo': True, 'status': 'normal', 'qtd_sugerida': 0, 'qtd_em_pedido': 0, 'estoque_atual': 1, 'estoque_minimo': 0, 'estoque_ideal': 0}]
        if '/fornecedores' in u: return [{'id': 'f1', 'nome': 'Elétrica Luz', 'ativo': True}, {'id': 'f2', 'nome': 'Velho', 'ativo': False}]
        if '/categorias' in u: return [{'id': 'cat-ele', 'nome': 'Elétrica'}, {'id': 'cat-lim', 'nome': 'Limpeza'}]
        if '/profiles' in u and 'id=eq.' in u: return [{'id': UIDS[papel], 'nome': 'Pessoa', 'superadmin': False}]
        if '/profiles' in u: return [{'id': UIDS['sindico'], 'nome': 'Síndica Ana'}]
        if '/condominios' in u: return [{'id': CA, 'nome': 'Cond A', 'ativo': True}]
        if '/membros' in u: return [{'condominio_id': CA, 'papel': papel, 'ativo': True}]
    return t
def storage(pg, enviados):
    def h(route):
        if route.request.method == 'POST' and '/object/notas-fiscais/' in route.request.url: enviados.append(route.request.url)
        route.fulfill(status=200, content_type='application/json', body='{"Key":"x"}', headers={'access-control-allow-origin': '*'})
    pg.route(re.compile(r'https://.*supabase\.co/storage/.*'), h)
def rpcs(ch, nome): return [x[1] for x in ch if x[0] == nome]
def main():
    srv = servidor(PORTA); falhou = []; ok = checador(falhou)
    try:
        with sync_playwright() as pw:
            # ---- síndico: lançar
            nav, pg, erros, ch = abrir(pw, PORTA, UIDS['sindico'], dados('sindico'), 'compras', '[data-acao=retroativa]')
            enviados = []; storage(pg, enviados)
            pg.click('[data-acao=retroativa]'); pg.wait_for_selector('.modal form')
            ok(pg.locator('#rt-forn option').all_inner_texts() == ['—', 'Elétrica Luz'], 'só fornecedores ativos na lista')
            pg.fill('#rt-data', f'{ANO - 1}-05-10'); pg.click('.modal [data-salvar]')
            ok('valor da nota' in pg.inner_text('.modal [data-erro]'), 'valor obrigatório')
            pg.fill('#rt-valor', 'mil reais'); pg.click('.modal [data-salvar]')
            ok('valor da nota' in pg.inner_text('.modal [data-erro]'), 'valor por extenso é recusado')
            pg.fill('#rt-valor', '1.234,56'); pg.fill('#rt-data', f'{ANO + 1}-01-01'); pg.click('.modal [data-salvar]')
            ok('futuro' in pg.inner_text('.modal [data-erro]'), 'data no futuro é recusada')
            pg.fill('#rt-data', f'{ANO - 1}-05-10')
            pg.set_input_files('#rt-arq', files=[{'name': 'nota.txt', 'mimeType': 'text/plain', 'buffer': b'x'}]); pg.click('.modal [data-salvar]')
            ok('Formato' in pg.inner_text('.modal [data-erro]'), 'arquivo que não é PDF/imagem é recusado')
            ok(not rpcs(ch, 'salvar_compra_retroativa'), 'nada enviado ao banco com dados inválidos')
            pg.set_input_files('#rt-arq', files=[{'name': 'Nota 123.pdf', 'mimeType': 'application/pdf', 'buffer': b'%PDF-1.4'}])
            pg.select_option('#rt-forn', 'f1'); pg.select_option('#rt-cat', 'cat-ele'); pg.fill('#rt-nf', ' 000123 '); pg.fill('#rt-obs', 'Lâmpadas')
            pg.click('.modal [data-salvar]'); pg.wait_for_selector('.modal', state='detached')
            esperar_chamada(pg, ch, 'atualizar_nf_compra', 1)
            s = rpcs(ch, 'salvar_compra_retroativa')[0]
            ok(s == {'p_condominio_id': CA, 'p_id': None, 'p_dados': {'data_compra': f'{ANO - 1}-05-10', 'valor': '1234.56', 'fornecedor_id': 'f1',
                     'categoria_id': 'cat-ele', 'numero_nf': '000123', 'observacoes': 'Lâmpadas'}}, 'lançamento com valor lido de "1.234,56": %s' % s)
            a = rpcs(ch, 'atualizar_nf_compra')[0]
            ok(a['p_compra_id'] == NOVA and re.fullmatch(f'{CA}/{NOVA}/[0-9a-f-]{{36}}\\.pdf', a['p_arquivo_path']) and a['p_numero_nf'] == '000123', 'PDF anexado à nota lançada: %s' % a)
            ok(len(enviados) == 1, 'arquivo enviado para o armazenamento de notas fiscais')
            ok(pg.locator('[data-aba=compras].active').count() == 1 and pg.input_value('#f-status') == 'todas', 'depois de lançar mostra todas as compras')
            # lista e detalhes
            linha = pg.locator('#conteudo tbody tr', has_text='1.234,56')
            ok(linha.locator('[data-retro]').count() == 1 and '—' in linha.locator('td').nth(2).inner_text(), 'na lista: etiqueta "Nota antiga" e sem quantidade de itens')
            linha.locator('[data-acao=abrir]').click(); pg.wait_for_selector('.modal [data-a=corrigir]')
            t = pg.inner_text('.modal')
            ok('Nota antiga' in t and 'Elétrica' in t and '000123' in t and 'não alterou o estoque' in t, 'detalhes da nota antiga')
            ok(pg.locator('.modal img').count() == 0 and XSS in t, 'observação maliciosa aparece como texto')
            ok(pg.locator('.modal [data-a=receber], .modal [data-a=cancelar]').count() == 0, 'nota antiga não tem recebimento nem cancelamento')
            pg.click('.modal [data-a=corrigir]'); pg.wait_for_selector('.modal form')
            ok(pg.input_value('#rt-valor') == '1234,56' and pg.input_value('#rt-cat') == 'cat-ele' and pg.input_value('#rt-nf') == '000123', 'correção vem preenchida')
            pg.fill('#rt-valor', '1300'); pg.click('.modal [data-salvar]'); pg.wait_for_selector('.modal', state='detached')
            esperar_chamada(pg, ch, 'salvar_compra_retroativa', 2)
            s = rpcs(ch, 'salvar_compra_retroativa')[1]
            ok(s['p_id'] == R1 and s['p_dados']['valor'] == '1300', 'correção grava no mesmo lançamento')
            ok(len(rpcs(ch, 'atualizar_nf_compra')) == 1, 'corrigir sem arquivo novo não reenvia arquivo')
            pg.locator('#conteudo tbody tr', has_text='1.234,56').locator('[data-acao=abrir]').click(); pg.wait_for_selector('.modal [data-a=excluir]')
            pg.click('.modal [data-a=excluir]'); pg.wait_for_selector('.modal [data-r="0"]'); pg.click('.modal [data-r="0"]')
            ok(not rpcs(ch, 'excluir_compra_retroativa'), 'cancelar não exclui')
            pg.click('.modal [data-a=excluir]'); pg.wait_for_selector('.modal [data-r="1"]'); pg.click('.modal [data-r="1"]')
            esperar_chamada(pg, ch, 'excluir_compra_retroativa', 1)
            ok(rpcs(ch, 'excluir_compra_retroativa')[0] == {'p_id': R1}, 'excluir a nota certa')
            ok(not erros, 'síndico sem erros de script: %s' % erros); nav.close()

            # ---- gestor: vê, não lança nem corrige
            nav, pg, erros, ch = abrir(pw, PORTA, UIDS['gestor'], dados('gestor'), 'compras', '#pagina .page-head')
            ok(pg.locator('[data-acao=retroativa]').count() == 0, 'gestor não vê "Lançar nota antiga"')
            pg.click('[data-aba=compras]'); pg.select_option('#f-status', 'todas')
            pg.locator('#conteudo tbody tr', has_text='1.234,56').locator('[data-acao=abrir]').click(); pg.wait_for_selector('.modal [data-fechar]')
            ok(pg.locator('.modal [data-a=corrigir], .modal [data-a=excluir]').count() == 0 and 'Nota antiga' in pg.inner_text('.modal'), 'gestor vê os detalhes sem Corrigir/Excluir')
            ok(not erros, 'gestor sem erros: %s' % erros); nav.close()

            # ---- relatórios de gastos
            nav, pg, erros, ch = abrir(pw, PORTA, UIDS['sindico'], dados('sindico'), 'gastos', '#g-cat')
            pg.wait_for_function("window.Chart && Chart.getChart('g-cat')")
            cat = dict(zip(pg.evaluate("Chart.getChart('g-cat').data.labels"), pg.evaluate("Chart.getChart('g-cat').data.datasets[0].data")))
            ok(cat == {'Elétrica': 1234.56, 'Limpeza': 100}, 'pizza: nota antiga entra na categoria informada: %s' % cat)
            ok('1.334,56' in pg.inner_text('#pagina h3 >> nth=0'), 'total do ano soma a nota antiga')
            ok(pg.locator('#pagina tbody tr', has_text='000123').locator('[data-retro]').count() == 1, 'tabela marca "Nota antiga"')
            ok(not erros, 'gastos sem erros: %s' % erros); nav.close()
    finally: srv.terminate()
    relatorio(falhou)
main()
