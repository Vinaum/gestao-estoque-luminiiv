import json, base64, threading, http.server, socketserver, functools, sys, time
from playwright.sync_api import sync_playwright

W = sys.argv[1]
def b64(d): return base64.urlsafe_b64encode(json.dumps(d).encode()).rstrip(b'=').decode()
JWT = b64({"alg":"HS256","typ":"JWT"})+"."+b64({"sub":"u1","role":"authenticated","aud":"authenticated","exp":int(time.time())+3600})+".sig"
PAYLOAD_IMG = '<img src=x onerror="window.__xss=1">'
USER = {"id":"u1","aud":"authenticated","role":"authenticated","email":"adm@teste.com","app_metadata":{},"user_metadata":{},"created_at":"2026-01-01T00:00:00Z"}
PROFILE = {"id":"u1","nome":"Ana "+PAYLOAD_IMG,"papel":"superadmin"}
OTHER = {"id":"u2","nome":"<script>window.__xss=2</script>Mallory","papel":"morador"}
ITEMS = [{"id":"i1","nome":"Lâmpada "+PAYLOAD_IMG,"categoria":"Elétrica","unidade":"un\"><b id=hack>","estoque_atual":1,"estoque_minimo":4}]
MOVS = [{"id":"m1","item_id":"i1","tipo":"entrada","quantidade":4,"data":"2026-11-10","responsavel":PAYLOAD_IMG,"fornecedor":"<b id=forn>Forn</b>","nota_fiscal":"NF <i id=nf>1</i>","valor":10}]
SETTINGS = {"id":1,"dias_atencao":20,"dias_critico":7,"meses_media":6}

handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=W)
handler.log_message = lambda *a, **k: None
srv = socketserver.TCPServer(("127.0.0.1", 8765), handler); srv.allow_reuse_address=True
threading.Thread(target=srv.serve_forever, daemon=True).start()

def api(route):
    req = route.request; url = req.url; accept = req.headers.get("accept","")
    cors = {"access-control-allow-origin":"*","access-control-allow-headers":"*","access-control-allow-methods":"*"}
    if req.method == "OPTIONS": return route.fulfill(status=204, headers=cors)
    if "/auth/v1/token" in url:
        return route.fulfill(status=200, headers=cors, content_type="application/json",
            body=json.dumps({"access_token":JWT,"token_type":"bearer","expires_in":3600,"expires_at":int(time.time())+3600,"refresh_token":"r","user":USER}))
    if "/rest/v1/profiles" in url:
        body = PROFILE if "object" in accept else [PROFILE, OTHER]
    elif "/rest/v1/items" in url: body = ITEMS
    elif "/rest/v1/movements" in url: body = MOVS
    elif "/rest/v1/settings" in url: body = SETTINGS
    else: body = []
    route.fulfill(status=200, headers=cors, content_type="application/json", body=json.dumps(body))

results = {}
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(); page = ctx.new_page()
    errors = []; page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("dialog", lambda d: (errors.append("DIALOG: "+d.message), d.dismiss()))
    page.route("**/*supabase.co/**", api)
    page.goto("http://127.0.0.1:8765/index.html")
    page.wait_for_selector("#authForm")
    results["tela_login_carrega"] = True
    results["link_esqueci_senha"] = page.locator("#toForgot").count() == 1
    page.fill("input[name=email]", "adm@teste.com"); page.fill("input[name=senha]", "123456")
    page.click("#authForm button[type=submit]")
    page.wait_for_selector(".rail", timeout=8000)
    results["entrou_no_app"] = True
    def check(label):
        results[label+"_sem_img_injetada"] = page.locator("img[src=x]").count() == 0
        results[label+"_sem_tag_b_injetada"] = page.locator("#hack, #forn, #nf").count() == 0
        results[label+"_sem_xss_executado"] = page.evaluate("window.__xss === undefined")
    check("painel")
    results["texto_do_payload_aparece_como_texto"] = "onerror" in page.inner_text(".rail-who")
    for tab in ["itens","movimentos","consumo","alertas","usuarios"]:
        page.click(f'.rail button[data-tab={tab}]'); page.wait_for_timeout(150); check(tab)
    if errors: results["erros_js"] = errors
    page.screenshot(path="shot.png")
    b.close()
srv.shutdown()
ok = all(v is True for k,v in results.items() if k != "erros_js") and "erros_js" not in results
for k,v in results.items(): print(("OK  " if v is True else "FALHA ")+k, "" if v is True else v)
print("RESULTADO:", "TUDO OK" if ok else "HÁ FALHAS")
