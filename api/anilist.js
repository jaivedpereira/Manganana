// Proxy para AniList GraphQL (dados premium: nota, popularidade, personagens)
// Uso: POST /api/anilist  body: {"query": "..."}  ou  GET /api/anilist?title=...

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  let query;
  if (req.method === 'POST') {
    try {
      // no Vercel, req.body pode vir como objeto (JSON parseado) ou string
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      query = body.query;
    } catch { return res.status(400).json({ error: 'body JSON inválido' }); }
  } else {
    const title = req.query.title;
    if (!title) return res.status(400).json({ error: 'Informe ?title=...' });
    query = `{ Media(search: ${JSON.stringify(title)}, type: MANGA) {
      id title { romaji english native }
      averageScore popularity favourites chapters volumes status
      genres tags { name }
      characters(role: MAIN, perPage: 8, sort: FAVOURITES_DESC) {
        nodes { id name { full native } image { large } description }
      }
    } }`;
  }

  try {
    const r = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ query }),
    });
    const text = await r.text();
    res.status(r.status);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400');
    res.send(text);
  } catch (e) {
    res.status(502).json({ error: 'Falha no proxy AniList: ' + e.message });
  }
}
