# Fase 4a — base do novo app

Fica na pasta `app/` e **não substitui** o app atual (que continua na raiz).

- Endereço no GitHub Pages: `https://vinaum.github.io/gestao-estoque-luminiiv/app/`
- Local: na pasta do repositório, `python3 -m http.server 8000` e abra `http://localhost:8000/app/`
  (módulos ES não abrem com duplo clique).

O que já funciona: entrar / criar conta / esqueci a senha, escolha de condomínio,
menu por papel, bloqueio de telas sem permissão, tela "Aguardando convite" e boas-vindas do morador.
As demais telas mostram "Em construção" até as próximas partes.

Testes: `node tests/html.test.mjs` e `python3 tests/e2e_menu.py` (precisa de playwright).
