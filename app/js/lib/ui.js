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
