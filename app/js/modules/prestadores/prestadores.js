import { h, render, on, raw } from '../../lib/html.js';
import { rpc } from '../../lib/supabase.js';
import { estado, papelAtual } from '../../lib/estado.js';
import { aviso, confirmar, pedirTexto, abrirJanela, janelaForm, mensagemErro } from '../../lib/ui.js';
import { dataBR } from '../../lib/format.js';
import { formatarTelefone, linkTel, linkWhats, validarIndicacao, validarComentario, sugestoesServico, buscar, filtrarAba, contar,
  rotuloRecomendacoes, quemIndicou, MAX_NOME, MAX_SERVICO, MAX_OBS, MAX_COMENTARIO, MAX_PENDENTES } from './calculos.js';

let lista = [], aba = 'publicado', texto = '', servico = '', raiz = null;
const cid = () => estado.condominioId;
const sindico = () => ['sindico', 'superadmin'].includes(papelAtual());

async function carregar() { lista = await rpc('listar_prestadores', { p_condominio_id: cid() }); }
async function atualizar() { await carregar(); desenhar(); }

const rotuloStatus = { pendente: 'Aguardando aprovação', recusado: 'Recusado', removido: 'Removido' };

function cartao(p) {
  const tel = formatarTelefone(p.telefone);
  const n = p.recomendacoes.length;
  const acoes = [];
  if (p.status === 'publicado') {
    if (!p.meu) acoes.push(p.minha_recomendacao
      ? h`<button class="icon-btn" data-acao="retirar" data-id="${p.id}">Retirar minha recomendação</button>`
      : h`<button class="btn" data-acao="recomendar" data-id="${p.id}">Recomendo</button>`);
    if (sindico()) acoes.push(h`<button class="icon-btn" data-acao="editar" data-id="${p.id}">Editar</button><button class="icon-btn" data-acao="remover" data-id="${p.id}">Remover</button>`);
  } else if (p.status === 'pendente') {
    if (sindico()) acoes.push(h`<button class="btn" data-acao="aprovar" data-id="${p.id}">Aprovar</button><button class="icon-btn" data-acao="recusar" data-id="${p.id}">Recusar</button>`);
    if (sindico() || p.meu) acoes.push(h`<button class="icon-btn" data-acao="editar" data-id="${p.id}">Editar</button>`);
  } else if (p.status === 'recusado') {
    if (p.meu) acoes.push(h`<button class="icon-btn" data-acao="editar" data-id="${p.id}">Editar e enviar de novo</button>`);
    if (sindico()) acoes.push(h`<button class="icon-btn" data-acao="aprovar" data-id="${p.id}">Aprovar mesmo assim</button>`);
  }
  return h`<article class="cartao-prest">
    <div class="tags"><span class="tag">${p.servico}</span>${rotuloStatus[p.status] ? h`<span class="tag tag-aviso">${rotuloStatus[p.status]}</span>` : ''}</div>
    <strong class="cartao-titulo">${p.nome}</strong>
    <div class="contato"><span>${tel}</span>
      <a class="icon-btn" href="${linkTel(p.telefone)}">Ligar</a>
      <a class="icon-btn" href="${linkWhats(p.telefone)}" target="_blank" rel="noopener noreferrer">WhatsApp</a></div>
    ${p.observacao ? h`<p class="obs-prest">${p.observacao}</p>` : ''}
    ${p.motivo ? h`<p class="obs-prest"><strong>${p.status === 'recusado' ? 'Motivo da recusa' : 'Motivo'}:</strong> ${p.motivo}</p>` : ''}
    <span class="dica">Indicado por ${quemIndicou(p.indicador)} · ${dataBR(p.indicado_em)}</span>
    ${p.status === 'publicado' ? h`<button class="link-recs" data-acao="ver" data-id="${p.id}">${rotuloRecomendacoes(n)}</button>` : ''}
    ${acoes.length ? h`<div class="linha-acoes">${acoes}</div>` : ''}
  </article>`;
}

function desenharLista() {
  const alvo = raiz.querySelector('#lista-prest');
  const base = filtrarAba(lista, aba);
  const itens = buscar(base, texto, servico);
  const vazio = ({ publicado: 'Nenhum prestador indicado ainda. Seja o primeiro a indicar!', pendente: 'Nenhuma indicação aguardando aprovação.',
    encerrados: 'Nenhuma indicação recusada ou removida.', minhas: 'Você não tem indicações em andamento.' })[aba];
  render(alvo, itens.length ? h`<div class="lista-prest">${itens.map(cartao)}</div>`
    : h`<div class="panel"><div class="empty">${base.length ? 'Nada encontrado com esse filtro.' : vazio}</div></div>`);
}

function desenhar() {
  const n = contar(lista);
  const abas = sindico()
    ? [['publicado', `Publicados (${n.publicado})`], ['pendente', `Aguardando aprovação (${n.pendente})`], ['encerrados', `Recusados e removidos (${n.encerrados})`]]
    : [['publicado', `Publicados (${n.publicado})`], ['minhas', `Minhas indicações (${n.minhas})`]];
  if (!abas.some(([k]) => k === aba)) aba = 'publicado';
  const tipos = sugestoesServico(filtrarAba(lista, 'publicado'));
  render(raiz, h`
    <div class="page-head"><div><h2>Prestadores recomendados</h2>
      <p>Profissionais indicados por moradores, como marceneiro, pedreiro e diarista.</p></div>
      <button class="btn" data-acao="indicar">Indicar prestador</button></div>
    <p class="aviso-lgpd">As indicações são opinião de moradores, não do condomínio. O nome e a unidade de quem indica ou recomenda aparecem junto, e os telefones só ficam visíveis para quem mora ou trabalha aqui.</p>
    <div class="tabs-mini" role="tablist">${abas.map(([k, r]) =>
      h`<button role="tab" data-aba="${k}" class="${aba === k ? 'active' : ''}" aria-selected="${aba === k}">${r}</button>`)}</div>
    <div class="barra-filtro">
      <input id="p-busca" type="search" placeholder="Buscar por nome ou serviço" value="${texto}" aria-label="Buscar prestador" autocomplete="off">
      <select id="p-servico" aria-label="Tipo de serviço"><option value="">Todos os serviços</option>
        ${tipos.map((t) => h`<option value="${t}" ${t === servico ? raw('selected') : ''}>${t}</option>`)}</select></div>
    <div id="lista-prest"></div>`);
  desenharLista();
}

// ---- indicar / editar
function formIndicacao(p = null) {
  const tipos = sugestoesServico(lista);
  janelaForm({
    titulo: p ? 'Editar indicação' : 'Indicar prestador', rotulo: p ? 'Salvar' : 'Enviar indicação', largo: true,
    intro: sindico() ? 'Como síndico, a sua indicação já entra publicada.'
      : `A indicação aparece para os moradores depois que o síndico aprovar (até ${MAX_PENDENTES} aguardando ao mesmo tempo). Seu nome e sua unidade aparecem junto.`,
    corpo: h`
      <div class="field"><label for="i-nome">Nome do profissional</label><input id="i-nome" name="nome" maxlength="${MAX_NOME}" value="${p?.nome ?? ''}" required autocomplete="off"></div>
      <div class="field"><label for="i-servico">Tipo de serviço</label><input id="i-servico" name="servico" maxlength="${MAX_SERVICO}" list="i-tipos" value="${p?.servico ?? ''}" required autocomplete="off" placeholder="marceneiro, pedreiro, diarista…">
        <datalist id="i-tipos">${tipos.map((t) => h`<option value="${t}"></option>`)}</datalist></div>
      <div class="field"><label for="i-tel">Telefone ou WhatsApp (com DDD)</label><input id="i-tel" name="telefone" type="tel" inputmode="tel" value="${p ? formatarTelefone(p.telefone) : ''}" required autocomplete="off"></div>
      <div class="field"><label for="i-obs">Observação (opcional, até ${MAX_OBS} caracteres)</label><textarea id="i-obs" name="observacao" rows="3" maxlength="${MAX_OBS}">${p?.observacao ?? ''}</textarea></div>`,
    aoEnviar: async (f) => {
      const erro = validarIndicacao(f); if (erro) throw new Error(erro);
      const dados = { nome: f.nome.trim(), servico: f.servico.trim(), telefone: f.telefone, observacao: (f.observacao ?? '').trim() };
      if (p) {
        await rpc('editar_prestador', { p_id: p.id, p_dados: dados });
        aviso('Alterações salvas.', 'ok'); await atualizar(); return;
      }
      const r = await rpc('indicar_prestador', { p_condominio_id: cid(), p_dados: dados });
      if (r.duplicado) { Promise.resolve().then(() => oferecerRecomendar(r.duplicado)); return; }
      aviso(sindico() ? 'Prestador publicado.' : 'Indicação enviada. O síndico vai avaliar.', 'ok');
      aba = sindico() ? 'publicado' : 'minhas'; await atualizar();
    },
  });
}

async function oferecerRecomendar(id) {
  await atualizar();
  const existente = lista.find((x) => x.id === id);
  if (!existente) return;
  const quer = await confirmar('Este prestador já está na lista',
    `${existente.nome} (${existente.servico}) já foi indicado com este telefone. Em vez de repetir, você pode recomendá-lo.`, { rotulo: 'Recomendar' });
  if (quer && !existente.meu && !existente.minha_recomendacao) formRecomendar(existente);
}

function formRecomendar(p) {
  janelaForm({
    titulo: `Recomendar ${p.nome}`, rotulo: 'Recomendo',
    intro: 'Seu nome e sua unidade aparecem junto da recomendação.',
    corpo: h`<div class="field"><label for="r-com">Comentário (opcional, até ${MAX_COMENTARIO} caracteres)</label>
      <textarea id="r-com" name="comentario" rows="3" maxlength="${MAX_COMENTARIO}"></textarea></div>`,
    aoEnviar: async (f) => {
      const erro = validarComentario(f.comentario); if (erro) throw new Error(erro);
      await rpc('recomendar_prestador', { p_id: p.id, p_comentario: (f.comentario ?? '').trim() || null });
      aviso('Obrigado pela recomendação.', 'ok'); await atualizar();
    },
  });
}

// ---- quem recomenda
function verRecomendacoes(p) {
  const fundo = abrirJanela(h`
    <h3>${p.nome}</h3><p class="dica">${rotuloRecomendacoes(p.recomendacoes.length)}</p>
    ${p.recomendacoes.length ? h`<ul class="lista-simples">${p.recomendacoes.map((r) => h`<li class="rec-item">
      <div><strong>${r.nome}</strong> <span class="dica">${r.unidade}</span>${r.comentario ? h`<p class="obs-prest">${r.comentario}</p>` : ''}</div>
      ${sindico() && r.comentario ? h`<button class="icon-btn" data-limpar="${r.user_id}">Remover comentário</button>` : ''}</li>`)}</ul>` : ''}
    <div class="acoes"><button class="btn ghost" data-fechar>Fechar</button></div>`, { largo: true });
  fundo.querySelector('[data-fechar]').addEventListener('click', () => fundo.remove());
  fundo.addEventListener('keydown', (e) => { if (e.key === 'Escape') fundo.remove(); });
  on(fundo, 'click', '[data-limpar]', async (_, b) => {
    try {
      await rpc('limpar_comentario_prestador', { p_id: p.id, p_user_id: b.dataset.limpar });
      fundo.remove(); aviso('Comentário removido.', 'ok'); await atualizar();
    } catch (e) { aviso(mensagemErro(e), 'erro'); }
  });
}

export async function abrir(el) {
  raiz = el; aba = 'publicado'; texto = ''; servico = '';
  await carregar(); desenhar();
  on(el, 'input', '#p-busca', (_, i) => { texto = i.value; desenharLista(); });
  on(el, 'change', '#p-servico', (_, s) => { servico = s.value; desenharLista(); });
  on(el, 'click', '[data-aba]', (_, b) => { aba = b.dataset.aba; desenhar(); });
  on(el, 'click', '[data-acao]', async (_, b) => {
    const a = b.dataset.acao, p = lista.find((x) => x.id === b.dataset.id);
    try {
      if (a === 'indicar') formIndicacao();
      else if (a === 'editar' && p) formIndicacao(p);
      else if (a === 'recomendar' && p) formRecomendar(p);
      else if (a === 'ver' && p) verRecomendacoes(p);
      else if (a === 'retirar' && p) {
        if (!(await confirmar('Retirar recomendação?', `Você deixa de constar entre quem recomenda ${p.nome}.`, { rotulo: 'Retirar' }))) return;
        await rpc('retirar_recomendacao', { p_id: p.id }); aviso('Recomendação retirada.', 'ok'); await atualizar();
      } else if (a === 'aprovar' && p) {
        await rpc('decidir_prestador', { p_id: p.id, p_acao: 'aprovar', p_motivo: null }); aviso('Prestador publicado.', 'ok'); await atualizar();
      } else if (a === 'recusar' && p) {
        const m = await pedirTexto('Recusar indicação', `Escreva o motivo. Quem indicou ${p.nome} vai ler.`, { rotulo: 'Recusar', minimo: 3 });
        if (m === null) return;
        await rpc('decidir_prestador', { p_id: p.id, p_acao: 'recusar', p_motivo: m }); aviso('Indicação recusada.', 'ok'); await atualizar();
      } else if (a === 'remover' && p) {
        const m = await pedirTexto('Remover da lista', `${p.nome} deixa de aparecer para os moradores. Se quiser, registre o motivo (fica só na auditoria e para o síndico).`, { rotulo: 'Remover' });
        if (m === null) return;
        await rpc('decidir_prestador', { p_id: p.id, p_acao: 'remover', p_motivo: m || null }); aviso('Prestador removido.', 'ok'); await atualizar();
      }
    } catch (e) { aviso(mensagemErro(e), 'erro'); }
  });
}
