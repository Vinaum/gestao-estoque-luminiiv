import { h, raw, render, on } from '../../lib/html.js';
import { db, rpc } from '../../lib/supabase.js';
import { estado, ehSuperadmin, condominioAtual } from '../../lib/estado.js';
import { dataBR, PAPEL_ROTULO } from '../../lib/format.js';
import { emailValido } from '../../lib/validacao.js';
import { aviso, confirmar, janelaForm, mensagemErro } from '../../lib/ui.js';

let membros = [], convites = [], nomes = {}, raizPagina = null;
const cid = () => estado.condominioId;
const euId = () => estado.sessao.user.id;
const papeisPermitidos = () => (ehSuperadmin() ? ['sindico', 'gestor', 'morador'] : ['gestor', 'morador']);

async function carregar() {
  const [m, c] = await Promise.all([
    db.from('membros').select('user_id,papel,ativo,criado_em').eq('condominio_id', cid()).order('criado_em'),
    db.from('convites').select('id,email,papel,criado_em').eq('condominio_id', cid()).is('usado_em', null).order('criado_em'),
  ]);
  if (m.error || c.error) throw new Error((m.error || c.error).message);
  membros = m.data; convites = c.data;
  const ids = membros.map((x) => x.user_id);
  const { data: pf } = ids.length ? await db.from('profiles').select('id,nome').in('id', ids) : { data: [] };
  nomes = Object.fromEntries((pf || []).map((p) => [p.id, p.nome]));
}

const podeMexer = (m) => m.user_id !== euId() && (ehSuperadmin() || m.papel !== 'sindico');

function desenhar() {
  render(raizPagina, h`
    <div class="page-head"><div><h2>Usuários</h2><p>Quem participa de ${condominioAtual()?.nome ?? 'este condomínio'} e com qual papel.</p></div>
      <button class="btn" data-acao="convidar">Convidar pessoa</button></div>
    <div class="panel"><h3>Participantes</h3>
      <div class="tabela-rolagem"><table><thead><tr><th>Nome</th><th>Papel</th><th>Situação</th><th></th></tr></thead><tbody>
        ${membros.map((m) => h`<tr class="${m.ativo ? '' : 'inativo'}">
          <td><b>${nomes[m.user_id] || '(sem nome)'}</b>${m.user_id === euId() ? h` <span class="tag">você</span>` : ''}</td>
          <td>${podeMexer(m) && m.ativo
            ? h`<select data-papel-de="${m.user_id}" aria-label="Papel de ${nomes[m.user_id] || ''}">${papeisPermitidos().map((p) => h`<option value="${p}" ${p === m.papel ? raw('selected') : ''}>${PAPEL_ROTULO[p]}</option>`)}</select>`
            : PAPEL_ROTULO[m.papel]}</td>
          <td>${m.ativo ? 'Ativo' : 'Desativado'}</td>
          <td>${podeMexer(m) ? h`<button class="icon-btn" data-acao="${m.ativo ? 'desativar' : 'reativar'}" data-id="${m.user_id}">${m.ativo ? 'Desativar' : 'Reativar'}</button>` : ''}</td></tr>`)}</tbody></table></div></div>
    <div class="panel"><h3>Convites pendentes</h3>
      ${convites.length ? h`<table><thead><tr><th>E-mail</th><th>Papel</th><th>Enviado em</th></tr></thead><tbody>
        ${convites.map((c) => h`<tr><td>${c.email}</td><td>${PAPEL_ROTULO[c.papel]}</td><td>${dataBR(c.criado_em)}</td></tr>`)}</tbody></table>`
        : h`<div class="empty">Nenhum convite pendente.</div>`}
      <p class="dica" style="margin-top:10px">O convite vale quando a pessoa criar a conta com este mesmo e-mail e confirmar o e-mail.</p></div>`);
}

function convidar() {
  janelaForm({
    titulo: 'Convidar pessoa', rotulo: 'Convidar',
    intro: 'Se a pessoa já tem conta confirmada, ela entra no condomínio na hora. Se não, o convite fica esperando.',
    corpo: h`
      <div class="field"><label for="c-email">E-mail</label><input id="c-email" name="email" type="email" required autocomplete="off"></div>
      <div class="field"><label for="c-papel">Papel</label><select id="c-papel" name="papel">${papeisPermitidos().map((p) => h`<option value="${p}" ${p === 'morador' ? raw('selected') : ''}>${PAPEL_ROTULO[p]}</option>`)}</select>
        <span class="dica">Gestor: equipe da comissão que opera o estoque e as compras. Morador: acesso só de boas-vindas.${ehSuperadmin() ? '' : ' Síndicos são definidos pelo superadmin.'}</span></div>`,
    aoEnviar: async (f) => {
      const email = f.email.trim().toLowerCase();
      if (!emailValido(email)) throw new Error('Informe um e-mail válido.');
      const r = await rpc('convidar_membro', { p_condominio_id: cid(), p_email: email, p_papel: f.papel });
      aviso(r === 'vinculado' ? 'Pessoa adicionada ao condomínio.' : 'Convite criado. Ela precisa criar a conta com este e-mail.', 'ok');
      await carregar(); desenhar();
    },
  });
}

export async function abrir(el) {
  raizPagina = el;
  await carregar(); desenhar();
  el.addEventListener('change', async (e) => {
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
      else if (a === 'desativar' || a === 'reativar') {
        const nome = nomes[b.dataset.id] || 'esta pessoa';
        if (a === 'desativar' && !(await confirmar('Desativar acesso?', `${nome} perderá o acesso a este condomínio. O histórico dela continua registrado.`, { rotulo: 'Desativar', perigo: true }))) return;
        await rpc('desativar_membro', { p_condominio_id: cid(), p_user_id: b.dataset.id, p_ativo: a === 'reativar' });
        aviso(a === 'reativar' ? 'Acesso reativado.' : 'Acesso desativado.', 'ok'); await carregar(); desenhar();
      }
    } catch (e) { aviso(mensagemErro(e), 'erro'); }
  });
}
