import { h, render } from '../lib/html.js';
export function abrir(el, rota) {
  render(el, h`<div class="page-head"><div><h2>${rota.titulo}</h2></div></div>
    <div class="panel stub"><b>Em construção</b>Esta tela chega nas próximas etapas da Fase 4.</div>`);
}
