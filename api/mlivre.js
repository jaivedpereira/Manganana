// Proxy Manga Livre (.to) — provedor BR de capítulos completos em português
// Sem Cloudflare! Funciona via HTTP simples (Madara theme).
// Uso:
//   /api/mlivre?type=search&q=one+piece
//   /api/mlivre?type=manga&slug=one-piece
//   /api/mlivre?type=chapter&url=<url do capítulo>

// ============ SITES MADARA (parser único reutilizável) ============
// Muitas fontes BR do Mihon usam o tema Madara (WordPress). Todas seguem o
// mesmo padrão de URLs, então reusamos UM parser variando apenas o domínio.
// Whitelist das confirmadas acessíveis (sem Cloudflare = funciona no servidor).
const MADARA_SITES = {
  'mangalivre': { domain: 'mangalivre.to', label: 'Manga Livre', color: '#4a7fc1' },
  'fenix': { domain: 'fenixproject.site', label: 'Fenix Project', color: '#7a5fc7' },
  'ghost': { domain: 'ghostscan.xyz', label: 'Ghost Scan', color: '#3d9c6a' },
  'nebulosa': { domain: 'nebulosascan.com', label: 'Nebulosa Scan', color: '#c0504d' },
  'ninja': { domain: 'ninjacomics.xyz', label: 'Ninja Comics', color: '#4a7fc1' },
  'montetai': { domain: 'montetaiscanlator.xyz', label: 'Montetai', color: '#7a5fc7' },
  'osaka': { domain: 'osakascan.com', label: 'Osaka Scan', color: '#3d9c6a' },
  'nocturne': { domain: 'nocfsb.com', label: 'Nocturne Summer', color: '#d4a94e' },
  'tia': { domain: 'tiamanhwa.com', label: 'Tia Manhwa', color: '#c0504d' },
  'flower': { domain: 'flowermangas.net', label: 'Flower Manga', color: '#3d9c6a' },
  'little': { domain: 'tiraninha.world', label: 'Little Tyrant', color: '#7a5fc7' },
  'geass': { domain: 'geasscomics.xyz', label: 'Geass Comics', color: '#4a7fc1' },
  'hiper': { domain: 'hipertoon.com', label: 'Hiper Toon', color: '#d4a94e' },
  'mangalivreblog': { domain: 'mangalivre.blog', label: 'Manga Livre Blog', color: '#4a7fc1' },
};

const BASE = 'https://mangalivre.to';
const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Mobile Safari/537.36';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const { type = 'search', q = '', slug = '', url = '', src = 'to' } = req.query;

  try {
    // ===== SITES MADARA: parser único parametrizado por domínio =====
    // src=madara:<site>  →  ex: /api/mlivre?src=madara:fenix&type=search&q=
    if (src.startsWith('madara:')) {
      const siteKey = src.slice(7);
      const site = MADARA_SITES[siteKey];
      if (!site) return res.status(400).json({ error: 'site madara desconhecido: ' + siteKey });
      const S = 'https://' + site.domain;
      const SH = { 'User-Agent': UA, 'Accept-Language': 'pt-BR,pt;q=0.9' };

      if (type === 'search') {
        const r = await fetch(`${S}/?s=${encodeURIComponent(q)}`, { headers: SH });
        const html = await r.text();
        // todos os resultados de mangá da busca
        const links = [...html.matchAll(new RegExp('href="[^"]*' + site.domain.replace(/\./g, '\\.') + '/(manga|serie|leitor|comic|obra)/([^"/]+)/"', 'g'))];
        const seen = new Set(); const out = [];
        for (const m of links) {
          const slugM = m[2];
          if (seen.has(slugM)) continue;
          seen.add(slugM);
          out.push({ slug: slugM, title: slugM.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()), site: siteKey });
        }
        return res.json({ data: out.slice(0, 20) });
      }
      if (type === 'list') {
        const page = parseInt(req.query.page || '1', 10);
        const order = req.query.sort === 'latest' ? 'latest' : 'views';
        const r = await fetch(`${S}/manga/?m_orderby=${order}&page=${page}`, { headers: SH });
        const html = await r.text();
        const items = [...html.matchAll(/href="([^"]*?)\/(manga|serie|leitor|comic|obra)\/([^"/]+)\/"[^>]*>\s*<img[^>]*src="([^"]+)"/g)]
          .map((m) => ({ slug: m[3], cover: m[4] }));
        const out = items.map((it) => ({
          slug: it.slug, cover: it.cover,
          title: it.slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
        }));
        return res.json({ data: out, hasNext: out.length >= 24, page, site: siteKey });
      }
      if (type === 'manga') {
        const r = await fetch(`${S}/manga/${slug}/ajax/chapters`, {
          method: 'POST',
          headers: { ...SH, 'Referer': `${S}/manga/${slug}/`, 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/x-www-form-urlencoded' },
        });
        const html = await r.text();
        const caps = [...html.matchAll(/href="([^\"]*capitulo-[^\"/]+)\/?"/g)].map((m) => m[1]);
        const seen = new Set(); const out = [];
        for (const u of caps) {
          const numM = u.match(/capitulo-(\d+(?:\.\d+)?)/);
          if (!numM) continue;
          const num = numM[1];
          if (seen.has(num)) continue;
          seen.add(num);
          out.push({ num, url: u });
        }
        out.sort((a, b) => parseFloat(a.num) - parseFloat(b.num));
        // título real
        let title = '';
        try { const sp = await fetch(`${S}/manga/${slug}/`, { headers: SH }); const ph = await sp.text(); const h1 = ph.match(/<h1[^>]*>([^<]+)<\/h1>/); if (h1) title = h1[1].trim(); } catch {}
        return res.json({ total: out.length, title, chapters: out, site: siteKey });
      }
      if (type === 'chapter') {
        const r = await fetch(url, { headers: { ...SH, 'Referer': S } });
        const html = await r.text();
        // imagens reais do capítulo: exclui logo/marca/compartilhar e exige ser de um cdn de leitor
        const imgs = [...html.matchAll(/<img[^>]+src="([^"]+(?:\.webp|\.jpg|\.jpeg|\.png)[^"]*)"/g)]
          .map((m) => m[1])
          .filter((u) => !/logo|banner|favicon|icon|watermark|share|avatar|loading|placeholder|thumb|social/i.test(u))
          .filter((u, i, arr) => arr.indexOf(u) === i); // dedup
        return res.json({ total: imgs.length, images: imgs });
      }
      return res.status(400).json({ error: 'tipo inválido madara' });
    }

    // ============ FONTE: Manga Livre .to (Madara — sem Cloudflare) ============
    if (src === 'vegi') {
      const VAPI = 'https://api.vegitoons.black';
      if (type === 'search') {
        const r = await fetch(`${VAPI}/obras/buscar?obr_nome=${encodeURIComponent(q)}&pagina=1`, {
          headers: { 'User-Agent': UA },
        });
        const d = await r.json();
        const obras = (d.obras || []).map((o) => ({
          id: o.obr_id, slug: String(o.obr_id), title: o.obr_nome || '',
          cover: o.obr_imagem || '',
        }));
        return res.json({ data: obras, total: d.total || 0, hasNext: d.pagina < d.totalPaginas });
      }
      // listagem por ranking (navegação do catálogo)
      if (type === 'list') {
        const page = parseInt(req.query.page || '1', 10);
        const r = await fetch(`${VAPI}/obras/ranking?pagina=${page}`, { headers: { 'User-Agent': UA } });
        const d = await r.json();
        const obras = (d.obras || []).map((o, i) => ({
          id: o.obr_id, slug: String(o.obr_id), title: o.obr_nome || '',
          cover: o.obr_imagem || '', rank: (page - 1) * 20 + i + 1,
        }));
        return res.json({ data: obras, total: d.total || 0, hasNext: page < d.totalPaginas, page });
      }
      if (type === 'manga') {
        const r = await fetch(`${VAPI}/obras/${slug}`, { headers: { 'User-Agent': UA } });
        const d = await r.json();
        const caps = (d.capitulos || [])
          .map((c) => ({ num: String(c.cap_numero), id: String(c.cap_id), title: c.cap_nome || '' }))
          .sort((a, b) => parseFloat(a.num) - parseFloat(b.num));
        return res.json({ total: caps.length, title: d.obr_nome || '', chapters: caps });
      }
      if (type === 'chapter') {
        const r = await fetch(`${VAPI}/capitulos/${slug}`, { headers: { 'User-Agent': UA } });
        const d = await r.json();
        const pages = (d.cap_paginas || []).map((u, i) => ({ number: i + 1, imageUrl: u }));
        return res.json({ total: pages.length, images: pages.map((p) => p.imageUrl) });
      }
      return res.status(400).json({ error: 'tipo inválido' });
    }

    // ============ FONTE: Comick .live (agregador global — capítulos BR via servidor) ============
    if (src === 'ck') {
      const CK = 'https://comick.live';
      const CKH = { 'User-Agent': UA, 'Referer': 'https://comick.live/', 'Accept': 'application/json' };
      if (type === 'search') {
        // busca via api.comick.dev (sem CF na busca)
        const r = await fetch('https://api.comick.dev/v1.0/search?q=' + encodeURIComponent(q) + '&limit=8', {
          headers: { 'User-Agent': UA },
        });
        if (!r.ok) throw new Error('ck search ' + r.status);
        const d = await r.json();
        const list = (d || []).map((m) => ({
          slug: m.slug, title: m.title || (m.md_titles || []).map((t) => t.title).find(Boolean) || m.slug,
          hid: m.hid, lastChapter: m.last_chapter || 0,
        }));
        return res.json({ data: list });
      }
      if (type === 'manga') {
        const lang = req.query.lang || 'pt-br';
        let all = [], page = 1;
        for (;;) {
          const r = await fetch(`${CK}/api/comics/${slug}/chapter-list?lang=${lang}&page=${page}`, { headers: CKH });
          if (!r.ok) throw new Error('ck caps ' + r.status);
          const d = await r.json();
          const data = d?.data || [];
          all = all.concat(data);
          if (!d?.hasNextPage || !data.length || page > 10) break;
          page++;
        }
        const caps = all.map((c) => ({
          num: String(c.chap), hid: c.hid, title: c.title || '', vol: c.vol || '',
          group: (c.group_name || []).join(', '),
        }));
        return res.json({ total: caps.length, title: slug.replace(/-/g, ' '), chapters: caps });
      }
      if (type === 'chapter') {
        // página do leitor: /comic/{slug}/{hid}-chapter-{chap}-{lang} tem o JSON #sv-data
        const r = await fetch(`${CK}/comic/${slug}/${req.query.hid}-chapter-${req.query.chap}-${req.query.lang || 'pt-br'}`, {
          headers: { 'User-Agent': UA, 'Referer': 'https://comick.live/' },
        });
        if (!r.ok) throw new Error('ck reader ' + r.status);
        const html = await r.text();
        const m = html.match(/id="sv-data"[^>]*>([^<]+)</);
        if (!m) throw new Error('sem sv-data');
        const d = JSON.parse(m[1]);
        const imgs = (d?.chapter?.images || []).map((i) => i.url);
        return res.json({ total: imgs.length, images: imgs });
      }
      return res.status(400).json({ error: 'tipo inválido' });
    }

    // ============ FONTE: Manga Livre .to (Madara — sem Cloudflare) ============
    if (type === 'list') {
      // listagem do catálogo (página de biblioteca do Madara por ordenação)
      const page = parseInt(req.query.page || '1', 10);
      const order = req.query.sort === 'latest' ? 'latest' : 'views';
      const r = await fetch(`${BASE}/manga/?m_orderby=${order}&page=${page}`, {
        headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR,pt;q=0.9' },
      });
      const html = await r.text();
      const items = [...html.matchAll(/href="([^"]*manga\/([^"/]+)\/)"[^>]*>\s*<img[^>]*src="([^"]+)"/g)]
        .map((m) => ({ slug: m[2], cover: m[3] }));
      const out = items.map((it) => ({
        slug: it.slug, cover: it.cover,
        title: it.slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      }));
      return res.json({ data: out, hasNext: out.length >= 24, page });
    }
    if (type === 'search') {
      // busca: pega o primeiro resultado de mangá
      const r = await fetch(`${BASE}/?s=${encodeURIComponent(q)}`, {
        headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR,pt;q=0.9' },
      });
      const html = await r.text();
      const m = html.match(new RegExp('href="' + BASE.replace(/\./g, '\\.') + '/manga/([^"/]+)/"'));
      if (!m) return res.json({ data: [] });
      const slugM = m[1];
      // título real: h1 da página do mangá
      let title = slugM.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      try {
        const pr = await fetch(`${BASE}/manga/${slugM}/`, {
          headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR' },
        });
        const ph = await pr.text();
        const h1 = ph.match(/<h1[^>]*>([^<]+)<\/h1>/);
        if (h1) title = h1[1].trim();
      } catch {}
      return res.json({ data: [{ slug: slugM, title }] });
    }

    if (type === 'manga') {
      // lista de capítulos via AJAX do Madara
      const r = await fetch(`${BASE}/manga/${slug}/ajax/chapters`, {
        method: 'POST',
        headers: {
          'User-Agent': UA,
          'Referer': `${BASE}/manga/${slug}/`,
          'X-Requested-With': 'XMLHttpRequest',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });
      const html = await r.text();
      const caps = [...html.matchAll(/href="([^"]*capitulo-[^"/]+)\/?"/g)].map((m) => m[1]);
      const seen = new Set();
      const out = [];
      for (const u of caps) {
        const numM = u.match(/capitulo-(\d+(?:\.\d+)?)/);
        if (!numM) continue;
        const num = numM[1];
        if (seen.has(num)) continue;
        seen.add(num);
        out.push({ num, url: u });
      }
      out.sort((a, b) => parseFloat(a.num) - parseFloat(b.num));
      return res.json({ total: out.length, chapters: out });
    }

    if (type === 'chapter') {
      // páginas do capítulo (imagens no HTML)
      const r = await fetch(url, {
        headers: { 'User-Agent': UA, 'Referer': BASE + '/', 'Accept-Language': 'pt-BR' },
      });
      const html = await r.text();
      const block = html.match(/<div class="reading-content[^>]*>(.*?)<\/div>\s*<\/div>/s);
      const src = block ? block[1] : html;
      const imgs = [...src.matchAll(/<img[^>]*src="\s*([^"]+)"/g)]
        .map((m) => m[1].trim())
        .filter((u) => u.includes('uploads'));
      return res.json({ total: imgs.length, images: imgs });
    }

    return res.status(400).json({ error: 'tipo inválido' });
  } catch (e) {
    return res.status(502).json({ error: 'Falha no proxy Manga Livre: ' + e.message });
  }
}
