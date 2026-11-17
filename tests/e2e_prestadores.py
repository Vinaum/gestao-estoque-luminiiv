"""Teste de navegador: prestadores recomendados (morador, gestor e síndico), com Supabase simulado."""
import sys; sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
from e2e_comum import *
from playwright.sync_api import sync_playwright
PORTA = 8788
CA = '11111111-1111-1111-1111-111111111111'
UIDS = {'morador': 'aaaaaaaa-0000-0000-0000-000000000004', 'gestor': 'aaaaaaaa-0000-0000-0000-000000000003', 'sindico': 'aaaaaaaa-0000-0000-0000-000000000002'}
XSS = '<img src=x onerror=alert(1)>'
ID = lambda n: f'eeeeeeee-0000-0000-0000-0000000000{n:02d}'
def pr(n, nome, servico, status='publicado', meu=False, recs=(), minha=False, **k):
    d = {'id': ID(n), 'nome': nome, 'servico': servico, 'telefone': '11988887777', 'observacao': None, 'status': status, 'motivo': None,
         'indicado_em': '2026-11-10T12:00:00Z', 'meu': meu, 'indicador': {'nome': 'Ana', 'unidade': 'Torre 2 · Apto 31'},
         'minha_recomendacao': minha, 'recomendacoes': list(recs)}
    d.update(k); return d
REC = {'user_id': 'u-bia', 'nome': 'Bia', 'unidade': 'Torre 1 · Apto 13', 'comentario': 'Fez meu armário'}
def lista(papel):
    tudo = [pr(1, 'Carlos Marceneiro', 'Marceneiro', recs=[REC]),
            pr(2, XSS, 'diarista', observacao='<script>alert(1)</script>', telefone='11977776666'),
            pr(3, 'Paulo Pedreiro', 'Pedreiro', 'pendente', meu=True, telefone='11966665555'),
            pr(4, 'Lia Eletricista', 'Eletricista', 'pendente', telefone='11955554444'),
            pr(5, 'Zeca Pintor', 'Pintor', 'recusado', meu=True, motivo='Já temos um pintor', telefone='11944443333'),
            pr(6, 'Rui Removido', 'Pintor', 'removido', telefone='11933332222'),
            pr(7, 'Dora Diarista', 'Diarista', minha=True, recs=[REC], telefone='11922221111')]
    return tudo if papel == 'sindico' else [p for p in tudo if p['status'] == 'publicado' or (p['meu'] and p['status'] in ('pendente', 'recusado'))]
def dados(papel):
    def t(u, q, m, corpo, acc):
        if m == 'RPC:listar_prestadores': return lista(papel)
        if m == 'RPC:indicar_prestador':
            return {'id': None, 'duplicado': ID(1)} if ''.join(c for c in corpo['p_dados']['telefone'] if c.isdigit()).endswith('11988887777') else {'id': ID(20), 'duplicado': None}
        if m.startswith('RPC'): return {}
        if '/profiles' in u and 'id=eq.' in u: return [{'id': UIDS[papel], 'nome': 'Pessoa', 'superadmin': False}]
        if '/condominios' in u: return [{'id': CA, 'nome': 'Cond A', 'ativo': True}]
        if '/membros' in u: return [{'condominio_id': CA, 'papel': papel, 'ativo': True}]
    return t
def chamadas(ch, nome): return [x for x in ch if x[0] == nome]
def cartao(pg, texto): return pg.locator('.cartao-prest', has_text=texto)
def main():
    srv = servidor(PORTA); falhou = []; ok = checador(falhou)
    try:
        with sync_playwright() as pw:
            # ---- morador
            nav, pg, erros, ch = abrir(pw, PORTA, UIDS['morador'], dados('morador'), 'prestadores', '.cartao-prest')
            ok([a.strip() for a in pg.locator('[data-aba]').all_inner_texts()] == ['Publicados (3)', 'Minhas indicações (2)'], 'abas do morador com contagem')
            ok(pg.locator('.cartao-prest').count() == 3, 'morador vê 3 publicados')
            ok(pg.locator('[data-acao=aprovar], [data-acao=recusar], [data-acao=remover]').count() == 0, 'morador não vê Aprovar, Recusar nem Remover')
            ok(pg.locator('#pagina img').count() == 0 and XSS in pg.inner_text('#pagina') and '<script>alert(1)</script>' in pg.inner_text('#pagina'), 'nome e observação maliciosos aparecem como texto')
            c1 = cartao(pg, 'Carlos Marceneiro')
            ok('Indicado por Ana — Torre 2 · Apto 31' in c1.inner_text(), 'mostra quem indicou e a unidade')
            ok('Recomendado por 1 morador' in c1.inner_text() and '(11) 98888-7777' in c1.inner_text(), 'mostra recomendações e telefone formatado')
            ok(c1.locator('a', has_text='Ligar').get_attribute('href') == 'tel:+5511988887777', 'link de ligar vem dos dígitos')
            ok(c1.locator('a', has_text='WhatsApp').get_attribute('href') == 'https://wa.me/5511988887777' and 'noopener' in c1.locator('a', has_text='WhatsApp').get_attribute('rel'), 'link do WhatsApp seguro')
            ok(cartao(pg, 'Dora').locator('[data-acao=retirar]').count() == 1 and cartao(pg, 'Dora').locator('[data-acao=recomendar]').count() == 0, 'já recomendado: oferece retirar')
            # busca e filtro
            pg.fill('#p-busca', 'carlos'); pg.wait_for_timeout(200)
            ok(pg.locator('.cartao-prest').count() == 1, 'busca por nome')
            pg.fill('#p-busca', 'zzz'); pg.wait_for_timeout(200)
            ok('Nada encontrado' in pg.inner_text('#lista-prest'), 'busca sem resultado')
            pg.fill('#p-busca', ''); pg.select_option('#p-servico', 'diarista'); pg.wait_for_timeout(200)
            ok(pg.locator('.cartao-prest').count() == 2 and 'Dora' in pg.inner_text('#lista-prest'), 'filtro por serviço (diarista e Diarista são o mesmo)')
            ok(pg.locator('#p-servico option').count() == 3, 'lista de serviços sem repetição')
            pg.select_option('#p-servico', ''); pg.wait_for_timeout(200)
            # ver recomendações
            pg.locator('.cartao-prest', has_text='Carlos').locator('[data-acao=ver]').click(); pg.wait_for_selector('.modal .rec-item')
            ok('Bia' in pg.inner_text('.modal') and 'Torre 1 · Apto 13' in pg.inner_text('.modal') and 'Fez meu armário' in pg.inner_text('.modal'), 'lista quem recomenda, com unidade e comentário')
            ok(pg.locator('.modal [data-limpar]').count() == 0, 'morador não remove comentário')
            pg.click('.modal [data-fechar]'); pg.wait_for_selector('.modal', state='detached')
            # recomendar
            pg.locator('.cartao-prest', has_text='Carlos').locator('[data-acao=recomendar]').click(); pg.wait_for_selector('.modal form')
            pg.fill('#r-com', 'Excelente trabalho'); pg.click('.modal button[type=submit]')
            esperar_chamada(pg, ch, 'recomendar_prestador', 1)
            ok(chamadas(ch, 'recomendar_prestador')[0][1] == {'p_id': ID(1), 'p_comentario': 'Excelente trabalho'}, 'recomendar envia id e comentário')
            pg.locator('.cartao-prest', has_text='Carlos').locator('[data-acao=recomendar]').click(); pg.wait_for_selector('.modal form')
            pg.click('.modal button[type=submit]'); esperar_chamada(pg, ch, 'recomendar_prestador', 2)
            ok(chamadas(ch, 'recomendar_prestador')[1][1] == {'p_id': ID(1), 'p_comentario': None}, 'comentário vazio vai como nulo')
            # retirar
            pg.locator('.cartao-prest', has_text='Dora').locator('[data-acao=retirar]').click(); pg.wait_for_selector('.modal [data-r="0"]'); pg.click('.modal [data-r="0"]')
            ok(not chamadas(ch, 'retirar_recomendacao'), 'cancelar não retira')
            pg.locator('.cartao-prest', has_text='Dora').locator('[data-acao=retirar]').click(); pg.wait_for_selector('.modal [data-r="1"]'); pg.click('.modal [data-r="1"]')
            esperar_chamada(pg, ch, 'retirar_recomendacao', 1)
            ok(chamadas(ch, 'retirar_recomendacao')[0][1] == {'p_id': ID(7)}, 'retirar envia o prestador certo')
            # indicar: validações e envio
            pg.click('[data-acao=indicar]'); pg.wait_for_selector('.modal form')
            ok('Seu nome e sua unidade aparecem junto' in pg.inner_text('.modal'), 'aviso de privacidade na indicação')
            pg.fill('#i-nome', 'Ana Costa'); pg.fill('#i-servico', 'Jardineiro'); pg.fill('#i-tel', '123'); pg.click('.modal button[type=submit]')
            ok('Telefone inválido' in pg.inner_text('.modal [data-erro]') and not chamadas(ch, 'indicar_prestador'), 'telefone inválido é recusado e não é enviado')
            pg.fill('#i-tel', '(21) 97777-1234'); pg.fill('#i-obs', 'Cuida bem das plantas'); pg.click('.modal button[type=submit]'); pg.wait_for_selector('.modal', state='detached')
            esperar_chamada(pg, ch, 'indicar_prestador', 1)
            ok(chamadas(ch, 'indicar_prestador')[0][1] == {'p_condominio_id': CA, 'p_dados': {'nome': 'Ana Costa', 'servico': 'Jardineiro', 'telefone': '(21) 97777-1234', 'observacao': 'Cuida bem das plantas'}}, 'indicação envia condomínio e dados')
            # duplicado: oferece recomendar
            pg.click('[data-acao=indicar]'); pg.wait_for_selector('.modal form')
            pg.fill('#i-nome', 'Carlos de novo'); pg.fill('#i-servico', 'Marceneiro'); pg.fill('#i-tel', '11 98888-7777'); pg.click('.modal button[type=submit]')
            pg.wait_for_selector('.modal [data-r="1"]'); ok('já está na lista' in pg.inner_text('.modal'), 'telefone repetido: sugere recomendar o existente')
            pg.click('.modal [data-r="1"]'); pg.wait_for_selector('.modal form')
            ok('Recomendar Carlos Marceneiro' in pg.inner_text('.modal'), 'e abre a recomendação do prestador existente')
            pg.click('.modal [data-fechar]'); pg.wait_for_selector('.modal', state='detached')
            # minhas indicações
            pg.click('[data-aba=minhas]'); pg.wait_for_timeout(200)
            ok(pg.locator('.cartao-prest').count() == 2, 'aba Minhas mostra pendente e recusado')
            ok('Aguardando aprovação' in cartao(pg, 'Paulo').inner_text() and 'Motivo da recusa: Já temos um pintor' in cartao(pg, 'Zeca').inner_text(), 'mostra a situação e o motivo da recusa')
            ok(cartao(pg, 'Zeca').locator('[data-acao=editar]').count() == 1, 'recusado pode ser editado e reenviado')
            cartao(pg, 'Paulo').locator('[data-acao=editar]').click(); pg.wait_for_selector('.modal form')
            ok(pg.input_value('#i-nome') == 'Paulo Pedreiro' and pg.input_value('#i-tel') == '(11) 96666-5555', 'editar vem preenchido (telefone formatado)')
            pg.fill('#i-nome', 'Paulo P. Pedreiro'); pg.click('.modal button[type=submit]'); pg.wait_for_selector('.modal', state='detached')
            esperar_chamada(pg, ch, 'editar_prestador', 1)
            e = chamadas(ch, 'editar_prestador')[0][1]
            ok(e['p_id'] == ID(3) and e['p_dados']['nome'] == 'Paulo P. Pedreiro', 'editar envia id e dados')
            ok(not erros, 'morador sem erros de script: %s' % erros); nav.close()

            # ---- gestor
            nav, pg, erros, ch = abrir(pw, PORTA, UIDS['gestor'], dados('gestor'), 'prestadores', '.cartao-prest')
            ok(pg.locator('[data-acao=aprovar], [data-acao=recusar], [data-acao=remover]').count() == 0, 'gestor não aprova nem remove')
            ok(pg.locator('[data-aba=pendente]').count() == 0, 'gestor não tem a aba de aprovação')
            ok(not erros, 'gestor sem erros de script: %s' % erros); nav.close()

            # ---- síndico
            nav, pg, erros, ch = abrir(pw, PORTA, UIDS['sindico'], dados('sindico'), 'prestadores', '.cartao-prest')
            ok([a.strip() for a in pg.locator('[data-aba]').all_inner_texts()] == ['Publicados (3)', 'Aguardando aprovação (2)', 'Recusados e removidos (2)'], 'abas do síndico com contagem')
            ok(cartao(pg, 'Carlos').locator('[data-acao=remover]').count() == 1 and cartao(pg, 'Carlos').locator('[data-acao=editar]').count() == 1, 'síndico edita e remove publicados')
            pg.locator('.cartao-prest', has_text='Carlos').locator('[data-acao=ver]').click(); pg.wait_for_selector('.modal .rec-item')
            pg.click('.modal [data-limpar]'); esperar_chamada(pg, ch, 'limpar_comentario_prestador', 1)
            ok(chamadas(ch, 'limpar_comentario_prestador')[0][1] == {'p_id': ID(1), 'p_user_id': 'u-bia'}, 'síndico remove comentário de outra pessoa')
            pg.click('[data-aba=pendente]'); pg.wait_for_timeout(200)
            ok(pg.locator('.cartao-prest').count() == 2, 'aba Aguardando mostra as 2 pendentes')
            cartao(pg, 'Lia').locator('[data-acao=aprovar]').click(); esperar_chamada(pg, ch, 'decidir_prestador', 1)
            ok(chamadas(ch, 'decidir_prestador')[0][1] == {'p_id': ID(4), 'p_acao': 'aprovar', 'p_motivo': None}, 'aprovar envia a ação certa')
            pg.click('[data-aba=pendente]'); pg.wait_for_timeout(200)
            cartao(pg, 'Lia').locator('[data-acao=recusar]').click(); pg.wait_for_selector('#pt-campo')
            pg.fill('#pt-campo', 'ab'); pg.click('.modal [data-r="1"]'); pg.wait_for_timeout(300)
            ok(not [x for x in ch if x[0] == 'decidir_prestador' and x[1]['p_acao'] == 'recusar'] and pg.locator('#pt-campo').count() == 1, 'recusa sem motivo suficiente não é enviada')
            pg.fill('#pt-campo', 'Telefone repetido'); pg.click('.modal [data-r="1"]'); esperar_chamada(pg, ch, 'decidir_prestador', 2)
            ok(chamadas(ch, 'decidir_prestador')[1][1] == {'p_id': ID(4), 'p_acao': 'recusar', 'p_motivo': 'Telefone repetido'}, 'recusar envia o motivo')
            pg.click('[data-aba=publicado]'); pg.wait_for_timeout(200)
            cartao(pg, 'Dora').locator('[data-acao=remover]').click(); pg.wait_for_selector('#pt-campo'); pg.click('.modal [data-r="1"]'); esperar_chamada(pg, ch, 'decidir_prestador', 3)
            ok(chamadas(ch, 'decidir_prestador')[2][1] == {'p_id': ID(7), 'p_acao': 'remover', 'p_motivo': None}, 'remover sem motivo envia nulo')
            pg.click('[data-aba=encerrados]'); pg.wait_for_timeout(200)
            ok(pg.locator('.cartao-prest').count() == 2 and pg.locator('.cartao-prest [data-acao=remover]').count() == 0, 'encerrados listados, sem ações de remoção')
            ok(not erros, 'síndico sem erros de script: %s' % erros); nav.close()
    finally: srv.terminate()
    relatorio(falhou)
main()
