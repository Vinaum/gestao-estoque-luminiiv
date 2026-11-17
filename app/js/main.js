import { h, raw, render } from './lib/html.js';
import { iniciarCliente, db, comTempo } from './lib/supabase.js';
import { estado, definirContexto, limparContexto, escolherCondominio, papelAtual, ehSuperadmin, condominioAtual } from './lib/estado.js';
import { PAPEL_ROTULO } from './lib/format.js';
import { aviso, mensagemErro } from './lib/ui.js';
import { telaAuth } from './modules/auth/auth.js';
import { ROTAS, PADRAO, rotasDoPapel } from './rotas.js';

const raiz = document.getElementById('root');
let modoAuth = 'login';
let msgAuth = null;
let recuperando = false;
let usuarioCarregado = null;

function falhaFatal(msg) {
  render(raiz, h`<div class="auth-wrap"><div class="auth-card"><h1>Não foi possível iniciar</h1>
    <p class="sub">Veja o motivo abaixo:</p><div class="auth-error">${msg}</div>
    <button class="btn" id="tentar">Tentar de novo</button></div></div>`);
  raiz.querySelector('#tentar').addEventListener('click', () => location.reload());
}
window.addEventListener('error', (e) => falhaFatal(e.message));
window.addEventListener('unhandledrejection', (e) => falhaFatal(mensagemErro(e.reason)));

/* ---------- Dados de contexto (quem sou, de quais condomínios participo) ---------- */
async function carregarContexto() {
  const uid = estado.sessao.user.id;
  const [perfil, conds, vinc] = await Promise.all([
    db.from('profiles').select('id, nome, superadmin').eq('id', uid).single(),
    db.from('condominios').select('id, nome, ativo').order('nome'),
    db.from('membros').select('condominio_id, papel, ativo').eq('user_id', uid).eq('ativo', true),
  ]);
  const falha = perfil.error || conds.error || vinc.error;
  if (falha) throw new Error('Não foi possível ler o seu cadastro: ' + falha.message);
  const vinculos = Object.fromEntries(vinc.data.map((v) => [v.condominio_id, v.papel]));
  definirContexto({ perfil: perfil.data, condominios: conds.data.filter((c) => c.ativo), vinculos });
  usuarioCarregado = uid;
}

/* ---------- Casca (menu + área da página) ---------- */
function rotaAtual() {
  const m = location.hash.match(/^#\/([\w-]+)/);
  return m ? m[1] : null;
}

function desenharCasca() {
  const papel = papelAtual();
  const rotas = rotasDoPapel(papel);
  const atual = rotaAtual();
  const grupos = [];
  rotas.forEach((r) => { let g = grupos.find((x) => x.nome === r.grupo); if (!g) grupos.push(g = { nome: r.grupo, itens: [] }); g.itens.push(r); });

  render(raiz, h`
    <div class="app">
      <nav class="rail" aria-label="Menu principal">
        <h1 class="rail-title">Gestão do condomínio</h1>
        <div class="rail-who"><b>${estado.perfil?.nome || estado.sessao.user.email}</b><br>${PAPEL_ROTULO[papel] ?? ''}</div>
        ${estado.condominios.length > 1 || ehSuperadmin() ? h`
          <label class="rail-sub" for="sel-cond">Condomínio</label>
          <select id="sel-cond">${estado.condominios.map((c) => h`<option value="${c.id}" ${c.id === estado.condominioId ? 'selected' : ''}>${c.nome}</option>`)}</select>`
          : h`<div class="rail-sub">${condominioAtual()?.nome ?? ''}</div>`}
        ${grupos.map((g) => h`${g.nome ? h`<div class="rail-sec">${g.nome}</div>` : ''}
          ${g.itens.map((r) => h`<a class="nav ${r.id === atual ? 'active' : ''}" href="#/${r.id}" ${r.id === atual ? raw('aria-current="page"') : ''}><span class="dot"></span>${r.titulo}</a>`)}`)}
        <div class="rail-foot"><button id="sair">Sair</button></div>
      </nav>
      <main class="main" id="pagina" tabindex="-1"></main>
    </div>`);
  raiz.querySelector('#sair').addEventListener('click', () => db.auth.signOut());
  raiz.querySelector('#sel-cond')?.addEventListener('change', (e) => {
    escolherCondominio(e.target.value);
    renderApp();
  });
}

async function abrirPagina() {
  const papel = papelAtual();
  const permitidas = rotasDoPapel(papel);
  let id = rotaAtual();
  let rota = permitidas.find((r) => r.id === id);
  if (!rota) {
    location.replace('#/' + (PADRAO[papel] ?? 'inicio'));
    return;
  }
  const el = document.getElementById('pagina');
  if (!el) return;
  el.innerHTML = '<div class="loading-note">Carregando…</div>';
  try {
    const mod = await import(rota.modulo || './modules/emconstrucao.js');
    // a rota pode ter mudado enquanto o módulo carregava
    if (rotaAtual() !== rota.id) return;
    await mod.abrir(el, rota);
  } catch (e) {
    el.innerHTML = '';
    render(el, h`<div class="panel"><h3>Não foi possível abrir esta tela</h3><div class="auth-error">${mensagemErro(e)}</div></div>`);
  }
}

function semVinculo() {
  render(raiz, h`<div class="auth-wrap"><div class="auth-card"><h1>Aguardando convite</h1>
    <p class="sub">Sua conta (${estado.sessao.user.email}) ainda não está vinculada a nenhum condomínio.
    Peça ao síndico para convidar este e-mail.</p><button class="btn" id="sair">Sair</button></div></div>`);
  raiz.querySelector('#sair').addEventListener('click', () => db.auth.signOut());
}

function renderApp() {
  if (!estado.condominioId || !papelAtual()) return semVinculo();
  desenharCasca();
  abrirPagina();
}

function renderAuth() {
  telaAuth(raiz, recuperando ? 'recovery' : modoAuth, msgAuth, {
    aoMudarModo: (modo, msg = null) => {
      if (modo === 'login') recuperando = false;
      modoAuth = modo; msgAuth = msg; renderAuth();
    },
  });
}

async function entrar() {
  render(raiz, h`<div class="loading-note">Entrando…</div>`);
  try {
    await comTempo(carregarContexto(), 15000, 'carregar o seu cadastro');
    if (!location.hash.startsWith('#/')) location.replace('#/' + (PADRAO[papelAtual()] ?? 'inicio'));
    renderApp();
  } catch (e) { falhaFatal(mensagemErro(e)); }
}

/* ---------- Início ---------- */
async function iniciar() {
  try { iniciarCliente(); } catch (e) { return falhaFatal(e.message); }
  const { data, error } = await db.auth.getSession();
  if (error) return falhaFatal('Erro ao conectar ao Supabase: ' + error.message);
  estado.sessao = data.session;
  if (/type=recovery/.test(location.hash)) recuperando = true;

  db.auth.onAuthStateChange((evento, sessao) => {
    estado.sessao = sessao;
    if (evento === 'PASSWORD_RECOVERY') { recuperando = true; renderAuth(); return; }
    if (!sessao) { limparContexto(); usuarioCarregado = null; renderAuth(); return; }
    // renovações de sessão não recarregam a tela; só um login de outra pessoa
    if (sessao.user.id !== usuarioCarregado && !recuperando) setTimeout(entrar, 0);
  });

  if (recuperando) renderAuth();
  else if (estado.sessao) await entrar();
  else renderAuth();
}

window.addEventListener('hashchange', () => { if (estado.sessao && usuarioCarregado) renderApp(); });
iniciar();
