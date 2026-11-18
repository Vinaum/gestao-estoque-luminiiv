import { h, raw } from '../../lib/html.js';
import { db, rpc } from '../../lib/supabase.js';
import { estado } from '../../lib/estado.js';
import { moeda } from '../../lib/format.js';
import { aviso, abrirJanela, mensagemErro } from '../../lib/ui.js';
import { lerValorReais, validarRetroativa, validarArquivoNF } from './retroativa_regras.js';

const hojeLocal = () => new Date().toLocaleDateString('sv-SE');
const valorCampo = (n) => (n == null ? '' : Number(n).toFixed(2).replace('.', ','));

// Lançar (ou corrigir) uma nota fiscal antiga: só valor total, sem itens e sem mexer no estoque. Só o síndico.
export async function abrirRetroativa({ compra = null, aoSalvar } = {}) {
  const cond = estado.condominioId;
  const [f, c] = await Promise.all([
    db.from('fornecedores').select('id,nome,ativo').eq('condominio_id', cond).order('nome'),
    db.from('categorias').select('id,nome').order('nome'),
  ]);
  if (f.error || c.error) throw new Error((f.error || c.error).message);
  const fornecedores = f.data.filter((x) => x.ativo || x.id === compra?.fornecedor_id);
  let idSalvo = compra?.compra_id ?? null;   // se o envio do arquivo falhar, tentar de novo corrige o mesmo lançamento
  const hoje = hojeLocal();

  const fundo = abrirJanela(h`
    <h3>${compra ? 'Corrigir nota antiga' : 'Lançar nota fiscal antiga'}</h3>
    <p class="dica">Para registrar gastos que já aconteceram. Entra nos relatórios de gastos e no painel, mas <b>não mexe no estoque</b> e não passa por aprovação.</p>
    <form novalidate>
      <div class="linha-campos">
        <div class="field"><label for="rt-data">Data da nota</label><input id="rt-data" name="data" type="date" max="${hoje}" value="${compra?.data_compra ?? ''}" required></div>
        <div class="field"><label for="rt-valor">Valor total (R$)</label><input id="rt-valor" name="valor" inputmode="decimal" placeholder="Ex.: 1.234,56" value="${valorCampo(compra?.valor_total)}" required autocomplete="off"></div>
      </div>
      <div class="linha-campos">
        <div class="field"><label for="rt-forn">Fornecedor (opcional)</label><select id="rt-forn" name="forn"><option value="">—</option>
          ${fornecedores.map((x) => h`<option value="${x.id}" ${x.id === compra?.fornecedor_id ? raw('selected') : ''}>${x.nome}</option>`)}</select></div>
        <div class="field"><label for="rt-cat">Categoria (opcional)</label><select id="rt-cat" name="cat"><option value="">—</option>
          ${c.data.map((x) => h`<option value="${x.id}" ${x.id === compra?.categoria_id ? raw('selected') : ''}>${x.nome}</option>`)}</select>
          <span class="dica">Aparece na pizza “Por categoria” dos relatórios.</span></div>
      </div>
      <div class="field"><label for="rt-nf">Número da nota (opcional)</label><input id="rt-nf" name="nf" maxlength="60" value="${compra?.numero_nf ?? ''}" autocomplete="off"></div>
      <div class="field"><label for="rt-obs">Observação (opcional)</label><textarea id="rt-obs" name="obs" rows="2" maxlength="1000" placeholder="Ex.: troca das lâmpadas da garagem">${compra?.observacoes ?? ''}</textarea></div>
      <div class="field"><label for="rt-arq">${compra?.nf_arquivo_path ? 'Trocar o arquivo da nota (opcional)' : 'Arquivo da nota (PDF, JPG ou PNG, até 5 MB)'}</label>
        <input id="rt-arq" name="arquivo" type="file" accept="application/pdf,image/jpeg,image/png,.pdf">
        ${compra?.nf_arquivo_path ? h`<span class="dica">Já há um arquivo anexado. Enviar outro substitui.</span>` : ''}</div>
      <div class="auth-error hidden" data-erro role="alert"></div>
      <div class="acoes"><button type="button" class="btn ghost" data-fechar>Cancelar</button>
        <button type="submit" class="btn" data-salvar>${compra ? 'Salvar correção' : 'Lançar nota'}</button></div>
    </form>`, { largo: true });
  const form = fundo.querySelector('form'), caixa = fundo.querySelector('[data-erro]'), botao = fundo.querySelector('[data-salvar]');
  const erro = (m) => { caixa.textContent = m; caixa.classList.remove('hidden'); };

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault(); caixa.classList.add('hidden');
    const d = new FormData(form);
    const data = String(d.get('data') ?? ''), valor = lerValorReais(d.get('valor'));
    const arq = d.get('arquivo'); const temArq = arq && arq.size > 0;
    const invalido = validarRetroativa({ data, valor }, hoje); if (invalido) return erro(invalido);
    const v = temArq ? validarArquivoNF(arq) : null; if (v?.erro) return erro(v.erro);
    const numero = String(d.get('nf') ?? '').trim();
    botao.disabled = true;
    try {
      idSalvo = await rpc('salvar_compra_retroativa', { p_condominio_id: cond, p_id: idSalvo, p_dados: {
        data_compra: data, valor: String(valor), fornecedor_id: d.get('forn') || null, categoria_id: d.get('cat') || null,
        numero_nf: numero || null, observacoes: String(d.get('obs') ?? '').trim() || null } });
      if (temArq) {
        const caminho = `${cond}/${idSalvo}/${crypto.randomUUID()}.${v.ext}`;
        const { error } = await db.storage.from('notas-fiscais').upload(caminho, arq, { contentType: arq.type || 'application/pdf', upsert: false });
        if (error) throw new Error('A nota foi lançada, mas o arquivo não foi enviado: ' + error.message + '. Tente de novo.');
        await rpc('atualizar_nf_compra', { p_compra_id: idSalvo, p_numero_nf: numero || null, p_arquivo_path: caminho });
        if (compra?.nf_arquivo_path) { try { await db.storage.from('notas-fiscais').remove([compra.nf_arquivo_path]); } catch { /* arquivo antigo fica órfão, sem prejuízo */ } }
      }
      fundo.remove();
      aviso(compra ? 'Nota corrigida.' : `Nota de ${moeda(valor)} lançada.`, 'ok');
      await aoSalvar?.();
    } catch (e) { erro(mensagemErro(e)); botao.disabled = false; }
  });
  fundo.querySelector('[data-fechar]').addEventListener('click', () => fundo.remove());
  fundo.addEventListener('keydown', (e) => { if (e.key === 'Escape') fundo.remove(); });
  form.querySelector('input').focus();
}
