import { h, raw, render, on } from '../../lib/html.js';
import { db, rpc } from '../../lib/supabase.js';
import { estado, ehSuperadmin, condominioAtual } from '../../lib/estado.js';
import { dataBR, PAPEL_ROTULO } from '../../lib/format.js';
import { emailValido } from '../../lib/validacao.js';
import { aviso, confirmar, janelaForm, mensagemErro } from '../../lib/ui.js';
import { carregarEstrutura, opcoesApto, rotuloApto } from '../../lib/unidades.js';

let membros = [], convites = [], nomes = {}, est = { torres: [], aptos: [] }, raizPagina = null;
const cid = () => estado.condominioId;
const euId = () => estado.sessao.user.id;
const papeisPermitidos = () => (ehSuperadmin() ? ['sindico', 'gestor', 'morador'] : ['gestor', 'morador']);

async function carregar() {
  const [m, c, estrutura] = await Promise.all([
    db.from('membros').select('user_id,papel,ativo,criado_em,apartamento_id').eq('condominio_id', cid()).order('criado_em'),
    db.from('convites').select('id,email,papel,criado_em,apartamento_id').eq('condominio_id', cid()).is('usado_em', null).order('criado_em'),
    carregarEstrutura(cid()),
  ]);
  if (m.error || c.error) throw new Error((m.error || c.error).message);
  membros = m.data; convites = c.data; est = estrutura;
  const ids = membros.map((x) => x.user_id);
  const { data: pf } = ids.length ? await db.from('profiles').select('id,nome').in('id', ids) : { data: [] };
  nomes = Object.fromEntries((pf || []).map((p) => [p.id, p.nome]));
}

const podeMexerConvite = (c) => ehSuperadmin() || c.papel !== 'sindico';
const podeMexer = (m) => m.user_id !== euId() && (ehSuperadmin() || m.papel !== 'sindico');

function desenhar() {
  render(raizPagina, h`
    <div class="page-head"><div><h2>Usuários</h2><p>Quem participa de ${condominioAtual()?.nome ?? 'este condomínio'} e com qual papel.</p></div>
      <button class="btn" data-acao="convidar">Convidar pessoa</button></div>
    <div class="panel"><h3>Participantes</h3>
      <div class="tabela-rolagem"><table><thead><tr><th>Nome</th><th>Papel</th><th>Apartamento</th><th>Situação</th><th></th></tr></thead><tbody>
        ${membros.map((m) => h`<tr class="${m.ativo ? '' : 'inativo'}">
          <td><b>${nomes[m.user_id] || '(sem nome)'}</b>${m.user_id === euId() ? h` <span class="tag">você</span>` : ''}</td>
          <td>${podeMexer(m) && m.ativo
            ? h`<select data-papel-de="${m.user_id}" aria-label="Papel de ${nomes[m.user_id] || ''}">${papeisPermitidos().map((p) => h`<option value="${p}" ${p === m.papel ? raw('selected') : ''}>${PAPEL_ROTULO[p]}</option>`)}</select>`
            : PAPEL_ROTULO[m.papel]}</td>
          <td><select data-apto-de="${m.user_id}" aria-label="Apartamento de ${nomes[m.user_id] || ''}">${opcoesApto(est, m.apartamento_id || '')}</select></td>
          <td>${m.ativo ? 'Ativo' : 'Desativado'}</td>
          <td>${podeMexer(m) ? h`<button class="icon-btn" data-acao="${m.ativo ? 'desativar' : 'reativar'}" data-id="${m.user_id}">${m.ativo ? 'Desativar' : 'Reativar'}</button>` : ''}</td></tr>`)}</tbody></table></div></div>
    <div class="panel"><h3>Convites pendentes</h3>
      ${convites.length ? h`<div class="tabela-rolagem"><table><thead><tr><th>E-mail</th><th>Papel</th><th>Apartamento</th><th>Enviado em</th><th></th></tr></thead><tbody>
        ${convites.map((c) => h`<tr><td>${c.email}</td>
          <td>${podeMexerConvite(c)
            ? h`<select data-convite-papel="${c.id}" aria-label="Papel do convite de ${c.email}">${papeisPermitidos().map((p) => h`<option value="${p}" ${p === c.papel ? raw('selected') : ''}>${PAPEL_ROTULO[p]}</option>`)}</select>`
            : PAPEL_ROTULO[c.papel]}</td>
          <td>${podeMexerConvite(c)
            ? h`<select data-convite-apto="${c.id}" aria-label="Apartamento do convite de ${c.email}">${opcoesApto(est, c.apartamento_id || '')}</select>`
            : (rotuloApto(c.apartamento_id, est) || '—')}</td>
          <td>${dataBR(c.criado_em)}</td>
          <td>${podeMexerConvite(c) ? h`<button class="icon-btn" data-acao="cancelar-convite" data-id="${c.id}">Cancelar convite</button>` : ''}</td></tr>`)}</tbody></table></div>`
        : h`<div class="empty">Nenhum convite pendente.</div>`}
      <p class="dica" style="margin-top:10px">O convite vale quando a pessoa criar a conta com este mesmo e-mail e confirmar o e-mail. Convidou o e-mail errado? Cancele o convite e convide de novo com o e-mail certo.${ehSuperadmin() ? '' : ' Convites de síndico só o superadmin altera.'}</p></div>`);
}

function convidar() {
  janelaForm({
    titulo: 'Convidar pessoa', rotulo: 'Convidar',
    intro: 'Se a pessoa já tem conta confirmada, ela entra no condomínio na hora. Se não, o convite fica esperando.',
    corpo: h`
      <div class="field"><label for="c-email">E-mail</label><input id="c-email" name="email" type="email" required autocomplete="off"></div>
      <div class="field"><label for="c-apto">Apartamento (opcional)</label><select id="c-apto" name="apto">${opcoesApto(est, '', 'Sem apartamento por enquanto')}</select>
        <span class="dica">Pode ser definido depois. Morador sem apartamento não aparece com unidade.</span></div>
      <div class="field"><label for="c-papel">Papel</label><select id="c-papel" name="papel">${papeisPermitidos().map((p) => h`<option value="${p}" ${p === 'morador' ? raw('selected') : ''}>${PAPEL_ROTULO[p]}</option>`)}</select>
        <span class="dica">Gestor: equipe da comissão que opera o estoque e as compras. Morador: acesso só de boas-vindas.${ehSuperadmin() ? '' : ' Síndicos são definidos pelo superadmin.'}</span></div>`,
    aoEnviar: async (f) => {
      const email = f.email.trim().toLowerCase();
      if (!emailValido(email)) throw new Error('Informe um e-mail válido.');
      const r = await rpc('convidar_membro', { p_condominio_id: cid(), p_email: email, p_papel: f.papel, p_apartamento_id: f.apto || null });
      aviso(r === 'vinculado' ? 'Pessoa adicionada ao condomínio.' : 'Convite criado. Ela precisa criar a conta com este e-mail.', 'ok');
      await carregar(); desenhar();
    },
  });
}

export async function abrir(el) {
  raizPagina = el;
  await carregar(); desenhar();
  el.addEventListener('change', async (e) => {
    const selA = e.target.closest('[data-apto-de]');
    if (selA) {
      const m = membros.find((x) => x.user_id === selA.dataset.aptoDe);
      try {
        await rpc('definir_apartamento_membro', { p_condominio_id: cid(), p_user_id: m.user_id, p_apartamento_id: selA.value || null });
        aviso('Apartamento atualizado.', 'ok'); await carregar(); desenhar();
      } catch (err) { aviso(mensagemErro(err), 'erro'); selA.value = m.apartamento_id || ''; }
      return;
    }
    const selCA = e.target.closest('[data-convite-apto]');
    if (selCA) {
      const c = convites.find((x) => x.id === selCA.dataset.conviteApto);
      try {
        await rpc('definir_apartamento_convite', { p_convite_id: c.id, p_apartamento_id: selCA.value || null });
        aviso('Apartamento do convite atualizado.', 'ok'); await carregar(); desenhar();
      } catch (err) { aviso(mensagemErro(err), 'erro'); selCA.value = c.apartamento_id || ''; }
      return;
    }
    const selC = e.target.closest('[data-convite-papel]');
    if (selC) {
      const c = convites.find((x) => x.id === selC.dataset.convitePapel);
      try {
        await rpc('alterar_convite_papel', { p_convite_id: c.id, p_papel: selC.value });
        aviso('Papel do convite alterado.', 'ok'); await carregar(); desenhar();
      } catch (err) { aviso(mensagemErro(err), 'erro'); selC.value = c.papel; }
      return;
    }
    const sel = e.target.closest('[data-papel-de]'); if (!sel) return;
    const m = membros.find((x) => x.user_id === sel.dataset.papelDe);
    try {
      await rpc('alterar_papel_membro', { p_condominio_id: cid(), p_user_id: m.user_id, p_papel: sel.value });
      aviso('Papel alterado.', 'ok'); await carregar(); desenhar();
    } catch (err) { aviso(mensagemErro(err), 'erro'); sel.value = m.papel; }
  });
  on(el, 'click', '[data-acao]', async (_, b) => {
    try {
      const a = b.dataset.acao;
      if (a === 'convidar') convidar();
      else if (a === 'cancelar-convite') {
        const c = convites.find((x) => x.id === b.dataset.id); if (!c) return;
        if (!(await confirmar('Cancelar convite?', `O convite para ${c.email} será removido. Se a pessoa criar a conta depois, não entrará no condomínio.`, { rotulo: 'Cancelar convite', perigo: true }))) return;
        await rpc('cancelar_convite', { p_convite_id: c.id });
        aviso('Convite cancelado.', 'ok'); await carregar(); desenhar();
      }
      else if (a === 'desativar' || a === 'reativar') {
        const nome = nomes[b.dataset.id] || 'esta pessoa';
        if (a === 'desativar' && !(await confirmar('Desativar acesso?', `${nome} perderá o acesso a este condomínio. O histórico dela continua registrado.`, { rotulo: 'Desativar', perigo: true }))) return;
        await rpc('desativar_membro', { p_condominio_id: cid(), p_user_id: b.dataset.id, p_ativo: a === 'reativar' });
        aviso(a === 'reativar' ? 'Acesso reativado.' : 'Acesso desativado.', 'ok'); await carregar(); desenhar();
      }
    } catch (e) { aviso(mensagemErro(e), 'erro'); }
  });
}
