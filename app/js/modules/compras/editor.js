import { h, raw, render } from '../../lib/html.js';
import { db, rpc } from '../../lib/supabase.js';
import { estado } from '../../lib/estado.js';
import { num, moeda, lerNumero, numCampo } from '../../lib/format.js';
import { aviso, abrirJanela, mensagemErro } from '../../lib/ui.js';

const hoje = () => new Date().toLocaleDateString('sv-SE'); // AAAA-MM-DD no fuso local

// Abre o editor de compra. `preItens`: [{item_id, qtd}] para começar já preenchido.
export async function abrirEditor({ compraId = null, preItens = [], aoSalvar }) {
  const cond = estado.condominioId;
  const [f, it, c, ci] = await Promise.all([
    db.from('fornecedores').select('id,nome,ativo').eq('condominio_id', cond).order('nome'),
    db.from('v_estoque_item').select('item_id,nome,unidade,fornecedor_principal_id').eq('condominio_id', cond).eq('ativo', true).order('nome'),
    compraId ? db.from('v_compras').select('*').eq('compra_id', compraId).maybeSingle() : { data: null },
    compraId ? db.from('compra_itens').select('item_id,qtd_solicitada,custo_unitario,vencimento_previsto').eq('compra_id', compraId) : { data: [] },
  ]);
  const falha = f.error || it.error || c.error || ci.error;
  if (falha) throw new Error(falha.message);
  const itens = it.data;
  if (!itens.length) throw new Error('Cadastre ao menos um item em “Operação diária” antes de criar uma compra.');
  const compra = c.data;
  const fornecedores = f.data.filter((x) => x.ativo || x.id === compra?.fornecedor_id);

  let linhas = compraId
    ? ci.data.map((x) => ({ item_id: x.item_id, qtd: numCampo(x.qtd_solicitada), custo: numCampo(x.custo_unitario), venc: x.vencimento_previsto || '' }))
    : preItens.map((x) => ({ item_id: x.item_id, qtd: numCampo(x.qtd), custo: '', venc: '' }));
  if (!linhas.length) linhas = [{ item_id: itens[0].item_id, qtd: '', custo: '', venc: '' }];

  const fundo = abrirJanela(h`
    <h3>${compraId ? 'Editar compra' : 'Nova compra'}</h3>
    <p>Registrar a compra não altera o estoque. O estoque só muda quando você registrar o recebimento.</p>
    <form novalidate>
      <div class="field"><label for="c-forn">Fornecedor</label><select id="c-forn" name="forn"><option value="">— escolher depois —</option>
        ${fornecedores.map((x) => h`<option value="${x.id}" ${x.id === compra?.fornecedor_id ? raw('selected') : ''}>${x.nome}</option>`)}</select></div>
      <div class="field"><label for="c-data">Data da compra</label><input id="c-data" name="data" type="date" value="${compra?.data_compra || hoje()}"></div>
      <div class="field"><label for="c-nf">Número da nota fiscal (opcional)</label><input id="c-nf" name="nf" value="${compra?.numero_nf || ''}"></div>
      <div class="tabela-rolagem"><table><thead><tr><th>Item</th><th>Qtd.</th><th>Custo unit. (R$)</th><th>Validade prevista</th><th></th></tr></thead><tbody data-linhas></tbody></table></div>
      <div class="linha-acoes" style="margin:8px 0"><button type="button" class="btn pequeno ghost" data-add>+ Adicionar item</button>
        <span class="dica" style="margin-left:auto">Total: <b class="num" data-total></b></span></div>
      <div class="field"><label for="c-obs">Observações</label><textarea id="c-obs" name="obs" rows="2">${compra?.observacoes || ''}</textarea></div>
      <div class="auth-error hidden" data-erro role="alert"></div>
      <div class="acoes"><button type="button" class="btn ghost" data-fechar>Cancelar</button>
        <button type="button" class="btn ghost" data-enviar="0">${compra?.status === 'aguardando_aprovacao' ? 'Salvar alterações' : 'Salvar rascunho'}</button>
        <button type="button" class="btn" data-enviar="1">Salvar e enviar para aprovação</button></div>
    </form>`, { largo: true });

  const corpo = fundo.querySelector('[data-linhas]');
  const total = () => linhas.reduce((s, l) => { const q = lerNumero(l.qtd), c_ = lerNumero(l.custo); return s + (Number.isFinite(q) && Number.isFinite(c_) ? q * c_ : 0); }, 0);
  const atualizaTotal = () => { fundo.querySelector('[data-total]').textContent = moeda(total()); };
  const desenhaLinhas = () => {
    render(corpo, h`${linhas.map((l, i) => h`<tr>
      <td><select data-i="${i}" data-c="item_id" aria-label="Item">${itens.map((x) => h`<option value="${x.item_id}" ${x.item_id === l.item_id ? raw('selected') : ''}>${x.nome} (${x.unidade})</option>`)}</select></td>
      <td><input class="inp-num" data-i="${i}" data-c="qtd" inputmode="decimal" value="${l.qtd}" aria-label="Quantidade"></td>
      <td><input class="inp-num" data-i="${i}" data-c="custo" inputmode="decimal" value="${l.custo}" placeholder="0,00" aria-label="Custo unitário"></td>
      <td><input data-i="${i}" data-c="venc" type="date" value="${l.venc}" aria-label="Validade prevista"></td>
      <td>${linhas.length > 1 ? h`<button type="button" class="icon-btn" data-rem="${i}" aria-label="Remover linha">✕</button>` : ''}</td></tr>`)}`);
    atualizaTotal();
  };
  desenhaLinhas();

  const caixaErro = fundo.querySelector('[data-erro]');
  const erro = (t) => { caixaErro.textContent = t; caixaErro.classList.remove('hidden'); };
  fundo.addEventListener('input', (e) => { const c_ = e.target.dataset?.c; if (c_) { linhas[Number(e.target.dataset.i)][c_] = e.target.value; atualizaTotal(); } });
  fundo.addEventListener('change', (e) => { const c_ = e.target.dataset?.c; if (c_) linhas[Number(e.target.dataset.i)][c_] = e.target.value; });
  fundo.querySelector('[data-add]').addEventListener('click', () => { linhas.push({ item_id: itens[0].item_id, qtd: '', custo: '', venc: '' }); desenhaLinhas(); });
  fundo.addEventListener('click', (e) => { const r = e.target.closest('[data-rem]'); if (r) { linhas.splice(Number(r.dataset.rem), 1); desenhaLinhas(); } });
  fundo.querySelector('[data-fechar]').addEventListener('click', () => fundo.remove());
  fundo.addEventListener('keydown', (e) => { if (e.key === 'Escape') fundo.remove(); });

  async function salvar(enviar) {
    caixaErro.classList.add('hidden');
    const vistos = new Set(); const itensEnv = [];
    for (const l of linhas) {
      const q = lerNumero(l.qtd), c_ = l.custo.trim() ? lerNumero(l.custo) : 0;
      if (!Number.isFinite(q) || q <= 0) return erro('Informe a quantidade de cada item (maior que zero).');
      if (!Number.isFinite(c_) || c_ < 0) return erro('Custo unitário inválido.');
      if (vistos.has(l.item_id)) return erro('Há o mesmo item em mais de uma linha. Some as quantidades numa só.');
      vistos.add(l.item_id);
      itensEnv.push({ item_id: l.item_id, qtd_solicitada: q, custo_unitario: c_, vencimento_previsto: l.venc || null });
    }
    const f_ = fundo.querySelector('form');
    const dados = { fornecedor_id: f_.forn.value || '', data_compra: f_.data.value || null, numero_nf: f_.nf.value.trim(), observacoes: f_.obs.value.trim() };
    fundo.querySelectorAll('[data-enviar]').forEach((b) => (b.disabled = true));
    try {
      await rpc('salvar_compra', { p_condominio_id: estado.condominioId, p_compra_id: compraId, p_dados: dados, p_itens: itensEnv, p_enviar: enviar });
      fundo.remove();
      aviso(enviar ? 'Compra enviada para aprovação.' : 'Alterações salvas.', 'ok');
      await aoSalvar?.();
    } catch (e) {
      erro(mensagemErro(e));
      fundo.querySelectorAll('[data-enviar]').forEach((b) => (b.disabled = false));
    }
  }
  fundo.querySelectorAll('[data-enviar]').forEach((b) => b.addEventListener('click', () => salvar(b.dataset.enviar === '1')));
}
