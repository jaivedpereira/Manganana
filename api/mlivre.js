// Proxy Manga Livre (.to) — provedor BR de capítulos completos em português
// Sem Cloudflare! Funciona via HTTP simples (Madara theme).
// Uso:
//   /api/mlivre?type=search&q=one+piece
//   /api/mlivre?type=manga&slug=one-piece
//   /api/mlivre?type=chapter&url=<url do capítulo>

const BASE = 'https://mangalivre.to';
const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Mobile Safari/537.36';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const { type = 'search', q = '', slug = '', url = '', src = 'to' } = req.query;

  try {
    // ============ FONTE: Vegitoons (API GreenShit — 4.494 obras BR, sem Cloudflare) ============
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
        return res.json({ data: obras, total: d.total || 0 });
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
