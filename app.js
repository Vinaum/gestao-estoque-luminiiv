/* ======================================================================
   1) CONFIGURAÇÃO — troque pelos dados do seu projeto Supabase
   (Project Settings → API, no painel do Supabase)
   ====================================================================== */
const SUPABASE_URL = 'https://aiuwreyhnubprlapkxli.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_RDrhP1P10yNKXlYtd1wf4g_2skPg7c0';

// Escapa texto antes de colocá-lo em HTML (impede injeção de código por nomes, fornecedores etc.)
function esc(v){
  return String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

let db = null; // cliente do Supabase (criado no boot)

function showFatal(msg){
  const root = document.getElementById('root');
  root.innerHTML = '<div class="auth-wrap"><div class="auth-card"><h1>Não foi possível iniciar</h1><p class="sub">Veja o motivo abaixo:</p><div class="auth-error">'+esc(msg)+'</div></div></div>';
}
window.addEventListener('error', e => showFatal(e.message));
window.addEventListener('unhandledrejection', e => showFatal((e.reason && e.reason.message) || String(e.reason)));

const CATEGORIAS = ['Elétrica','Hidráulica','Limpeza','Jardinagem','Pintura','Segurança','Ferramentas','Outros'];
const UNIDADES = ['un','L','kg','m','cx','par','rolo'];
const PAPEL_LABEL = { superadmin:'Superadmin', sindico:'Síndico', gestor:'Gestor / zelador', morador:'Morador' };

let session = null;
let profile = null;
let state = { items: [], movements: [], settings: { dias_atencao:20, dias_critico:7, meses_media:6 }, profiles: [] };
let activeTab = 'dashboard';
let editingItemId = null;
let movFilter = 'todos';
let authMode = 'login'; // 'login' | 'signup' | 'forgot'
let recovering = false; // true quando a pessoa chegou pelo link de redefinição de senha
let authMsg = null;

function canWrite(){ return profile && ['superadmin','sindico','gestor'].includes(profile.papel); }
function isSuperadmin(){ return profile && profile.papel==='superadmin'; }
function isSindico(){ return profile && (profile.papel==='sindico' || profile.papel==='superadmin'); } // síndico ou superadmin

/* ---------------- boot ---------------- */
async function boot(){
  if(!window.supabase) return showFatal('A biblioteca do Supabase não carregou. Verifique a internet ou bloqueadores de anúncios/scripts.');
  if(SUPABASE_URL.includes('SEU-PROJETO') || SUPABASE_ANON_KEY.includes('SUA_CHAVE')) return showFatal('Configure SUPABASE_URL e SUPABASE_ANON_KEY no começo do script do index.html.');
  try{ new URL(SUPABASE_URL); }catch(e){ return showFatal('A SUPABASE_URL parece inválida. Ela deve ser como https://SEU-PROJECT-ID.supabase.co'); }
  db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data, error } = await db.auth.getSession();
  if(error) return showFatal('Erro ao conectar ao Supabase: '+error.message);
  session = data.session;
  if(/type=recovery/.test(window.location.hash)) recovering = true;
  db.auth.onAuthStateChange((event, s)=>{
    session = s;
    if(event==='PASSWORD_RECOVERY'){ recovering = true; renderRoot(); return; }
    if(!s){ profile=null; if(canalTempoReal){ db.removeChannel(canalTempoReal); canalTempoReal=null; } renderRoot(); }
  });
  if(recovering){ renderRoot(); }
  else if(session){ await afterLogin(); } else { renderRoot(); }
}

function comTempo(promessa, ms, rotulo){
  return Promise.race([
    promessa,
    new Promise((_, rej)=> setTimeout(()=> rej(new Error('Tempo esgotado ao '+rotulo+'. Verifique a internet e se o projeto do Supabase está ativo (não pausado).')), ms))
  ]);
}

async function afterLogin(){
  const root = document.getElementById('root');
  root.innerHTML = '<div class="loading-note">Entrando…</div>';
  try{
    await comTempo(loadProfile(), 15000, 'carregar o perfil');
    await comTempo(loadAll(), 15000, 'carregar os dados');
    subscribeRealtime();
    renderRoot();
  }catch(e){
    showFatal(e.message || String(e));
  }
}

async function loadProfile(){
  const { data, error } = await db.from('profiles').select('*').eq('id', session.user.id).single();
  if(error) throw new Error('Não foi possível ler o seu perfil: '+error.message+' (código '+(error.code||'?')+')');
  profile = data;
}

async function loadAll(){
  const [itemsRes, movRes, settingsRes] = await Promise.all([
    db.from('items').select('*').order('nome'),
    db.from('movements').select('*').order('data', {ascending:false}),
    db.from('settings').select('*').eq('id',1).single()
  ]);
  const falha = itemsRes.error || movRes.error || settingsRes.error;
  if(falha) throw new Error('Erro ao ler os dados: '+falha.message+' (código '+(falha.code||'?')+')');
  state.items = itemsRes.data || [];
  state.movements = movRes.data || [];
  if(settingsRes.data) state.settings = settingsRes.data;
  if(isSindico()){
    const { data: profs } = await db.from('profiles').select('*').order('nome');
    state.profiles = profs || [];
  }
}

let canalTempoReal = null;
function subscribeRealtime(){
  if(canalTempoReal){ db.removeChannel(canalTempoReal); canalTempoReal = null; }
  canalTempoReal = db.channel('estoque-changes')
    .on('postgres_changes', { event:'*', schema:'public', table:'items' }, async ()=>{ await loadAll(); renderRoot(); })
    .on('postgres_changes', { event:'*', schema:'public', table:'movements' }, async ()=>{ await loadAll(); renderRoot(); })
    .on('postgres_changes', { event:'*', schema:'public', table:'settings' }, async ()=>{ await loadAll(); renderRoot(); })
    .subscribe();
}

/* ---------------- cálculos (iguais à versão anterior, snake_case) ---------------- */
function monthKey(d){ const dt = new Date(d); return dt.getFullYear()+'-'+String(dt.getMonth()+1).padStart(2,'0'); }

function consumoMedioMensal(itemId){
  const meses = state.settings.meses_media || 6;
  const hoje = new Date();
  const chaves = [];
  for(let i=0;i<meses;i++){ const d = new Date(hoje.getFullYear(), hoje.getMonth()-i, 1); chaves.push(monthKey(d)); }
  const somaPorMes = {}; chaves.forEach(c => somaPorMes[c] = 0);
  state.movements.filter(m => m.item_id===itemId && m.tipo==='saida').forEach(m=>{
    const k = monthKey(m.data); if(k in somaPorMes) somaPorMes[k] += Number(m.quantidade);
  });
  return Object.values(somaPorMes).reduce((a,b)=>a+b,0) / meses;
}
function diasRestantes(item){
  const consumo = consumoMedioMensal(item.id);
  if(consumo <= 0) return Infinity;
  return (item.estoque_atual / consumo) * 30;
}
function statusItem(item){
  const dias = diasRestantes(item);
  const { dias_critico, dias_atencao } = state.settings;
  if(item.estoque_atual <= item.estoque_minimo || dias <= dias_critico) return 'crit';
  if(dias <= dias_atencao) return 'warn';
  return 'ok';
}
function fmtDias(d){ return d===Infinity ? '—' : Math.max(0,Math.round(d))+' d'; }
function fmtNum(n){ return Number(n).toLocaleString('pt-BR', {maximumFractionDigits:2}); }
function fmtDataBR(iso){ const [y,m,d] = iso.split('-'); return `${d}/${m}/${y}`; }
function itemsComStatus(){
  return state.items.map(it => ({ ...it, _status: statusItem(it), _dias: diasRestantes(it), _consumo: consumoMedioMensal(it.id) }));
}

/* ---------------- root render: auth ou app ---------------- */
function renderRoot(){
  const root = document.getElementById('root');
  if(recovering){ root.innerHTML = renderRecovery(); attachRecoveryHandlers(); return; }
  if(!session){ root.innerHTML = renderAuth(); attachAuthHandlers(); return; }
  if(!profile){ root.innerHTML = '<div class="auth-wrap"><div class="auth-card"><h1>Perfil não encontrado</h1><p class="sub">Você entrou, mas não há perfil para esta conta. Confirme que o schema.sql foi executado no Supabase (antes de criar a conta).</p><button class="btn" id="logoutBtn2">Sair</button></div></div>'; const b=document.getElementById('logoutBtn2'); if(b) b.onclick=async()=>{ await db.auth.signOut(); session=null; renderRoot(); }; return; }
  root.innerHTML = renderApp();
  attachAppHandlers();
}

/* ---------------- tela de login/cadastro ---------------- */
function renderAuth(){
  const isSignup = authMode==='signup';
  if(authMode==='forgot') return renderForgot();
  return `
  <div class="auth-wrap">
    <div class="auth-card">
      <h1>Estoque de manutenção</h1>
      <p class="sub">${isSignup ? 'Criar uma conta' : 'Entrar na sua conta'}</p>
      ${authMsg && authMsg.type==='error' ? `<div class="auth-error">${esc(authMsg.text)}</div>` : ''}
      ${authMsg && authMsg.type==='ok' ? `<div class="auth-ok">${esc(authMsg.text)}</div>` : ''}
      <form id="authForm">
        ${isSignup ? `<div class="field"><label>Nome</label><input name="nome" required placeholder="Seu nome"></div>` : ''}
        <div class="field"><label>E-mail</label><input type="email" name="email" required placeholder="voce@email.com"></div>
        <div class="field"><label>Senha</label><input type="password" name="senha" required minlength="6" placeholder="••••••••"></div>
        <button class="btn" type="submit">${isSignup ? 'Criar conta' : 'Entrar'}</button>
      </form>
      ${isSignup ? '' : '<div class="auth-toggle" style="margin-top:12px;"><a id="toForgot">Esqueci minha senha</a></div>'}
      <div class="auth-toggle">
        ${isSignup ? 'Já tem conta? <a id="toLogin">Entrar</a>' : 'Ainda não tem conta? <a id="toSignup">Criar conta</a>'}
      </div>
    </div>
  </div>`;
}

function renderForgot(){
  return `
  <div class="auth-wrap">
    <div class="auth-card">
      <h1>Redefinir senha</h1>
      <p class="sub">Informe o e-mail da sua conta. Enviaremos um link para criar uma nova senha.</p>
      ${authMsg && authMsg.type==='error' ? `<div class="auth-error">${esc(authMsg.text)}</div>` : ''}
      ${authMsg && authMsg.type==='ok' ? `<div class="auth-ok">${esc(authMsg.text)}</div>` : ''}
      <form id="forgotForm">
        <div class="field"><label>E-mail</label><input type="email" name="email" required placeholder="voce@email.com"></div>
        <button class="btn" type="submit">Enviar link</button>
      </form>
      <div class="auth-toggle"><a id="backToLogin">Voltar para o login</a></div>
    </div>
  </div>`;
}

function renderRecovery(){
  return `
  <div class="auth-wrap">
    <div class="auth-card">
      <h1>Nova senha</h1>
      <p class="sub">Escolha uma nova senha para a sua conta.</p>
      ${authMsg && authMsg.type==='error' ? `<div class="auth-error">${esc(authMsg.text)}</div>` : ''}
      <form id="recoveryForm">
        <div class="field"><label>Nova senha</label><input type="password" name="senha" required minlength="6" placeholder="Mínimo de 6 caracteres"></div>
        <div class="field"><label>Repita a nova senha</label><input type="password" name="senha2" required minlength="6"></div>
        <button class="btn" type="submit">Salvar nova senha</button>
      </form>
    </div>
  </div>`;
}

function attachRecoveryHandlers(){
  const form = document.getElementById('recoveryForm');
  form.onsubmit = async (e)=>{
    e.preventDefault();
    const f = new FormData(form);
    if(f.get('senha') !== f.get('senha2')){ authMsg = {type:'error', text:'As duas senhas não são iguais.'}; renderRoot(); return; }
    const { error } = await db.auth.updateUser({ password: f.get('senha') });
    if(error){ authMsg = {type:'error', text: error.message}; renderRoot(); return; }
    authMsg = null; recovering = false;
    history.replaceState(null, '', window.location.pathname);
    const { data } = await db.auth.getSession();
    session = data.session;
    if(session){ await afterLogin(); } else { authMode='login'; renderRoot(); }
  };
}

function attachAuthHandlers(){
  if(authMode==='forgot'){
    const ff = document.getElementById('forgotForm');
    ff.onsubmit = async (e)=>{
      e.preventDefault();
      const email = new FormData(ff).get('email');
      const { error } = await db.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + window.location.pathname });
      authMsg = error ? {type:'error', text: error.message}
                      : {type:'ok', text:'Se o e-mail estiver cadastrado, você receberá um link em instantes. Olhe também o spam.'};
      renderRoot();
    };
    document.getElementById('backToLogin').onclick = ()=>{ authMode='login'; authMsg=null; renderRoot(); };
    return;
  }
  const form = document.getElementById('authForm');
  form.onsubmit = async (e)=>{
    e.preventDefault();
    const f = new FormData(form);
    authMsg = null;
    if(authMode==='signup'){
      const { error } = await db.auth.signUp({
        email: f.get('email'), password: f.get('senha'),
        options: { data: { nome: f.get('nome') } }
      });
      if(error){ authMsg = {type:'error', text: error.message}; renderRoot(); return; }
      authMsg = {type:'ok', text:'Conta criada. Verifique seu e-mail se a confirmação estiver ativada, depois entre.'};
      authMode = 'login'; renderRoot(); return;
    }else{
      const { error } = await db.auth.signInWithPassword({ email: f.get('email'), password: f.get('senha') });
      if(error){ authMsg = {type:'error', text: error.message}; renderRoot(); return; }
      authMsg = null;
      await afterLogin();
    }
  };
  const toForgot = document.getElementById('toForgot');
  if(toForgot) toForgot.onclick = ()=>{ authMode='forgot'; authMsg=null; renderRoot(); };
  const toSignup = document.getElementById('toSignup');
  if(toSignup) toSignup.onclick = ()=>{ authMode='signup'; authMsg=null; renderRoot(); };
  const toLogin = document.getElementById('toLogin');
  if(toLogin) toLogin.onclick = ()=>{ authMode='login'; authMsg=null; renderRoot(); };
}

/* ---------------- app (autenticado) ---------------- */
function renderApp(){
  const alertCount = itemsComStatus().filter(i=>i._status==='crit'||i._status==='warn').length;
  const tabs = [
    ['dashboard','Painel'], ['itens','Itens'], ['movimentos','Movimentações'],
    ['consumo','Consumo médio'], ['alertas','Alertas']
  ];
  if(isSindico()) tabs.push(['usuarios','Usuários']);

  return `
  <div class="app">
    <nav class="rail">
      <div class="rail-title">Estoque</div>
      <div class="rail-sub">Manutenção do condomínio</div>
      <div class="rail-who">Logado como<br><b>${esc(profile.nome || session.user.email)}</b> · ${PAPEL_LABEL[profile.papel]}</div>
      ${tabs.map(([id,label])=>`
        <button data-tab="${id}" class="${activeTab===id?'active':''}">
          <span class="dot"></span>${label}
          ${id==='alertas' && alertCount>0 ? `<span class="badge">${alertCount}</span>` : ''}
        </button>`).join('')}
      <div class="rail-foot"><button id="logoutBtn" class="ghost-link">Sair</button></div>
    </nav>
    <main class="main">
      ${ activeTab==='dashboard' ? renderDashboard()
       : activeTab==='itens' ? renderItens()
       : activeTab==='movimentos' ? renderMovimentos()
       : activeTab==='consumo' ? renderConsumo()
       : activeTab==='alertas' ? renderAlertas()
       : activeTab==='usuarios' ? renderUsuarios() : '' }
    </main>
  </div>`;
}

function roleNote(){
  if(canWrite()) return '';
  return `<div class="readonly-note">Seu papel é <b>morador</b>: você pode visualizar tudo, mas o registro e a edição são feitos pelo síndico ou gestor.</div>`;
}

/* ---- Dashboard ---- */
function renderDashboard(){
  const items = itemsComStatus();
  const crit = items.filter(i=>i._status==='crit');
  const warn = items.filter(i=>i._status==='warn');
  const recentMovs = [...state.movements].sort((a,b)=> b.data.localeCompare(a.data)).slice(0,6);
  const gastosMes = state.movements.filter(m=> m.tipo==='entrada' && monthKey(m.data)===monthKey(new Date()) && m.valor)
    .reduce((s,m)=> s + Number(m.valor||0), 0);
  return `
    <div class="page-head"><div><h1>Painel do estoque</h1><p>Visão geral dos itens de manutenção do condomínio.</p></div></div>
    <div class="cards">
      <div class="card"><div class="k">Itens cadastrados</div><div class="v num">${items.length}</div></div>
      <div class="card crit"><div class="k">Em nível crítico</div><div class="v num">${crit.length}</div></div>
      <div class="card warn"><div class="k">Em atenção</div><div class="v num">${warn.length}</div></div>
      <div class="card"><div class="k">Compras este mês</div><div class="v num">R$ ${fmtNum(gastosMes)}</div></div>
    </div>
    <div class="panel">
      <h3>Itens que precisam de reposição</h3>
      ${ (crit.length+warn.length)===0 ? `<div class="empty">Nenhum item em alerta no momento.</div>` : `
      <table><tr><th>Item</th><th>Estoque</th><th>Mínimo</th><th>Consumo médio/mês</th><th>Estimativa</th><th>Status</th></tr>
      ${[...crit,...warn].map(rowAlerta).join('')}</table>`}
    </div>
    <div class="panel">
      <h3>Últimas movimentações</h3>
      ${ recentMovs.length===0 ? `<div class="empty">Nenhuma movimentação registrada ainda.</div>` : `
      <table><tr><th>Data</th><th>Item</th><th>Tipo</th><th>Qtd.</th><th>Nota fiscal</th></tr>
      ${recentMovs.map(m=>{
        const item = state.items.find(i=>i.id===m.item_id);
        return `<tr><td class="num">${fmtDataBR(m.data)}</td><td>${esc(item?item.nome:'—')}</td>
          <td>${m.tipo==='entrada'?'Entrada':'Saída'}</td>
          <td class="num">${fmtNum(m.quantidade)} ${esc(item?item.unidade:'')}</td>
          <td>${esc(m.nota_fiscal || '—')}</td></tr>`;
      }).join('')}</table>`}
    </div>`;
}
function rowAlerta(i){
  const cls = i._status==='crit' ? 'row-crit' : 'row-warn';
  const pill = i._status==='crit' ? `<span class="status-pill status-crit">Crítico</span>` : `<span class="status-pill status-warn">Atenção</span>`;
  return `<tr class="${cls}">
    <td>${esc(i.nome)}</td><td class="num">${fmtNum(i.estoque_atual)} ${esc(i.unidade)}</td>
    <td class="num">${fmtNum(i.estoque_minimo)} ${esc(i.unidade)}</td>
    <td class="num">${fmtNum(i._consumo)} ${esc(i.unidade)}</td>
    <td class="num">${fmtDias(i._dias)}</td><td>${pill}</td></tr>`;
}

/* ---- Itens ---- */
function renderItens(){
  const items = itemsComStatus();
  const editing = editingItemId ? state.items.find(i=>i.id===editingItemId) : null;
  const write = canWrite();
  return `
    <div class="page-head"><div><h1>Itens de manutenção</h1><p>Cadastre os itens, o estoque atual e o mínimo aceitável.</p></div></div>
    ${roleNote()}
    ${write ? `
    <div class="panel">
      <h3>${editing ? 'Editar item' : 'Novo item'}</h3>
      <form id="itemForm" class="inline-form">
        <div class="field"><label>Nome</label><input name="nome" required value="${esc(editing?editing.nome:'')}" placeholder="Ex.: Lâmpada LED 9W"></div>
        <div class="field"><label>Categoria</label><select name="categoria">${CATEGORIAS.map(c=>`<option ${editing&&editing.categoria===c?'selected':''}>${c}</option>`).join('')}</select></div>
        <div class="field"><label>Unidade</label><select name="unidade">${UNIDADES.map(u=>`<option ${editing&&editing.unidade===u?'selected':''}>${u}</option>`).join('')}</select></div>
        <div class="field"><label>Estoque atual</label><input type="number" step="0.01" min="0" name="estoque_atual" required value="${editing?editing.estoque_atual:''}"></div>
        <div class="field"><label>Estoque mínimo</label><input type="number" step="0.01" min="0" name="estoque_minimo" required value="${editing?editing.estoque_minimo:''}"></div>
        <div class="form-actions">
          <button type="submit" class="btn">${editing ? 'Salvar alterações' : 'Adicionar item'}</button>
          ${editing ? `<button type="button" class="btn ghost" id="cancelEdit">Cancelar</button>` : ''}
        </div>
      </form>
    </div>` : ''}
    <div class="panel">
      <h3>Todos os itens (${items.length})</h3>
      ${items.length===0 ? `<div class="empty">Nenhum item cadastrado.</div>` : `
      <table><tr><th>Item</th><th>Categoria</th><th>Estoque</th><th>Mínimo</th><th>Status</th>${write?'<th></th>':''}</tr>
      ${items.map(i=>`
        <tr class="${i._status==='crit'?'row-crit':i._status==='warn'?'row-warn':''}">
          <td>${esc(i.nome)}</td><td><span class="tag">${esc(i.categoria)}</span></td>
          <td class="num">${fmtNum(i.estoque_atual)} ${esc(i.unidade)}</td>
          <td class="num">${fmtNum(i.estoque_minimo)} ${esc(i.unidade)}</td>
          <td>${i._status==='crit'?'<span class="status-pill status-crit">Crítico</span>':i._status==='warn'?'<span class="status-pill status-warn">Atenção</span>':'<span class="status-pill status-ok">Ok</span>'}</td>
          ${write ? `<td><button class="icon-btn" data-edit-item="${i.id}">Editar</button>
          <button class="icon-btn" data-del-item="${i.id}" ${isSindico()?'':'disabled title="Só o síndico pode excluir"'}>Excluir</button></td>` : ''}
        </tr>`).join('')}</table>`}
    </div>`;
}

/* ---- Movimentos ---- */
function renderMovimentos(){
  const list = [...state.movements].sort((a,b)=> b.data.localeCompare(a.data));
  const filtered = movFilter==='todos' ? list : list.filter(m=>m.tipo===movFilter);
  const itemOptions = state.items.map(i=>`<option value="${i.id}">${esc(i.nome)}</option>`).join('');
  const write = canWrite();
  return `
    <div class="page-head"><div><h1>Movimentações de estoque</h1><p>Registre entradas (compras) e saídas (uso) dos itens.</p></div></div>
    ${roleNote()}
    ${write ? `
    <div class="panel">
      <h3>Nova movimentação</h3>
      <form id="movForm" class="inline-form">
        <div class="field"><label>Item</label><select name="item_id" required>${itemOptions || '<option value="">Cadastre um item primeiro</option>'}</select></div>
        <div class="field"><label>Tipo</label><select name="tipo" id="movTipo">
          <option value="entrada">Entrada (compra)</option><option value="saida">Saída (uso)</option></select></div>
        <div class="field"><label>Quantidade</label><input type="number" step="0.01" min="0.01" name="quantidade" required></div>
        <div class="field"><label>Data</label><input type="date" name="data" value="${new Date().toISOString().slice(0,10)}" required></div>
        <div class="field"><label>Responsável</label><input name="responsavel" placeholder="Zelador, síndico..."></div>
        <div class="field nf-field"><label>Fornecedor</label><input name="fornecedor" placeholder="Nome do prestador"></div>
        <div class="field nf-field"><label>Nº nota fiscal</label><input name="nota_fiscal" placeholder="Ex.: NF 4521"></div>
        <div class="field nf-field"><label>Valor (R$)</label><input type="number" step="0.01" min="0" name="valor" placeholder="0,00"></div>
        <div class="field" style="grid-column:1/-1;"><label>Observação</label><textarea name="observacao" placeholder="Opcional"></textarea></div>
        <div class="form-actions"><button type="submit" class="btn">Registrar movimentação</button></div>
      </form>
    </div>` : ''}
    <div class="panel">
      <div class="toolbar"><h3 style="margin:0;">Histórico (${filtered.length})</h3>
        <div class="tabs-mini">
          <button data-movfilter="todos" class="${movFilter==='todos'?'active':''}">Todos</button>
          <button data-movfilter="entrada" class="${movFilter==='entrada'?'active':''}">Entradas</button>
          <button data-movfilter="saida" class="${movFilter==='saida'?'active':''}">Saídas</button>
        </div>
      </div>
      ${filtered.length===0 ? `<div class="empty">Nenhuma movimentação nesse filtro.</div>` : `
      <table><tr><th>Data</th><th>Item</th><th>Tipo</th><th>Qtd.</th><th>Fornecedor / NF</th><th>Valor</th><th>Resp.</th>${isSindico()?'<th></th>':''}</tr>
      ${filtered.map(m=>{
        const item = state.items.find(i=>i.id===m.item_id);
        return `<tr><td class="num">${fmtDataBR(m.data)}</td><td>${item ? esc(item.nome) : '<em>item removido</em>'}</td>
          <td>${m.tipo==='entrada'?'Entrada':'Saída'}</td>
          <td class="num">${fmtNum(m.quantidade)} ${esc(item?item.unidade:'')}</td>
          <td>${esc(m.fornecedor||'—')}${m.nota_fiscal?' · '+esc(m.nota_fiscal):''}</td>
          <td class="num">${m.valor?('R$ '+fmtNum(m.valor)):'—'}</td>
          <td>${esc(m.responsavel||'—')}</td>
          ${isSindico() ? `<td><button class="icon-btn" data-del-mov="${m.id}">Excluir</button></td>` : ''}
        </tr>`;
      }).join('')}</table>`}
    </div>`;
}

/* ---- Consumo médio ---- */
function renderConsumo(){
  const items = itemsComStatus();
  return `
    <div class="page-head"><div><h1>Consumo médio mensal</h1><p>Calculado automaticamente pela média de saídas dos últimos ${state.settings.meses_media} meses.</p></div></div>
    ${isSindico() ? `
    <div class="panel">
      <form id="settingsForm" class="inline-form" style="margin-top:0;">
        <div class="field"><label>Meses considerados na média</label><input type="number" min="1" max="24" name="meses_media" value="${state.settings.meses_media}"></div>
        <div class="field"><label>Alerta de atenção (dias restantes)</label><input type="number" min="1" name="dias_atencao" value="${state.settings.dias_atencao}"></div>
        <div class="field"><label>Alerta crítico (dias restantes)</label><input type="number" min="1" name="dias_critico" value="${state.settings.dias_critico}"></div>
        <div class="form-actions"><button type="submit" class="btn ghost">Salvar parâmetros</button></div>
      </form>
    </div>` : ''}
    <div class="panel">
      <h3>Consumo por item</h3>
      ${items.length===0 ? `<div class="empty">Nenhum item cadastrado.</div>` : `
      <table><tr><th>Item</th><th>Estoque atual</th><th>Consumo médio/mês</th><th>Dias restantes estimados</th></tr>
      ${items.map(i=>`<tr class="${i._status==='crit'?'row-crit':i._status==='warn'?'row-warn':''}">
        <td>${esc(i.nome)}</td><td class="num">${fmtNum(i.estoque_atual)} ${esc(i.unidade)}</td>
        <td class="num">${fmtNum(i._consumo)} ${esc(i.unidade)}</td><td class="num">${fmtDias(i._dias)}</td></tr>`).join('')}
      </table>`}
    </div>`;
}

/* ---- Alertas ---- */
function renderAlertas(){
  const items = itemsComStatus().filter(i=>i._status!=='ok').sort((a,b)=> a._dias - b._dias);
  return `
    <div class="page-head"><div><h1>Alertas de reposição</h1><p>Itens abaixo do estoque mínimo ou perto de acabar, segundo o consumo médio.</p></div></div>
    <div class="panel">
      ${items.length===0 ? `<div class="empty">Nenhum alerta ativo. Estoque sob controle.</div>` : `
      <table><tr><th>Item</th><th>Estoque</th><th>Mínimo</th><th>Consumo médio/mês</th><th>Estimativa</th><th>Status</th></tr>
      ${items.map(rowAlerta).join('')}</table>`}
    </div>`;
}

/* ---- Usuários (só síndico) ---- */
// Quais papéis o usuário logado pode atribuir a uma pessoa (o banco confere de novo)
function papeisPermitidos(alvo){
  if(isSuperadmin()) return Object.keys(PAPEL_LABEL);
  if(alvo.papel==='gestor' || alvo.papel==='morador') return ['gestor','morador'];
  return []; // síndico não mexe em síndico nem superadmin
}

function renderUsuarios(){
  return `
    <div class="page-head"><div><h1>Usuários e papéis</h1><p>${isSuperadmin() ? 'Defina quem é superadmin, síndico, gestor (zelador) ou morador.' : 'Defina quem é gestor (zelador) ou morador.'}</p></div></div>
    <div class="panel">
      ${state.profiles.length===0 ? `<div class="empty">Nenhum usuário encontrado.</div>` : `
      <table><tr><th>Nome</th><th>Papel</th><th></th></tr>
      ${state.profiles.map(p=>`
        <tr>
          <td>${esc(p.nome || '(sem nome)')} ${p.id===profile.id ? '<span class="role-pill">você</span>' : ''}</td>
          <td><span class="role-pill">${PAPEL_LABEL[p.papel]}</span></td>
          <td>
            ${(()=>{
              const opcoes = papeisPermitidos(p);
              const travado = p.id===profile.id || opcoes.length===0;
              const motivo = p.id===profile.id ? 'Você não pode alterar seu próprio papel' : 'Só o superadmin altera este papel';
              return `<select data-role-select="${p.id}" ${travado ? `disabled title="${motivo}"` : ''}>
                ${(travado ? Object.keys(PAPEL_LABEL) : opcoes).map(k=>`<option value="${k}" ${p.papel===k?'selected':''}>${PAPEL_LABEL[k]}</option>`).join('')}
              </select>`;
            })()}
          </td>
        </tr>`).join('')}</table>`}
    </div>`;
}

/* ---------------- handlers ---------------- */
function attachAppHandlers(){
  document.querySelectorAll('.rail button[data-tab]').forEach(b=>{
    b.onclick = ()=>{ activeTab = b.dataset.tab; editingItemId=null; renderRoot(); };
  });
  const logoutBtn = document.getElementById('logoutBtn');
  if(logoutBtn) logoutBtn.onclick = async ()=>{ await db.auth.signOut(); session=null; profile=null; renderRoot(); };

  const itemForm = document.getElementById('itemForm');
  if(itemForm){
    itemForm.onsubmit = async (e)=>{
      e.preventDefault();
      const f = new FormData(itemForm);
      const data = {
        nome: f.get('nome').trim(), categoria: f.get('categoria'), unidade: f.get('unidade'),
        estoque_atual: Number(f.get('estoque_atual')), estoque_minimo: Number(f.get('estoque_minimo'))
      };
      let error;
      if(editingItemId){ ({ error } = await db.from('items').update(data).eq('id', editingItemId)); }
      else{ ({ error } = await db.from('items').insert(data)); }
      if(error){ alert('Erro ao salvar item: '+error.message); return; }
      editingItemId = null;
      await loadAll(); renderRoot();
    };
  }
  const cancelEdit = document.getElementById('cancelEdit');
  if(cancelEdit) cancelEdit.onclick = ()=>{ editingItemId=null; renderRoot(); };

  document.querySelectorAll('[data-edit-item]').forEach(btn=>{
    btn.onclick = ()=>{ editingItemId = btn.dataset.editItem; renderRoot(); window.scrollTo(0,0); };
  });
  document.querySelectorAll('[data-del-item]').forEach(btn=>{
    btn.onclick = async ()=>{
      if(btn.disabled) return;
      if(!confirm('Excluir este item?')) return;
      const { error } = await db.from('items').delete().eq('id', btn.dataset.delItem);
      if(error){ alert('Erro ao excluir: '+error.message); return; }
      await loadAll(); renderRoot();
    };
  });

  const movForm = document.getElementById('movForm');
  if(movForm){
    movForm.onsubmit = async (e)=>{
      e.preventDefault();
      const f = new FormData(movForm);
      const itemId = f.get('item_id');
      const tipo = f.get('tipo');
      const quantidade = Number(f.get('quantidade'));
      const item = state.items.find(i=>i.id===itemId);
      if(!item) return;
      if(tipo==='saida' && quantidade > item.estoque_atual){
        if(!confirm(`A saída (${quantidade} ${item.unidade}) é maior que o estoque atual (${item.estoque_atual} ${item.unidade}). Registrar mesmo assim?`)) return;
      }
      const mov = {
        item_id: itemId, tipo, quantidade, data: f.get('data'),
        responsavel: f.get('responsavel')||'', fornecedor: f.get('fornecedor')||'',
        nota_fiscal: f.get('nota_fiscal')||'', valor: f.get('valor') ? Number(f.get('valor')) : null,
        observacao: f.get('observacao')||'', created_by: session.user.id
      };
      // O estoque do item é atualizado automaticamente pelo banco (trigger).
      const { error: e1 } = await db.from('movements').insert(mov);
      if(e1){ alert('Erro ao registrar movimentação: '+e1.message); return; }
      await loadAll(); renderRoot();
    };
    const tipoSelect = document.getElementById('movTipo');
    const toggleNfFields = ()=>{ const show = tipoSelect.value === 'entrada'; document.querySelectorAll('.nf-field').forEach(el=> el.style.display = show ? 'flex' : 'none'); };
    tipoSelect.onchange = toggleNfFields; toggleNfFields();
  }

  document.querySelectorAll('[data-del-mov]').forEach(btn=>{
    btn.onclick = async ()=>{
      const mov = state.movements.find(m=>m.id===btn.dataset.delMov);
      if(!mov) return;
      if(!confirm('Excluir esta movimentação? O estoque do item será ajustado de volta.')) return;
      // O banco reverte o efeito no estoque automaticamente (trigger).
      const { error: e1 } = await db.from('movements').delete().eq('id', mov.id);
      if(e1){ alert('Erro ao excluir: '+e1.message); return; }
      await loadAll(); renderRoot();
    };
  });

  document.querySelectorAll('[data-movfilter]').forEach(btn=>{
    btn.onclick = ()=>{ movFilter = btn.dataset.movfilter; renderRoot(); };
  });

  const settingsForm = document.getElementById('settingsForm');
  if(settingsForm){
    settingsForm.onsubmit = async (e)=>{
      e.preventDefault();
      const f = new FormData(settingsForm);
      const upd = {
        meses_media: Math.max(1, Number(f.get('meses_media'))||6),
        dias_atencao: Math.max(1, Number(f.get('dias_atencao'))||20),
        dias_critico: Math.max(1, Number(f.get('dias_critico'))||7)
      };
      const { error } = await db.from('settings').update(upd).eq('id',1);
      if(error){ alert('Erro ao salvar parâmetros: '+error.message); return; }
      await loadAll(); renderRoot();
    };
  }

  document.querySelectorAll('[data-role-select]').forEach(sel=>{
    sel.onchange = async ()=>{
      const { error } = await db.from('profiles').update({ papel: sel.value }).eq('id', sel.dataset.roleSelect);
      if(error){ alert('Erro ao alterar papel: '+error.message); await loadAll(); renderRoot(); return; }
      await loadAll(); renderRoot();
    };
  });
}

boot();
