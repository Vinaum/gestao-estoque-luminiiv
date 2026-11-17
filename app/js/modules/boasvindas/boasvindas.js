import { h, render } from '../../lib/html.js';
import { estado, condominioAtual } from '../../lib/estado.js';

export function abrir(el) {
  render(el, h`
    <div class="page-head"><div><h2>Olá, ${estado.perfil?.nome || 'morador(a)'}</h2>
      <p>${condominioAtual()?.nome ?? ''}</p></div></div>
    <div class="panel"><h3>Bem-vindo(a)</h3>
      <p>Os avisos do condomínio estão em “Comunicados”, no menu. Em breve: indicação de prestadores de serviço e outros serviços do condomínio.</p></div>`);
}
