// Proxy serverless para a MangaDex API (resolve CORS)
// Uso: /api/proxy?path=/manga?limit=10&availableTranslatedLanguage[]=pt-br

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  // lê ?path= do query string (ex: "/manga?limit=10")
  const { path } = req.query;
  if (!path || typeof path !== 'string') {
    return res.status(400).json({ error: 'Informe ?path=/manga?...' });
  }

  const target = 'https://api.mangadex.org' + path;

  try {
    const r = await fetch(target, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Manganana/2.0 (aplicativo de leitura de mangá)',
      },
    });
    const text = await r.text();
    res.status(r.status);
    res.setHeader('Content-Type', r.headers.get('content-type') || 'application/json');
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300');
    res.send(text);
  } catch (e) {
    res.status(502).json({ error: 'Falha no proxy: ' + e.message });
  }
}
