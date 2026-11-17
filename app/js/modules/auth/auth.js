import { h, render } from '../../lib/html.js';
import { db } from '../../lib/supabase.js';

// Telas de entrada: login, criar conta, esqueci a senha e nova senha.
export function telaAuth(raiz, modo, mensagem, { aoMudarModo }) {
  const titulo = { login: 'Entrar', signup: 'Criar conta', forgot: 'Recuperar senha', recovery: 'Nova senha' }[modo];
  const sub = {
    login: 'Gestão do condomínio',
    signup: 'Depois de criar a conta, você precisa ser convidado(a) pelo síndico.',
    forgot: 'Enviaremos um link para o seu e-mail.',
    recovery: 'Escolha uma nova senha para a sua conta.',
  }[modo];
  render(raiz, h`
    <div class="auth-wrap"><div class="auth-card">
      <h1>${titulo}</h1><p class="sub">${sub}</p>
      ${mensagem ? h`<div class="${mensagem.tipo === 'ok' ? 'auth-ok' : 'auth-error'}" role="alert">${mensagem.texto}</div>` : ''}
      <form id="f-auth" novalidate>
        ${modo === 'signup' ? h`<div class="field"><label for="a-nome">Nome</label><input id="a-nome" required autocomplete="name"></div>` : ''}
        ${modo !== 'recovery' ? h`<div class="field"><label for="a-email">E-mail</label><input id="a-email" type="email" required autocomplete="email"></div>` : ''}
        ${modo !== 'forgot' ? h`<div class="field"><label for="a-senha">${modo === 'recovery' ? 'Nova senha' : 'Senha'}</label>
          <input id="a-senha" type="password" required minlength="8" autocomplete="${modo === 'login' ? 'current-password' : 'new-password'}"></div>` : ''}
        <button class="btn" type="submit">${modo === 'login' ? 'Entrar' : modo === 'signup' ? 'Criar conta' : modo === 'forgot' ? 'Enviar link' : 'Salvar senha'}</button>
      </form>
      <div class="auth-toggle">
        ${modo === 'login' ? h`<a data-modo="signup">Criar conta</a> · <a data-modo="forgot">Esqueci minha senha</a>` : ''}
        ${modo === 'signup' || modo === 'forgot' ? h`<a data-modo="login">Voltar para entrar</a>` : ''}
      </div>
    </div></div>`);

  raiz.querySelectorAll('[data-modo]').forEach((a) => a.addEventListener('click', () => aoMudarModo(a.dataset.modo)));
  raiz.querySelector('#f-auth').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const val = (id) => raiz.querySelector('#' + id)?.value.trim() ?? '';
    const email = val('a-email'), senha = raiz.querySelector('#a-senha')?.value ?? '', nome = val('a-nome');
    const botao = raiz.querySelector('button[type=submit]');
    const erro = (texto) => aoMudarModo(modo, { tipo: 'erro', texto });
    if (modo !== 'recovery' && !email) return erro('Informe o e-mail.');
    if (modo !== 'forgot' && senha.length < 8) return erro('A senha precisa ter pelo menos 8 caracteres.');
    if (modo === 'signup' && !nome) return erro('Informe o seu nome.');
    botao.disabled = true;
    const base = location.href.split('#')[0];
    try {
      if (modo === 'login') {
        const { error } = await db.auth.signInWithPassword({ email, password: senha });
        if (error) return erro(/confirm/i.test(error.message) ? 'Confirme o seu e-mail antes de entrar (veja a caixa de entrada).' : 'E-mail ou senha incorretos.');
      } else if (modo === 'signup') {
        const { error } = await db.auth.signUp({ email, password: senha, options: { data: { nome }, emailRedirectTo: base } });
        if (error) return erro(error.message);
        aoMudarModo('login', { tipo: 'ok', texto: 'Conta criada. Confirme o e-mail que enviamos e depois entre.' });
      } else if (modo === 'forgot') {
        const { error } = await db.auth.resetPasswordForEmail(email, { redirectTo: base });
        if (error) return erro(error.message);
        aoMudarModo('login', { tipo: 'ok', texto: 'Se o e-mail existir, o link foi enviado.' });
      } else if (modo === 'recovery') {
        const { error } = await db.auth.updateUser({ password: senha });
        if (error) return erro(error.message);
        aoMudarModo('login', { tipo: 'ok', texto: 'Senha alterada. Entre com a nova senha.' });
        await db.auth.signOut();
      }
    } finally { botao.disabled = false; }
  });
}
