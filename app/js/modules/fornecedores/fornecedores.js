import { h, raw, render, on } from '../../lib/html.js';
import { db } from '../../lib/supabase.js';
import { estado, papelAtual } from '../../lib/estado.js';
import { moeda, dataBR } from '../../lib/format.js';
import { cnpjValido, formatarCnpj, emailValido, soDigitos } from '../../lib/validacao.js';
import { aviso, janelaForm, janelaInfo, mensagemErro } from '../../lib/ui.js';

let forn = [], cats = [], vinculos = {}, raizPagina = null;
let filtro = { texto: '', inativos: false };
const cid = () => estado.condominioId;
// Só o síndico (ou superadmin) ativa/desativa; o gestor cadastra e edita.
const podeAtivar = () => ['sindico', 'superadmin'].includes(papelAtual());

async function carregar() {
  const [f, c, v] = await Promise.all([
    db.from('fornecedores').select('*').eq('condominio_id', cid()).order('nome'),
    db.from('categorias').select('id,nome').order('nome'),
    db.from('fornecedor_categorias').select('fornecedor_id,categoria_id').eq('condominio_id', cid()),
  ]);
  const falha = f.error || c.error || v.error;
  if (falha) throw new Error(falha.message);
  forn = f.data; cats = c.data;
  vinculos = {};
  v.data.forEach((x) => { (vinculos[x.fornecedor_id] ||= []).push(x.categoria_id); });
}

const nomeCats = (id) => (vinculos[id] || []).map((cid_) => cats.find((c) => c.id === cid_)?.nome).filter(Boolean);

function tabela() {
  const t = filtro.texto.trim().toLowerCase();
  const lista = forn.filter((f) => (filtro.inativos || f.ativo) &&
    (!t || [f.nome, f.razao_social, f.cnpj, f.contato].some((x) => (x || '').toLowerCase().includes(t))));
  if (!forn.length) return h`<div class="empty">Nenhum fornecedor cadastrado.</div>`;
  if (!lista.length) return h`<div class="empty">Nenhum fornecedor com esse filtro.</div>`;
  return h`<div class="tabela-rolagem"><table><thead><tr><th>Fornecedor</th><th>Contato</th><th>Categorias</th><th></th></tr></thead><tbody>
    ${lista.map((f) => h`<tr class="${f.ativo ? '' : 'inativo'}">
      <td><b>${f.nome}</b> ${f.ativo ? '' : h`<span class="tag">inativo</span>`}<br><span class="num">${f.cnpj ? formatarCnpj(f.cnpj) : ''}</span></td>
      <td>${f.contato || '—'}<br>${f.telefone || ''} ${f.email || ''}</td>
      <td>${nomeCats(f.id).map((n) => h`<span class="tag">${n}</span> `)}</td>
      <td><div class="linha-acoes"><button class="icon-btn" data-acao="editar" data-id="${f.id}">Editar</button>
        <button class="icon-btn" data-acao="historico" data-id="${f.id}">Compras</button></div></td></tr>`)}</tbody></table></div>`;
}

function desenhar() {
  render(raizPagina, h`
    <div class="page-head"><div><h2>Fornecedores</h2><p>Quem fornece materiais e serviços ao condomínio.</p></div>
      <button class="btn" data-acao="novo">Novo fornecedor</button></div>
    <div class="panel"><div class="filtros">
      <input id="f-texto" type="search" placeholder="Buscar por nome, CNPJ ou contato" value="${filtro.texto}" aria-label="Buscar">
      <label><input type="checkbox" id="f-inativos" ${filtro.inativos ? raw('checked') : ''}> Mostrar inativos</label></div>
      <div id="tab">${tabela()}</div></div>`);
  const refaz = () => render(raizPagina.querySelector('#tab'), tabela());
  raizPagina.querySelector('#f-texto').addEventListener('input', (e) => { filtro.texto = e.target.value; refaz(); });
  raizPagina.querySelector('#f-inativos').addEventListener('change', (e) => { filtro.inativos = e.target.checked; refaz(); });
}

function formulario(f) {
  const marcadas = new Set(f ? vinculos[f.id] || [] : []);
  const v = (k) => (f ? f[k] || '' : '');
  janelaForm({
    titulo: f ? `Editar — ${f.nome}` : 'Novo fornecedor', rotulo: 'Salvar', largo: true,
    corpo: h`
      <div class="field"><label for="f-nome">Nome</label><input id="f-nome" name="nome" value="${v('nome')}" required></div>
      <div class="field"><label for="f-razao">Razão social (opcional)</label><input id="f-razao" name="razao" value="${v('razao_social')}"></div>
      <div class="field"><label for="f-cnpj">CNPJ (opcional)</label><input id="f-cnpj" name="cnpj" inputmode="numeric" value="${f?.cnpj ? formatarCnpj(f.cnpj) : ''}" placeholder="00.000.000/0000-00"></div>
      <div class="field"><label for="f-contato">Pessoa de contato</label><input id="f-contato" name="contato" value="${v('contato')}"></div>
      <div class="field"><label for="f-tel">Telefone</label><input id="f-tel" name="tel" value="${v('telefone')}"></div>
      <div class="field"><label for="f-email">E-mail</label><input id="f-email" name="email" type="email" value="${v('email')}"></div>
      <div class="field"><label for="f-end">Endereço</label><input id="f-end" name="end" value="${v('endereco')}"></div>
      <div class="field"><label>Categorias que atende</label><div>${cats.map((c) => h`<label style="display:inline-block;margin:0 12px 4px 0"><input type="checkbox" name="cat_${c.id}" value="1" ${marcadas.has(c.id) ? raw('checked') : ''}> ${c.nome}</label>`)}</div></div>
      <div class="field"><label for="f-obs">Observações</label><textarea id="f-obs" name="obs" rows="2">${v('observacoes')}</textarea></div>
      ${f && podeAtivar() ? h`<div class="field"><label><input type="checkbox" name="ativo" value="1" ${f.ativo ? raw('checked') : ''}> Fornecedor ativo</label></div>` : ''}`,
    aoEnviar: async (x) => {
      if (!x.nome.trim()) throw new Error('Informe o nome.');
      const cnpj = soDigitos(x.cnpj);
      if (cnpj && !cnpjValido(cnpj)) throw new Error('CNPJ inválido. Confira os 14 números.');
      if (x.email.trim() && !emailValido(x.email.trim())) throw new Error('E-mail inválido.');
      const dados = { nome: x.nome.trim(), razao_social: x.razao.trim() || null, cnpj: cnpj || null, contato: x.contato.trim() || null,
        telefone: x.tel.trim() || null, email: x.email.trim() || null, endereco: x.end.trim() || null, observacoes: x.obs.trim() || null };
      let id = f?.id;
      if (f) {
        if (podeAtivar()) dados.ativo = x.ativo === '1';
        const { error } = await db.from('fornecedores').update(dados).eq('id', id);
        if (error) throw new Error(erroForn(error));
      } else {
        const { data, error } = await db.from('fornecedores').insert({ ...dados, condominio_id: cid() }).select('id').single();
        if (error) throw new Error(erroForn(error));
        id = data.id;
      }
      const novas = cats.filter((c) => x['cat_' + c.id] === '1').map((c) => c.id);
      const antigas = f ? vinculos[id] || [] : [];
      const remover = antigas.filter((c) => !novas.includes(c)), incluir = novas.filter((c) => !antigas.includes(c));
      if (remover.length) {
        const { error } = await db.from('fornecedor_categorias').delete().eq('fornecedor_id', id).in('categoria_id', remover);
        if (error) throw new Error(error.message);
      }
      if (incluir.length) {
        const { error } = await db.from('fornecedor_categorias').insert(incluir.map((c) => ({ fornecedor_id: id, condominio_id: cid(), categoria_id: c })));
        if (error) throw new Error(error.message);
      }
      aviso('Fornecedor salvo.', 'ok');
      await carregar(); render(raizPagina.querySelector('#tab'), tabela());
    },
  });
}
const erroForn = (e) => (e.code === '23505' ? 'Já existe um fornecedor com esse CNPJ.' : e.message);

async function historico(id) {
  const f = forn.find((x) => x.id === id);
  const { data, error } = await db.from('v_compras').select('compra_id,data_compra,status,valor_total,numero_nf').eq('fornecedor_id', id).order('data_compra', { ascending: false }).limit(50);
  if (error) throw new Error(error.message);
  const efetivadas = data.filter((c) => ['pedido_realizado', 'parcialmente_recebido', 'recebido'].includes(c.status));
  janelaInfo(`Compras — ${f.nome}`, data.length ? h`
    <p class="dica">Total em compras efetivadas: <b class="num">${moeda(efetivadas.reduce((s, c) => s + Number(c.valor_total), 0))}</b></p>
    <div class="tabela-rolagem"><table><thead><tr><th>Data</th><th>NF</th><th>Situação</th><th>Valor</th></tr></thead><tbody>
    ${data.map((c) => h`<tr><td>${dataBR(c.data_compra)}</td><td>${c.numero_nf || '—'}</td><td>${c.status.replaceAll('_', ' ')}</td><td class="num">${moeda(c.valor_total)}</td></tr>`)}</tbody></table></div>`
    : h`<div class="empty">Nenhuma compra com este fornecedor.</div>`);
}

export async function abrir(el) {
  raizPagina = el;
  await carregar(); desenhar();
  on(el, 'click', '[data-acao]', async (_, b) => {
    try {
      const a = b.dataset.acao, f = forn.find((x) => x.id === b.dataset.id);
      if (a === 'novo') formulario(null);
      else if (a === 'editar') formulario(f);
      else if (a === 'historico') await historico(b.dataset.id);
    } catch (e) { aviso(mensagemErro(e), 'erro'); }
  });
}
