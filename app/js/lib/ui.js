import { h, render, on } from './html.js';

export function aviso(texto, tipo = '') {
  let caixa = document.getElementById('toasts');
  if (!caixa) { caixa = document.createElement('div'); caixa.id = 'toasts'; caixa.setAttribute('role', 'status'); document.body.appendChild(caixa); }
  const el = document.createElement('div');
  el.className = 'toast ' + tipo;
  el.textContent = texto;
  caixa.appendChild(el);
  setTimeout(() => el.remove(), tipo === 'erro' ? 7000 : 4000);
}

function abrirJanela(conteudo) {
  const fundo = document.createElement('div');
  fundo.className = 'overlay';
  render(fundo, h`<div class="modal" role="dialog" aria-modal="true">${conteudo}</div>`);
  document.body.appendChild(fundo);
  return fundo;
}

// Pergunta sim/não. Devolve uma Promise<boolean>.
export function confirmar(titulo, texto, { rotulo = 'Confirmar', perigo = false } = {}) {
  return new Promise((resolver) => {
    const fundo = abrirJanela(h`<h3>${titulo}</h3><p>${texto}</p>
      <div class="acoes"><button class="btn ghost" data-r="0">Cancelar</button>
      <button class="btn ${perigo ? 'danger' : ''}" data-r="1">${rotulo}</button></div>`);
    const fechar = (v) => { fundo.remove(); resolver(v); };
    on(fundo, 'click', '[data-r]', (_, b) => fechar(b.dataset.r === '1'));
    fundo.querySelector('[data-r="1"]').focus();
    fundo.addEventListener('keydown', (e) => { if (e.key === 'Escape') fechar(false); });
  });
}

// Pede um texto (ex.: justificativa). Devolve a string ou null se cancelar.
export function pedirTexto(titulo, texto, { rotulo = 'Confirmar', minimo = 0 } = {}) {
  return new Promise((resolver) => {
    const fundo = abrirJanela(h`<h3>${titulo}</h3><p>${texto}</p>
      <div class="field"><textarea id="pt-campo" rows="3"></textarea></div>
      <div class="acoes"><button class="btn ghost" data-r="0">Cancelar</button>
      <button class="btn" data-r="1">${rotulo}</button></div>`);
    const campo = fundo.querySelector('#pt-campo');
    campo.focus();
    const fechar = (v) => { fundo.remove(); resolver(v); };
    on(fundo, 'click', '[data-r]', (_, b) => {
      if (b.dataset.r === '0') return fechar(null);
      const v = campo.value.trim();
      if (v.length < minimo) { aviso(`Escreva pelo menos ${minimo} caracteres.`, 'erro'); return; }
      fechar(v);
    });
    fundo.addEventListener('keydown', (e) => { if (e.key === 'Escape') fechar(null); });
  });
}

// Traduz erros do banco para frases que a pessoa entende.
export function mensagemErro(e) {
  const m = (e && e.message) || String(e);
  if (/row-level security|permission denied|Sem permiss/i.test(m)) return 'Você não tem permissão para esta ação.';
  if (/Failed to fetch|NetworkError|Tempo esgotado/i.test(m)) return 'Sem conexão com o servidor. Verifique a internet e tente de novo.';
  return m;
}

// Janela com formulário. `aoEnviar` recebe os campos como objeto; se lançar erro, ele aparece na janela.
export function janelaForm({ titulo, intro = '', corpo, rotulo = 'Salvar', aoEnviar }) {
  const fundo = abrirJanela(h`<h3>${titulo}</h3>${intro ? h`<p>${intro}</p>` : ''}
    <form novalidate>${corpo}
      <div class="auth-error hidden" data-erro role="alert"></div>
      <div class="acoes"><button type="button" class="btn ghost" data-fechar>Cancelar</button>
      <button class="btn" type="submit">${rotulo}</button></div></form>`);
  const form = fundo.querySelector('form');
  const caixaErro = fundo.querySelector('[data-erro]');
  const botao = form.querySelector('button[type=submit]');
  fundo.querySelector('[data-fechar]').addEventListener('click', () => fundo.remove());
  fundo.addEventListener('keydown', (e) => { if (e.key === 'Escape') fundo.remove(); });
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    botao.disabled = true; caixaErro.classList.add('hidden');
    try { await aoEnviar(Object.fromEntries(new FormData(form))); fundo.remove(); }
    catch (e) { caixaErro.textContent = mensagemErro(e); caixaErro.classList.remove('hidden'); botao.disabled = false; }
  });
  form.querySelector('input:not([type=hidden]),select,textarea')?.focus();
  return fundo;
}

// Janela só de leitura, com botão Fechar.
export function janelaInfo(titulo, corpo) {
  const fundo = abrirJanela(h`<h3>${titulo}</h3>${corpo}<div class="acoes"><button class="btn ghost" data-fechar>Fechar</button></div>`);
  fundo.querySelector('[data-fechar]').addEventListener('click', () => fundo.remove());
  fundo.addEventListener('keydown', (e) => { if (e.key === 'Escape') fundo.remove(); });
  fundo.querySelector('[data-fechar]').focus();
  return fundo;
}
