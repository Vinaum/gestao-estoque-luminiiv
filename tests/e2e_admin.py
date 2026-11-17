"""Teste de navegador: Administração (superadmin) e Usuários (síndico)."""
import sys; sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
from e2e_comum import *
from playwright.sync_api import sync_playwright
PORTA = 8782
CA = '11111111-1111-1111-1111-111111111111'; CB = '22222222-2222-2222-2222-222222222222'
SUP = 'aaaaaaaa-0000-0000-0000-000000000001'; SIN = 'aaaaaaaa-0000-0000-0000-000000000002'; GES = 'aaaaaaaa-0000-0000-0000-000000000003'; MOR = 'aaaaaaaa-0000-0000-0000-000000000004'
XSS = '<img src=x onerror=alert(1)>'
NOMES = {SUP: 'Super', SIN: 'Sindico', GES: 'Gestora', MOR: 'Morador'}
def dados_comuns(papel_da_sessao, superadmin):
    contagem = {'perfil': 0}
    def t(u, q, m, corpo, acc):
        if m == 'RPC:verificar_consistencia': return t.diag
        if m.startswith('RPC'): return {}
        if '/profiles' in u and 'id=eq.' in u and 'select=id%2Cnome%2Csuperadmin' in u: contagem['perfil'] += 1; return [{'id': SUP if superadmin else SIN, 'nome': 'Eu', 'superadmin': superadmin}]
        if '/profiles' in u: return [{'id': k, 'nome': v, 'superadmin': k == SUP} for k, v in NOMES.items()]
        if '/condominios' in u: return [{'id': CA, 'nome': XSS, 'ativo': True, 'cnpj': '11222333000181'}, {'id': CB, 'nome': 'Cond B', 'ativo': True, 'cnpj': None}]
        if '/condominio_config' in u: return [{'condominio_id': CA, 'faixa_atencao': 0.25, 'venc_alerta_1': 30, 'venc_alerta_2': 90}, {'condominio_id': CB, 'faixa_atencao': 0.25, 'venc_alerta_1': 30, 'venc_alerta_2': 90}]
        if '/membros' in u:
            if 'user_id=eq.' in u: return [{'condominio_id': CA, 'papel': papel_da_sessao, 'ativo': True}] if not superadmin else []
            if 'papel=eq.sindico' in u: return [{'condominio_id': CA, 'user_id': SIN, 'ativo': True}]
            return [{'condominio_id': CA, 'user_id': SIN, 'papel': 'sindico', 'ativo': True, 'criado_em': '2026-01-01'}, {'condominio_id': CA, 'user_id': GES, 'papel': 'gestor', 'ativo': True, 'criado_em': '2026-01-02'},
                    {'condominio_id': CA, 'user_id': MOR, 'papel': 'morador', 'ativo': True, 'criado_em': '2026-01-03'}]
        if '/convites' in u: return [{'id': 'c1', 'email': 'novo@x.com', 'papel': 'morador', 'criado_em': '2026-11-01'}]
        if '/categorias' in u: return [{'id': 'k1', 'nome': 'Limpeza', 'ativo': True}]
        if '/unidades_medida' in u: return [{'id': 'u1', 'sigla': 'un', 'nome': 'unidade', 'ativo': True}]
        if '/auditoria' in u:
            return [{'id': 1, 'tabela': 'itens', 'registro_id': 'x', 'acao': 'update', 'antes': {'estoque_minimo': 3}, 'depois': {'estoque_minimo': 5}, 'usuario_id': GES, 'em': '2026-11-16T12:00:00Z'}]
    t.diag = []; t.contagem = contagem
    return t
def main():
    srv = servidor(PORTA); falhou = []; ok = checador(falhou)
    try:
        with sync_playwright() as pw:
            # ============ SUPERADMIN
            t = dados_comuns('', True)
            nav, pg, erros, ch = abrir(pw, PORTA, SUP, t, 'admin', '#pagina table')
            ok(pg.locator('#pagina img').count() == 0 and XSS in pg.inner_text('#pagina'), 'nome malicioso de condomínio aparece como texto')
            ok('Sindico' in pg.inner_text('#pagina') and 'sem síndico' in pg.inner_text('#pagina'), 'mostra síndico de cada condomínio')
            pg.click('[data-acao=novo-cond]'); pg.wait_for_selector('.modal form'); pg.fill('#k-nome', 'Cond C'); pg.fill('#k-cnpj', '11.222.333/0001-44'); pg.click('.modal button[type=submit]')
            ok('cnpj' in pg.inner_text('.modal [data-erro]').lower(), 'CNPJ inválido recusado')
            antes = t.contagem['perfil']
            pg.fill('#k-cnpj', '11.222.333/0001-81'); pg.click('.modal button[type=submit]'); pg.wait_for_selector('.modal', state='detached'); pg.wait_for_timeout(400)
            c = [x for x in ch if x[0] == 'criar_condominio']
            ok(len(c) == 1 and c[0][1] == {'p_nome': 'Cond C', 'p_cnpj': '11222333000181'}, 'criar condomínio envia nome e CNPJ só com números')
            ok(t.contagem['perfil'] > antes, 'lista de condomínios do menu é recarregada depois de criar')
            pg.locator('tr', has_text='Cond B').locator('[data-acao=param]').click(); pg.wait_for_selector('.modal form')
            pg.fill('#p-1', '90'); pg.fill('#p-2', '30'); pg.click('.modal button[type=submit]')
            ok('menor' in pg.inner_text('.modal [data-erro]'), 'primeiro prazo maior que o segundo é recusado')
            pg.fill('#p-f', '30'); pg.fill('#p-1', '20'); pg.fill('#p-2', '60'); pg.click('.modal button[type=submit]'); pg.wait_for_selector('.modal', state='detached')
            c = [x for x in ch if x[0] == 'PATCH condominio_config']
            ok(len(c) == 1 and c[0][1] == {'faixa_atencao': 0.3, 'venc_alerta_1': 20, 'venc_alerta_2': 60} and c[0][2]['condominio_id'] == 'eq.' + CB, 'parâmetros salvos (30% -> 0,3; 20 e 60 dias) no condomínio certo')
            pg.locator('tr', has_text='Cond B').locator('[data-acao=sindico]').click(); pg.wait_for_selector('.modal form'); pg.fill('#s-email', 'novo.sindico@x.com'); pg.click('.modal button[type=submit]'); pg.wait_for_selector('.modal', state='detached')
            c = [x for x in ch if x[0] == 'convidar_membro']
            ok(len(c) == 1 and c[0][1] == {'p_condominio_id': CB, 'p_email': 'novo.sindico@x.com', 'p_papel': 'sindico'}, 'definir síndico chama convidar_membro com papel sindico')
            pg.click('[data-aba=pessoas]'); esperar(pg, "document.querySelector('#pagina').innerText.includes('Gestora')")
            ok('Gestora' in pg.inner_text('#pagina') and 'superadmin' in pg.inner_text('#pagina'), 'aba Pessoas lista as contas')
            pg.click('[data-aba=catalogos]'); pg.wait_for_selector('[data-acao=edita-cat]'); pg.click('[data-acao=edita-cat]'); pg.wait_for_selector('.modal form'); pg.fill('#k-n', 'Limpeza geral'); pg.click('.modal button[type=submit]'); pg.wait_for_selector('.modal', state='detached')
            c = [x for x in ch if x[0] == 'PATCH categorias']
            ok(len(c) == 1 and c[0][1] == {'nome': 'Limpeza geral', 'ativo': True}, 'editar categoria envia nome e situação')
            pg.click('[data-aba=auditoria]'); pg.wait_for_selector('text=mínimo: 3 → 5')
            ok('mínimo: 3 → 5' in pg.inner_text('#pagina') and 'Gestora' in pg.inner_text('#pagina'), 'auditoria mostra quem e o que mudou')
            pg.select_option('#f-tab', 'itens'); pg.wait_for_timeout(400)
            ok(any(x[0] == 'GET auditoria' and x[2].get('tabela') == 'eq.itens' for x in ch), 'filtro da auditoria consulta só a tabela escolhida')
            pg.click('[data-aba=diagnostico]'); pg.click('[data-acao=diagnosticar]'); pg.wait_for_selector('.auth-ok')
            ok('Nenhuma divergência' in pg.inner_text('#pagina'), 'diagnóstico sem divergências')
            t.diag = [{'problema': 'saldo diferente', 'referencia': 'x', 'esperado': 5, 'encontrado': 4}]
            pg.click('[data-acao=diagnosticar]'); pg.wait_for_selector('.auth-error')
            ok('1 divergência' in pg.inner_text('#pagina') and 'saldo diferente' in pg.inner_text('#pagina'), 'diagnóstico mostra divergência')
            ok(not erros, 'admin sem erros de script: %s' % erros); nav.close()
            # ============ SÍNDICO: usuários
            t = dados_comuns('sindico', False)
            nav, pg, erros, ch = abrir(pw, PORTA, SIN, t, 'usuarios', '#pagina table')
            ok(pg.locator('[data-papel-de="%s"]' % SIN).count() == 0, 'síndico não tem seletor para o próprio papel')
            sel = pg.locator('[data-papel-de="%s"]' % GES)
            ok(sel.locator('option').all_inner_texts() == ['Gestor', 'Morador'], 'síndico só pode escolher Gestor ou Morador')
            sel.select_option('morador'); pg.wait_for_selector('.toast.ok')
            c = [x for x in ch if x[0] == 'alterar_papel_membro']
            ok(len(c) == 1 and c[0][1] == {'p_condominio_id': CA, 'p_user_id': GES, 'p_papel': 'morador'}, 'alterar papel envia a pessoa certa')
            pg.click('[data-acao=convidar]'); pg.wait_for_selector('.modal form'); pg.fill('#c-email', 'semarroba'); pg.click('.modal button[type=submit]')
            ok('e-mail' in pg.inner_text('.modal [data-erro]').lower(), 'e-mail inválido recusado')
            ok(pg.locator('#c-papel option').all_inner_texts() == ['Gestor', 'Morador'], 'convite: síndico não oferece papel Síndico')
            pg.fill('#c-email', 'Nova@X.com'); pg.select_option('#c-papel', 'gestor'); pg.click('.modal button[type=submit]'); pg.wait_for_selector('.modal', state='detached')
            c = [x for x in ch if x[0] == 'convidar_membro']
            ok(len(c) == 1 and c[0][1] == {'p_condominio_id': CA, 'p_email': 'nova@x.com', 'p_papel': 'gestor'}, 'convite envia e-mail em minúsculas e papel')
            pg.click('[data-acao=desativar][data-id="%s"]' % MOR); pg.wait_for_selector('.modal [data-r="1"]'); pg.click('.modal [data-r="1"]'); pg.wait_for_selector('.toast.ok')
            c = [x for x in ch if x[0] == 'desativar_membro']
            ok(len(c) == 1 and c[0][1]['p_ativo'] is False and c[0][1]['p_user_id'] == MOR, 'desativar pede confirmação e envia p_ativo falso')
            ok('novo@x.com' in pg.inner_text('#pagina'), 'convites pendentes listados')
            ok(not erros, 'usuários sem erros de script: %s' % erros); nav.close()
            # gestor e morador não entram em usuários/admin; síndico não entra em admin
            for papel, uid, rota in [('gestor', GES, 'usuarios'), ('sindico', SIN, 'admin')]:
                t = dados_comuns(papel, False)
                nav, pg, erros, ch = abrir(pw, PORTA, uid, t, rota, '#pagina'); pg.wait_for_timeout(500)
                ok(pg.evaluate('location.hash') == ('#/operacao' if papel == 'gestor' else '#/painel'), f'{papel} é redirecionado de #/{rota}'); nav.close()
    finally: srv.terminate()
    relatorio(falhou)
main()
