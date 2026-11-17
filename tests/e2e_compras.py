"""Teste de navegador: Fornecedores, Central de compras, Aprovações (Supabase simulado)."""
import json, base64, subprocess, time, sys, os, re
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); PORTA = 8780
REF='aiuwreyhnubprlapkxli'; COND='11111111-1111-1111-1111-111111111111'
UID_G='aaaaaaaa-0000-0000-0000-000000000003'; UID_S='aaaaaaaa-0000-0000-0000-000000000002'
I1='bbbbbbbb-0000-0000-0000-000000000001'; I2='bbbbbbbb-0000-0000-0000-000000000002'; I3='bbbbbbbb-0000-0000-0000-000000000003'
F1='99999999-0000-0000-0000-000000000001'; C_AGU='77777777-0000-0000-0000-000000000001'; C_APR='77777777-0000-0000-0000-000000000002'
CI1='88888888-0000-0000-0000-000000000001'
XSS='<img src=x onerror=alert(1)>'
def b64(d): return base64.urlsafe_b64encode(json.dumps(d).encode()).decode().rstrip('=')
def jwt(u): return f"{b64({'alg':'HS256'})}.{b64({'sub':u,'exp':4102444800})}.x"
base=dict(condominio_id=COND,categoria='Limpeza',categoria_id='f1',unidade='cx',unidade_id='f2',ativo=True,total_lotes=1,estoque_minimo=5,estoque_ideal=20,fornecedor_principal_id=None)
ITENS=[dict(base,item_id=I1,nome='Papel toalha',estoque_atual=4,status='comprar',qtd_sugerida=16,qtd_em_pedido=0),
       dict(base,item_id=I2,nome='Sabão',estoque_atual=3,status='esgotado',qtd_sugerida=17,qtd_em_pedido=17),   # já coberto
       dict(base,item_id=I3,nome=XSS,estoque_atual=6,status='atencao',qtd_sugerida=14,qtd_em_pedido=4)]
def vc(cid,status,**k): return dict(compra_id=cid,condominio_id=COND,data_compra='2026-11-16',mes='2026-11-01',fornecedor_id=F1,fornecedor='Higiene Total',categoria_id=None,categoria=None,numero_nf=None,nf_arquivo_path=None,status=status,responsavel_id=UID_G,aprovada_por=None,aprovada_em=None,observacoes=None,valor_total=300,qtd_itens=1,**k)
COMPRAS=[vc(C_AGU,'aguardando_aprovacao'),vc(C_APR,'aprovada')]
FORN=[dict(id=F1,condominio_id=COND,nome=XSS,razao_social=None,cnpj='11222333000181',contato='Ana',telefone='1',email=None,endereco=None,observacoes=None,ativo=True)]

def main():
    srv=subprocess.Popen([sys.executable,'-m','http.server',str(PORTA),'--directory',RAIZ],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL); time.sleep(1)
    falhou=[]
    def ok(c,m):
        print(('OK   ' if c else 'FALHOU'),m)
        if not c: falhou.append(m)
    try:
        with sync_playwright() as pw:
            def abrir(uid,papel,rota):
                nav=pw.chromium.launch(); pg=nav.new_context().new_page(); erros=[]; ch=[]
                pg.on('pageerror',lambda e:erros.append(str(e))); pg.on('dialog',lambda d:(erros.append('ALERTA'),d.dismiss()))
                def rest(route):
                    rq=route.request; u=rq.url; q=parse_qs(urlparse(u).query); acc=rq.headers.get('accept','')
                    def reply(x,status=200):
                        if 'object' in acc and isinstance(x,list): x=x[0] if x else None
                        route.fulfill(status=status,content_type='application/json',body=json.dumps(x),headers={'access-control-allow-origin':'*'})
                    if '/storage/v1/object/' in u and rq.method=='POST':
                        ch.append(('storage.upload',u.split('/notas-fiscais/')[1])); return reply({'Key':'x'})
                    if '/rpc/' in u: ch.append((u.split('/rpc/')[1],rq.post_data_json)); return reply({})
                    if rq.method in ('POST','PATCH','DELETE'):
                        ch.append((rq.method+' '+urlparse(u).path.split('/')[-1],rq.post_data_json)); 
                        if 'select=id' in u: return reply({'id':F1})
                        route.fulfill(status=204,body='',headers={'access-control-allow-origin':'*'}); return
                    if '/profiles' in u and 'id=eq.' in u: return reply([{'id':uid,'nome':'Pessoa','superadmin':False}])
                    if '/profiles' in u: return reply([{'id':UID_G,'nome':'Gestora'},{'id':UID_S,'nome':'Síndico'}])
                    if '/condominios' in u: return reply([{'id':COND,'nome':'Cond A','ativo':True}])
                    if '/membros' in u: return reply([{'condominio_id':COND,'papel':papel,'ativo':True}])
                    if '/v_estoque_item' in u: return reply(ITENS)
                    if '/v_compras' in u:
                        cid=(q.get('compra_id') or [''])[0].replace('eq.','')
                        lst=[c for c in COMPRAS if not cid or c['compra_id']==cid]
                        st=(q.get('status') or [''])[0]
                        if st.startswith('in.'): lst=[c for c in lst if c['status'] in st[4:-1].split(',')]
                        return reply(lst)
                    if '/compra_itens' in u: return reply([dict(id=CI1,item_id=I1,qtd_solicitada=16,qtd_recebida=0,custo_unitario=10,custo_total=160,vencimento_previsto='2027-06-01')])
                    if '/recebimentos' in u or '/recebimento_itens' in u: return reply([])
                    if '/fornecedor_categorias' in u: return reply([{'fornecedor_id':F1,'categoria_id':'f1'}])
                    if '/fornecedores' in u: return reply(FORN)
                    if '/categorias' in u: return reply([{'id':'f1','nome':'Limpeza'},{'id':'f9','nome':'Outros'}])
                    return reply([])
                pg.route(re.compile(r'https://.*supabase\.co/(rest|storage)/v1/.*'),rest)
                pg.route(re.compile(r'https://.*supabase\.co/(auth|realtime).*'),lambda r:r.fulfill(status=200,content_type='application/json',body='{}',headers={'access-control-allow-origin':'*'}))
                pg.route(re.compile(r'https://fonts\..*'),lambda r:r.fulfill(status=200,body=''))
                sess={'access_token':jwt(uid),'refresh_token':'r','expires_in':3600,'expires_at':4102444800,'token_type':'bearer','user':{'id':uid,'email':'x@t.com','aud':'authenticated'}}
                pg.add_init_script(f"localStorage.setItem('sb-{REF}-auth-token', {json.dumps(json.dumps(sess))});")
                pg.goto(f'http://localhost:{PORTA}/app/index.html#/{rota}'); pg.wait_for_selector('#pagina table, #pagina .empty, #pagina .panel',timeout=8000)
                return nav,pg,erros,ch

            # ============ FORNECEDORES (gestor)
            nav,pg,erros,ch=abrir(UID_G,'gestor','fornecedores'); pg.wait_for_selector('#tab table')
            ok(pg.locator('#tab img').count()==0 and XSS in pg.inner_text('#tab'),'nome malicioso de fornecedor aparece como texto')
            ok('11.222.333/0001-81' in pg.inner_text('#tab') and 'Limpeza' in pg.inner_text('#tab'),'CNPJ formatado e categoria na lista')
            pg.click('[data-acao=novo]'); pg.wait_for_selector('.modal form')
            pg.fill('#f-nome','Elétrica Luz'); pg.fill('#f-cnpj','11.222.333/0001-44'); pg.click('.modal button[type=submit]')
            ok('cnpj' in pg.inner_text('.modal [data-erro]').lower(),'CNPJ inválido é recusado na tela')
            pg.fill('#f-cnpj','11.222.333/0001-81'); pg.check('input[name="cat_f9"]'); pg.click('.modal button[type=submit]'); pg.wait_for_selector('.modal',state='detached')
            ins=[c for c in ch if c[0]=='POST fornecedores']; cat=[c for c in ch if c[0]=='POST fornecedor_categorias']
            ok(len(ins)==1 and ins[0][1]['cnpj']=='11222333000181' and ins[0][1]['condominio_id']==COND,'fornecedor enviado com CNPJ só números e condomínio')
            ok(len(cat)==1 and cat[0][1][0]['categoria_id']=='f9','categorias do fornecedor gravadas')
            ok(not erros,'fornecedores sem erros de script: %s'%erros); nav.close()

            # ============ CENTRAL DE COMPRAS (gestor)
            nav,pg,erros,ch=abrir(UID_G,'gestor','compras'); pg.wait_for_selector('#conteudo table')
            ok(pg.locator('#conteudo tbody tr').count()==1 and 'Papel toalha' in pg.inner_text('#conteudo'),'necessidade lista só o item que falta (Sabão coberto por pedido, atenção oculto)')
            ok('16' in pg.locator('#conteudo tbody tr').inner_text(),'sugerido comprar = 16')
            pg.check('#inc-atencao'); ok(pg.locator('#conteudo tbody tr').count()==2 and pg.locator('#conteudo img').count()==0,'itens em atenção entram sob demanda (nome é texto)')
            pg.uncheck('#inc-atencao')
            ok(pg.locator('[data-acao=criar-selecionados]').is_disabled(),'criar compra desabilitado sem seleção')
            pg.check('[data-marca="%s"]'%I1); pg.click('[data-acao=criar-selecionados]'); pg.wait_for_selector('.modal form')
            ok(pg.locator('.modal [data-c=qtd]').input_value()=='16','editor abre com a quantidade sugerida (16)')
            pg.fill('.modal [data-c=custo]','12,5'); ok('R$' in pg.inner_text('.modal [data-total]') and '200,00' in pg.inner_text('.modal [data-total]'),'total = 16 × 12,50 = R$ 200,00')
            pg.click('.modal [data-add]'); pg.fill('.modal tbody tr:nth-child(2) [data-c=qtd]','1')
            pg.click('.modal [data-enviar="1"]'); ok('mais de uma linha' in pg.inner_text('.modal [data-erro]'),'mesmo item em duas linhas é recusado')
            ok(not [c for c in ch if c[0]=='salvar_compra'],'nada enviado ao banco com dados inválidos')
            pg.click('.modal tbody tr:nth-child(2) [data-rem]')
            pg.click('.modal [data-enviar="1"]'); pg.wait_for_selector('.modal',state='detached')
            c=[x for x in ch if x[0]=='salvar_compra']
            ok(len(c)==1 and c[0][1]['p_enviar'] is True and c[0][1]['p_condominio_id']==COND and c[0][1]['p_compra_id'] is None,'salvar e enviar: p_enviar verdadeiro, compra nova')
            ok(c[0][1]['p_itens']==[{'item_id':I1,'qtd_solicitada':16,'custo_unitario':12.5,'vencimento_previsto':None}],'itens enviados com custo 12,5')
            # abrir compra aprovada -> recebimento
            pg.click('[data-aba=compras]'); pg.select_option('#f-status','todas')
            pg.locator('tr', has_text='Aprovada').locator('[data-acao=abrir]').click(); pg.wait_for_selector('.modal [data-a=receber]')
            ok(pg.locator('.modal [data-a=aprovar]').count()==0,'gestor não vê o botão Aprovar')
            ok(pg.locator('.modal [data-a=pedido]').count()==1,'compra aprovada oferece "pedido realizado"')
            pg.click('.modal [data-a=receber]'); pg.wait_for_selector('.modal form')
            ok(pg.locator('.modal input.inp-num').input_value()=='16','recebimento sugere o que falta (16)')
            pg.fill('.modal input.inp-num','17'); pg.click('.modal button[type=submit]'); ok('não pode receber mais' in pg.inner_text('.modal [data-erro]'),'receber acima do que falta é recusado na tela')
            pg.fill('.modal input.inp-num','6'); pg.click('.modal button[type=submit]'); pg.wait_for_selector('.modal',state='detached')
            c=[x for x in ch if x[0]=='registrar_recebimento']
            ok(len(c)==1 and c[0][1]['p_itens']==[{'compra_item_id':CI1,'quantidade':6,'vencimento':'2027-06-01'}] and c[0][1]['p_compra_id']==C_APR,'recebimento parcial de 6 enviado com a validade prevista')
            ok(re.fullmatch(r'[0-9a-f-]{36}',c[0][1]['p_chave']) is not None,'recebimento leva chave de operação')
            # nota fiscal
            pg.locator('tr', has_text='Aprovada').locator('[data-acao=abrir]').click(); pg.wait_for_selector('.modal [data-nf-editar]')
            pg.click('.modal [data-nf-editar]'); pg.wait_for_selector('.modal form')
            os.makedirs('/tmp/nf_teste',exist_ok=True); open('/tmp/nf_teste/nota.pdf','wb').write(b'%PDF-1.4 teste'); open('/tmp/nf_teste/nota.txt','w').write('x')
            pg.fill('#n-num','NF 123'); pg.set_input_files('#n-arq','/tmp/nf_teste/nota.txt'); pg.click('.modal button[type=submit]')
            ok('formato' in pg.inner_text('.modal [data-erro]').lower(),'anexo .txt é recusado')
            pg.set_input_files('#n-arq','/tmp/nf_teste/nota.pdf'); pg.click('.modal button[type=submit]'); pg.wait_for_selector('.modal',state='detached')
            up=[x for x in ch if x[0]=='storage.upload']; nf=[x for x in ch if x[0]=='atualizar_nf_compra']
            ok(len(up)==1 and up[0][1].startswith(COND+'/'+C_APR+'/') and up[0][1].endswith('.pdf'),'PDF enviado para pasta do condomínio/compra')
            ok(len(nf)==1 and nf[0][1]['p_numero_nf']=='NF 123' and nf[0][1]['p_arquivo_path'].startswith(COND+'/'+C_APR+'/'),'número e caminho da NF gravados')
            ok(not erros,'compras sem erros de script: %s'%erros); nav.close()

            # ============ SÍNDICO: aprovações
            nav,pg,erros,ch=abrir(UID_S,'sindico','aprovacoes'); pg.wait_for_selector('#pagina table')
            ok('Aguardando aprovação (1)' in pg.inner_text('#pagina'),'síndico vê 1 compra aguardando')
            pg.locator('[data-acao=abrir]').first.click(); pg.wait_for_selector('.modal [data-a=aprovar]')
            pg.click('.modal [data-a=aprovar]'); pg.wait_for_selector('.modal [data-r="1"]'); pg.click('.modal [data-r="1"]'); pg.wait_for_selector('.toast.ok')
            c=[x for x in ch if x[0]=='aprovar_compra']
            ok(len(c)==1 and c[0][1]=={'p_compra_id':C_AGU},'síndico aprova a compra certa (com confirmação)')
            ok(not erros,'aprovações sem erros de script: %s'%erros); nav.close()
            # gestor não acessa aprovações
            nav,pg,erros,ch=abrir(UID_G,'gestor','aprovacoes'); pg.wait_for_timeout(500)
            ok(pg.evaluate('location.hash')=='#/operacao','gestor é redirecionado de #/aprovacoes'); nav.close()
    finally: srv.terminate()
    print('RESULTADO:','FALHOU %s'%falhou if falhou else 'TUDO OK'); sys.exit(1 if falhou else 0)
main()
