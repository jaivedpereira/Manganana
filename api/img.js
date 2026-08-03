// Proxy de IMAGENS para o MangaDex (resolve bloqueio de User-Agent de navegador)
// Uso: /api/img?url=<url da imagem codificada>

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  const { url } = req.query;
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Informe ?url=...' });
  }
  // só permite domínios do MangaDex e AniList (segurança)
  let host;
  try { host = new URL(url).hostname; } catch { host = ''; }
  const ok = host === 'uploads.mangadex.org'
    || host.endsWith('.mangadex.org')
    || host === 'mangadex.network'
    || host.endsWith('.mangadex.network')
    || host === 'mangadex.tv'
    || host.endsWith('.mangadex.tv')
    || host === 's4.anilist.co'
    || host.endsWith('.anilist.co')
    || host === 'media.kitsu.app'
    || host.endsWith('.kitsu.app')
    || host.endsWith('.kitsu.io');
  if (!ok) {
    return res.status(403).json({ error: 'Domínio não permitido' });
  }

  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Mobile Safari/537.36',
        'Accept': 'image/avif,image/webp,image/png,image/jpeg,image/*,*/*;q=0.8',
        'Referer': 'https://anilist.co/',
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
      },
    });
    if (!r.ok) {
      return res.status(r.status).send('img error');
    }
    const buf = await r.arrayBuffer();
    res.status(200);
    res.setHeader('Content-Type', r.headers.get('content-type') || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800');
    res.setHeader('Content-Length', buf.byteLength);
    res.send(Buffer.from(buf));
  } catch (e) {
    res.status(502).json({ error: 'Falha no proxy de imagem: ' + e.message });
  }
}
