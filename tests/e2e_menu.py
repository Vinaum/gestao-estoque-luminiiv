"""Teste de navegador: entra com cada papel (Supabase simulado) e confere o menu.
Uso: python3 tests/e2e_menu.py   (sobe um servidor local na pasta pai de tests/)"""
import json, base64, subprocess, time, sys, os, re
from playwright.sync_api import sync_playwright

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORTA = 8777
REF = 'aiuwreyhnubprlapkxli'
COND_A = '11111111-1111-1111-1111-111111111111'
COND_B = '22222222-2222-2222-2222-222222222222'

def b64(d): return base64.urlsafe_b64encode(json.dumps(d).encode()).decode().rstrip('=')
def jwt(uid): return f"{b64({'alg':'HS256','typ':'JWT'})}.{b64({'sub':uid,'role':'authenticated','exp':4102444800})}.assinatura"

CASOS = {
  'gestor':   dict(uid='aaaaaaaa-0000-0000-0000-000000000003', super=False, conds=[(COND_A,'Cond A')], vinc={COND_A:'gestor'},
                   menu=['Operação diária','Estoque atual','Configuração de estoque','Central de compras','Fornecedores','Consumo'], inicial='#/operacao'),
  'sindico':  dict(uid='aaaaaaaa-0000-0000-0000-000000000002', super=False, conds=[(COND_A,'Cond A')], vinc={COND_A:'sindico'},
                   menu=['Painel do síndico','Aprovações','Operação diária','Estoque atual','Configuração de estoque','Central de compras','Fornecedores','Consumo','Relatórios de gastos','Usuários'], inicial='#/painel'),
  'superadmin': dict(uid='aaaaaaaa-0000-0000-0000-000000000001', super=True, conds=[(COND_A,'Cond A'),(COND_B,'Cond B')], vinc={},
                   menu=['Painel do síndico','Aprovações','Operação diária','Estoque atual','Configuração de estoque','Central de compras','Fornecedores','Consumo','Relatórios de gastos','Usuários','Administração'], inicial='#/admin'),
  'morador':  dict(uid='aaaaaaaa-0000-0000-0000-000000000004', super=False, conds=[(COND_A,'Cond A')], vinc={COND_A:'morador'},
                   menu=['Início'], inicial='#/inicio'),
}

def rodar(pw, nome, c, nome_perfil='Pessoa Teste', nome_cond=None):
    nav = pw.chromium.launch(); ctx = nav.new_context(); pg = ctx.new_page()
    erros = []
    pg.on('pageerror', lambda e: erros.append(str(e)))
    pg.on('dialog', lambda d: (erros.append('ALERTA: '+d.message), d.dismiss()))
    conds = [(i, nome_cond or n) for i, n in c['conds']] if nome_cond else c['conds']
    def rest(route):
        u = route.request.url
        corpo = []
        if '/rest/v1/profiles' in u: corpo = {'id': c['uid'], 'nome': nome_perfil, 'superadmin': c['super']}
        elif '/rest/v1/condominios' in u: corpo = [{'id': i, 'nome': n, 'ativo': True} for i, n in conds]
        elif '/rest/v1/membros' in u: corpo = [{'condominio_id': k, 'papel': v, 'ativo': True} for k, v in c['vinc'].items()]
        route.fulfill(status=200, content_type='application/json', body=json.dumps(corpo), headers={'access-control-allow-origin': '*'})
    pg.route(re.compile(r'https://.*supabase\.co/rest/v1/.*'), rest)
    pg.route(re.compile(r'https://.*supabase\.co/(auth|realtime).*'), lambda r: r.fulfill(status=200, content_type='application/json', body='{}', headers={'access-control-allow-origin': '*'}))
    pg.route(re.compile(r'https://fonts\..*'), lambda r: r.fulfill(status=200, body=''))
    sessao = {'access_token': jwt(c['uid']), 'refresh_token': 'r', 'expires_in': 3600, 'expires_at': 4102444800, 'token_type': 'bearer',
              'user': {'id': c['uid'], 'email': nome + '@teste.com', 'aud': 'authenticated', 'role': 'authenticated'}}
    pg.add_init_script(f"localStorage.setItem('sb-{REF}-auth-token', {json.dumps(json.dumps(sessao))});")
    pg.goto(f'http://localhost:{PORTA}/app/index.html')
    pg.wait_for_selector('.rail, .auth-card', timeout=8000)
    return nav, pg, erros

def main():
    srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORTA), '--directory', RAIZ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1); falhou = False
    try:
        with sync_playwright() as pw:
            for nome, c in CASOS.items():
                nav, pg, erros = rodar(pw, nome, c)
                menu = [t.strip() for t in pg.locator('.rail a.nav').all_inner_texts()]
                ok = menu == c['menu'] and pg.evaluate('location.hash') == c['inicial'] and not erros
                print(('OK   ' if ok else 'FALHOU'), nome, '| menu:', len(menu), '| rota:', pg.evaluate('location.hash'), erros or '')
                if not ok: print('   esperado:', c['menu'], '\n   obtido  :', menu); falhou = True
                if nome == 'superadmin':
                    n = pg.locator('#sel-cond option').count()
                    print(('OK   ' if n == 2 else 'FALHOU'), 'superadmin vê seletor com 2 condomínios'); falhou |= n != 2
                    pg.select_option('#sel-cond', COND_B); pg.wait_for_timeout(300)
                    sel = pg.locator('#sel-cond').input_value()
                    print(('OK   ' if sel == COND_B else 'FALHOU'), 'troca de condomínio'); falhou |= sel != COND_B
                if nome == 'gestor':
                    pg.goto(f'http://localhost:{PORTA}/app/index.html#/usuarios'); pg.wait_for_timeout(400)
                    h = pg.evaluate('location.hash')
                    print(('OK   ' if h == '#/operacao' else 'FALHOU'), 'gestor não entra em #/usuarios ->', h); falhou |= h != '#/operacao'
                    pg.goto(f'http://localhost:{PORTA}/app/index.html#/admin'); pg.wait_for_timeout(400)
                    h = pg.evaluate('location.hash')
                    print(('OK   ' if h == '#/operacao' else 'FALHOU'), 'gestor não entra em #/admin ->', h); falhou |= h != '#/operacao'
                nav.close()
            # sem vínculo
            c = dict(uid='aaaaaaaa-0000-0000-0000-000000000009', super=False, conds=[], vinc={})
            nav, pg, erros = rodar(pw, 'novo', c)
            ok = 'Aguardando convite' in pg.inner_text('body'); print(('OK   ' if ok else 'FALHOU'), 'conta sem vínculo vê "Aguardando convite"'); falhou |= not ok; nav.close()
            # XSS em nomes
            xss = '<img src=x onerror=alert(1)>'
            nav, pg, erros = rodar(pw, 'xss', CASOS['gestor'], nome_perfil=xss, nome_cond=xss)
            pg.wait_for_timeout(500)
            ok = pg.locator('.rail img').count() == 0 and xss in pg.inner_text('.rail') and not erros
            print(('OK   ' if ok else 'FALHOU'), 'nome malicioso aparece como texto', erros or ''); falhou |= not ok; nav.close()
            # sem sessão: tela de login
            nav = pw.chromium.launch(); pg = nav.new_page()
            pg.route(re.compile(r'https://fonts\..*'), lambda r: r.fulfill(status=200, body=''))
            pg.goto(f'http://localhost:{PORTA}/app/index.html'); pg.wait_for_selector('.auth-card')
            ok = pg.locator('#a-email').count() == 1 and pg.locator('#a-senha').count() == 1
            print(('OK   ' if ok else 'FALHOU'), 'sem sessão mostra o login'); falhou |= not ok
            pg.click('[data-modo=signup]'); ok = pg.locator('#a-nome').count() == 1
            print(('OK   ' if ok else 'FALHOU'), 'alterna para criar conta'); falhou |= not ok
            pg.click('[data-modo=login]'); pg.click('[data-modo=forgot]'); ok = pg.locator('#a-senha').count() == 0
            print(('OK   ' if ok else 'FALHOU'), 'esqueci a senha não pede senha'); falhou |= not ok; nav.close()
    finally:
        srv.terminate()
    print('RESULTADO:', 'FALHOU' if falhou else 'TUDO OK'); sys.exit(1 if falhou else 0)
main()
