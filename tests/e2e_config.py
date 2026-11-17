"""Teste de navegador: Configuração de estoque e Estoque atual (Supabase simulado)."""
import json, base64, subprocess, time, sys, os, re
from playwright.sync_api import sync_playwright
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); PORTA = 8779
REF='aiuwreyhnubprlapkxli'; COND='11111111-1111-1111-1111-111111111111'; UID='aaaaaaaa-0000-0000-0000-000000000003'
I1='bbbbbbbb-0000-0000-0000-000000000001'; I2='bbbbbbbb-0000-0000-0000-000000000002'
def b64(d): return base64.urlsafe_b64encode(json.dumps(d).encode()).decode().rstrip('=')
def jwt(u): return f"{b64({'alg':'HS256'})}.{b64({'sub':u,'exp':4102444800})}.x"
base=dict(condominio_id=COND, categoria='Limpeza', categoria_id='f1', unidade='cx', unidade_id='f2', descricao=None, ativo=True, total_lotes=1)
ITENS=[dict(base,item_id=I1,nome='Papel toalha',estoque_atual=4,estoque_minimo=5,estoque_ideal=1500,localizacao='Depósito',status='comprar',qtd_sugerida=1496,qtd_em_pedido=0),
       dict(base,item_id=I2,nome='<b>Cera</b>',estoque_atual=0,estoque_minimo=0,estoque_ideal=0,localizacao=None,status='esgotado',qtd_sugerida=0,qtd_em_pedido=0,ativo=False,total_lotes=0)]
LOTES=[dict(lote_id='c1',condominio_id=COND,item_id=I1,item_nome='Papel toalha',unidade='cx',codigo='L002',saldo=4,vencimento='2027-03-01',faixa_vencimento='ok',valor_em_estoque=100),
       dict(lote_id='c2',condominio_id=COND,item_id=I1,item_nome='Papel toalha',unidade='cx',codigo='L001',saldo=2,vencimento='2020-01-01',faixa_vencimento='vencido',valor_em_estoque=50)]
HIST=[dict(id=1,item_id=I1,minimo_anterior=3,minimo_novo=5,ideal_anterior=20,ideal_novo=20,usuario_nome='Gestora',em='2026-11-16T12:00:00Z')]
def main():
    srv=subprocess.Popen([sys.executable,'-m','http.server',str(PORTA),'--directory',RAIZ],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL); time.sleep(1)
    falhou=[]; chamadas=[]
    def ok(c,m):
        print(('OK   ' if c else 'FALHOU'),m)
        if not c: falhou.append(m)
    try:
        with sync_playwright() as pw:
            nav=pw.chromium.launch(); pg=nav.new_context().new_page(); erros=[]
            pg.on('pageerror',lambda e:erros.append(str(e))); pg.on('dialog',lambda d:(erros.append('ALERTA'),d.dismiss()))
            def rest(route):
                rq=route.request; u=rq.url; corpo=[]
                if '/rpc/' in u:
                    chamadas.append((u.split('/rpc/')[1].split('?')[0],rq.post_data_json)); corpo={}
                elif rq.method=='PATCH': chamadas.append(('itens.update',rq.post_data_json)); route.fulfill(status=204,body='',headers={'access-control-allow-origin':'*'}); return
                elif '/profiles' in u and 'id=eq.' in u: corpo={'id':UID,'nome':'Gestora','superadmin':False}
                elif '/condominios' in u: corpo=[{'id':COND,'nome':'Cond A','ativo':True}]
                elif '/membros' in u: corpo=[{'condominio_id':COND,'papel':'gestor','ativo':True}]
                elif '/v_estoque_item' in u: corpo=ITENS
                elif '/v_lotes' in u: corpo=LOTES
                elif '/v_historico_parametros' in u: corpo=HIST
                elif '/categorias' in u: corpo=[{'id':'f1','nome':'Limpeza'}]
                elif '/unidades_medida' in u: corpo=[{'id':'f2','sigla':'cx','nome':'caixa'}]
                route.fulfill(status=200,content_type='application/json',body=json.dumps(corpo),headers={'access-control-allow-origin':'*'})
            pg.route(re.compile(r'https://.*supabase\.co/rest/v1/.*'),rest)
            pg.route(re.compile(r'https://.*supabase\.co/(auth|realtime).*'),lambda r:r.fulfill(status=200,content_type='application/json',body='{}',headers={'access-control-allow-origin':'*'}))
            pg.route(re.compile(r'https://fonts\..*'),lambda r:r.fulfill(status=200,body=''))
            sess={'access_token':jwt(UID),'refresh_token':'r','expires_in':3600,'expires_at':4102444800,'token_type':'bearer','user':{'id':UID,'email':'g@t.com','aud':'authenticated'}}
            pg.add_init_script(f"localStorage.setItem('sb-{REF}-auth-token', {json.dumps(json.dumps(sess))});")
            # ---- Configuração
            pg.goto(f'http://localhost:{PORTA}/app/index.html#/config-estoque')
            pg.wait_for_selector('#tab table',timeout=8000)
            ok(pg.locator('#tab tbody tr').count()==1,'inativos ficam escondidos por padrão')
            ok(pg.locator('[data-campo=ideal]').input_value()=='1500','ideal 1500 aparece sem ponto de milhar')
            ok(pg.locator('[data-acao=salvar]').is_disabled(),'Salvar começa desabilitado')
            pg.check('#ver-inativos'); ok(pg.locator('#tab tbody tr').count()==2 and pg.locator('#tab b').count()==2 and '<b>Cera</b>' in pg.inner_text('#tab'),'inativos aparecem sob demanda e nome é texto')
            pg.uncheck('#ver-inativos')
            pg.fill('[data-campo=ideal]','2')
            ok(pg.locator('[data-acao=salvar]').is_enabled(),'alterar um campo habilita Salvar')
            pg.click('[data-acao=salvar]'); pg.wait_for_selector('.toast.erro')
            ok(not [c for c in chamadas if c[0]=='atualizar_parametros_item'],'ideal menor que mínimo não é enviado')
            pg.fill('[data-campo=min]','6,5'); pg.fill('[data-campo=ideal]','2000')
            pg.click('[data-acao=salvar]'); pg.wait_for_selector('.toast.ok')
            c=[x for x in chamadas if x[0]=='atualizar_parametros_item']
            ok(len(c)==1 and c[0][1]=={'p_item_id':I1,'p_minimo':6.5,'p_ideal':2000},'salvar envia mínimo 6,5 e ideal 2000')
            pg.click('[data-acao=historico]'); pg.wait_for_selector('.modal table')
            t=pg.inner_text('.modal'); ok('Gestora' in t and '3 → 5' in t,'histórico mostra quem e a mudança 3 → 5'); pg.click('.modal [data-fechar]')
            pg.click('[data-acao=editar]'); pg.wait_for_selector('.modal form')
            ok(pg.locator('#x-uni').is_disabled(),'unidade travada em item com estoque')
            pg.fill('#x-nome','Papel toalha 2f'); pg.click('.modal button[type=submit]'); pg.wait_for_selector('.modal',state='detached')
            c=[x for x in chamadas if x[0]=='itens.update']
            ok(len(c)==1 and c[0][1]['nome']=='Papel toalha 2f' and c[0][1]['ativo'] is True and 'unidade_id' not in c[0][1],'editar envia nome e não troca a unidade')
            # ---- Estoque atual
            pg.goto(f'http://localhost:{PORTA}/app/index.html#/estoque'); pg.wait_for_selector('.panel table',timeout=8000)
            linhas=pg.locator('.panel').nth(1).locator('tbody tr').all_inner_texts()
            ok(len(linhas)==2 and 'L001' in linhas[0] and 'Vencido' in linhas[0],'lotes ordenados por validade, vencido primeiro')
            ok('R$' in pg.inner_text('.panel >> nth=1') and '150,00' in pg.inner_text('.panel >> nth=1'),'valor total em estoque (R$ 150,00)')
            ok(not erros,'sem erros de script: %s'%erros)
            nav.close()
    finally: srv.terminate()
    print('RESULTADO:','FALHOU %s'%falhou if falhou else 'TUDO OK'); sys.exit(1 if falhou else 0)
main()
