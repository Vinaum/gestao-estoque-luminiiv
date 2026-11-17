// Montagem segura de HTML: tudo o que é interpolado é escapado, a menos que venha de raw().
// Uso:  render(el, h`<td>${item.nome}</td>`)
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Raw(String(s));

function valor(v) {
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(valor).join('');
  if (v === null || v === undefined || v === false || v === true) return '';
  return esc(v);
}

export function h(partes, ...vals) {
  let out = '';
  partes.forEach((p, i) => { out += p + (i < vals.length ? valor(vals[i]) : ''); });
  return new Raw(out);
}

export function render(el, conteudo) { el.innerHTML = conteudo instanceof Raw ? conteudo.s : esc(conteudo); }

// Escuta eventos por delegação: on(raiz, 'click', '[data-acao]', (ev, alvo) => ...)
export function on(raiz, tipo, seletor, fn) {
  raiz.addEventListener(tipo, (ev) => {
    const alvo = ev.target.closest(seletor);
    if (alvo && raiz.contains(alvo)) fn(ev, alvo);
  });
}
