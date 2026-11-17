import { h, render, on } from '../../lib/html.js';
import { db, rpc } from '../../lib/supabase.js';
import { estado, papelAtual } from '../../lib/estado.js';
import { aviso, confirmar, abrirJanela, mensagemErro } from '../../lib/ui.js';
import { dataBR, dataHoraBR } from '../../lib/format.js';
import { carregarEstrutura } from '../../lib/unidades.js';
import { TIPOS, vencido, resumo, filtrarAba, contar } from './calculos.js';
import { abrirEditor } from './editor.js';
import { abrirLeituras } from './leituras.js';

let lista = [], lidos = new Set(), est = { torres: [], aptos: [] }, aba = 'publicado', raiz = null;
const equipe = () => ['sindico', 'gestor', 'superadmin'].includes(papelAtual());
const nomeTorre = (id) => est.torres.find((t) => t.id === id)?.nome ?? 'uma torre';
const destino = (c) => (c.torre_id ? nomeTorre(c.torre_id) : 'Todo o condomínio');

async function carregar() {
  const cid = estado.condominioId;
  const [c, l, e] = await Promise.all([
    db.from('comunicados').select('id,titulo,corpo,tipo,torre_id,fixado,status,publicado_em,expira_em,editado_em,anexo_path,anexo_nome,criado_em').eq('condominio_id', cid),
    db.from('comunicado_leituras').select('comunicado_id').eq('condominio_id', cid).eq('user_id', estado.perfil.id),
    carregarEstrutura(cid),
  ]);
  if (c.error || l.error) throw new Error((c.error || l.error).message);
  lista = c.data; lidos = new Set(l.data.map((x) => x.comunicado_id)); est = e;
}
async function atualizar() { await carregar(); desenhar(); }

// "Novo" = publicado, ainda não aberto por esta pessoa e dentro da validade.
// Para a equipe, comunicados de torre não são marcados (ela não é o público deles).
const ehNovo = (c) => c.status === 'publicado' && !lidos.has(c.id) && !vencido(c) && (!c.torre_id || papelAtual() === 'morador');

function cartao(c) {
  const novo = ehNovo(c);
  const meta = [
    c.status === 'rascunho' ? 'Rascunho' : c.status === 'arquivado' ? 'Arquivado' : `Publicado em ${dataBR(c.publicado_em)}`,
    c.expira_em ? `até ${dataBR(c.expira_em)}` : null,
    c.editado_em ? `editado em ${dataBR(c.editado_em)}` : null,
    c.anexo_nome ? 'com anexo' : null,
  ].filter(Boolean).join(' · ');
  const acoes = !equipe() ? '' : c.status === 'rascunho'
    ? h`<button class="icon-btn" data-acao="editar" data-id="${c.id}">Editar</button><button class="icon-btn" data-acao="publicar" data-id="${c.id}">Publicar</button><button class="icon-btn" data-acao="arquivar" data-id="${c.id}">Arquivar</button>`
    : c.status === 'publicado'
      ? h`<button class="icon-btn" data-acao="editar" data-id="${c.id}">Editar</button><button class="icon-btn" data-acao="leituras" data-id="${c.id}">Quem leu</button><button class="icon-btn" data-acao="arquivar" data-id="${c.id}">Arquivar</button>`
      : h`<button class="icon-btn" data-acao="publicar" data-id="${c.id}">Publicar de novo</button>`;
  return h`<article class="cartao-com ${novo ? 'novo' : ''}">
    <button class="cartao-abrir" data-acao="abrir" data-id="${c.id}">
      <span class="tags"><span class="tag">${TIPOS[c.tipo] ?? 'Aviso'}</span>
        ${c.fixado ? h`<span class="tag">Fixado</span>` : ''}${novo ? h`<span class="tag tag-novo">Novo</span>` : ''}${c.status === 'publicado' && vencido(c) ? h`<span class="tag">Vencido</span>` : ''}
        <span class="tag">${destino(c)}</span></span>
      <strong class="cartao-titulo">${c.titulo}</strong>
      <span class="dica">${meta}</span>
      <span class="cartao-resumo">${resumo(c.corpo)}</span>
    </button>
    ${acoes ? h`<div class="linha-acoes">${acoes}</div>` : ''}
  </article>`;
}

function desenhar() {
  const n = contar(lista);
  const itens = filtrarAba(lista, equipe() ? aba : 'publicado');
  const vazio = equipe()
    ? ({ publicado: 'Nenhum comunicado publicado.', rascunho: 'Nenhum rascunho.', arquivado: 'Nenhum comunicado arquivado.' })[aba]
    : 'Nenhum comunicado no momento.';
  render(raiz, h`
    <div class="page-head"><div><h2>Comunicados</h2><p>Avisos do condomínio.</p></div>
      ${equipe() ? h`<button class="btn" data-acao="novo">Novo comunicado</button>` : ''}</div>
    ${equipe() ? h`<div class="tabs-mini" role="tablist">
      ${[['publicado', 'Publicados'], ['rascunho', 'Rascunhos'], ['arquivado', 'Arquivados']].map(([k, r]) =>
        h`<button role="tab" data-aba="${k}" class="${aba === k ? 'active' : ''}" aria-selected="${aba === k}">${r} (${n[k]})</button>`)}</div>` : ''}
    ${itens.length ? h`<div class="lista-com">${itens.map(cartao)}</div>` : h`<div class="panel"><div class="empty">${vazio}</div></div>`}`);
}

async function ler(c) {
  const fundo = abrirJanela(h`
    <h3>${c.titulo}</h3>
    <p class="dica">${TIPOS[c.tipo] ?? 'Aviso'} · ${destino(c)}${c.publicado_em ? ` · publicado em ${dataHoraBR(c.publicado_em)}` : ''}${c.editado_em ? ` · editado em ${dataHoraBR(c.editado_em)}` : ''}${c.expira_em ? ` · visível até ${dataBR(c.expira_em)}` : ''}</p>
    <div class="corpo-comunicado">${c.corpo}</div>
    <div class="auth-error hidden" data-erro role="alert"></div>
    <div class="acoes">${c.anexo_path ? h`<button class="btn ghost" data-ver-anexo>Abrir anexo${c.anexo_nome ? ` (${c.anexo_nome})` : ''}</button>` : ''}
      <button class="btn" data-fechar>Fechar</button></div>`, { largo: true });
  fundo.querySelector('[data-fechar]').addEventListener('click', () => fundo.remove());
  fundo.addEventListener('keydown', (e) => { if (e.key === 'Escape') fundo.remove(); });
  fundo.querySelector('[data-fechar]').focus();
  fundo.querySelector('[data-ver-anexo]')?.addEventListener('click', async () => {
    const { data, error } = await db.storage.from('comunicados').createSignedUrl(c.anexo_path, 60);
    if (error) { const e = fundo.querySelector('[data-erro]'); e.textContent = mensagemErro(error); e.classList.remove('hidden'); return; }
    window.open(data.signedUrl, '_blank', 'noopener');
  });
  if (c.status === 'publicado' && !lidos.has(c.id)) {
    try {
      if (await rpc('marcar_comunicado_lido', { p_id: c.id })) { lidos.add(c.id); desenhar(); }
    } catch { /* não impede a leitura */ }
  }
}

export async function abrir(el) {
  raiz = el; aba = 'publicado';
  await carregar(); desenhar();
  on(el, 'click', '[data-aba]', (_, b) => { aba = b.dataset.aba; desenhar(); });
  on(el, 'click', '[data-acao]', async (_, b) => {
    const a = b.dataset.acao, c = lista.find((x) => x.id === b.dataset.id);
    try {
      if (a === 'novo') abrirEditor({ est, aoSalvar: atualizar });
      else if (a === 'abrir' && c) await ler(c);
      else if (a === 'editar' && c) abrirEditor({ comunicado: c, est, aoSalvar: atualizar });
      else if (a === 'leituras' && c) await abrirLeituras(c, est);
      else if (a === 'publicar' && c) {
        if (!(await confirmar('Publicar comunicado?', `${c.torre_id ? 'Os moradores de ' + nomeTorre(c.torre_id) : 'Todos os moradores'} passam a ver "${c.titulo}".`, { rotulo: 'Publicar' }))) return;
        await rpc('publicar_comunicado', { p_id: c.id });
        aviso('Comunicado publicado.', 'ok'); aba = 'publicado'; await atualizar();
      } else if (a === 'arquivar' && c) {
        if (!(await confirmar('Arquivar comunicado?', `"${c.titulo}" deixa de aparecer para os moradores. Ele continua guardado e pode ser publicado de novo.`, { rotulo: 'Arquivar', perigo: true }))) return;
        await rpc('arquivar_comunicado', { p_id: c.id });
        aviso('Comunicado arquivado.', 'ok'); await atualizar();
      }
    } catch (e) { aviso(mensagemErro(e), 'erro'); }
  });
}
