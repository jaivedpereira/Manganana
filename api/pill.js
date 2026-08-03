// Proxy MangaPill (provedor secundário de capítulos)
// Busca SSR + capítulos + páginas via scraping serverless
// Uso:
//   /api/pill?type=search&q=berserk
//   /api/pill?type=manga&slug=723/chainsaw-man
//   /api/pill?type=chapter&slug=723-10001000/chainsaw-man-chapter-1

const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Mobile Safari/537.36';

function extractImgs(html) {
  const imgs = [];
  const re = /<img[^>]*src="([^"]+\.(?:jpe?g|png|webp|avif)[^"]*)"[^>]*>/gi;
  let m;
  while ((m = re.exec(html))) imgs.push(m[1].replace(/&amp;/g, '&'));
  return [...new Set(imgs)];
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const { type = 'search', q = '', slug = '' } = req.query;
  let url;
  if (type === 'search') url = `https://mangapill.com/search?q=${encodeURIComponent(q)}`;
  else if (type === 'manga') url = `https://mangapill.com/manga/${slug}`;
  else if (type === 'chapter') url = `https://mangapill.com/chapters/${slug}`;
  else return res.status(400).json({ error: 'tipo inválido' });

  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'en,pt-BR;q=0.9' },
    });
    if (!r.ok) return res.status(r.status).json({ error: 'MangaPill ' + r.status });
    const html = await r.text();

    if (type === 'search') {
      // DEBUG: retorna tamanho do HTML se não achar nada
      if (!html.includes('/manga/')) {
        return res.status(200).json({ data: [], debug: { htmlLen: html.length, snippet: html.slice(0, 200) } });
      }
      // extrai mangás: href + título ([\s\S] cruza quebras de linha)
      const mangaRe = /<a[^>]*href="(\/manga\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
      const out = [];
      let m;
      while ((m = mangaRe.exec(html))) {
        const body = m[2];
        const t = /<img[^>]*alt="([^"]+)"/.exec(body);
        let title = t ? t[1].trim() : '';
        // título pode vir duplicado ("Chainsaw Man Chainsaw Man")
        const half = title.length / 2;
        if (title.slice(0, Math.floor(half)) === title.slice(Math.ceil(half))) title = title.slice(0, Math.floor(half));
        if (!title) {
          const d = /<div[^>]*class="[^"]*line-clamp[^"]*"[^>]*>([^<]+)</.exec(body);
          if (d) title = d[1].trim();
        }
        const slug = m[1].replace('/manga/', '');
        if (title && !out.some((o) => o.slug === slug)) out.push({ slug, title, source: 'mangapill' });
      }
      return res.status(200).json({ data: out });
    }

    if (type === 'manga') {
      // capítulos: /chapters/ID-SEQ/slug
      const chapRe = /href="(\/chapters\/[^"]+)"[^>]*>([\s\S]{1,80}?)<\/a>/g;
      const chaps = [];
      let m;
      while ((m = chapRe.exec(html))) {
        const full = m[1].replace('/chapters/', '');
        const label = m[2].replace(/<[^>]+>/g, '').trim();
        chaps.push({ slug: full, title: label, num: label, source: 'mangapill' });
      }
      const seen = new Set();
      const uniq = chaps.filter((c) => (seen.has(c.slug) ? false : (seen.add(c.slug), true)));
      // título do mangá
      const titleM = /<h1[^>]*>([^<]{2,120})<\/h1>/.exec(html) || /<title>([^<]{2,120})<\/title>/.exec(html);
      return res.status(200).json({
        title: titleM ? titleM[1].trim() : '',
        total: uniq.length,
        chapters: uniq,
      });
    }

    if (type === 'chapter') {
      const imgs = extractImgs(html);
      return res.status(200).json({ pages: imgs });
    }

    return res.status(400).json({ error: 'tipo inválido' });
  } catch (e) {
    return res.status(502).json({ error: 'Falha no proxy MangaPill: ' + e.message });
  }
}
