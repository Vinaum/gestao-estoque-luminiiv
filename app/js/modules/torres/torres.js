import { h, render, on } from '../../lib/html.js';
import { rpc } from '../../lib/supabase.js';
import { estado, condominioAtual } from '../../lib/estado.js';
import { aviso, confirmar, janelaForm, mensagemErro } from '../../lib/ui.js';
import { carregarEstrutura } from '../../lib/unidades.js';

let est = { torres: [], aptos: [] }, raiz = null;
const cid = () => estado.condominioId;
const inteiro = (v) => (/^\d+$/.test(String(v ?? '').trim()) ? Number(String(v).trim()) : NaN);

async function carregar() { est = await carregarEstrutura(cid()); }
async function atualizar() { await carregar(); desenhar(); }

function desenhar() {
  render(raiz, h`
    <div class="page-head"><div><h2>Torres e apartamentos</h2>
      <p>A estrutura de ${condominioAtual()?.nome ?? 'este condomínio'}. Com ela cada morador fica ligado ao seu apartamento.</p></div>
      <button class="btn" data-acao="nova-torre">Nova torre</button></div>
    ${est.torres.length ? '' : h`<div class="panel"><div class="empty">Nenhuma torre cadastrada ainda.</div>
      <div style="text-align:center"><button class="btn" data-acao="lote-torres">Criar torres em lote</button></div></div>`}
    ${est.torres.map((t) => {
      const ap = est.aptos.filter((a) => a.torre_id === t.id);
      const ativos = ap.filter((a) => a.ativo).length;
      return h`<div class="panel ${t.ativo ? '' : 'inativo'}">
        <div class="toolbar"><h3 style="margin:0">${t.nome} ${t.ativo ? '' : h`<span class="tag">desativada</span>`}
          <span class="dica">${ativos} apartamento(s)</span></h3>
          <div class="linha-acoes">
            <button class="icon-btn" data-acao="gerar" data-id="${t.id}">Gerar apartamentos</button>
            <button class="icon-btn" data-acao="add-apto" data-id="${t.id}">Adicionar um</button>
            <button class="icon-btn" data-acao="renomear" data-id="${t.id}">Renomear</button>
            <button class="icon-btn" data-acao="torre-ativo" data-id="${t.id}">${t.ativo ? 'Desativar' : 'Reativar'}</button>
          </div></div>
        ${ap.length ? h`<div class="chips-apto">${ap.map((a) => h`<button class="chip-apto ${a.ativo ? '' : 'inativo'}" data-acao="apto" data-id="${a.id}" title="${a.ativo ? 'Clique para desativar' : 'Desativado — clique para reativar'}">${a.numero}</button>`)}</div>`
          : h`<div class="empty">Sem apartamentos. Use "Gerar apartamentos".</div>`}
      </div>`;
    })}
    <p class="dica">Moradores ligados a um apartamento aparecem com a unidade nas indicações e comunicados. Não é possível apagar torre ou apartamento; só desativar, e apenas quando ninguém estiver vinculado.</p>`);
}

const achaTorre = (id) => est.torres.find((t) => t.id === id);

function novaTorre() {
  janelaForm({
    titulo: 'Nova torre', rotulo: 'Criar',
    corpo: h`<div class="field"><label for="t-nome">Nome</label><input id="t-nome" name="nome" maxlength="40" required autocomplete="off"></div>`,
    aoEnviar: async (f) => {
      await rpc('salvar_torre', { p_condominio_id: cid(), p_torre_id: null, p_nome: f.nome, p_ativo: true });
      aviso('Torre criada.', 'ok'); await atualizar();
    },
  });
}

function loteTorres() {
  janelaForm({
    titulo: 'Criar torres em lote', rotulo: 'Criar',
    intro: 'Cria "Torre 1", "Torre 2"… As que já existirem são mantidas.',
    corpo: h`
      <div class="field"><label for="l-q">Quantas torres?</label><input id="l-q" name="q" inputmode="numeric" value="5" required></div>
      <div class="field"><label for="l-p">Nome base</label><input id="l-p" name="prefixo" value="Torre" maxlength="30" required></div>`,
    aoEnviar: async (f) => {
      const q = inteiro(f.q);
      if (!(q >= 1 && q <= 20)) throw new Error('Informe de 1 a 20 torres.');
      const n = await rpc('criar_torres_lote', { p_condominio_id: cid(), p_quantidade: q, p_prefixo: f.prefixo });
      aviso(n ? `${n} torre(s) criada(s).` : 'Todas já existiam.', 'ok'); await atualizar();
    },
  });
}

function renomear(t) {
  janelaForm({
    titulo: `Renomear — ${t.nome}`, rotulo: 'Salvar',
    corpo: h`<div class="field"><label for="t-nome">Nome</label><input id="t-nome" name="nome" maxlength="40" value="${t.nome}" required></div>`,
    aoEnviar: async (f) => {
      await rpc('salvar_torre', { p_condominio_id: cid(), p_torre_id: t.id, p_nome: f.nome, p_ativo: t.ativo });
      aviso('Torre renomeada.', 'ok'); await atualizar();
    },
  });
}

function gerar(t) {
  janelaForm({
    titulo: `Gerar apartamentos — ${t.nome}`, rotulo: 'Gerar',
    intro: 'Numeração: andar × 10 + posição. Andares 0 a 4 com 4 por andar geram 01–04, 11–14, 21–24, 31–34 e 41–44. Os que já existem são ignorados.',
    corpo: h`
      <div class="field"><label for="g-i">Andar inicial (0 = térreo)</label><input id="g-i" name="ini" inputmode="numeric" value="0" required></div>
      <div class="field"><label for="g-f">Andar final</label><input id="g-f" name="fim" inputmode="numeric" value="4" required></div>
      <div class="field"><label for="g-n">Apartamentos por andar (1 a 9)</label><input id="g-n" name="por" inputmode="numeric" value="4" required></div>`,
    aoEnviar: async (f) => {
      const ini = inteiro(f.ini), fim = inteiro(f.fim), por = inteiro(f.por);
      if ([ini, fim, por].some(Number.isNaN)) throw new Error('Use apenas números inteiros.');
      if (fim < ini || fim > 30) throw new Error('Andares inválidos: o final não pode ser menor que o inicial, e vai até 30.');
      if (por < 1 || por > 9) throw new Error('Informe de 1 a 9 apartamentos por andar.');
      const n = await rpc('gerar_apartamentos', { p_torre_id: t.id, p_andar_inicial: ini, p_andar_final: fim, p_por_andar: por });
      aviso(n ? `${n} apartamento(s) criado(s) em ${t.nome}.` : 'Todos esses apartamentos já existiam.', 'ok'); await atualizar();
    },
  });
}

function adicionar(t) {
  janelaForm({
    titulo: `Adicionar apartamento — ${t.nome}`, rotulo: 'Adicionar',
    corpo: h`<div class="field"><label for="a-n">Número</label><input id="a-n" name="numero" maxlength="6" required autocomplete="off">
      <span class="dica">Até 6 letras ou números, sem espaços. Ex.: 51, 101, 3A.</span></div>`,
    aoEnviar: async (f) => {
      await rpc('salvar_apartamento', { p_torre_id: t.id, p_numero: f.numero.trim() });
      aviso('Apartamento adicionado.', 'ok'); await atualizar();
    },
  });
}

export async function abrir(el) {
  raiz = el;
  await carregar(); desenhar();
  on(el, 'click', '[data-acao]', async (_, b) => {
    try {
      const a = b.dataset.acao, t = achaTorre(b.dataset.id);
      if (a === 'nova-torre') novaTorre();
      else if (a === 'lote-torres') loteTorres();
      else if (a === 'renomear' && t) renomear(t);
      else if (a === 'gerar' && t) gerar(t);
      else if (a === 'add-apto' && t) adicionar(t);
      else if (a === 'torre-ativo' && t) {
        if (t.ativo && !(await confirmar('Desativar torre?', `${t.nome} deixa de aparecer nas escolhas de apartamento. Só é possível se ninguém estiver vinculado a ela.`, { rotulo: 'Desativar', perigo: true }))) return;
        await rpc('salvar_torre', { p_condominio_id: cid(), p_torre_id: t.id, p_nome: t.nome, p_ativo: !t.ativo });
        aviso(t.ativo ? 'Torre desativada.' : 'Torre reativada.', 'ok'); await atualizar();
      } else if (a === 'apto') {
        const ap = est.aptos.find((x) => x.id === b.dataset.id); if (!ap) return;
        const torre = achaTorre(ap.torre_id);
        if (ap.ativo && !(await confirmar('Desativar apartamento?', `${torre?.nome ?? ''} · Apto ${ap.numero} deixa de aparecer nas escolhas. Só é possível se ninguém estiver vinculado.`, { rotulo: 'Desativar', perigo: true }))) return;
        await rpc('mudar_apartamento_ativo', { p_apartamento_id: ap.id, p_ativo: !ap.ativo });
        aviso(ap.ativo ? 'Apartamento desativado.' : 'Apartamento reativado.', 'ok'); await atualizar();
      }
    } catch (e) { aviso(mensagemErro(e), 'erro'); }
  });
}
