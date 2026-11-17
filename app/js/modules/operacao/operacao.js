import { h, raw, render, on } from '../../lib/html.js';
import { db, rpc } from '../../lib/supabase.js';
import { estado } from '../../lib/estado.js';
import { num, dataHoraBR, dataBR, lerNumero } from '../../lib/format.js';
import { aviso, pedirTexto, janelaForm, mensagemErro } from '../../lib/ui.js';

const STATUS = {
  sem_estoque_cadastrado: ['Sem estoque cadastrado', 'status-neutro'],
  esgotado: ['Esgotado', 'status-crit'],
  comprar: ['Comprar', 'status-crit'],
  atencao: ['Atenção', 'status-warn'],
  normal: ['Normal', 'status-ok'],
};
const TIPO = { entrada: 'Entrada', consumo: 'Consumo', perda: 'Perda', ajuste: 'Ajuste', doacao: 'Doação', descarte: 'Descarte' };
const MOTIVOS = ['Uso diário', 'Manutenção preventiva', 'Manutenção corretiva', 'Reposição em área comum', 'Material danificado', 'Vencido'];

let dados = { itens: [], movs: [], lotesCod: {}, nomes: {}, estornadas: new Set() };
let filtro = { texto: '', status: '' };
let raizPagina = null;

const cid = () => estado.condominioId;
const chaveNova = () => crypto.randomUUID();

async function carregar() {
  const [itens, movs] = await Promise.all([
    db.from('v_estoque_item').select('*').eq('condominio_id', cid()).eq('ativo', true).order('nome'),
    db.from('movimentacoes')
      .select('id,item_id,lote_id,tipo,sinal,quantidade,motivo,justificativa,data_hora,responsavel_id,recebimento_item_id,estorno_de')
      .eq('condominio_id', cid()).order('data_hora', { ascending: false }).limit(40),
  ]);
  if (itens.error) throw new Error(itens.error.message);
  if (movs.error) throw new Error(movs.error.message);
  dados.itens = itens.data;
  dados.movs = movs.data;
  dados.estornadas = new Set(movs.data.filter((m) => m.estorno_de).map((m) => m.estorno_de));
  const lotes = [...new Set(movs.data.map((m) => m.lote_id))];
  const resp = [...new Set(movs.data.map((m) => m.responsavel_id))];
  const [l, p] = await Promise.all([
    lotes.length ? db.from('lotes').select('id,codigo').in('id', lotes) : { data: [] },
    resp.length ? db.from('profiles').select('id,nome').in('id', resp) : { data: [] },
  ]);
  dados.lotesCod = Object.fromEntries((l.data || []).map((x) => [x.id, x.codigo]));
  dados.nomes = Object.fromEntries((p.data || []).map((x) => [x.id, x.nome]));
}

function filtrados() {
  const t = filtro.texto.trim().toLowerCase();
  return dados.itens.filter((i) =>
    (!t || i.nome.toLowerCase().includes(t) || (i.categoria || '').toLowerCase().includes(t)) &&
    (!filtro.status || i.status === filtro.status));
}

const pill = (s) => { const [rot, cls] = STATUS[s] || [s, 'status-neutro']; return h`<span class="status-pill ${cls}">${rot}</span>`; };

function cartoes() {
  const c = (st) => dados.itens.filter((i) => i.status === st).length;
  return h`<div class="cards">
    <div class="card"><div class="k">Itens ativos</div><div class="v">${dados.itens.length}</div></div>
    <div class="card crit"><div class="k">Para comprar</div><div class="v">${c('comprar')}</div></div>
    <div class="card crit"><div class="k">Esgotados</div><div class="v">${c('esgotado')}</div></div>
    <div class="card warn"><div class="k">Em atenção</div><div class="v">${c('atencao')}</div></div></div>`;
}

function tabelaItens() {
  const lista = filtrados();
  if (!dados.itens.length) return h`<div class="empty">Nenhum item cadastrado. Use “Novo item” para começar.</div>`;
  if (!lista.length) return h`<div class="empty">Nenhum item com esse filtro.</div>`;
  return h`<div class="tabela-rolagem"><table><thead><tr><th>Item</th><th>Estoque</th><th>Situação</th><th>Local</th><th>Ações</th></tr></thead><tbody>
    ${lista.map((i) => h`<tr class="${i.status === 'esgotado' || i.status === 'comprar' ? 'row-crit' : i.status === 'atencao' ? 'row-warn' : ''}">
      <td><b>${i.nome}</b><br><span class="tag">${i.categoria}</span></td>
      <td class="num">${num(i.estoque_atual)} ${i.unidade}</td>
      <td>${pill(i.status)}</td>
      <td>${i.localizacao || '—'}</td>
      <td><div class="linha-acoes">
        <button class="btn pequeno" data-acao="saida" data-id="${i.item_id}" ${i.estoque_atual > 0 ? '' : raw('disabled')}>Registrar saída</button>
        <button class="btn pequeno ghost" data-acao="entrada" data-id="${i.item_id}">Entrada</button>
        <button class="btn pequeno ghost" data-acao="ajuste" data-id="${i.item_id}">Ajustar</button>
      </div></td></tr>`)}</tbody></table></div>`;
}

function tabelaMovs() {
  if (!dados.movs.length) return h`<div class="empty">Nenhuma movimentação ainda.</div>`;
  const nomeItem = Object.fromEntries(dados.itens.map((i) => [i.item_id, i]));
  return h`<div class="tabela-rolagem"><table><thead><tr><th>Quando</th><th>Item</th><th>Tipo</th><th>Qtd.</th><th>Motivo</th><th>Quem</th><th></th></tr></thead><tbody>
    ${dados.movs.map((m) => {
      const it = nomeItem[m.item_id];
      const estornavel = !m.estorno_de && !dados.estornadas.has(m.id) && !m.recebimento_item_id;
      return h`<tr>
        <td>${dataHoraBR(m.data_hora)}</td>
        <td>${it?.nome ?? '(item inativo)'}</td>
        <td>${m.estorno_de ? 'Estorno' : TIPO[m.tipo] ?? m.tipo}${dados.estornadas.has(m.id) ? h` <span class="tag">estornada</span>` : ''}</td>
        <td class="num ${m.sinal > 0 ? 'qtd-mais' : 'qtd-menos'}">${m.sinal > 0 ? '+' : '−'}${num(m.quantidade)} ${it?.unidade ?? ''}</td>
        <td>${m.estorno_de ? m.justificativa : m.motivo}</td>
        <td>${dados.nomes[m.responsavel_id] || '—'}</td>
        <td>${estornavel ? h`<button class="icon-btn" data-acao="estornar" data-id="${m.id}">Estornar</button>` : ''}</td></tr>`;
    })}</tbody></table></div>`;
}

function desenhar() {
  render(raizPagina, h`
    <div class="page-head"><div><h2>Operação diária</h2><p>Registre o que entra e o que sai do estoque.</p></div>
      <button class="btn" data-acao="novo-item">Novo item</button></div>
    ${cartoes()}
    <div class="panel"><h3>Itens</h3>
      <div class="filtros">
        <input id="f-texto" type="search" placeholder="Buscar item ou categoria" value="${filtro.texto}" aria-label="Buscar">
        <select id="f-status" aria-label="Situação"><option value="">Todas as situações</option>
          ${Object.entries(STATUS).map(([k, [r]]) => h`<option value="${k}" ${filtro.status === k ? raw('selected') : ''}>${r}</option>`)}</select>
      </div>
      <div id="lista-itens">${tabelaItens()}</div></div>
    <div class="panel"><h3>Últimas movimentações</h3>${tabelaMovs()}</div>`);
  const texto = raizPagina.querySelector('#f-texto');
  texto.addEventListener('input', () => {
    filtro.texto = texto.value;
    render(raizPagina.querySelector('#lista-itens'), tabelaItens());
  });
  raizPagina.querySelector('#f-status').addEventListener('change', (e) => {
    filtro.status = e.target.value;
    render(raizPagina.querySelector('#lista-itens'), tabelaItens());
  });
}

async function recarregar() { await carregar(); desenhar(); }
const item = (id) => dados.itens.find((i) => i.item_id === id);

async function lotesDoItem(id) {
  const { data, error } = await db.from('v_lotes').select('lote_id,codigo,saldo,vencimento,data_entrada,origem')
    .eq('item_id', id).order('data_entrada').order('codigo');
  if (error) throw new Error(error.message);
  return data;
}
const rotuloLote = (l) => `${l.codigo} — saldo ${num(l.saldo)}${l.vencimento ? ' — vence ' + dataBR(l.vencimento) : ''}`;

function exigirQtd(v) {
  const q = lerNumero(v);
  if (!Number.isFinite(q) || q <= 0) throw new Error('Informe uma quantidade maior que zero.');
  return q;
}

/* ---------------- ações ---------------- */
async function abrirSaida(id) {
  const it = item(id); const chave = chaveNova();
  const lotes = (await lotesDoItem(id)).filter((l) => Number(l.saldo) > 0);
  janelaForm({
    titulo: `Registrar saída — ${it.nome}`,
    intro: `Disponível: ${num(it.estoque_atual)} ${it.unidade}. Sai primeiro o que vence antes (ou o mais antigo).`,
    rotulo: 'Registrar saída',
    corpo: h`
      <div class="field"><label for="s-tipo">Tipo</label><select id="s-tipo" name="tipo">
        <option value="consumo">Consumo</option><option value="perda">Perda</option>
        <option value="descarte">Descarte</option><option value="doacao">Doação (saída)</option></select></div>
      <div class="field"><label for="s-qtd">Quantidade (${it.unidade})</label><input id="s-qtd" name="qtd" inputmode="decimal" required></div>
      <div class="field"><label for="s-motivo">Motivo</label><input id="s-motivo" name="motivo" list="motivos" required autocomplete="off">
        <datalist id="motivos">${MOTIVOS.map((m) => h`<option value="${m}">`)}</datalist></div>
      <div class="field"><label for="s-lote">De qual lote?</label><select id="s-lote" name="lote">
        <option value="">Automático (recomendado)</option>${lotes.map((l) => h`<option value="${l.lote_id}">${rotuloLote(l)}</option>`)}</select></div>
      <div class="field"><label for="s-obs">Observação (opcional)</label><textarea id="s-obs" name="obs" rows="2"></textarea></div>`,
    aoEnviar: async (f) => {
      const q = exigirQtd(f.qtd);
      if (!f.motivo.trim()) throw new Error('Informe o motivo.');
      await rpc('registrar_saida', { p_item_id: id, p_tipo: f.tipo, p_quantidade: q, p_motivo: f.motivo.trim(),
        p_chave: chave, p_observacao: f.obs.trim() || null, p_lote_id: f.lote || null });
      aviso('Saída registrada.', 'ok'); await recarregar();
    },
  });
}

function abrirEntrada(id) {
  const it = item(id); const chave = chaveNova();
  janelaForm({
    titulo: `Entrada extraordinária — ${it.nome}`,
    intro: 'Para material que chegou fora de uma compra (sobra de obra, doação recebida…). Compras comuns são recebidas na Central de compras.',
    rotulo: 'Registrar entrada',
    corpo: h`
      <div class="field"><label for="e-origem">Origem</label><select id="e-origem" name="origem">
        <option value="entrada_extraordinaria">Entrada extraordinária</option><option value="doacao">Doação recebida</option></select></div>
      <div class="field"><label for="e-qtd">Quantidade (${it.unidade})</label><input id="e-qtd" name="qtd" inputmode="decimal" required></div>
      <div class="field"><label for="e-motivo">Motivo</label><input id="e-motivo" name="motivo" required autocomplete="off"></div>
      <div class="field"><label for="e-custo">Custo unitário (opcional)</label><input id="e-custo" name="custo" inputmode="decimal" placeholder="0,00"></div>
      <div class="field"><label for="e-venc">Validade (opcional)</label><input id="e-venc" name="venc" type="date"></div>
      <div class="field"><label for="e-obs">Observação (opcional)</label><textarea id="e-obs" name="obs" rows="2"></textarea></div>`,
    aoEnviar: async (f) => {
      const q = exigirQtd(f.qtd);
      if (!f.motivo.trim()) throw new Error('Informe o motivo.');
      const custo = f.custo.trim() ? lerNumero(f.custo) : 0;
      if (!Number.isFinite(custo) || custo < 0) throw new Error('Custo inválido.');
      await rpc('registrar_entrada_extraordinaria', { p_item_id: id, p_quantidade: q, p_origem: f.origem, p_motivo: f.motivo.trim(),
        p_chave: chave, p_custo_unitario: custo, p_vencimento: f.venc || null, p_observacao: f.obs.trim() || null });
      aviso('Entrada registrada.', 'ok'); await recarregar();
    },
  });
}

async function abrirAjuste(id) {
  const it = item(id); const chave = chaveNova();
  const lotes = await lotesDoItem(id);
  if (!lotes.length) return aviso('Este item ainda não tem estoque. Use “Entrada” para lançar a primeira quantidade.', 'erro');
  janelaForm({
    titulo: `Ajustar estoque — ${it.nome}`,
    intro: 'Informe quanto realmente existe no lote (contagem física). O sistema calcula a diferença e guarda a justificativa.',
    rotulo: 'Registrar ajuste',
    corpo: h`
      <div class="field"><label for="a-lote">Lote</label><select id="a-lote" name="lote">${lotes.map((l) => h`<option value="${l.lote_id}">${rotuloLote(l)}</option>`)}</select></div>
      <div class="field"><label for="a-qtd">Quantidade contada (${it.unidade})</label><input id="a-qtd" name="qtd" inputmode="decimal" required></div>
      <div class="field"><label for="a-just">Justificativa</label><textarea id="a-just" name="just" rows="2" required></textarea>
        <span class="dica">Mínimo de 5 caracteres. Fica registrada para sempre.</span></div>`,
    aoEnviar: async (f) => {
      const q = lerNumero(f.qtd);
      if (!Number.isFinite(q) || q < 0) throw new Error('Informe a quantidade contada (zero ou mais).');
      if (f.just.trim().length < 5) throw new Error('Escreva a justificativa (mínimo de 5 caracteres).');
      await rpc('registrar_ajuste', { p_item_id: id, p_lote_id: f.lote, p_quantidade_fisica: q, p_justificativa: f.just.trim(), p_chave: chave });
      aviso('Ajuste registrado.', 'ok'); await recarregar();
    },
  });
}

async function estornar(movId) {
  const just = await pedirTexto('Estornar movimentação', 'Isto cria uma movimentação inversa; o registro original permanece. Explique o motivo:', { rotulo: 'Estornar', minimo: 5 });
  if (just === null) return;
  await rpc('estornar_movimentacao', { p_mov_id: movId, p_justificativa: just, p_chave: chaveNova() });
  aviso('Movimentação estornada.', 'ok'); await recarregar();
}

async function abrirNovoItem() {
  const [cats, unis] = await Promise.all([
    db.from('categorias').select('id,nome').order('nome'), db.from('unidades_medida').select('id,sigla,nome').order('sigla')]);
  if (cats.error || unis.error) throw new Error((cats.error || unis.error).message);
  janelaForm({
    titulo: 'Novo item', rotulo: 'Cadastrar',
    intro: 'O estoque começa em zero. Lance a primeira quantidade em “Entrada” ou recebendo uma compra.',
    corpo: h`
      <div class="field"><label for="n-nome">Nome</label><input id="n-nome" name="nome" required></div>
      <div class="field"><label for="n-cat">Categoria</label><select id="n-cat" name="cat">${cats.data.map((c) => h`<option value="${c.id}">${c.nome}</option>`)}</select></div>
      <div class="field"><label for="n-uni">Unidade</label><select id="n-uni" name="uni">${unis.data.map((u) => h`<option value="${u.id}">${u.sigla} — ${u.nome}</option>`)}</select></div>
      <div class="field"><label for="n-min">Estoque mínimo</label><input id="n-min" name="min" inputmode="decimal" value="0"></div>
      <div class="field"><label for="n-ideal">Estoque ideal</label><input id="n-ideal" name="ideal" inputmode="decimal" value="0">
        <span class="dica">É a quantidade que você quer ter depois de repor. Não pode ser menor que o mínimo.</span></div>
      <div class="field"><label for="n-loc">Local (opcional)</label><input id="n-loc" name="loc"></div>`,
    aoEnviar: async (f) => {
      const min = lerNumero(f.min), ideal = lerNumero(f.ideal);
      if (!f.nome.trim()) throw new Error('Informe o nome.');
      if (!Number.isFinite(min) || min < 0 || !Number.isFinite(ideal) || ideal < 0) throw new Error('Mínimo e ideal precisam ser números (zero ou mais).');
      if (ideal < min) throw new Error('O estoque ideal não pode ser menor que o mínimo.');
      const { error } = await db.from('itens').insert({ condominio_id: cid(), nome: f.nome.trim(), categoria_id: f.cat, unidade_id: f.uni,
        estoque_minimo: min, estoque_ideal: ideal, localizacao: f.loc.trim() || null });
      if (error) throw new Error(error.code === '23505' ? 'Já existe um item com esse nome.' : error.message);
      aviso('Item cadastrado.', 'ok'); await recarregar();
    },
  });
}

export async function abrir(el) {
  raizPagina = el;
  await carregar();
  desenhar();
  on(el, 'click', '[data-acao]', async (_, b) => {
    try {
      const a = b.dataset.acao, id = b.dataset.id;
      if (a === 'saida') await abrirSaida(id);
      else if (a === 'entrada') abrirEntrada(id);
      else if (a === 'ajuste') await abrirAjuste(id);
      else if (a === 'estornar') await estornar(id);
      else if (a === 'novo-item') await abrirNovoItem();
    } catch (e) { aviso(mensagemErro(e), 'erro'); }
  });
}
