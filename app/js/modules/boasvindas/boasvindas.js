import { h, render } from '../../lib/html.js';
import { estado, condominioAtual } from '../../lib/estado.js';

export function abrir(el) {
  render(el, h`
    <div class="page-head"><div><h2>Olá, ${estado.perfil?.nome || 'morador(a)'}</h2>
      <p>${condominioAtual()?.nome ?? ''}</p></div></div>
    <div class="panel"><h3>Bem-vindo(a)</h3>
      <p>Os avisos do condomínio estão em “Comunicados” e as indicações de profissionais (marceneiro, pedreiro, diarista…) em “Prestadores”, no menu.</p></div>`);
}
