import { h, raw, render, on } from '../../lib/html.js';
import { db, rpc } from '../../lib/supabase.js';
import { estado, papelAtual } from '../../lib/estado.js';
import { aviso, confirmar, abrirJanela, mensagemErro } from '../../lib/ui.js';
import { dataBR } from '../../lib/format.js';
import { nomeArquivo } from '../comunicados/calculos.js';
import { TIPOS_ATA, MAX_TITULO, MAX_RESUMO, filtrarAtas, anosDasAtas, validarAta, validarPdf, hojeLocal } from './calculos.js';

// Atas das assembleias. Todos os membros leem; síndico e gestor cadastram e editam; só o síndico exclui.
let lista = [], busca = '', ano = '', raiz = null;
const equipe = () => ['sindico', 'gestor', 'superadmin'].includes(papelAtual());
const podeExcluir = () => ['sindico', 'superadmin'].includes(papelAtual());

async function carregar() {
  const { data, error } = await db.from('atas')
    .select('id,data_assembleia,tipo,titulo,resumo,arquivo_path,arquivo_nome,criado_em')
    .eq('condominio_id', estado.condominioId);
  if (error) throw new Error(error.message);
  lista = data;
}
async function atualizar() { await carregar(); desenhar(); }

function linha(a) {
  return h`<tr data-ata="${a.id}">
    <td>${dataBR(a.data_assembleia)}</td>
    <td><span class="tag">${TIPOS_ATA[a.tipo] ?? a.tipo}</span></td>
    <td><strong>${a.titulo}</strong>${a.resumo ? h`<div class="dica resumo-ata">${a.resumo}</div>` : ''}</td>
    <td class="acoes-linha">
      ${a.arquivo_path ? h`<button class="btn ghost" data-acao="pdf" data-id="${a.id}">Abrir PDF</button>` : h`<span class="tag" data-sem-pdf>Sem PDF</span>`}
      ${equipe() ? h`<button class="icon-btn" data-acao="editar" data-id="${a.id}">Editar</button>` : ''}
      ${podeExcluir() ? h`<button class="icon-btn" data-acao="excluir" data-id="${a.id}">Excluir</button>` : ''}
    </td></tr>`;
}

function desenhar() {
  const anos = anosDasAtas(lista);
  if (ano && !anos.includes(Number(ano))) ano = '';
  const vis = filtrarAtas(lista, { busca, ano });
  render(raiz, h`
    <div class="page-head"><div><h2>Atas das assembleias</h2><p>${lista.length} ${lista.length === 1 ? 'ata guardada' : 'atas guardadas'}</p></div>
      ${equipe() ? h`<button class="btn" data-acao="nova">Nova ata</button>` : ''}</div>
    <div class="panel">
      <div class="filtros">
        <input id="at-busca" type="search" placeholder="Buscar por título ou assunto" value="${busca}" aria-label="Buscar ata" autocomplete="off">
        <select id="at-ano" aria-label="Ano"><option value="">Todos os anos</option>
          ${anos.map((y) => h`<option value="${y}" ${String(y) === String(ano) ? raw('selected') : ''}>${y}</option>`)}</select>
      </div>
      ${!lista.length ? h`<div class="empty">Nenhuma ata cadastrada ainda.${equipe() ? ' Use "Nova ata" para enviar a primeira.' : ''}</div>`
        : !vis.length ? h`<div class="empty">Nenhuma ata encontrada com esse filtro.</div>`
        : h`<div class="tabela-rolagem"><table class="tabela-atas"><thead><tr><th>Data</th><th>Tipo</th><th>Ata</th><th></th></tr></thead>
            <tbody>${vis.map(linha)}</tbody></table></div>`}
    </div>`);
  const campo = raiz.querySelector('#at-busca');
  campo.addEventListener('input', () => {
    busca = campo.value; const pos = campo.selectionStart; desenhar();
    const novo = raiz.querySelector('#at-busca'); novo.focus(); novo.setSelectionRange(pos, pos);
  });
  raiz.querySelector('#at-ano').addEventListener('change', (e) => { ano = e.target.value; desenhar(); });
}

async function abrirPdf(a) {
  const aba = window.open('', '_blank');   // aberta já no clique, para o navegador não bloquear
  const { data, error } = await db.storage.from('atas').createSignedUrl(a.arquivo_path, 120);
  if (error) { aba?.close(); throw new Error(error.message); }
  if (aba) { aba.opener = null; aba.location.href = data.signedUrl; } else window.location.href = data.signedUrl;
}

function editor(a = null) {
  let idSalvo = a?.id ?? null;   // se o envio do PDF falhar, tentar de novo atualiza a mesma ata
  const hoje = hojeLocal();
  const fundo = abrirJanela(h`
    <h3>${a ? 'Editar ata' : 'Nova ata'}</h3>
    <form novalidate>
      <div class="field"><label for="at-titulo">Título</label><input id="at-titulo" name="titulo" maxlength="${MAX_TITULO}" value="${a?.titulo ?? ''}" placeholder="Ex.: Assembleia geral ordinária 2026" required autocomplete="off"></div>
      <div class="linha-campos">
        <div class="field"><label for="at-data">Data da assembleia</label><input id="at-data" name="data" type="date" max="${hoje}" value="${a?.data_assembleia ?? ''}" required></div>
        <div class="field"><label for="at-tipo">Tipo</label><select id="at-tipo" name="tipo">
          ${Object.entries(TIPOS_ATA).map(([k, r]) => h`<option value="${k}" ${k === (a?.tipo ?? 'ordinaria') ? raw('selected') : ''}>${r}</option>`)}</select></div>
      </div>
      <div class="field"><label for="at-resumo">Resumo (opcional)</label><textarea id="at-resumo" name="resumo" rows="4" maxlength="${MAX_RESUMO}" placeholder="Principais decisões: aprovação das contas, eleição do síndico…">${a?.resumo ?? ''}</textarea>
        <span class="dica">Ajuda a encontrar a ata pela busca.</span></div>
      <div class="field"><label for="at-pdf">${a?.arquivo_path ? 'Trocar o PDF (opcional)' : 'PDF da ata (até 10 MB)'}</label>
        <input id="at-pdf" name="pdf" type="file" accept="application/pdf,.pdf">
        ${a?.arquivo_path ? h`<span class="dica">PDF atual: ${a.arquivo_nome || 'ata.pdf'}. Enviar outro substitui.</span>` : ''}</div>
      <div class="auth-error hidden" data-erro role="alert"></div>
      <div class="acoes"><button type="button" class="btn ghost" data-fechar>Cancelar</button>
        <button type="submit" class="btn" data-salvar>${a ? 'Salvar alterações' : 'Salvar ata'}</button></div>
    </form>`, { largo: true });
  const form = fundo.querySelector('form'), caixa = fundo.querySelector('[data-erro]'), botao = fundo.querySelector('[data-salvar]');
  const erro = (m) => { caixa.textContent = m; caixa.classList.remove('hidden'); };

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault(); caixa.classList.add('hidden');
    const f = new FormData(form);
    const dados = { titulo: String(f.get('titulo') ?? '').trim(), data: String(f.get('data') ?? ''), resumo: String(f.get('resumo') ?? '').trim() };
    const arq = f.get('pdf'); const temArq = arq && arq.size > 0;
    const invalido = validarAta(dados, hoje) || (temArq || !a?.arquivo_path ? validarPdf(temArq ? arq : null) : null);
    if (invalido) return erro(invalido);
    botao.disabled = true;
    try {
      idSalvo = await rpc('salvar_ata', { p_condominio_id: estado.condominioId, p_id: idSalvo,
        p_dados: { titulo: dados.titulo, data_assembleia: dados.data, tipo: f.get('tipo'), resumo: dados.resumo } });
      if (temArq) {
        const caminho = `${estado.condominioId}/${idSalvo}/${crypto.randomUUID()}.pdf`;
        const { error } = await db.storage.from('atas').upload(caminho, arq, { contentType: 'application/pdf', upsert: false });
        if (error) throw new Error('Os dados da ata foram salvos, mas o PDF não foi enviado: ' + error.message + '. Tente de novo.');
        await rpc('definir_arquivo_ata', { p_id: idSalvo, p_path: caminho, p_nome: nomeArquivo(arq.name) });
        if (a?.arquivo_path) { try { await db.storage.from('atas').remove([a.arquivo_path]); } catch { /* arquivo antigo fica órfão, sem prejuízo */ } }
      }
      fundo.remove();
      aviso(a ? 'Ata atualizada.' : 'Ata salva.', 'ok');
      await atualizar();
    } catch (e) { erro(mensagemErro(e)); botao.disabled = false; }
  });
  fundo.querySelector('[data-fechar]').addEventListener('click', () => fundo.remove());
  fundo.addEventListener('keydown', (e) => { if (e.key === 'Escape') fundo.remove(); });
  form.querySelector('input').focus();
}

export async function abrir(el) {
  raiz = el; busca = ''; ano = '';
  await carregar(); desenhar();
  on(el, 'click', '[data-acao]', async (_, b) => {
    const acao = b.dataset.acao, a = lista.find((x) => x.id === b.dataset.id);
    try {
      if (acao === 'nova') editor();
      else if (acao === 'editar' && a) editor(a);
      else if (acao === 'pdf' && a) await abrirPdf(a);
      else if (acao === 'excluir' && a) {
        if (!(await confirmar(`Excluir a ata “${a.titulo}”?`, 'A ata e o PDF são apagados para todos. A exclusão fica registrada na auditoria.', { rotulo: 'Excluir', perigo: true }))) return;
        const caminho = await rpc('excluir_ata', { p_id: a.id });
        if (caminho) { try { await db.storage.from('atas').remove([caminho]); } catch { /* sem prejuízo */ } }
        aviso('Ata excluída.', 'ok'); await atualizar();
      }
    } catch (e) { aviso(mensagemErro(e), 'erro'); }
  });
}
