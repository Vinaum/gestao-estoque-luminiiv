import { h, raw, render, on } from '../../lib/html.js';
import { db, rpc } from '../../lib/supabase.js';
import { estado } from '../../lib/estado.js';
import { num, numCampo, dataHoraBR, lerNumero } from '../../lib/format.js';
import { aviso, confirmar, janelaForm, janelaInfo, mensagemErro } from '../../lib/ui.js';

let itens = [];
let verInativos = false;
let raizPagina = null;
const cid = () => estado.condominioId;

async function carregar() {
  const { data, error } = await db.from('v_estoque_item').select('*').eq('condominio_id', cid()).order('nome');
  if (error) throw new Error(error.message);
  itens = data;
}
const item = (id) => itens.find((i) => i.item_id === id);

function linhas() {
  const lista = itens.filter((i) => verInativos || i.ativo);
  if (!itens.length) return h`<div class="empty">Nenhum item cadastrado. Cadastre em “Operação diária”.</div>`;
  if (!lista.length) return h`<div class="empty">Nenhum item ativo.</div>`;
  return h`<div class="tabela-rolagem"><table><thead><tr><th>Item</th><th>Estoque atual</th><th>Mínimo</th><th>Ideal</th><th></th><th></th></tr></thead><tbody>
    ${lista.map((i) => h`<tr class="${i.ativo ? '' : 'inativo'}" data-linha="${i.item_id}">
      <td><b>${i.nome}</b> ${i.ativo ? '' : h`<span class="tag">inativo</span>`}<br><span class="tag">${i.categoria}</span>${i.localizacao ? h` <span class="tag">${i.localizacao}</span>` : ''}</td>
      <td class="num">${num(i.estoque_atual)} ${i.unidade}</td>
      <td><input class="inp-num" inputmode="decimal" data-campo="min" data-orig="${i.estoque_minimo}" value="${numCampo(i.estoque_minimo)}" aria-label="Mínimo de ${i.nome}"></td>
      <td><input class="inp-num" inputmode="decimal" data-campo="ideal" data-orig="${i.estoque_ideal}" value="${numCampo(i.estoque_ideal)}" aria-label="Ideal de ${i.nome}"></td>
      <td><button class="btn pequeno" data-acao="salvar" data-id="${i.item_id}" disabled>Salvar</button></td>
      <td><div class="linha-acoes">
        <button class="icon-btn" data-acao="editar" data-id="${i.item_id}">Editar</button>
        <button class="icon-btn" data-acao="historico" data-id="${i.item_id}">Histórico</button></div></td></tr>`)}</tbody></table></div>`;
}

function desenhar() {
  render(raizPagina, h`
    <div class="page-head"><div><h2>Configuração de estoque</h2>
      <p>Defina o <b>mínimo</b> (abaixo disso o item aparece como “Comprar”) e o <b>ideal</b> (quanto você quer ter depois de repor).</p></div></div>
    <div class="panel">
      <div class="filtros"><label><input type="checkbox" id="ver-inativos" ${verInativos ? raw('checked') : ''}> Mostrar itens inativos</label></div>
      <div id="tab">${linhas()}</div></div>`);
  raizPagina.querySelector('#ver-inativos').addEventListener('change', (e) => { verInativos = e.target.checked; render(raizPagina.querySelector('#tab'), linhas()); });
}

// Marca a linha como alterada e liga o botão Salvar só se houver diferença.
function aoDigitar(campo) {
  const linha = campo.closest('tr');
  const campos = [...linha.querySelectorAll('.inp-num')];
  let mudou = false;
  campos.forEach((c) => {
    const igual = lerNumero(c.value) === Number(c.dataset.orig);
    c.classList.toggle('alterado', !igual); if (!igual) mudou = true;
  });
  linha.querySelector('[data-acao=salvar]').disabled = !mudou;
}

async function salvar(id, botao) {
  const linha = botao.closest('tr');
  const min = lerNumero(linha.querySelector('[data-campo=min]').value);
  const ideal = lerNumero(linha.querySelector('[data-campo=ideal]').value);
  if (!Number.isFinite(min) || !Number.isFinite(ideal) || min < 0 || ideal < 0) return aviso('Informe valores numéricos de zero ou mais.', 'erro');
  if (ideal < min) return aviso('O estoque ideal não pode ser menor que o mínimo.', 'erro');
  botao.disabled = true;
  try {
    await rpc('atualizar_parametros_item', { p_item_id: id, p_minimo: min, p_ideal: ideal });
  } catch (e) { botao.disabled = false; throw e; }
  aviso('Parâmetros salvos.', 'ok');
  await carregar();               // a situação (Comprar/Normal…) pode ter mudado
  render(raizPagina.querySelector('#tab'), linhas());
}

async function historico(id) {
  const it = item(id);
  const { data, error } = await db.from('v_historico_parametros').select('*').eq('item_id', id).order('em', { ascending: false }).limit(30);
  if (error) throw new Error(error.message);
  const f = (a, b) => (a === b ? num(b, 3) : `${num(a, 3)} → ${num(b, 3)}`);
  janelaInfo(`Histórico — ${it.nome}`, data.length
    ? h`<div class="tabela-rolagem"><table><thead><tr><th>Quando</th><th>Quem</th><th>Mínimo</th><th>Ideal</th></tr></thead><tbody>
        ${data.map((r) => h`<tr><td>${dataHoraBR(r.em)}</td><td>${r.usuario_nome || '—'}</td>
          <td class="num">${f(r.minimo_anterior, r.minimo_novo)}</td><td class="num">${f(r.ideal_anterior, r.ideal_novo)}</td></tr>`)}</tbody></table></div>`
    : h`<div class="empty">Nenhuma alteração de mínimo ou ideal registrada.</div>`);
}

async function editar(id) {
  const it = item(id);
  const [cats, unis] = await Promise.all([db.from('categorias').select('id,nome').order('nome'), db.from('unidades_medida').select('id,sigla,nome').order('sigla')]);
  if (cats.error || unis.error) throw new Error((cats.error || unis.error).message);
  const temEstoque = Number(it.total_lotes) > 0;
  janelaForm({
    titulo: `Editar item — ${it.nome}`, rotulo: 'Salvar',
    corpo: h`
      <div class="field"><label for="x-nome">Nome</label><input id="x-nome" name="nome" value="${it.nome}" required></div>
      <div class="field"><label for="x-cat">Categoria</label><select id="x-cat" name="cat">${cats.data.map((c) => h`<option value="${c.id}" ${c.id === it.categoria_id ? raw('selected') : ''}>${c.nome}</option>`)}</select></div>
      <div class="field"><label for="x-uni">Unidade</label><select id="x-uni" name="uni" ${temEstoque ? raw('disabled') : ''}>${unis.data.map((u) => h`<option value="${u.id}" ${u.id === it.unidade_id ? raw('selected') : ''}>${u.sigla} — ${u.nome}</option>`)}</select>
        ${temEstoque ? h`<span class="dica">A unidade não muda depois que o item recebe estoque.</span>` : ''}</div>
      <div class="field"><label for="x-loc">Local</label><input id="x-loc" name="loc" value="${it.localizacao || ''}"></div>
      <div class="field"><label for="x-desc">Descrição (opcional)</label><textarea id="x-desc" name="desc" rows="2">${it.descricao || ''}</textarea></div>
      <div class="field"><label><input type="checkbox" name="ativo" value="1" ${it.ativo ? raw('checked') : ''}> Item ativo</label>
        <span class="dica">Itens inativos somem das listas de operação e não recebem saídas.</span></div>`,
    aoEnviar: async (f) => {
      if (!f.nome.trim()) throw new Error('Informe o nome.');
      const ativo = f.ativo === '1';
      if (it.ativo && !ativo && Number(it.estoque_atual) > 0 &&
          !(await confirmar('Inativar item com estoque?', `Ainda há ${num(it.estoque_atual)} ${it.unidade} em estoque. Ele deixará de aparecer na operação.`, { rotulo: 'Inativar', perigo: true }))) return;
      const mudancas = { nome: f.nome.trim(), categoria_id: f.cat, localizacao: f.loc.trim() || null, descricao: f.desc.trim() || null, ativo };
      if (!temEstoque && f.uni) mudancas.unidade_id = f.uni;
      const { error } = await db.from('itens').update(mudancas).eq('id', id);
      if (error) throw new Error(error.code === '23505' ? 'Já existe um item com esse nome.' : error.message);
      aviso('Item atualizado.', 'ok');
      await carregar(); render(raizPagina.querySelector('#tab'), linhas());
    },
  });
}

export async function abrir(el) {
  raizPagina = el;
  await carregar();
  desenhar();
  on(el, 'input', '.inp-num', (_, c) => aoDigitar(c));
  on(el, 'click', '[data-acao]', async (_, b) => {
    try {
      const a = b.dataset.acao, id = b.dataset.id;
      if (a === 'salvar') await salvar(id, b);
      else if (a === 'editar') await editar(id);
      else if (a === 'historico') await historico(id);
    } catch (e) { aviso(mensagemErro(e), 'erro'); }
  });
}
