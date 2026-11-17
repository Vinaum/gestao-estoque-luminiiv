import { h, raw } from '../../lib/html.js';
import { db, rpc } from '../../lib/supabase.js';
import { estado } from '../../lib/estado.js';
import { aviso, abrirJanela, mensagemErro } from '../../lib/ui.js';
import { TIPOS, MAX_TITULO, MAX_TEXTO, validarDados, validarArquivo, nomeArquivo, expiraISO, dataParaCampo } from './calculos.js';

// Editor de comunicado (equipe). Novo, rascunho ou publicado. Arquivado não se edita: publica-se de novo.
export function abrirEditor({ comunicado = null, est, aoSalvar }) {
  const c = comunicado;
  const publicado = c?.status === 'publicado';
  let idSalvo = c?.id ?? null;   // se algo falhar depois de salvar, o reenvio atualiza o mesmo comunicado
  const torres = est.torres.filter((t) => t.ativo || t.id === c?.torre_id);

  const fundo = abrirJanela(h`
    <h3>${c ? 'Editar comunicado' : 'Novo comunicado'}</h3>
    <form novalidate>
      <div class="field"><label for="co-titulo">Título</label><input id="co-titulo" name="titulo" maxlength="${MAX_TITULO}" value="${c?.titulo ?? ''}" required autocomplete="off"></div>
      <div class="linha-campos">
        <div class="field"><label for="co-tipo">Tipo</label><select id="co-tipo" name="tipo">
          ${Object.entries(TIPOS).map(([k, r]) => h`<option value="${k}" ${k === (c?.tipo ?? 'aviso') ? raw('selected') : ''}>${r}</option>`)}</select></div>
        <div class="field"><label for="co-torre">Para quem</label><select id="co-torre" name="torre">
          <option value="">Todo o condomínio</option>
          ${torres.map((t) => h`<option value="${t.id}" ${t.id === c?.torre_id ? raw('selected') : ''}>${t.nome}</option>`)}</select></div>
      </div>
      <div class="field"><label for="co-corpo">Texto</label><textarea id="co-corpo" name="corpo" rows="9" maxlength="${MAX_TEXTO}" required>${c?.corpo ?? ''}</textarea>
        <span class="dica">Texto simples, até ${MAX_TEXTO} caracteres. Links digitados não ficam clicáveis.</span></div>
      <div class="linha-campos">
        <div class="field"><label for="co-expira">Deixa de aparecer em (opcional)</label><input id="co-expira" name="expira" type="date" value="${dataParaCampo(c?.expira_em)}"></div>
        <div class="field"><label><input type="checkbox" name="fixado" value="1" ${c?.fixado ? raw('checked') : ''}> Fixar no topo da lista</label></div>
      </div>
      <div class="field"><label for="co-arq">Anexo (opcional: PDF, JPG ou PNG, até 5 MB)</label>
        <input id="co-arq" name="arquivo" type="file" accept="application/pdf,image/jpeg,image/png">
        ${c?.anexo_path ? h`<span class="dica">Anexo atual: ${c.anexo_nome || 'arquivo'}. Enviar outro substitui.</span>
          <label><input type="checkbox" name="remover" value="1"> Remover o anexo atual</label>` : ''}</div>
      <div class="auth-error hidden" data-erro role="alert"></div>
      <div class="acoes"><button type="button" class="btn ghost" data-fechar>Cancelar</button>
        ${publicado ? h`<button type="button" class="btn" data-a="salvar">Salvar alterações</button>`
          : h`<button type="button" class="btn ghost" data-a="rascunho">Salvar rascunho</button><button type="button" class="btn" data-a="publicar">Publicar</button>`}
      </div>
    </form>`, { largo: true });

  const form = fundo.querySelector('form'), caixaErro = fundo.querySelector('[data-erro]');
  const botoes = [...fundo.querySelectorAll('[data-a]')];
  const mostrarErro = (e) => { caixaErro.textContent = typeof e === 'string' ? e : mensagemErro(e); caixaErro.classList.remove('hidden'); };
  const apagarArquivo = async (caminho) => { if (caminho) { try { await db.storage.from('comunicados').remove([caminho]); } catch { /* o arquivo antigo fica órfão, sem prejuízo */ } } };

  async function executar(acao) {
    caixaErro.classList.add('hidden'); botoes.forEach((b) => { b.disabled = true; });
    try {
      const f = new FormData(form);
      const titulo = String(f.get('titulo') ?? '').trim(), corpo = String(f.get('corpo') ?? '').trim();
      const invalido = validarDados({ titulo, corpo }); if (invalido) throw new Error(invalido);
      const exp = expiraISO(String(f.get('expira') ?? '')); if (exp.erro) throw new Error(exp.erro);
      const arq = f.get('arquivo'); const temArq = arq && arq.size > 0;
      const v = temArq ? validarArquivo(arq) : null; if (v?.erro) throw new Error(v.erro);

      idSalvo = await rpc('salvar_comunicado', {
        p_condominio_id: estado.condominioId, p_id: idSalvo,
        p_dados: { titulo, corpo, tipo: f.get('tipo'), torre_id: f.get('torre') || null, fixado: f.get('fixado') === '1', expira_em: exp.iso },
      });
      if (temArq) {
        const caminho = `${estado.condominioId}/${idSalvo}/${crypto.randomUUID()}.${v.ext}`;
        const { error } = await db.storage.from('comunicados').upload(caminho, arq, { contentType: arq.type, upsert: false });
        if (error) throw new Error('O comunicado foi salvo, mas não foi possível enviar o anexo: ' + error.message);
        await rpc('definir_anexo_comunicado', { p_id: idSalvo, p_path: caminho, p_nome: nomeArquivo(arq.name) });
        await apagarArquivo(c?.anexo_path);
      } else if (f.get('remover') === '1' && c?.anexo_path) {
        await rpc('definir_anexo_comunicado', { p_id: idSalvo, p_path: null, p_nome: null });
        await apagarArquivo(c.anexo_path);
      }
      if (acao === 'publicar') await rpc('publicar_comunicado', { p_id: idSalvo });
      fundo.remove();
      aviso(acao === 'publicar' ? 'Comunicado publicado.' : acao === 'rascunho' ? 'Rascunho salvo.' : 'Alterações salvas.', 'ok');
      await aoSalvar?.();
    } catch (e) { mostrarErro(e); botoes.forEach((b) => { b.disabled = false; }); }
  }

  fundo.querySelector('[data-fechar]').addEventListener('click', () => fundo.remove());
  fundo.addEventListener('keydown', (e) => { if (e.key === 'Escape') fundo.remove(); });
  form.addEventListener('submit', (e) => e.preventDefault());
  botoes.forEach((b) => b.addEventListener('click', () => executar(b.dataset.a)));
  form.querySelector('input').focus();
  return fundo;
}
