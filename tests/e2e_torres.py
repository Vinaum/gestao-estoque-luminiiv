"""Teste de navegador: tela Torres e apartamentos (síndico), com Supabase simulado."""
import sys; sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
from e2e_comum import *
from playwright.sync_api import sync_playwright
PORTA = 8786
CA = '11111111-1111-1111-1111-111111111111'; SIN = 'aaaaaaaa-0000-0000-0000-000000000002'
XSS = '<img src=x onerror=alert(1)>'
T1 = 'bbbbbbbb-0000-0000-0000-000000000001'; T2 = 'bbbbbbbb-0000-0000-0000-000000000002'
A = lambda n, t, num, ativo=True: {'id': f'cccccccc-0000-0000-0000-0000000000{n}', 'torre_id': t, 'numero': num, 'ativo': ativo}
def dados():
    est = {'cheio': False}
    def t(u, q, m, corpo, acc):
        if m == 'RPC:criar_torres_lote': est['cheio'] = True; return 5
        if m == 'RPC:gerar_apartamentos': return 20
        if m.startswith('RPC'): return {}
        if '/torres' in u:
            return [{'id': T1, 'nome': 'Torre 1', 'ativo': True}, {'id': T2, 'nome': XSS, 'ativo': True}] if est['cheio'] else []
        if '/apartamentos' in u:
            return [A('11', T1, '11'), A('02', T1, '02'), A('12', T1, '12', False), A('21', T2, '21')] if est['cheio'] else []
        if '/profiles' in u and 'id=eq.' in u: return [{'id': SIN, 'nome': 'Sindico', 'superadmin': False}]
        if '/profiles' in u: return [{'id': SIN, 'nome': 'Sindico'}]
        if '/condominios' in u: return [{'id': CA, 'nome': 'Cond A', 'ativo': True}]
        if '/membros' in u: return [{'condominio_id': CA, 'papel': 'sindico', 'ativo': True}]
    t.est = est
    return t
def ate(pg, cond, ms=6000):
    """Espera uma condição em Python. Usa pg.wait_for_timeout (e não time.sleep) para o Playwright continuar servindo as respostas simuladas."""
    fim = time.time() + ms / 1000
    while time.time() < fim:
        if cond(): return True
        pg.wait_for_timeout(50)
    raise TimeoutError('condição não atendida')
from contextlib import contextmanager
@contextmanager
def feito(pg, ch, rpc, n):
    """Executa a ação e espera: a chamada ao banco, a recarga dos dados e o novo desenho da tela (evita clicar durante a troca)."""
    base = len([x for x in ch if x[0] == 'GET apartamentos'])
    yield
    ate(pg, lambda: len([x for x in ch if x[0] == rpc]) >= n)
    ate(pg, lambda: len([x for x in ch if x[0] == 'GET apartamentos']) > base)
    pg.wait_for_timeout(250)
def main():
    srv = servidor(PORTA); falhou = []; ok = checador(falhou)
    try:
        with sync_playwright() as pw:
            t = dados()
            nav, pg, erros, ch = abrir(pw, PORTA, SIN, t, 'torres', '#pagina h2')
            ok('Nenhuma torre cadastrada' in pg.inner_text('#pagina'), 'sem torres: mostra o estado vazio')
            pg.click('[data-acao=lote-torres]'); pg.wait_for_selector('.modal form')
            ok(pg.input_value('#l-q') == '5' and pg.input_value('#l-p') == 'Torre', 'lote vem preenchido com 5 torres e o nome Torre')
            pg.fill('#l-q', '0'); pg.click('.modal button[type=submit]')
            ok('1 a 20' in pg.inner_text('.modal [data-erro]'), 'quantidade 0 é recusada na tela')
            ok(not [x for x in ch if x[0] == 'criar_torres_lote'], 'e nada é enviado ao banco')
            pg.fill('#l-q', '5'); pg.click('.modal button[type=submit]'); pg.wait_for_selector('.modal', state='detached'); pg.wait_for_selector('.chip-apto')
            c = [x for x in ch if x[0] == 'criar_torres_lote']
            ok(len(c) == 1 and c[0][1] == {'p_condominio_id': CA, 'p_quantidade': 5, 'p_prefixo': 'Torre'}, 'criar torres em lote envia condomínio, quantidade e nome base')
            txt = pg.inner_text('#pagina')
            ok(pg.locator('#pagina img').count() == 0 and XSS in txt, 'nome malicioso de torre aparece como texto')
            ok(pg.locator('.panel', has_text='Torre 1').locator('.chip-apto').all_inner_texts() == ['02', '11', '12'], 'apartamentos em ordem natural dentro da torre')
            ok('desativada' not in txt and pg.locator('.chip-apto.inativo').count() == 1, 'apartamento inativo marcado (riscado)')
            ok('2 apartamento(s)' in pg.locator('.panel', has_text='Torre 1').inner_text(), 'contagem só considera apartamentos ativos')

            # gerar
            pg.locator('.panel', has_text='Torre 1').locator('[data-acao=gerar]').click(); pg.wait_for_selector('.modal form')
            ok((pg.input_value('#g-i'), pg.input_value('#g-f'), pg.input_value('#g-n')) == ('0', '4', '4'), 'gerar vem com térreo ao 4º andar e 4 por andar')
            ok('01–04' in pg.inner_text('.modal') and '41–44' in pg.inner_text('.modal'), 'explica a numeração na própria janela')
            pg.fill('#g-f', '40'); pg.click('.modal button[type=submit]')
            ok('Andares inválidos' in pg.inner_text('.modal [data-erro]'), 'andar final acima de 30 é recusado')
            pg.fill('#g-f', '4'); pg.fill('#g-n', '10'); pg.click('.modal button[type=submit]')
            ok('1 a 9' in pg.inner_text('.modal [data-erro]'), '10 por andar é recusado')
            pg.fill('#g-n', 'x'); pg.click('.modal button[type=submit]')
            ok('inteiros' in pg.inner_text('.modal [data-erro]'), 'texto no lugar de número é recusado')
            ok(not [x for x in ch if x[0] == 'gerar_apartamentos'], 'nenhuma geração inválida chegou ao banco')
            pg.fill('#g-n', '6'); pg.click('.modal button[type=submit]'); pg.wait_for_selector('.modal', state='detached')
            c = [x for x in ch if x[0] == 'gerar_apartamentos']
            ok(len(c) == 1 and c[0][1] == {'p_torre_id': T1, 'p_andar_inicial': 0, 'p_andar_final': 4, 'p_por_andar': 6}, 'gerar envia a torre certa e os andares')
            ok(esperar(pg, "document.body.innerText.includes('20 apartamento(s) criado(s)')"), 'avisa quantos foram criados')

            # adicionar um
            pg.locator('.panel', has_text='Torre 1').locator('[data-acao=add-apto]').click(); pg.wait_for_selector('.modal form')
            pg.fill('#a-n', '3A'); pg.click('.modal button[type=submit]'); pg.wait_for_selector('.modal', state='detached')
            c = [x for x in ch if x[0] == 'salvar_apartamento']
            ok(len(c) == 1 and c[0][1] == {'p_torre_id': T1, 'p_numero': '3A'}, 'adicionar um apartamento envia torre e número')

            # renomear
            pg.locator('.panel', has_text='Torre 1').locator('[data-acao=renomear]').click(); pg.wait_for_selector('.modal form')
            ok(pg.input_value('#t-nome') == 'Torre 1', 'renomear vem com o nome atual')
            pg.fill('#t-nome', 'Torre Norte'); pg.click('.modal button[type=submit]'); pg.wait_for_selector('.modal', state='detached')
            c = [x for x in ch if x[0] == 'salvar_torre']
            ok(len(c) == 1 and c[0][1] == {'p_condominio_id': CA, 'p_torre_id': T1, 'p_nome': 'Torre Norte', 'p_ativo': True}, 'renomear envia o nome novo mantendo a situação')

            # desativar torre: pede confirmação
            pg.locator('.panel', has_text='Torre 1').locator('[data-acao=torre-ativo]').click(); pg.wait_for_selector('.modal [data-r="0"]'); pg.click('.modal [data-r="0"]')
            ok(len([x for x in ch if x[0] == 'salvar_torre']) == 1, 'cancelar a confirmação não desativa a torre')
            pg.locator('.panel', has_text='Torre 1').locator('[data-acao=torre-ativo]').click(); pg.wait_for_selector('.modal [data-r="1"]'); 
            with feito(pg, ch, 'salvar_torre', 2): pg.click('.modal [data-r="1"]')
            c = [x for x in ch if x[0] == 'salvar_torre']
            ok(len(c) == 2 and c[1][1]['p_ativo'] is False and c[1][1]['p_torre_id'] == T1, 'confirmar desativa a torre certa')

            # apartamento: desativar (com confirmação) e reativar (direto)
            pg.locator('.chip-apto', has_text='11').first.click(); pg.wait_for_selector('.modal [data-r="1"]')
            ok('Só é possível se ninguém estiver vinculado' in pg.inner_text('.modal'), 'confirmação explica a regra do vínculo')
            
            with feito(pg, ch, 'mudar_apartamento_ativo', 1): pg.click('.modal [data-r="1"]')
            c = [x for x in ch if x[0] == 'mudar_apartamento_ativo']
            ok(len(c) == 1 and c[0][1] == {'p_apartamento_id': 'cccccccc-0000-0000-0000-000000000011', 'p_ativo': False}, 'desativar apartamento envia o id e ativo falso')
            
            with feito(pg, ch, 'mudar_apartamento_ativo', 2): pg.locator('.chip-apto.inativo').first.click()
            c = [x for x in ch if x[0] == 'mudar_apartamento_ativo']
            ok(len(c) == 2 and c[1][1] == {'p_apartamento_id': 'cccccccc-0000-0000-0000-000000000012', 'p_ativo': True}, 'reativar apartamento não pede confirmação')
            ok(not erros, 'torres sem erros de script: %s' % erros); nav.close()
    finally: srv.terminate()
    relatorio(falhou)
main()
