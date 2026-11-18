"""Teste de navegador: serviços contratados e pagamentos (gestor e síndico) e reflexo em gastos e painel, com Supabase simulado."""
import sys, json, re, datetime; sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
from e2e_comum import *
from playwright.sync_api import sync_playwright
PORTA = 8807
CA = '11111111-1111-1111-1111-111111111111'
UIDS = {'sindico': 'aaaaaaaa-0000-0000-0000-000000000002', 'gestor': 'aaaaaaaa-0000-0000-0000-000000000003', 'morador': 'aaaaaaaa-0000-0000-0000-000000000004'}
HOJE = datetime.date.today(); ANO = HOJE.year; MES = f'{ANO}-{HOJE.month:02d}'
NOVO = 'dddddddd-0000-0000-0000-000000000099'; PAG = 'eeeeeeee-0000-0000-0000-000000000099'
XSS = '<img src=x onerror=alert(1)>'
SID = lambda n: f'dddddddd-0000-0000-0000-0000000000{n:02d}'
PID = lambda n: f'eeeeeeee-0000-0000-0000-0000000000{n:02d}'
def sv(n, nome, servico, **k):
    d = dict(id=SID(n), condominio_id=CA, nome=nome, servico=servico, telefone=None, email=None, valor_combinado=None,
             periodicidade='mensal', dia_pagamento=None, observacoes=None, ativo=True)
    d.update(k); return d
SERV = [sv(1, 'Piscinas Azul', 'Piscineiro', telefone='11987654321', valor_combinado=850, dia_pagamento=1),
        sv(2, XSS, 'Jardineiro', periodicidade='por_visita', valor_combinado=150),
        sv(3, 'Dedetiza Já', 'Dedetização', dia_pagamento=28),
        sv(4, 'Elevadores Velho', 'Elevador', ativo=False)]
PAGS = [dict(id=PID(1), servico_id=SID(1), data_pagamento=f'{MES}-01' if HOJE.day >= 1 else f'{MES}-01', valor=850, referencia='Este mês', numero_recibo='R-77',
             observacao=None, comprovante_path=f'{CA}/{PID(1)}/r.pdf', comprovante_nome='r.pdf', registrado_por=UIDS['gestor']),
        dict(id=PID(2), servico_id=SID(2), data_pagamento=f'{ANO}-01-15', valor=150, referencia=None, numero_recibo=None,
             observacao=None, comprovante_path=None, comprovante_nome=None, registrado_por=UIDS['sindico'])]
def dados(papel):
    def t(u, q, m, corpo, acc):
        if m == 'RPC:salvar_servico': return corpo['p_id'] or NOVO
        if m == 'RPC:registrar_pagamento_servico': return PAG
        if m == 'RPC:excluir_pagamento_servico': return f'{CA}/{PID(1)}/r.pdf'
        if m.startswith('RPC'): return None
        if '/servicos_contratados' in u: return SERV
        if '/servico_pagamentos' in u:
            if 'servico_id' in q: return [p for p in PAGS if q['servico_id'][0] == 'eq.' + p['servico_id']]
            return PAGS
        if '/v_compras' in u: return [dict(compra_id='c1', condominio_id=CA, data_compra=f'{ANO}-01-10', fornecedor='Loja', numero_nf='9', status='recebido', valor_total=100, retroativa=False)]
        if '/compra_itens' in u: return [{'compra_id': 'c1', 'item_id': 'i1', 'custo_total': 100}]
        if '/v_estoque_item' in u: return [{'item_id': 'i1', 'categoria': 'Limpeza', 'nome': 'Sabão', 'ativo': True, 'status': 'normal', 'qtd_sugerida': 0, 'qtd_em_pedido': 0, 'estoque_atual': 1}]
        if '/profiles' in u and 'id=eq.' in u: return [{'id': UIDS[papel], 'nome': 'Pessoa', 'superadmin': False}]
        if '/profiles' in u: return [{'id': UIDS['gestor'], 'nome': 'Gestora Bia'}, {'id': UIDS['sindico'], 'nome': 'Síndica Ana'}]
        if '/condominios' in u: return [{'id': CA, 'nome': 'Cond A', 'ativo': True}]
        if '/membros' in u: return [{'condominio_id': CA, 'papel': papel, 'ativo': True}]
    return t
def storage(pg, enviados):
    def h(route):
        u = route.request.url
        if '/object/sign/' in u: return route.fulfill(status=200, content_type='application/json', body=json.dumps({'signedURL': '/object/sign/servicos/x.pdf?token=t'}), headers={'access-control-allow-origin': '*'})
        if route.request.method == 'POST' and '/object/servicos/' in u: enviados.append(u)
        route.fulfill(status=200, content_type='application/json', body='{"Key":"x"}', headers={'access-control-allow-origin': '*'})
    pg.route(re.compile(r'https://.*supabase\.co/storage/.*'), h)
    pg.context.route(re.compile(r'.*token=t.*'), lambda r: r.fulfill(status=200, content_type='text/html', body='<p>ok</p>'))
def rpcs(ch, nome): return [x[1] for x in ch if x[0] == nome]
def linha(pg, txt): return pg.locator('#pagina tbody tr', has_text=txt)
def main():
    srv = servidor(PORTA); falhou = []; ok = checador(falhou)
    try:
        with sync_playwright() as pw:
            # ---- gestor
            nav, pg, erros, ch = abrir(pw, PORTA, UIDS['gestor'], dados('gestor'), 'servicos', '#pagina tbody tr')
            enviados = []; storage(pg, enviados)
            ok(pg.locator('#pagina tbody tr').count() == 3, 'lista só os ativos')
            ok(pg.locator('[data-acao=desativar], [data-acao=reativar]').count() == 0, 'gestor não desativa')
            ok(linha(pg, 'Piscinas Azul').locator('[data-situacao=pago]').count() == 1, 'mensal pago no mês aparece como pago')
            dd = linha(pg, 'Dedetiza Já').locator('[data-situacao]').get_attribute('data-situacao')
            ok(dd == ('atrasado' if HOJE.day > 28 else 'pendente'), 'mensal sem pagamento: a pagar (ou atrasado depois do dia): %s' % dd)
            ok(linha(pg, 'Jardineiro').locator('[data-situacao]').count() == 0, 'por visita não tem situação do mês')
            ok(pg.locator('#pagina img').count() == 0 and XSS in pg.inner_text('#pagina'), 'nome malicioso como texto')
            ok(linha(pg, 'Piscinas Azul').locator('a[href="https://wa.me/5511987654321"]').count() == 1 and linha(pg, 'Piscinas Azul').locator('a[href="tel:+5511987654321"]').count() == 1, 'links de ligar e WhatsApp')
            esperado_apagar = '1'
            ok(pg.inner_text('[data-resumo=ativos]') == '3' and pg.inner_text('[data-resumo=apagar]') == esperado_apagar, 'cartões: 3 ativos e 1 mensal a pagar')
            pg.check('#sv-inativos'); ok(pg.locator('#pagina tbody tr').count() == 4 and 'desativado' in linha(pg, 'Elevadores Velho').inner_text(), 'mostrar desativados'); pg.uncheck('#sv-inativos')
            # novo serviço
            pg.click('[data-acao=novo]'); pg.wait_for_selector('.modal form')
            pg.fill('#sv-nome', 'João Jardins'); pg.click('.modal [data-salvar]')
            ok('Informe o serviço' in pg.inner_text('.modal [data-erro]'), 'serviço obrigatório')
            pg.fill('#sv-servico', 'Jardineiro'); pg.fill('#sv-tel', '1234'); pg.click('.modal [data-salvar]')
            ok('Telefone inválido' in pg.inner_text('.modal [data-erro]'), 'telefone inválido')
            pg.fill('#sv-tel', '(11) 3333-4444'); pg.fill('#sv-valor', '1.200,50'); pg.fill('#sv-dia', '40'); pg.click('.modal [data-salvar]')
            ok('1 a 31' in pg.inner_text('.modal [data-erro]') and not rpcs(ch, 'salvar_servico'), 'dia inválido e nada enviado')
            pg.fill('#sv-dia', '5'); pg.click('.modal [data-salvar]'); pg.wait_for_selector('.modal', state='detached')
            esperar_chamada(pg, ch, 'salvar_servico', 1)
            s = rpcs(ch, 'salvar_servico')[0]
            ok(s['p_id'] is None and s['p_dados']['valor_combinado'] == '1200.5' and s['p_dados']['dia_pagamento'] == '5' and s['p_dados']['telefone'] == '(11) 3333-4444' and s['p_dados']['periodicidade'] == 'mensal', 'novo serviço com valor lido de "1.200,50": %s' % s)
            # registrar pagamento com comprovante
            linha(pg, 'Dedetiza Já').locator('[data-acao=pagar]').click(); pg.wait_for_selector('.modal form')
            ok(pg.input_value('#pg-ref') != '' and '/' in pg.input_value('#pg-ref'), 'mensal: referência do mês já preenchida')
            pg.fill('#pg-valor', ''); pg.click('.modal [data-salvar]')
            ok('valor pago' in pg.inner_text('.modal [data-erro]'), 'valor obrigatório')
            pg.fill('#pg-valor', '320,00'); pg.fill('#pg-data', f'{ANO + 1}-01-01'); pg.click('.modal [data-salvar]')
            ok('futuro' in pg.inner_text('.modal [data-erro]') and not rpcs(ch, 'registrar_pagamento_servico'), 'data futura recusada')
            pg.fill('#pg-data', HOJE.isoformat()); pg.fill('#pg-rec', 'NF 55')
            pg.set_input_files('#pg-arq', files=[{'name': 'Recibo.pdf', 'mimeType': 'application/pdf', 'buffer': b'%PDF-1.4'}])
            pg.click('.modal [data-salvar]'); pg.wait_for_selector('.modal', state='detached')
            esperar_chamada(pg, ch, 'definir_comprovante_pagamento', 1)
            r = rpcs(ch, 'registrar_pagamento_servico')[0]
            ok(r['p_servico_id'] == SID(3) and r['p_dados']['valor'] == '320' and r['p_dados']['numero_recibo'] == 'NF 55' and re.fullmatch(r'[0-9a-f-]{36}', r['p_chave']), 'pagamento registrado com chave única: %s' % r)
            d = rpcs(ch, 'definir_comprovante_pagamento')[0]
            ok(re.fullmatch(f'{CA}/{PAG}/[0-9a-f-]{{36}}\\.pdf', d['p_path']) and d['p_nome'] == 'Recibo.pdf' and len(enviados) == 1, 'comprovante enviado e ligado ao pagamento: %s' % d)
            # sem valor combinado: por visita usa o combinado de 150
            linha(pg, 'Jardineiro').locator('[data-acao=pagar]').click(); pg.wait_for_selector('.modal form')
            ok(pg.input_value('#pg-valor') == '150,00' and pg.input_value('#pg-ref') == '', 'por visita: valor combinado sugerido e sem referência de mês')
            pg.keyboard.press('Escape')
            # histórico
            linha(pg, 'Piscinas Azul').locator('[data-acao=historico]').click(); pg.wait_for_selector('.modal [data-pag]')
            t = pg.inner_text('.modal')
            ok('R-77' in t and 'Gestora Bia' in t and pg.locator('.modal [data-h=ver]').count() == 1, 'histórico com recibo, quem registrou e comprovante')
            ok(pg.locator('.modal [data-h=corrigir], .modal [data-h=excluir]').count() == 0, 'gestor não corrige nem exclui pagamento')
            with pg.context.expect_page() as nova: pg.click('.modal [data-h=ver]')
            try: nova.value.wait_for_url(re.compile('token=t'), timeout=5000, wait_until='commit')
            except Exception: pass
            ok('token=t' in nova.value.url, 'comprovante abre em nova aba')
            pg.keyboard.press('Escape'); pg.set_viewport_size({'width': 390, 'height': 844}); pg.wait_for_timeout(200)
            ok(not pg.evaluate("[...document.querySelectorAll('#pagina .tabela-rolagem')].some(e => e.scrollWidth > e.clientWidth)") and linha(pg, 'Piscinas Azul').locator('[data-acao=pagar]').is_visible(), 'no celular: sem rolagem lateral e botão de pagamento visível')
            ok(not erros, 'gestor sem erros: %s' % erros); nav.close()

            # ---- síndico: desativar, corrigir e excluir pagamento
            nav, pg, erros, ch = abrir(pw, PORTA, UIDS['sindico'], dados('sindico'), 'servicos', '#pagina tbody tr')
            enviados = []; storage(pg, enviados)
            linha(pg, 'Dedetiza Já').locator('[data-acao=desativar]').click(); pg.wait_for_selector('.modal [data-r="1"]'); pg.click('.modal [data-r="1"]')
            esperar_chamada(pg, ch, 'definir_servico_ativo', 1)
            ok(rpcs(ch, 'definir_servico_ativo')[0] == {'p_id': SID(3), 'p_ativo': False}, 'síndico desativa o serviço certo')
            pg.check('#sv-inativos'); linha(pg, 'Elevadores Velho').locator('[data-acao=reativar]').click()
            esperar_chamada(pg, ch, 'definir_servico_ativo', 2)
            ok(rpcs(ch, 'definir_servico_ativo')[1] == {'p_id': SID(4), 'p_ativo': True} and linha(pg, 'Elevadores Velho').locator('[data-acao=pagar]').count() == 0, 'reativar sem confirmação; desativado não tem "Registrar pagamento"')
            linha(pg, 'Piscinas Azul').locator('[data-acao=historico]').click(); pg.wait_for_selector('.modal [data-h=corrigir]')
            pg.click('.modal [data-h=corrigir]'); pg.wait_for_selector('.modal form')
            ok(pg.input_value('#pg-valor') == '850,00' and pg.input_value('#pg-rec') == 'R-77' and pg.locator('#pg-arq').count() == 0, 'corrigir vem preenchido (sem trocar comprovante)')
            pg.fill('#pg-valor', '900'); pg.click('.modal [data-salvar]')
            esperar_chamada(pg, ch, 'corrigir_pagamento_servico', 1)
            c = rpcs(ch, 'corrigir_pagamento_servico')[0]
            ok(c['p_id'] == PID(1) and c['p_dados']['valor'] == '900', 'correção do pagamento certo')
            pg.wait_for_selector('.modal [data-h=excluir]')
            pg.click('.modal [data-h=excluir]'); pg.wait_for_selector('.modal [data-r="1"]'); pg.click('.modal [data-r="1"]')
            esperar_chamada(pg, ch, 'excluir_pagamento_servico', 1)
            ok(rpcs(ch, 'excluir_pagamento_servico')[0] == {'p_id': PID(1)}, 'exclui o pagamento certo')
            ok(not erros, 'síndico sem erros: %s' % erros); nav.close()

            # ---- gastos e painel
            nav, pg, erros, ch = abrir(pw, PORTA, UIDS['sindico'], dados('sindico'), 'gastos', '#g-cat')
            pg.wait_for_function("window.Chart && Chart.getChart('g-cat')")
            cat = dict(zip(pg.evaluate("Chart.getChart('g-cat').data.labels"), pg.evaluate("Chart.getChart('g-cat').data.datasets[0].data")))
            ok(cat == {'Serviços': 1000, 'Limpeza': 100}, 'pizza: pagamentos entram como "Serviços": %s' % cat)
            ok('1.100,00' in pg.inner_text('#pagina h3 >> nth=0'), 'total do ano soma compras e serviços')
            ok(pg.locator('#pagina tbody [data-servico]').count() == 2, 'tabela marca os pagamentos como "Serviço"')
            pg.select_option('#f-forn', 'Piscinas Azul (Piscineiro)'); pg.wait_for_timeout(300)
            ok('850,00' in pg.inner_text('#pagina h3 >> nth=0'), 'filtro por fornecedor funciona com o prestador')
            ok(not erros, 'gastos sem erros: %s' % erros); nav.close()
            nav, pg, erros, ch = abrir(pw, PORTA, UIDS['sindico'], dados('sindico'), 'painel', '#pagina .cards')
            ok(f'1.100,00' in pg.inner_text('#pagina .cards'), 'painel: gasto do ano inclui serviços')
            ok(not erros, 'painel sem erros: %s' % erros); nav.close()

            # ---- morador não acessa
            nav, pg, erros, ch = abrir(pw, PORTA, UIDS['morador'], dados('morador'), 'servicos', '#pagina')
            pg.wait_for_timeout(800)
            ok(not pg.url.endswith('#/servicos') and 'Serviços contratados' not in pg.inner_text('body'), 'morador é levado para fora e não vê o menu: %s' % pg.url)
            nav.close()
    finally: srv.terminate()
    relatorio(falhou)
main()
