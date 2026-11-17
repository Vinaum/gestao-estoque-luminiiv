"""Apoio dos testes de navegador: servidor local + Supabase simulado + sessão falsa."""
import json, base64, subprocess, time, sys, os, re
from urllib.parse import urlparse, parse_qs
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REF = 'aiuwreyhnubprlapkxli'
def b64(d): return base64.urlsafe_b64encode(json.dumps(d).encode()).decode().rstrip('=')
def jwt(u): return f"{b64({'alg':'HS256'})}.{b64({'sub':u,'exp':4102444800})}.x"
def servidor(porta):
    p = subprocess.Popen([sys.executable, '-m', 'http.server', str(porta), '--directory', RAIZ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(1); return p
def relatorio(falhou):
    print('RESULTADO:', 'FALHOU %s' % falhou if falhou else 'TUDO OK'); sys.exit(1 if falhou else 0)
def checador(falhou):
    def ok(c, m):
        print(('OK   ' if c else 'FALHOU'), m)
        if not c: falhou.append(m)
    return ok
def abrir(pw, porta, uid, tratar, rota, esperar='#pagina .panel'):
    """tratar(url, query, metodo, corpo, accept) -> (dados, status) ou None para padrão []. Devolve (nav, pg, erros, chamadas)."""
    nav = pw.chromium.launch(); ctx = nav.new_context(accept_downloads=True); pg = ctx.new_page(); erros = []; chamadas = []
    pg.on('pageerror', lambda e: erros.append(str(e))); pg.on('dialog', lambda d: (erros.append('ALERTA'), d.dismiss()))
    def rest(route):
        rq = route.request; u = rq.url; q = parse_qs(urlparse(u).query); acc = rq.headers.get('accept', '')
        def reply(x, status=200):
            if 'object' in acc and isinstance(x, list): x = x[0] if x else None
            route.fulfill(status=status, content_type='application/json', body=json.dumps(x), headers={'access-control-allow-origin': '*'})
        corpo = None
        try: corpo = rq.post_data_json
        except Exception: pass
        if '/rpc/' in u:
            nome = u.split('/rpc/')[1].split('?')[0]; chamadas.append((nome, corpo))
            r = tratar(u, q, 'RPC:' + nome, corpo, acc); return reply(r if r is not None else {})
        if rq.method in ('POST', 'PATCH', 'DELETE'):
            chamadas.append((rq.method + ' ' + urlparse(u).path.split('/')[-1], corpo, dict((k, v[0]) for k, v in q.items())))
            route.fulfill(status=204, body='', headers={'access-control-allow-origin': '*'}); return
        chamadas.append(('GET ' + urlparse(u).path.split('/')[-1], None, dict((k, v[0]) for k, v in q.items())))
        r = tratar(u, q, 'GET', None, acc); reply(r if r is not None else [])
    pg.route(re.compile(r'https://.*supabase\.co/rest/v1/.*'), rest)
    pg.route(re.compile(r'https://.*supabase\.co/(auth|realtime|storage).*'), lambda r: r.fulfill(status=200, content_type='application/json', body='{}', headers={'access-control-allow-origin': '*'}))
    pg.route(re.compile(r'https://fonts\..*'), lambda r: r.fulfill(status=200, body=''))
    sess = {'access_token': jwt(uid), 'refresh_token': 'r', 'expires_in': 3600, 'expires_at': 4102444800, 'token_type': 'bearer', 'user': {'id': uid, 'email': 'x@t.com', 'aud': 'authenticated'}}
    pg.add_init_script(f"localStorage.setItem('sb-{REF}-auth-token', {json.dumps(json.dumps(sess))});")
    pg.goto(f'http://localhost:{porta}/app/index.html#/{rota}'); pg.wait_for_selector(esperar, timeout=8000)
    return nav, pg, erros, chamadas

def esperar(pg, expr, ms=8000):
    """Espera uma expressão JS ficar verdadeira (sem eval: o CSP do app proíbe)."""
    fim = time.time() + ms / 1000
    while time.time() < fim:
        try:
            if pg.evaluate(expr): return True
        except Exception: pass
        time.sleep(0.1)
    raise TimeoutError('condição não atendida: ' + expr)
