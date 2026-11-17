"""Auditoria estática de segurança do código do app (não precisa de navegador nem de banco).
Falha se encontrar: segredo no código, script externo, eval, atributo de evento inline,
HTML montado sem escape, política de segurança (CSP) frouxa ou biblioteca alterada."""
import os, re, sys, hashlib
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
falhas = []
def falha(msg): falhas.append(msg); print('FALHOU', msg)
def ok(msg): print('OK   ', msg)
def arquivos(pasta, exts):
    base = os.path.join(RAIZ, pasta)
    for d, _, fs in os.walk(base):
        for f in fs:
            if f.endswith(exts): yield os.path.join(d, f)
rel = lambda p: os.path.relpath(p, RAIZ)
js = list(arquivos('app', ('.js',))); htmls = list(arquivos('app', ('.html',)))

# 1) segredos
padroes = [r'service_role', r'sb_secret_', r'eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.', r'-----BEGIN [A-Z ]*PRIVATE KEY', r'ghp_[A-Za-z0-9]{20,}', r'github_pat_']
sem_coment = lambda p: '\n'.join(l for l in open(p, encoding='utf-8').read().split('\n') if not l.strip().startswith('//'))
ach = [(rel(p), pad) for p in js + htmls for pad in padroes if re.search(pad, sem_coment(p))]
ach and falha('possível segredo no código: %s' % ach) or ok('nenhum segredo no código do app (service_role, chaves secretas, tokens)')

# 2) funções perigosas
ruim = [(rel(p), t) for p in js for t in ['eval(', 'new Function', 'document.write', 'setTimeout("', "setTimeout('"] if t in open(p, encoding='utf-8').read()]
ruim and falha('uso de função perigosa: %s' % ruim) or ok('sem eval, new Function nem document.write')

# 3) atributos de evento inline em HTML montado ou arquivo
ev = re.compile(r'\son(click|error|load|mouseover|focus|change|submit|input|keydown|keyup)\s*=', re.I)
ach = [rel(p) for p in js + htmls if ev.search(open(p, encoding='utf-8').read())]
ach and falha('atributo de evento inline em: %s' % ach) or ok('sem onclick/onerror inline (eventos são ligados por código)')

# 4) innerHTML só com texto fixo
ach = []
for p in js:
    if p.endswith(os.path.join('lib', 'html.js')): continue
    for n, l in enumerate(open(p, encoding='utf-8'), 1):
        if re.search(r'(innerHTML|outerHTML|insertAdjacentHTML)', l) and not re.search(r"(innerHTML|outerHTML)\s*=\s*'[^'$+]*';", l):
            ach.append(f'{rel(p)}:{n}')
ach and falha('innerHTML com conteúdo não fixo: %s' % ach) or ok('innerHTML só com texto fixo (todo o resto passa por h`` que escapa)')

# 5) template literal com HTML e interpolação sem a função h (analisa aninhamento de ${ })
def templates(src):
    """Devolve (tag, texto_estatico) de cada template literal, inclusive os aninhados."""
    saida = []; pilha = []; i = 0; n = len(src)
    def abrir(i):
        j = i - 1; k = j
        while k >= 0 and (src[k].isalnum() or src[k] in '_$.'): k -= 1
        return src[k + 1:i]
    modo = []  # 'c' código, 't' template
    estat = []
    tags = []
    modo.append('c'); chaves = []
    while i < n:
        c = src[i]
        if modo[-1] == 'c':
            if c == '`':
                tags.append(abrir(i)); estat.append([]); modo.append('t')
            elif c in '\'"':
                q = c; i += 1
                while i < n and src[i] != q:
                    i += 2 if src[i] == '\\' else 1
            elif c == '/' and src[i:i+2] == '//':
                while i < n and src[i] != '\n': i += 1
            elif c == '/' and src[i:i+2] == '/*':
                i = src.index('*/', i + 2) + 1
            elif c == '{': chaves.append('{')
            elif c == '}':
                if chaves and chaves[-1] == '$':
                    chaves.pop(); modo.pop()
                elif chaves: chaves.pop()
        else:
            if c == '\\': estat[-1].append(src[i:i+2]); i += 1
            elif c == '`':
                saida.append((tags.pop(), ''.join(estat.pop()))); modo.pop()
            elif c == '$' and src[i+1:i+2] == '{':
                estat[-1].append('${'); chaves.append('$'); modo.append('c'); i += 1
            else: estat[-1].append(c)
        i += 1
    return saida
ach = []
for p in js:
    for tag, txt in templates(open(p, encoding='utf-8').read()):
        if tag == '' and re.search(r'<\w', txt) and '${' in txt: ach.append(f'{rel(p)}: {txt[:60]!r}')
ach and falha('HTML com interpolação sem escape: %s' % ach[:5]) or ok('todo HTML com dados passa pela função h`` (escape automático)')

# 6) scripts e estilos externos
ach = []
for p in htmls:
    t = open(p, encoding='utf-8').read()
    ach += [(rel(p), u) for u in re.findall(r'<script[^>]+src=["\']([^"\']+)', t) if re.match(r'(https?:)?//', u)]
ach and falha('script externo: %s' % ach) or ok('nenhum script carregado de servidor externo')
ach = [rel(p) for p in js if re.search(r"\.src\s*=\s*['\"`]https?:", open(p, encoding='utf-8').read())]
ach and falha('script externo via código: %s' % ach) or ok('nenhum script externo carregado por código')

# 7) CSP
for p in htmls:
    t = open(p, encoding='utf-8').read(); m = re.search(r'Content-Security-Policy"\s+content="([^"]+)"', t)
    if not m: falha('sem CSP em ' + rel(p)); continue
    csp = m.group(1); scr = re.search(r"script-src([^;]*)", csp).group(1)
    if "'unsafe-inline'" in scr or "'unsafe-eval'" in scr or 'http' in scr: falha('CSP frouxa em script-src: %s' % scr)
    elif "default-src 'self'" not in csp or "object-src 'none'" not in csp or "base-uri 'none'" not in csp: falha('CSP incompleta em ' + rel(p))
    else: ok("CSP de %s: script-src só 'self', sem eval, sem inline" % rel(p))

# 8) integridade das bibliotecas
soma = os.path.join(RAIZ, 'vendor', 'SHA256SUMS')
if not os.path.exists(soma): falha('vendor/SHA256SUMS ausente')
else:
    for l in open(soma):
        h_, nome = l.split(); real = hashlib.sha256(open(os.path.join(RAIZ, 'vendor', nome), 'rb').read()).hexdigest()
        real != h_ and falha('biblioteca alterada: ' + nome) or ok('integridade de vendor/%s' % nome)

# 9) .gitignore
gi = os.path.join(RAIZ, '.gitignore')
if os.path.exists(gi):
    t = open(gi).read(); faltam = [x for x in ['.env', 'node_modules', '*.save'] if x not in t]
    faltam and falha('.gitignore sem: %s' % faltam) or ok('.gitignore protege .env, node_modules e backups .save')

# 10) migrations: nenhum comando destrutivo fora de pendentes/
mig = os.path.join(RAIZ, 'supabase', 'migrations')
if os.path.isdir(mig):
    ach = [f for f in os.listdir(mig) if re.search(r'\bdrop\s+(table|schema|column)\b|\btruncate\b', open(os.path.join(mig, f), encoding='utf-8').read().replace('before truncate', ''), re.I)]
    ach and falha('migration destrutiva fora de pendentes/: %s' % ach) or ok('nenhuma migration destrutiva (drop table/schema/column, truncate)')
print('RESULTADO:', 'FALHOU %d' % len(falhas) if falhas else 'TUDO OK'); sys.exit(1 if falhas else 0)
