#!/usr/bin/env python3
"""
SCRAPER BR — baixa capítulos em PORTUGUÊS do Manga Livre (.to) e salva no GitHub.

FUNCIONA DE QUALQUER LUGAR (sem Cloudflare!) — pode rodar no celular (Termux)
ou até no servidor. Baixa os capítulos BR completos que faltam no MangaDex.

USO:
    python scraper_br.py "jujutsu kaisen"              # baixa TODOS os capítulos
    python scraper_br.py "one piece" 1050 1100         # só caps 1050 a 1100
    python scraper_br.py "boa noite punpun" 1 20       # caps 1 a 20
    python scraper_br.py --update                       # só atualiza o índice

O índice (br_extra.json) vai pro GitHub; o Manganana lê e mostra os capítulos.
"""
import json, os, sys, re, time, zipfile, io, urllib.request, urllib.parse, subprocess, tempfile

UA = {'User-Agent': 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Mobile Safari/537.36',
      'Accept-Language': 'pt-BR,pt;q=0.9'}
BASE = 'https://mangalivre.to'

DATA_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'br_extra.json')
REPO = 'jaivedpereira/manganana-br-data'
BRANCH = 'main'

# ---------- helpers ----------
def get(url, binary=False):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=40) as r:
        return r.read() if binary else r.read().decode('utf-8', 'ignore')

def post(url, referer, data):
    req = urllib.request.Request(url, data=data.encode(), headers={
        **UA, 'Referer': referer, 'X-Requested-With': 'XMLHttpRequest',
        'Content-Type': 'application/x-www-form-urlencoded'})
    with urllib.request.urlopen(req, timeout=40) as r:
        return r.read().decode('utf-8', 'ignore')

# ---------- Manga Livre (.to — sem Cloudflare, principal) ----------
def ml_search(q):
    """Busca mangá no Manga Livre .to. Retorna (titulo, slug) ou None.
    Tenta variações do nome automaticamente e valida similaridade
    (evita falso positivo tipo 'punpun' → 'Witches and Cigarettes')."""
    variacoes = [q]
    palavras = q.split()
    if len(palavras) > 1:
        variacoes.append(palavras[-1])           # 'punpun'
        variacoes.append(' '.join(palavras[:2])) # 'boa noite'
    vistos = set()
    for v in variacoes:
        if v in vistos: continue
        vistos.add(v)
        try:
            html = get(f'{BASE}/?s={urllib.parse.quote(v)}')
            # coleta TODOS os resultados da busca
            achados = re.findall(r'href="' + re.escape(BASE) + r'/manga/([^"/]+)/"', html)
            for slug in dict.fromkeys(achados):
                # título real: h1 da página do mangá
                titulo = slug.replace('-', ' ').title()
                try:
                    ph = get(f'{BASE}/manga/{slug}/')
                    h1 = re.findall(r'<h1[^>]*>([^<]+)</h1>', ph)
                    if h1:
                        titulo = h1[0].strip()
                except Exception:
                    pass
                # valida similaridade: o título achado deve bater com a busca
                if not _similar(titulo + ' ' + slug, v):
                    print(f'   🔎 .to: "{v}" → {titulo[:35]} (não é o que buscamos, pulando)')
                    continue
                print(f'   🔎 .to: "{v}" → {titulo[:40]}')
                return (titulo, slug)
        except Exception:
            pass
    print('⚠️ Busca sem resultado no Manga Livre.')
    return None

def _similar(titulo_achado, query):
    """True se o título achado tem palavra em comum relevante com a busca."""
    t = titulo_achado.lower()
    q = query.lower()
    if q in t or t in q:
        return True
    palavras = q.split()
    for w in palavras:
        if len(w) > 3 and (w in t or any(w in s for s in t.replace('-', ' ').split())):
            return True
    return False

def ml_chapters(slug):
    """Lista capítulos via AJAX do Madara. Retorna [(num, url)]."""
    html = post(f'{BASE}/manga/{slug}/ajax/chapters', f'{BASE}/manga/{slug}/',
                '')
    caps = re.findall(r'href="([^"]*capitulo-[^"/]+)/?"[^>]*>', html)
    seen, out = set(), []
    for u in caps:
        num_m = re.search(r'capitulo-(\d+(?:\.\d+)?)', u)
        if not num_m: continue
        num = num_m.group(1)
        if num in seen: continue
        seen.add(num)
        out.append((num, u))
    def key(x):
        try: return float(x[0])
        except: return 999999
    out.sort(key=key)
    return out

def ml_pages(cap_url):
    """Extrai URLs das imagens de um capítulo."""
    html = get(cap_url)
    m = re.search(r'<div class="reading-content[^>]*>(.*?)</div>\s*</div>', html, re.S)
    bloco = m.group(1) if m else html
    imgs = re.findall(r'<img[^>]*src="\s*([^"]+)"', bloco)
    return [u.strip() for u in imgs if 'uploads' in u]

def upload_gofile(path):
    """Sobe arquivo pro gofile.io e retorna o link direto."""
    boundary = '----mnbr' + str(int(time.time()))
    with open(path, 'rb') as f:
        data = f.read()
    body = io.BytesIO()
    body.write(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{os.path.basename(path)}"\r\nContent-Type: application/octet-stream\r\n\r\n'.encode())
    body.write(data)
    body.write(f'\r\n--{boundary}--\r\n'.encode())
    req = urllib.request.Request('https://upload.gofile.io/uploadfile', data=body.getvalue(),
        headers={**UA, 'Content-Type': f'multipart/form-data; boundary={boundary}'})
    with urllib.request.urlopen(req, timeout=180) as r:
        d = json.loads(r.read().decode())
    if d.get('status') != 'ok':
        raise Exception('gofile: ' + str(d))
    info = d['data']
    return f"https://media.gofile.io/download/{info['id']}/{info['name']}"

# ---------- Manga Livre .org (API REST — Cloudflare, funciona no celular) ----------
MLORG = 'https://mangalivre.org'

def mlorg_search(q):
    """Busca via API do mangalivre.org. Retorna (titulo, slug) ou None.
    Tenta variações do nome automaticamente (ex: 'boa noite punpun' → 'punpun')."""
    variacoes = [q]
    # última palavra (ex: punpun), primeira palavra, sem acentos
    palavras = q.split()
    if len(palavras) > 1:
        variacoes.append(palavras[-1])           # 'punpun'
        variacoes.append(' '.join(palavras[:2])) # 'boa noite'
    variacoes.append(re.sub(r'[áàâãäéèêëíìîïóòôõöúùûüç]', lambda m: {'á':'a','à':'a','â':'a','ã':'a','ä':'a','é':'e','è':'e','ê':'e','ë':'e','í':'i','ì':'i','î':'i','ï':'i','ó':'o','ò':'o','ô':'o','õ':'o','ö':'o','ú':'u','ù':'u','û':'u','ü':'u','ç':'c'}[m.group(0)], q))
    vistos = set()
    for v in variacoes:
        if v in vistos: continue
        vistos.add(v)
        try:
            data = urllib.parse.urlencode({'search': v}).encode()
            req = urllib.request.Request(f'{MLORG}/lib/search/series.json', data=data, headers={
                **UA, 'Content-Type': 'application/x-www-form-urlencoded',
                'X-Requested-With': 'XMLHttpRequest', 'Origin': MLORG, 'Referer': MLORG + '/'})
            with urllib.request.urlopen(req, timeout=40) as r:
                d = json.loads(r.read().decode())
            # d é {categoria: [SearchItemDto{label, link, cover}]}
            for lista in d.values():
                if not isinstance(lista, list) or not lista:
                    continue
                for item in lista:
                    label = item.get('label', '') or ''
                    slug = item.get('link', '').rstrip('/').split('/')[-1]
                    if not _similar(label + ' ' + slug, v):
                        continue
                    print(f'   🔎 .org: "{v}" → {label[:40]}')
                    return (label, slug)
            print(f'   🔎 .org: "{v}" → sem match válido')
        except Exception as e:
            print('⚠️ mangalivre.org inacessível:', str(e)[:50])
            return None
    return None

def mlorg_chapters(slug):
    """Capítulos via API: GET /api/v1/mangas/{slug}. Retorna [(num, chapter_id)]."""
    d = json.loads(get(f'{MLORG}/api/v1/mangas/{slug}'))
    chs = d.get('chapters', [])
    out = []
    for c in chs:
        num = str(c.get('number', ''))
        if not num:
            continue
        out.append((num, c.get('id')))
    def key(x):
        try: return float(x[0])
        except: return 999999
    out.sort(key=key)
    return out

def mlorg_pages(chapter_id):
    """Páginas via API: GET /api/v1/chapters/{id}. Retorna [urls]."""
    d = json.loads(get(f'{MLORG}/api/v1/chapters/{chapter_id}'))
    pages = sorted(d.get('pages', []), key=lambda p: p.get('number', 0))
    return [p['imageUrl'] for p in pages if p.get('imageUrl')]

# ---------- fluxo principal ----------
def main():
    args = sys.argv[1:]
    if not args or args[0] == '--help':
        print(__doc__); return
    if args[0] == '--update':
        push_index(); return
    query = args[0]
    cap_a = float(args[1]) if len(args) > 1 else None
    cap_b = float(args[2]) if len(args) > 2 else cap_a

    print(f'🔍 Buscando "{query}"…')
    # fonte 1: Manga Livre .to (sem Cloudflare — funciona em qualquer lugar)
    found = ml_search(query)
    fonte = 'mangalivre.to'
    # fonte 2: Manga Livre .org (API REST — precisa IP residencial)
    if not found:
        print('⚠️ .to sem resultado, tentando mangalivre.org…')
        found = mlorg_search(query)
        fonte = 'mangalivre.org'
    if not found:
        print('❌ Não achei em nenhuma fonte. Tente outro nome (ex: "jujutsu", "punpun").')
        return
    titulo, hid = found
    print(f'✅ Encontrado: {titulo} (fonte: {fonte})')

    print('📋 Listando capítulos…')
    if fonte == 'mangalivre.org':
        caps = mlorg_chapters(hid)
        pagina_fn = mlorg_pages
    else:
        caps = ml_chapters(hid)
        pagina_fn = ml_pages
    if not caps:
        print('❌ Nenhum capítulo encontrado.')
        return
    print(f'📚 {len(caps)} capítulos no total')
    if cap_a:
        caps = [c for c in caps if cap_a <= float(c[0]) <= (cap_b or cap_a)]
        print(f'🎯 Filtrando: {len(caps)} capítulos ({cap_a}–{cap_b})')

    data = {}
    if os.path.exists(DATA_FILE):
        data = json.load(open(DATA_FILE))
    key = urllib.parse.quote(titulo.lower().replace(' ', '-'))

    total = len(caps)
    ok = 0
    for i, (num, cap_url) in enumerate(caps, 1):
        print(f'  [{i}/{total}] Cap. {num}… ', end='', flush=True)
        try:
            imgs = pagina_fn(cap_url)
            if not imgs:
                print('⚠️ sem imagens'); continue
            zdata = io.BytesIO()
            with zipfile.ZipFile(zdata, 'w', zipfile.ZIP_DEFLATED) as z:
                for j, img_url in enumerate(imgs):
                    try:
                        raw = get(img_url, binary=True)
                        ext = '.webp' if 'webp' in img_url.lower() else ('.png' if 'png' in img_url.lower() else '.jpg')
                        z.writestr(f'{j+1:03d}{ext}', raw)
                    except Exception as e:
                        print(f'(img {j+1} err {str(e)[:15]})', end='')
            zdata.seek(0)
            with tempfile.NamedTemporaryFile(suffix='.zip', delete=False) as tf:
                tf.write(zdata.getvalue()); tmp = tf.name
            link = upload_gofile(tmp)
            os.unlink(tmp)
            data.setdefault(key, {'title': titulo, 'chapters': {}})
            data[key]['chapters'][str(num)] = {'zip': link, 'pages': len(imgs), 'ts': int(time.time())}
            ok += 1
            print(f'✅ {len(imgs)} págs')
        except Exception as e:
            print(f'❌ {str(e)[:40]}')

    json.dump(data, open(DATA_FILE, 'w'), ensure_ascii=False, indent=1)
    print(f'\n💾 Índice salvo: {DATA_FILE} ({ok}/{total} capítulos de {titulo})')
    push_index()

def push_index():
    print('☁️ Enviando índice pro GitHub…')
    try:
        subprocess.run(['git', 'add', DATA_FILE], check=True)
        subprocess.run(['git', 'commit', '-m', 'update br_extra.json [scraper]'], check=True)
        subprocess.run(['git', 'push', 'origin', BRANCH], check=True)
        print('✅ Índice no GitHub! O Manganana já consegue ler.')
    except Exception as e:
        print('⚠️ Push falhou:', str(e)[:80])
        print('   Rode: git add br_extra.json && git commit -m "upd" && git push')

if __name__ == '__main__':
    main()
