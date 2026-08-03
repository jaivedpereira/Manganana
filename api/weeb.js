// Proxy para WeebCentral API (provedor de capítulos multi-idioma)
// Uso: /api/weeb?path=/search/series?query=...&limit=...

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  const { path } = req.query;
  if (!path || typeof path !== 'string') {
    return res.status(400).json({ error: 'Informe ?path=...' });
  }

  const target = 'https://api.weebcentral.com' + path;

  try {
    const r = await fetch(target, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/125.0 Mobile Safari/537.36',
        'Accept': 'application/json',
      },
    });
    const text = await r.text();
    res.status(r.status);
    res.setHeader('Content-Type', r.headers.get('content-type') || 'application/json');
    res.setHeader('Cache-Control', 'public, max-age=120, s-maxage=600');
    res.send(text);
  } catch (e) {
    res.status(502).json({ error: 'Falha no proxy WeebCentral: ' + e.message });
  }
}
