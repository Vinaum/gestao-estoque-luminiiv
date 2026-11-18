import { h, raw, render, on } from '../../lib/html.js';
import { db, rpc } from '../../lib/supabase.js';
import { estado } from '../../lib/estado.js';
import { num, lerNumero } from '../../lib/format.js';
import { aviso, abrirJanela, janelaForm, mensagemErro } from '../../lib/ui.js';
import { CONSERVACAO, filtrarPatrimonio, resumoPatrimonio } from './calculos.js';

// Ferramentas e patrimônio: itens permanentes (sem mínimo, ideal, validade nem alerta de compra).
let itens = [], filtro = { busca: '', conservacao: '', inativos: false }, raiz = null;
const cid = () => estado.condominioId;
const item = (id) => itens.find((i) => i.item_id === id);
const pill = (c) => { const [r, cls] = CONSERVACAO[c] || [c, 'status-neutro']; return h`<span class="status-pill ${cls}">${r}</span>`; };
const opcoesConservacao = (atual = 'bom') => Object.entries(CONSERVACAO).map(([k, [r]]) => h`<option value="${k}" ${k === atual ? raw('selected') : ''}>${r}</option>`);

async function carregar() {
  const { data, error } = await db.from('v_estoque_item').select('*').eq('condominio_id', cid()).order('nome');
  if (error) throw new Error(error.message);
  itens = data;
}
async function atualizar() { await carregar(); desenhar(); }

function tabela() {
  const lista = filtrarPatrimonio(itens, filtro);
  if (!itens.some((i) => i.permanente)) {
    return h`<div class="empty">Nenhuma ferramenta ou item de patrimônio ainda. Use “Cadastrar ferramenta” ou “Marcar itens já cadastrados”.</div>`;
  }
  if (!lista.length) return h`<div class="empty">Nenhum item com esse filtro.</div>`;
  return h`<div class="tabela-rolagem"><table class="tabela-patrimonio"><thead><tr><th>Item</th><th>Quantidade</th><th>Local</th><th>Conservação</th><th></th></tr></thead><tbody>
    ${lista.map((i) => h`<tr class="${i.ativo ? '' : 'inativo'}" data-linha="${i.item_id}">
      <td><b>${i.nome}</b> ${i.ativo ? '' : h`<span class="tag">inativo</span>`}<br><span class="tag">${i.categoria}</span>
        ${i.descricao ? h`<div class="dica">${i.descricao}</div>` : ''}</td>
      <td class="num">${num(i.estoque_atual)} ${i.unidade}</td>
      <td>${i.localizacao || '—'}</td>
      <td>${pill(i.conservacao)}</td>
      <td><button class="icon-btn" data-acao="editar" data-id="${i.item_id}">Atualizar</button></td></tr>`)}</tbody></table></div>`;
}

function desenhar() {
  const r = resumoPatrimonio(itens);
  render(raiz, h`
    <div class="page-head"><div><h2>Ferramentas e patrimônio</h2>
      <p>Itens que ficam no condomínio (martelo, mangueira, escada…). Não têm mínimo nem validade e não geram alerta de compra.</p></div>
      <div class="linha-acoes"><button class="btn ghost" data-acao="marcar">Marcar itens já cadastrados</button>
        <button class="btn" data-acao="nova">Cadastrar ferramenta</button></div></div>
    <div class="cards">
      <div class="card"><div class="k">Itens</div><div class="v" data-resumo="itens">${r.itens}</div></div>
      <div class="card"><div class="k">Unidades no total</div><div class="v" data-resumo="unidades">${num(r.unidades)}</div></div>
      <div class="card warn"><div class="k">Precisam de reparo</div><div class="v" data-resumo="reparo">${r.reparo}</div></div>
      <div class="card crit"><div class="k">Sem uso / quebrados</div><div class="v" data-resumo="inutilizavel">${r.inutilizavel}</div></div>
    </div>
    <div class="panel">
      <div class="filtros">
        <input id="pt-busca" type="search" placeholder="Buscar por nome, local ou categoria" value="${filtro.busca}" aria-label="Buscar" autocomplete="off">
        <select id="pt-cons" aria-label="Conservação"><option value="">Qualquer estado</option>${Object.entries(CONSERVACAO).map(([k, [rot]]) => h`<option value="${k}" ${k === filtro.conservacao ? raw('selected') : ''}>${rot}</option>`)}</select>
        <label><input type="checkbox" id="pt-inativos" ${filtro.inativos ? raw('checked') : ''}> Mostrar inativos</label>
      </div>
      <div id="pt-tab">${tabela()}</div>
      <p class="dica">Para registrar que uma ferramenta foi perdida, quebrou e foi descartada, ou que chegou mais uma, use “Registrar saída” ou “Entrada” em Operação diária.</p>
    </div>`);
  const campo = raiz.querySelector('#pt-busca');
  campo.addEventListener('input', () => { filtro.busca = campo.value; render(raiz.querySelector('#pt-tab'), tabela()); });
  raiz.querySelector('#pt-cons').addEventListener('change', (e) => { filtro.conservacao = e.target.value; render(raiz.querySelector('#pt-tab'), tabela()); });
  raiz.querySelector('#pt-inativos').addEventListener('change', (e) => { filtro.inativos = e.target.checked; render(raiz.querySelector('#pt-tab'), tabela()); });
}

async function catalogos() {
  const [cats, unis] = await Promise.all([db.from('categorias').select('id,nome').order('nome'), db.from('unidades_medida').select('id,sigla,nome').order('sigla')]);
  if (cats.error || unis.error) throw new Error((cats.error || unis.error).message);
  return { cats: cats.data, unis: unis.data };
}

async function nova() {
  const { cats, unis } = await catalogos();
  const catPadrao = cats.find((c) => /ferrament/i.test(c.nome))?.id;
  const uniPadrao = unis.find((u) => u.sigla === 'un')?.id;
  let idCriado = null;   // se a entrada falhar depois do cadastro, tentar de novo não duplica o item
  const chave = crypto.randomUUID();
  janelaForm({
    titulo: 'Cadastrar ferramenta ou patrimônio', rotulo: 'Cadastrar',
    corpo: h`
      <div class="field"><label for="pn-nome">Nome</label><input id="pn-nome" name="nome" required placeholder="Ex.: Escada de alumínio 7 degraus" autocomplete="off"></div>
      <div class="linha-campos">
        <div class="field"><label for="pn-cat">Categoria</label><select id="pn-cat" name="cat">${cats.map((c) => h`<option value="${c.id}" ${c.id === catPadrao ? raw('selected') : ''}>${c.nome}</option>`)}</select></div>
        <div class="field"><label for="pn-uni">Unidade</label><select id="pn-uni" name="uni">${unis.map((u) => h`<option value="${u.id}" ${u.id === uniPadrao ? raw('selected') : ''}>${u.sigla} — ${u.nome}</option>`)}</select></div>
      </div>
      <div class="linha-campos">
        <div class="field"><label for="pn-qtd">Quantidade que já existe</label><input id="pn-qtd" name="qtd" inputmode="decimal" placeholder="Ex.: 2">
          <span class="dica">Deixe em branco se ainda não chegou.</span></div>
        <div class="field"><label for="pn-cons">Conservação</label><select id="pn-cons" name="cons">${opcoesConservacao()}</select></div>
      </div>
      <div class="field"><label for="pn-loc">Local (opcional)</label><input id="pn-loc" name="loc" placeholder="Ex.: Depósito do subsolo"></div>
      <div class="field"><label for="pn-desc">Descrição (opcional)</label><textarea id="pn-desc" name="desc" rows="2" placeholder="Marca, modelo, número de patrimônio…"></textarea></div>`,
    aoEnviar: async (f) => {
      const nome = f.nome.trim();
      if (!nome) throw new Error('Informe o nome.');
      const qtd = f.qtd.trim() ? lerNumero(f.qtd) : 0;
      if (!Number.isFinite(qtd) || qtd < 0) throw new Error('Quantidade inválida.');
      if (!idCriado) {
        const { data, error } = await db.from('itens').insert({ condominio_id: cid(), nome, categoria_id: f.cat, unidade_id: f.uni,
          localizacao: f.loc.trim() || null, descricao: f.desc.trim() || null, permanente: true, conservacao: f.cons }).select('id').single();
        if (error) throw new Error(error.code === '23505' ? 'Já existe um item com esse nome.' : error.message);
        idCriado = data.id;
      }
      if (qtd > 0) {
        try {
          await rpc('registrar_entrada_extraordinaria', { p_item_id: idCriado, p_quantidade: qtd, p_origem: 'entrada_extraordinaria',
            p_motivo: 'Inventário inicial (item já existente)', p_chave: chave });
        } catch (e) { await atualizar(); throw new Error('O item foi cadastrado, mas a quantidade não foi registrada: ' + mensagemErro(e) + ' Clique em Cadastrar para tentar de novo.'); }
      }
      aviso('Item cadastrado.', 'ok'); await atualizar();
    },
  });
}

function editar(id) {
  const it = item(id);
  janelaForm({
    titulo: `Atualizar — ${it.nome}`, rotulo: 'Salvar',
    corpo: h`
      <div class="field"><label for="pe-cons">Conservação</label><select id="pe-cons" name="cons">${opcoesConservacao(it.conservacao)}</select></div>
      <div class="field"><label for="pe-loc">Local</label><input id="pe-loc" name="loc" value="${it.localizacao || ''}"></div>
      <div class="field"><label for="pe-desc">Descrição</label><textarea id="pe-desc" name="desc" rows="2">${it.descricao || ''}</textarea></div>
      <div class="field"><label><input type="checkbox" name="permanente" value="1" checked> É ferramenta ou patrimônio</label>
        <span class="dica">Desmarque se o item é, na verdade, material de consumo. Depois defina o mínimo e o ideal em Configuração de estoque.</span></div>`,
    aoEnviar: async (f) => {
      const mudancas = { conservacao: f.cons, localizacao: f.loc.trim() || null, descricao: f.desc.trim() || null, permanente: f.permanente === '1' };
      const { error } = await db.from('itens').update(mudancas).eq('id', id);
      if (error) throw new Error(error.message);
      aviso(mudancas.permanente ? 'Item atualizado.' : 'Item voltou a ser de consumo.', 'ok');
      await atualizar();
    },
  });
}

function marcar() {
  const candidatos = itens.filter((i) => !i.permanente && i.ativo).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  const fundo = abrirJanela(h`
    <h3>Marcar itens já cadastrados</h3>
    <p>Escolha os itens que são ferramentas ou patrimônio. Eles deixam de ter mínimo e ideal e saem dos alertas de compra e de vencimento. A quantidade em estoque continua a mesma.</p>
    ${candidatos.length ? h`<input type="search" class="campo-busca" data-filtro placeholder="Filtrar a lista" aria-label="Filtrar a lista" autocomplete="off">
      <ul class="lista-simples lista-marcar">${candidatos.map((i) => h`<li data-nome="${i.nome.toLowerCase()}"><label><input type="checkbox" value="${i.item_id}"> ${i.nome}</label>
        <span class="dica">${i.categoria} · ${num(i.estoque_atual)} ${i.unidade}</span></li>`)}</ul>`
      : h`<div class="empty">Não há itens de consumo ativos para marcar.</div>`}
    <div class="auth-error hidden" data-erro role="alert"></div>
    <div class="acoes"><button class="btn ghost" data-fechar>Cancelar</button>
      ${candidatos.length ? h`<button class="btn" data-confirmar disabled>Marcar como permanentes</button>` : ''}</div>`, { largo: true });
  const ok = fundo.querySelector('[data-confirmar]'), caixas = () => [...fundo.querySelectorAll('.lista-marcar input:checked')];
  const fechar = () => fundo.remove();
  fundo.querySelector('[data-fechar]').addEventListener('click', fechar);
  fundo.addEventListener('keydown', (e) => { if (e.key === 'Escape') fechar(); });
  fundo.addEventListener('change', () => { if (ok) { const n = caixas().length; ok.disabled = !n; ok.textContent = n ? `Marcar ${n} como permanente${n > 1 ? 's' : ''}` : 'Marcar como permanentes'; } });
  fundo.querySelector('[data-filtro]')?.addEventListener('input', (e) => {
    const t = e.target.value.trim().toLowerCase();
    fundo.querySelectorAll('.lista-marcar li').forEach((li) => { li.hidden = !!t && !li.dataset.nome.includes(t); });
  });
  ok?.addEventListener('click', async () => {
    const ids = caixas().map((c) => c.value);
    ok.disabled = true;
    try {
      const { error } = await db.from('itens').update({ permanente: true }).in('id', ids);
      if (error) throw new Error(error.message);
      fechar(); aviso(`${ids.length} ${ids.length > 1 ? 'itens marcados' : 'item marcado'} como permanente${ids.length > 1 ? 's' : ''}.`, 'ok');
      await atualizar();
    } catch (e) { const c = fundo.querySelector('[data-erro]'); c.textContent = mensagemErro(e); c.classList.remove('hidden'); ok.disabled = false; }
  });
  fundo.querySelector('[data-filtro]')?.focus();
}

export async function abrir(el) {
  raiz = el; filtro = { busca: '', conservacao: '', inativos: false };
  await atualizar();
  on(el, 'click', '[data-acao]', async (_, b) => {
    try {
      const a = b.dataset.acao;
      if (a === 'nova') await nova();
      else if (a === 'marcar') marcar();
      else if (a === 'editar') editar(b.dataset.id);
    } catch (e) { aviso(mensagemErro(e), 'erro'); }
  });
}
