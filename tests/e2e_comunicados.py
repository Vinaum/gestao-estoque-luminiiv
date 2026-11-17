"""Teste de navegador: comunicados (morador, gestor e síndico), com Supabase simulado."""
import sys; sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
from e2e_comum import *
from playwright.sync_api import sync_playwright
PORTA = 8787
CA = '11111111-1111-1111-1111-111111111111'
UIDS = {'morador': 'aaaaaaaa-0000-0000-0000-000000000004', 'gestor': 'aaaaaaaa-0000-0000-0000-000000000003', 'sindico': 'aaaaaaaa-0000-0000-0000-000000000002'}
XSS = '<img src=x onerror=alert(1)>'
T1 = 'bbbbbbbb-0000-0000-0000-000000000001'
ID = lambda n: f'dddddddd-0000-0000-0000-0000000000{n:02d}'
def com(n, titulo, status='publicado', **k):
    d = {'id': ID(n), 'titulo': titulo, 'corpo': 'Texto\nem duas linhas', 'tipo': 'aviso', 'torre_id': None, 'fixado': False, 'status': status,
         'publicado_em': '2026-11-10T12:00:00Z' if status != 'rascunho' else None, 'expira_em': None, 'editado_em': None,
         'anexo_path': None, 'anexo_nome': None, 'criado_em': '2026-11-09T12:00:00Z'}
    d.update(k); return d
LISTA = lambda: [com(1, 'Corte de água'), com(2, XSS, fixado=True, corpo='<script>alert(1)</script>'), com(3, 'Rascunho X', 'rascunho'),
                 com(4, 'Antigo', 'arquivado'), com(5, 'Vencido', expira_em='2020-01-01T00:00:00Z'),
                 com(6, 'Com anexo', anexo_path=f'{CA}/{ID(6)}/a.pdf', anexo_nome='ata.pdf')]
def dados(papel, lidos=()):
    def t(u, q, m, corpo, acc):
        if m == 'RPC:salvar_comunicado': return corpo['p_id'] or ID(9)
        if m == 'RPC:marcar_comunicado_lido': return True
        if m == 'RPC:leituras_comunicado': return {'total': 4, 'lidos': 3, 'pendentes': [{'user_id': 'u1', 'nome': XSS, 'apartamento_id': None}]}
        if m.startswith('RPC'): return {}
        if '/comunicado_leituras' in u: return [{'comunicado_id': i} for i in lidos]
        if '/comunicados' in u:
            return [c for c in LISTA() if papel in ('sindico', 'gestor') or (c['status'] == 'publicado')]
        if '/torres' in u: return [{'id': T1, 'nome': 'Torre 1', 'ativo': True}]
        if '/apartamentos' in u: return []
        if '/profiles' in u and 'id=eq.' in u: return [{'id': UIDS[papel], 'nome': 'Pessoa', 'superadmin': False}]
        if '/condominios' in u: return [{'id': CA, 'nome': 'Cond A', 'ativo': True}]
        if '/membros' in u: return [{'condominio_id': CA, 'papel': papel, 'ativo': True}]
    return t
def main():
    srv = servidor(PORTA); falhou = []; ok = checador(falhou)
    try:
        with sync_playwright() as pw:
            # ---- morador
            nav, pg, erros, ch = abrir(pw, PORTA, UIDS['morador'], dados('morador', lidos=[ID(1)]), 'comunicados', '.cartao-com')
            ok(pg.locator('.cartao-com').count() == 4, 'morador vê só os 4 publicados (sem rascunho/arquivado)')
            ok(pg.locator('[data-acao=novo], [data-aba], [data-acao=editar]').count() == 0, 'morador não vê Novo, abas nem Editar')
            ok(pg.locator('#pagina img').count() == 0 and XSS in pg.inner_text('#pagina'), 'título malicioso aparece como texto')
            ok(pg.locator('.cartao-com').first.inner_text().count('Fixado') == 1, 'fixado vem primeiro')
            ok(pg.locator('.cartao-com', has_text='Corte de água').locator('.tag-novo').count() == 0, 'já lido não tem "Novo"')
            ok(pg.locator('.cartao-com', has_text='Vencido').locator('.tag-novo').count() == 0 and 'Vencido' in pg.locator('.cartao-com', has_text='Vencido').inner_text(), 'vencido não é "Novo" e é marcado')
            ok(pg.locator('.tag-novo').count() == 2, 'dois "Novo" (o lido e o vencido ficam de fora)')
            pg.locator('.cartao-com', has_text='Com anexo').locator('[data-acao=abrir]').click(); pg.wait_for_selector('.modal .corpo-comunicado')
            esperar_chamada(pg, ch, 'marcar_comunicado_lido', 1)
            ch_l = [x for x in ch if x[0] == 'marcar_comunicado_lido']
            ok(ch_l[0][1] == {'p_id': ID(6)}, 'abrir marca como lido (id certo)')
            ok(pg.locator('.cartao-com', has_text='Com anexo').locator('.tag-novo').count() == 0, 'e o "Novo" some da lista')
            ok('Abrir anexo (ata.pdf)' in pg.inner_text('.modal'), 'mostra o botão do anexo')
            pg.click('.modal [data-fechar]'); pg.wait_for_selector('.modal', state='detached')
            pg.locator('.cartao-com', has_text=XSS).locator('[data-acao=abrir]').click(); pg.wait_for_selector('.modal .corpo-comunicado')
            ok(pg.locator('.modal script').count() == 0 and '<script>alert(1)</script>' in pg.inner_text('.modal .corpo-comunicado'), 'corpo malicioso aparece como texto')
            ok(pg.evaluate("getComputedStyle(document.querySelector('.corpo-comunicado')).whiteSpace") == 'pre-wrap', 'quebras de linha preservadas')
            ok(not erros, 'morador sem erros de script: %s' % erros); nav.close()

            # ---- gestor
            nav, pg, erros, ch = abrir(pw, PORTA, UIDS['gestor'], dados('gestor'), 'comunicados', '.cartao-com')
            ab = pg.locator('[data-aba]').all_inner_texts()
            ok([a.strip() for a in ab] == ['Publicados (4)', 'Rascunhos (1)', 'Arquivados (1)'], 'abas com contagem: %s' % ab)
            pg.click('[data-aba=rascunho]'); ok(pg.locator('.cartao-com').count() == 1 and 'Rascunho X' in pg.inner_text('#pagina'), 'aba Rascunhos')
            ok(pg.locator('.cartao-com [data-acao=publicar]').count() == 1, 'rascunho tem Publicar')
            pg.click('[data-aba=arquivado]'); ok('Publicar de novo' in pg.inner_text('#pagina'), 'arquivado pode ser publicado de novo')
            pg.click('[data-aba=publicado]')

            # novo comunicado: validações
            pg.click('[data-acao=novo]'); pg.wait_for_selector('.modal form')
            pg.click('.modal [data-a=publicar]')
            ok(pg.locator('.modal [data-erro]:not(.hidden)').count() == 1, 'título/texto vazios são recusados')
            ok(not [x for x in ch if x[0] == 'salvar_comunicado'], 'e nada é enviado')
            pg.fill('#co-titulo', 'Reunião'); pg.fill('#co-corpo', 'Dia 20, às 19h'); pg.fill('#co-expira', '2020-01-01')
            pg.click('.modal [data-a=publicar]')
            ok('já passou' in pg.inner_text('.modal [data-erro]'), 'data de validade no passado é recusada')
            ok(not [x for x in ch if x[0] == 'salvar_comunicado'], 'sem envio com data passada')
            pg.fill('#co-expira', '2099-12-31'); pg.select_option('#co-tipo', 'assembleia'); pg.select_option('#co-torre', T1); pg.check('input[name=fixado]')
            pg.click('.modal [data-a=publicar]'); pg.wait_for_selector('.modal', state='detached')
            s = [x for x in ch if x[0] == 'salvar_comunicado']
            ok(len(s) == 1 and s[0][1]['p_condominio_id'] == CA and s[0][1]['p_id'] is None, 'salvar: condomínio certo e sem id (novo)')
            d = s[0][1]['p_dados']
            ok((d['titulo'], d['corpo'], d['tipo'], d['torre_id'], d['fixado']) == ('Reunião', 'Dia 20, às 19h', 'assembleia', T1, True) and d['expira_em'][:10] in ('2099-12-31', '2100-01-01'), 'campos enviados corretamente: %s' % d)
            esperar_chamada(pg, ch, 'publicar_comunicado', 1)
            ok([x for x in ch if x[0] == 'publicar_comunicado'][0][1] == {'p_id': ID(9)}, 'publica o id devolvido pelo salvar')

            # editar publicado: só "Salvar alterações"
            pg.locator('.cartao-com', has_text='Corte de água').locator('[data-acao=editar]').click(); pg.wait_for_selector('.modal form')
            ok(pg.locator('.modal [data-a=salvar]').count() == 1 and pg.locator('.modal [data-a=publicar]').count() == 0, 'publicado só oferece Salvar alterações')
            ok(pg.input_value('#co-titulo') == 'Corte de água', 'editor vem preenchido')
            pg.fill('#co-titulo', 'Corte de água às 10h'); pg.click('.modal [data-a=salvar]'); pg.wait_for_selector('.modal', state='detached')
            s = [x for x in ch if x[0] == 'salvar_comunicado']
            ok(len(s) == 2 and s[1][1]['p_id'] == ID(1), 'editar envia o id existente')
            ok(len([x for x in ch if x[0] == 'publicar_comunicado']) == 1, 'salvar alterações não republica')
            esperar_chamada(pg, ch, 'salvar_comunicado', 2)

            # anexo: envio de arquivo
            pg.click('[data-acao=novo]'); pg.wait_for_selector('.modal form')
            pg.fill('#co-titulo', 'Com PDF'); pg.fill('#co-corpo', 'Veja'); 
            pg.set_input_files('#co-arq', files=[{'name': 'x.exe', 'mimeType': 'application/octet-stream', 'buffer': b'abc'}])
            pg.click('.modal [data-a=rascunho]')
            ok(pg.locator('.modal [data-erro]:not(.hidden)').count() == 1, 'tipo de arquivo não permitido é recusado')
            ok(len([x for x in ch if x[0] == 'salvar_comunicado']) == 2, 'sem envio ao banco com arquivo inválido')
            pg.set_input_files('#co-arq', files=[{'name': 'Ata 1.pdf', 'mimeType': 'application/pdf', 'buffer': b'%PDF-1.4'}])
            pg.click('.modal [data-a=rascunho]'); pg.wait_for_selector('.modal', state='detached')
            esperar_chamada(pg, ch, 'definir_anexo_comunicado', 1)
            a = [x for x in ch if x[0] == 'definir_anexo_comunicado'][0][1]
            ok(a['p_id'] == ID(9) and a['p_path'].startswith(f'{CA}/{ID(9)}/') and a['p_path'].endswith('.pdf') and a['p_nome'] == 'Ata 1.pdf', 'anexo: caminho condomínio/comunicado/arquivo e nome: %s' % a)
            ok(len([x for x in ch if x[0] == 'publicar_comunicado']) == 1, 'rascunho com anexo não publica')

            # arquivar (confirma) e quem leu
            pg.locator('.cartao-com', has_text='Corte de água').locator('[data-acao=arquivar]').click(); pg.wait_for_selector('.modal [data-r="0"]'); pg.click('.modal [data-r="0"]')
            ok(not [x for x in ch if x[0] == 'arquivar_comunicado'], 'cancelar não arquiva')
            pg.locator('.cartao-com', has_text='Corte de água').locator('[data-acao=arquivar]').click(); pg.wait_for_selector('.modal [data-r="1"]'); pg.click('.modal [data-r="1"]')
            esperar_chamada(pg, ch, 'arquivar_comunicado', 1)
            ok([x for x in ch if x[0] == 'arquivar_comunicado'][0][1] == {'p_id': ID(1)}, 'confirmar arquiva o comunicado certo')
            pg.locator('.cartao-com', has_text='Com anexo').locator('[data-acao=leituras]').click(); pg.wait_for_selector('.modal .progresso')
            tx = pg.inner_text('.modal')
            ok('3 de 4' in tx.replace('Lido por ', '').replace(' pessoas (75%).', '').replace('\n', ' ') or 'Lido por 3 de 4' in tx, 'mostra "lido por 3 de 4"')
            ok(pg.locator('.modal img').count() == 0 and XSS in tx and 'sem apartamento' in tx, 'pendentes: nome malicioso como texto e "sem apartamento"')
            ok(not erros, 'gestor sem erros de script: %s' % erros); nav.close()

            # ---- síndico: publicar um rascunho
            nav, pg, erros, ch = abrir(pw, PORTA, UIDS['sindico'], dados('sindico'), 'comunicados', '.cartao-com')
            pg.click('[data-aba=rascunho]')
            pg.locator('.cartao-com [data-acao=publicar]').click(); pg.wait_for_selector('.modal [data-r="1"]'); pg.click('.modal [data-r="1"]')
            esperar_chamada(pg, ch, 'publicar_comunicado', 1)
            ok([x for x in ch if x[0] == 'publicar_comunicado'][0][1] == {'p_id': ID(3)}, 'síndico publica o rascunho certo')
            ok(not erros, 'síndico sem erros de script: %s' % erros); nav.close()
    finally: srv.terminate()
    relatorio(falhou)
main()
