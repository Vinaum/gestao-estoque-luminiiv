import { h, render } from '../../lib/html.js';
import { db } from '../../lib/supabase.js';
import { estado, condominioAtual } from '../../lib/estado.js';
import { dataBR } from '../../lib/format.js';
import { aviso, mensagemErro } from '../../lib/ui.js';
import { TIPOS, resumo, paraInicio } from '../comunicados/calculos.js';

// Início do morador: o que há de novo e atalhos. Só leitura.
export async function abrir(el) {
  const cabeca = h`<div class="page-head"><div><h2>Olá, ${estado.perfil?.nome || 'morador(a)'}</h2><p>${condominioAtual()?.nome ?? ''}</p></div></div>`;
  render(el, h`${cabeca}<div class="panel"><p class="dica">Carregando…</p></div>`);
  let r;
  try {
    const cid = estado.condominioId;
    const [c, l] = await Promise.all([
      db.from('comunicados').select('id,titulo,corpo,tipo,fixado,status,publicado_em,expira_em,criado_em').eq('condominio_id', cid),
      db.from('comunicado_leituras').select('comunicado_id').eq('condominio_id', cid).eq('user_id', estado.perfil.id),
    ]);
    if (c.error || l.error) throw new Error((c.error || l.error).message);
    r = paraInicio(c.data, new Set(l.data.map((x) => x.comunicado_id)));
  } catch (e) {
    aviso(mensagemErro(e), 'erro');
    render(el, h`${cabeca}<div class="panel"><div class="empty">Não foi possível carregar agora. Tente de novo em instantes.</div></div>`);
    return;
  }
  const { itens, novos, total, ehNovo } = r;
  render(el, h`${cabeca}
    <div class="panel"><h3>Comunicados ${novos ? h`<span class="tag tag-novo" data-novos>${novos} ${novos === 1 ? 'novo' : 'novos'}</span>` : ''}</h3>
      ${itens.length ? h`<div class="lista-com">${itens.map((c) => h`<a class="cartao-com ${ehNovo(c) ? 'novo' : ''}" href="#/comunicados" data-inicio-com>
          <span class="tags"><span class="tag">${TIPOS[c.tipo] ?? 'Aviso'}</span>${c.fixado ? h`<span class="tag">Fixado</span>` : ''}${ehNovo(c) ? h`<span class="tag tag-novo">Novo</span>` : ''}</span>
          <strong class="cartao-titulo">${c.titulo}</strong>
          <span class="dica">Publicado em ${dataBR(c.publicado_em)}</span>
          <span class="cartao-resumo">${resumo(c.corpo, 120)}</span></a>`)}</div>
        <p><a class="btn ghost" href="#/comunicados">${total > itens.length ? `Ver todos os comunicados (${total})` : 'Abrir comunicados'}</a></p>`
        : h`<div class="empty">Nenhum comunicado no momento.</div>`}</div>
    <div class="panel"><h3>Prestadores</h3>
      <p>Procurando marceneiro, pedreiro, diarista…? Veja quem os vizinhos indicam e indique também quem já te atendeu bem.</p>
      <p><a class="btn ghost" href="#/prestadores">Ver prestadores</a></p></div>`);
}
