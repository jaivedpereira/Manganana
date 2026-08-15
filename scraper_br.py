#!/usr/bin/env python3
"""
SCRAPER BR — roda no CELULAR (Termux), onde o IP residencial passa no Cloudflare.
Baixa capítulos em português de sites BR e salva num índice JSON no GitHub.

USO:
    python scraper_br.py "jujutsu kaisen" [cap_inicial] [cap_final]
    python scraper_br.py "one piece" 1000
    python scraper_br.py --update        # só atualiza o índice no GitHub

O celular só precisa ficar ligado durante o download. Depois, o Manganana
lê o índice do GitHub e mostra os capítulos BR extras.
"""
import json, os, sys, re, time, zipfile, io, urllib.request, urllib.parse, subprocess, tempfile

UA = {'User-Agent': 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Mobile Safari/537.36',
      'Accept-Language': 'pt-BR,pt;q=0.9'}

DATA_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'br_extra.json')
REPO = 'jaivedpereira/manganana-br-data'   # repo onde o índice fica salvo
BRANCH = 'main'

# ---------- helpers ----------
def get(url, binary=False):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read() if binary else r.read().decode('utf-8', 'ignore')

def upload_gofile(path):
    """Sobe arquivo pro gofile.io e retorna o link de download direto."""
    boundary = '----mnbr' + str(int(time.time()))
    with open(path, 'rb') as f:
        data = f.read()
    body = io.BytesIO()
    body.write(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{os.path.basename(path)}"\r\nContent-Type: application/octet-stream\r\n\r\n'.encode())
    body.write(data)
    body.write(f'\r\n--{boundary}--\r\n'.encode())
    req = urllib.request.Request('https://upload.gofile.io/uploadfile', data=body.getvalue(),
        headers={**UA, 'Content-Type': f'multipart/form-data; boundary={boundary}'})
    with urllib.request.urlopen(req, timeout=120) as r:
        d = json.loads(r.read().decode())
    if d.get('status') != 'ok':
        raise Exception('gofile: ' + str(d))
    info = d['data']
    # link direto do arquivo (sem página)
    return f"https://media.gofile.io/download/{info['id']}/{info['name']}"

# ---------- busca no Union Mangas ----------
def search_union(q):
    """Busca mangá no Union Mangas. Retorna (titulo, url_do_manga)."""
    url = 'https://unionmangas.top/busca?q=' + urllib.parse.quote(q)
    try:
        html = get(url)
    except Exception as e:
        print('❌ Union Mangas inacessível:', str(e)[:60])
        return None
    m = re.search(r'<a[^>]+href="(/manga/[^"]+)"[^>]*>\s*([^<]{2,60})', html)
    if not m:
        # tenta formato JSON/outro
        m2 = re.search(r'"url"\s*:\s*"([^"]*manga[^"]*)"', html)
        if m2: return (q, m2.group(1))
        print('⚠️ Busca sem resultado (pode ter mudado o layout).')
        return None
    return (m.group(2).strip(), m.group(1))

def list_chapters_union(manga_url):
    """Extrai (numero, url) de todos os capítulos da página do mangá."""
    html = get('https://unionmangas.top' + manga_url)
    caps = re.findall(r'href="(/leitor/[^"]+)"[^>]*>\s*(?:<[^>]+>\s*)*([^<]{0,40})', html)
    seen, out = set(), []
    for url_cap, titulo in caps:
        num = re.search(r'(\d+(?:\.\d+)?)', titulo)
        ch = num.group(1) if num else str(len(out) + 1)
        key = url_cap.split('/')[-1]
        if key in seen: continue
        seen.add(key)
        out.append((ch, url_cap))
    out.sort(key=lambda x: float(x[0]))
    return out

def chapter_images_union(leitor_url):
    """Extrai as URLs das páginas de um capítulo no leitor."""
    html = get('https://unionmangas.top' + leitor_url)
    imgs = re.findall(r'<img[^>]+src="([^"]+\.(?:jpe?g|png|webp))"[^>]*>', html, re.I)
    return [u.replace('&amp;', '&') for u in imgs]

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

    print(f'🔍 Buscando "{query}" no Union Mangas…')
    found = search_union(query)
    if not found:
        print('❌ Não achei no Union Mangas. Tente outro nome (ex: "jujutsu").')
        return
    titulo, manga_url = found
    print(f'✅ Encontrado: {titulo}')

    print('📋 Listando capítulos…')
    caps = list_chapters_union(manga_url)
    print(f'📚 {len(caps)} capítulos no total')
    if cap_a:
        caps = [c for c in caps if cap_a <= float(c[0]) <= (cap_b or cap_a)]
        print(f'🎯 Filtrando: {len(caps)} capítulos ({cap_a}–{cap_b})')

    # carrega índice atual
    data = {}
    if os.path.exists(DATA_FILE):
        data = json.load(open(DATA_FILE))
    key = urllib.parse.quote(titulo.lower().replace(' ', '-'))

    total = len(caps)
    for i, (num, cap_url) in enumerate(caps, 1):
        print(f'  [{i}/{total}] Cap. {num}… ', end='', flush=True)
        try:
            imgs = chapter_images_union(cap_url)
            if not imgs:
                print('⚠️ sem imagens'); continue
            # baixa as imagens e zipa
            zdata = io.BytesIO()
            with zipfile.ZipFile(zdata, 'w', zipfile.ZIP_DEFLATED) as z:
                for j, img_url in enumerate(imgs):
                    try:
                        raw = get(img_url, binary=True)
                        ext = '.jpg' if 'jpeg' in img_url.lower() or 'jpg' in img_url.lower() else '.png'
                        z.writestr(f'{j+1:03d}{ext}', raw)
                    except Exception as e:
                        print(f'(img {j+1} erro: {str(e)[:20]})', end='')
            zdata.seek(0)
            with tempfile.NamedTemporaryFile(suffix='.zip', delete=False) as tf:
                tf.write(zdata.getvalue()); tmp = tf.name
            link = upload_gofile(tmp)
            os.unlink(tmp)
            data.setdefault(key, {'title': titulo, 'chapters': {}})
            data[key]['chapters'][str(num)] = {'zip': link, 'pages': len(imgs), 'ts': int(time.time())}
            print(f'✅ {len(imgs)} págs')
        except Exception as e:
            print(f'❌ {str(e)[:40]}')

    json.dump(data, open(DATA_FILE, 'w'), ensure_ascii=False, indent=1)
    print(f'\n💾 Índice salvo: {DATA_FILE} ({len(data)} mangás)')
    push_index()

def push_index():
    """Commit + push do índice pro GitHub."""
    print('☁️ Enviando índice pro GitHub…')
    try:
        subprocess.run(['git', 'add', DATA_FILE], check=True)
        subprocess.run(['git', 'commit', '-m', 'update br_extra.json [scraper]'], check=True)
        subprocess.run(['git', 'push', 'origin', BRANCH], check=True)
        print('✅ Índice no GitHub! O Manganana já consegue ler.')
    except Exception as e:
        print('⚠️ Push falhou:', str(e)[:80])
        print('   Rode manualmente: git add br_extra.json && git commit -m "upd" && git push')

if __name__ == '__main__':
    main()
