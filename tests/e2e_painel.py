"""Teste de navegador do Painel do síndico, usando linhas reais exportadas do banco (tests/fixtures/painel_dados.json)."""
import json, base64, subprocess, time, sys, os, re
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright
RAIZ=os.path.dirname(os.path.dirname(os.path.abspath(__file__))); PORTA=8781
REF='aiuwreyhnubprlapkxli'; PAPEL=os.environ.get('PAPEL_TESTE','sindico')
UID={'sindico':'00000000-0000-0000-0000-0000000000a2','gestor':'00000000-0000-0000-0000-0000000000a3'}[PAPEL]
D=json.load(open(os.path.join(RAIZ,'tests/fixtures/painel_dados.json')))
COND=D['itens'][0]['condominio_id']
def b64(d): return base64.urlsafe_b64encode(json.dumps(d).encode()).decode().rstrip('=')
def jwt(u): return f"{b64({'alg':'HS256'})}.{b64({'sub':u,'exp':4102444800})}.x"
def main():
    srv=subprocess.Popen([sys.executable,'-m','http.server',str(PORTA),'--directory',RAIZ],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL); time.sleep(1)
    falhou=[]
    def ok(c,m):
        print(('OK   ' if c else 'FALHOU'),m)
        if not c: falhou.append(m)
    try:
        with sync_playwright() as pw:
            nav=pw.chromium.launch(); pg=nav.new_context().new_page(); erros=[]
            pg.on('pageerror',lambda e:erros.append(str(e))); pg.on('dialog',lambda d:(erros.append('ALERTA'),d.dismiss()))
            def rest(route):
                u=route.request.url; q=parse_qs(urlparse(u).query); acc=route.request.headers.get('accept','')
                def reply(x):
                    if 'object' in acc and isinstance(x,list): x=x[0] if x else None
                    route.fulfill(status=200,content_type='application/json',body=json.dumps(x),headers={'access-control-allow-origin':'*'})
                if '/profiles' in u and 'id=eq.' in u: return reply([{'id':UID,'nome':PAPEL,'superadmin':False}])
                if '/profiles' in u: return reply([{'id':UID,'nome':'Síndico'},{'id':'00000000-0000-0000-0000-0000000000a3','nome':'Gestor'}])
                if '/condominios' in u: return reply([{'id':COND,'nome':'Cond A','ativo':True}])
                if '/membros' in u: return reply([{'condominio_id':COND,'papel':PAPEL,'ativo':True}])
                if '/fornecedores' in u: return reply([{'id':'f1','condominio_id':COND,'nome':'Forn Teste','ativo':True,'cnpj':None}])
                if '/v_estoque_item' in u: return reply(D['itens'])
                if '/v_lotes' in u: return reply(D['lotes'])
                if '/v_saidas_mensal' in u: return reply(D['saidas'])
                if '/v_compras' in u:
                    st=(q.get('status') or [''])[0]
                    if st=='eq.aguardando_aprovacao': return reply([])
                    return reply(D['compras'])
                if '/movimentacoes' in u:
                    tipo=(q.get('tipo') or [''])[0].replace('eq.','')
                    return reply([m for m in D['movs'] if m['tipo']==tipo][:10])
                reply([])
            pg.route(re.compile(r'https://.*supabase\.co/rest/v1/.*'),rest)
            pg.route(re.compile(r'https://.*supabase\.co/(auth|realtime).*'),lambda r:r.fulfill(status=200,content_type='application/json',body='{}',headers={'access-control-allow-origin':'*'}))
            pg.route(re.compile(r'https://fonts\..*'),lambda r:r.fulfill(status=200,body=''))
            sess={'access_token':jwt(UID),'refresh_token':'r','expires_in':3600,'expires_at':4102444800,'token_type':'bearer','user':{'id':UID,'email':'s@t.com','aud':'authenticated'}}
            pg.add_init_script(f"localStorage.setItem('sb-{REF}-auth-token', {json.dumps(json.dumps(sess))});")
            base=f'http://localhost:{PORTA}/{os.environ.get("APP_CAMINHO", "app")}/index.html'
            pg.goto(base+('#/painel' if PAPEL=='gestor' else '')); pg.wait_for_selector('.cards.oito',timeout=8000)
            ok(pg.evaluate('location.hash')=='#/painel',PAPEL+' abre o painel')
            cards={c.locator('.k').inner_text():c.locator('.v').inner_text() for c in pg.locator('.cards .card').all()}
            ok(cards['Itens cadastrados']=='4' and cards['Para comprar']=='1' and cards['Esgotados']=='1' and cards['Em atenção']=='1','indicadores: 4 itens, 1 comprar, 1 esgotado, 1 em atenção')
            ok(cards['Vencidos ou a vencer em 30 dias']=='2','indicador de vencimentos = 2')
            gm=[v for k,v in cards.items() if k.startswith('Gasto em') and not re.search(r'\d{4}$',k)][0]; ga=[v for k,v in cards.items() if re.search(r'Gasto em \d{4}$',k)][0]
            ok('100,50' in gm and '300,50' in ga,'gasto do mês R$ 100,50 e do ano R$ 300,50 (iguais ao banco)')
            ok(cards['Compras aguardando aprovação']=='0','aprovações pendentes = 0')
            t=pg.locator('.panel',has_text='Alertas de reposição').inner_text()
            ok('Esgotado' in t and 'Comprar' in t and 'SemEstoque' not in t,'alertas: esgotado e comprar; item sem estoque cadastrado fora')
            ok('1 item(ns) ainda sem estoque cadastrado' in pg.inner_text('#pagina'),'aviso discreto de item sem estoque cadastrado')
            ok('Atencao' in pg.locator('.panel',has_text='Estoque em atenção').inner_text(),'seção estoque em atenção')
            tv=pg.locator('.panel',has_text='Próximos vencimentos').inner_text()
            ok('Vencido' in tv and 'Até 30 dias' in tv and 'Esgotado' not in tv,'vencimentos: vencido e até 30 dias; lote zerado não aparece')
            ok(pg.locator('.barra').count()==12 and pg.locator('.barra.atual').count()==1,'gráfico anual com 12 meses e o mês atual destacado')
            ok('contagem física' in pg.locator('.panel',has_text='Ajustes recentes').inner_text(),'ajustes recentes com justificativa')
            ok(pg.locator('.panel',has_text='Consumo recente').locator('tbody tr').count()>=2,'consumo recente listado')
            ok(pg.locator('a[href="#/config-estoque"]').count()>=1 and pg.locator('a[href="#/operacao"]').count()>=1,'atalhos para configurar estoque e cadastrar item')
            if PAPEL=='gestor':
                ok(pg.locator('#pagina .cards a[href="#/aprovacoes"]').count()==0,'gestor vê o total de aprovações, mas sem link para aprovar')
            else:
                ok(pg.locator('#pagina .cards a[href="#/aprovacoes"]').count()==1,'síndico tem o link para aprovações')
            pg.goto(base+'#/gastos'); pg.wait_for_selector('#pagina h2',timeout=8000)
            ok(pg.evaluate('location.hash')=='#/gastos' and 'gasto' in pg.locator('#pagina h2').first.inner_text().lower(),PAPEL+' abre o relatório de gastos')
            pg.goto(base+'#/fornecedores'); pg.wait_for_selector('[data-acao=editar]',timeout=8000); pg.click('[data-acao=editar]'); pg.wait_for_selector('.modal form')
            tem=pg.locator('.modal input[name=ativo]').count()
            ok(tem==(0 if PAPEL=='gestor' else 1),'edição de fornecedor: caixa "ativo" '+('ausente para o gestor' if PAPEL=='gestor' else 'presente para o síndico'))
            ok(not erros,'sem erros de script: %s'%erros); nav.close()
    finally: srv.terminate()
    print('RESULTADO:','FALHOU %s'%falhou if falhou else 'TUDO OK'); sys.exit(1 if falhou else 0)
main()
