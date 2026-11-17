import { h } from '../../lib/html.js';
import { rpc } from '../../lib/supabase.js';
import { janelaInfo, aviso, mensagemErro } from '../../lib/ui.js';
import { rotuloApto } from '../../lib/unidades.js';

// Quem já abriu o comunicado e quem ainda falta (síndico e gestor).
export async function abrirLeituras(c, est) {
  let r;
  try { r = await rpc('leituras_comunicado', { p_id: c.id }); }
  catch (e) { aviso(mensagemErro(e), 'erro'); return; }
  const total = Number(r.total) || 0, lidos = Number(r.lidos) || 0;
  const pct = total ? Math.round((lidos / total) * 100) : 0;
  const pend = r.pendentes ?? [];
  janelaInfo('Quem leu', h`
    <p><strong>${c.titulo}</strong></p>
    <p>Lido por <strong data-lidos>${lidos}</strong> de <strong data-total>${total}</strong> pessoas (${pct}%).</p>
    <div class="progresso" role="img" aria-label="${pct}% leram"><div class="progresso-cheio" style="width:${pct}%"></div></div>
    ${pend.length ? h`<h4>Ainda não abriram (${total - lidos})</h4>
      <ul class="lista-simples">${pend.map((p) => h`<li>${p.nome} <span class="dica">${rotuloApto(p.apartamento_id, est) || 'sem apartamento'}</span></li>`)}</ul>
      ${total - lidos > pend.length ? h`<p class="dica">Mostrando as ${pend.length} primeiras.</p>` : ''}`
      : h`<p>Todos já abriram este comunicado.</p>`}`);
}
