/* ===== Manganana — app.js =====
   Fonte de dados: MangaDex API v5 (api.mangadex.org)
   - Catálogo: mangás com tradução pt-br
   - Capas: uploads.mangadex.org/covers/{mangaId}/{fileName}
   - Capítulos: feed do mangá em pt-br
   - Leitor: at-home server (páginas dos capítulos)
*/

'use strict';

const API = 'https://api.mangadex.org';
const CDN = 'https://uploads.mangadex.org';
const CORS = 'https://corsproxy.io/?url='; // fallback p/ imagens bloqueadas por hotlink

// Em produção (Vercel) usamos o proxy serverless p/ evitar bloqueio CORS do MangaDex.
// Em localhost a API responde CORS normalmente, então chamamos direto.
const API_BASE = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
  ? API
  : '/api/proxy';

// Proxy de imagens: o MangaDex bloqueia User-Agent de navegador (404), então
// em produção as imagens passam pelo nosso proxy com UA de servidor.
const IMG_PROXY = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
  ? null
  : '/api/img?url=';
function px(url) { return IMG_PROXY ? IMG_PROXY + encodeURIComponent(url) : url; }

/* ---------- util ---------- */
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function toast(msg, icon) {
  const t = $('#toast');
  t.innerHTML = '';
  if (icon) {
    const i = document.createElement('span');
    i.className = 'toast-icon';
    i.textContent = icon;
    t.appendChild(i);
  }
  const s = document.createElement('span');
  s.textContent = msg;
  t.appendChild(s);
  t.classList.remove('show');
  // força reflow pra reiniciar a animação
  void t.offsetWidth;
  t.classList.add('show');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove('show'), 2200);
}

// tempo relativo: "agora", "há 5 min", "há 3 h", "há 2 d"
function relTime(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'agora';
  if (m < 60) return `há ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 7) return d === 1 ? 'há 1 dia' : `há ${d} dias`;
  const w = Math.floor(d / 7);
  if (w < 5) return `há ${w} sem`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `há ${mo} ${mo === 1 ? 'mês' : 'meses'}`;
  return `há ${Math.floor(d / 365)} ano(s)`;
}

function store(key, val) { localStorage.setItem('mn_' + key, JSON.stringify(val)); }
function load(key, def) { try { return JSON.parse(localStorage.getItem('mn_' + key)) ?? def; } catch { return def; } }

/* ---------- estado ---------- */
const state = {
  tab: 'home',
  settings: load('settings', { mode: 'vertical', quality: 'full', rtl: false, dark: true, theme: 'dark', readerBg: 'auto', readerBright: 100, readerWidth: 100, readerContrast: 100, readerSat: 100, readerSharp: 'soft', webtoon: false, tapZones: false }),
  favs: load('favs', []),           // [{id, title, cover}]
  history: load('history', []),     // [{id, title, cover, chapter, chapterId, page, ts}]
  readCount: load('readCount', {}), // {mangaId: n páginas lidas}
  explore: { query: '', genre: 'all', offset: 0, loading: false },
  filters: load('filters', { status: '', year: '', sort: 'followedCount' }), // busca avançada
  searchHistory: load('searchHistory', []), // últimas buscas do usuário
  detail: null,          // mangá atual
  premium: null,         // dados premium (AniList) do mangá atual
  chapters: [],          // capítulos do mangá atual (provedor/idioma ativo)
  allChapters: {},       // cache: {lang: [capítulos]} por idioma
  autoProvider: {},      // cache: {lang: provedor escolhido automaticamente}
  lang: 'pt-br',         // idioma ativo
  provider: 'mangadex',  // provedor ativo: mangadex | mangapill
  pill: null,          // match no MangaPill {slug, title}
  ml: null,            // match no Manga Livre {slug, title} (capítulos BR completos)
  vegi: null,          // match na Vegitoons {id, title} (manhwas BR)
  ck: null,            // match no Comick {slug, title} (agregador global — direto do browser)
  brExtra: null,       // capítulos BR extras do scraper {title, chapters:{num:{zip,pages,ts}}}
  reader: null,          // {manga, chapter, pages, baseUrl, hash, idx, provider}
  genres: [],            // tags do MangaDex
};

/* ---------- AniList: dados premium (nota, popularidade, personagens) ---------- */
const ANILIST_URL = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
  ? 'https://graphql.anilist.co'
  : '/api/anilist';

async function fetchAniList(title) {
  const query = `{ Media(search: ${JSON.stringify(title)}, type: MANGA) {
    id title { romaji english }
    averageScore popularity favourites chapters volumes status
    genres
    characters(role: MAIN, perPage: 8, sort: FAVOURITES_DESC) {
      nodes { id name { full } image { large } description }
    }
  } }`;
  const r = await fetch(ANILIST_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!r.ok) throw new Error('AniList ' + r.status);
  const d = await r.json();
  return d?.data?.Media || null;
}

function anilistScore(media) {
  const s = media?.averageScore;
  return s != null ? (s / 10).toFixed(1) : null;
}

function scoreStars(score) {
  if (score == null) return '';
  const n = parseFloat(score);
  const full = Math.round(n / 2); // 10 -> 5 estrelas
  return '★'.repeat(full) + '☆'.repeat(5 - full);
}

function cleanAniDesc(desc) {
  // remove metadados do AniList (Height/Age/Birthday/etc) que aparecem como __Campo__: valor
  let d = (desc || '')
    .replace(/__([^_]+)__\s*:\s*[^A-Z]{0,50}/g, '')  // __Height__: 152 cm (4'11") ...
    .replace(/__([^_]+)__/g, '')
    .replace(/<[^>]+>/g, '')           // HTML
    .replace(/\s+/g, ' ')
    .trim();
  // remove links do AniList [Nome](url)
  d = d.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  // se ainda sobrou prefixo de metadado sem o __...__ (ex: "Height: 152 cm"), remove
  d = d.replace(/^(height|age|birthday|birthplace|blood type|occupation|affiliation|relatives|alias|nickname)\s*:?\s*[^A-Z]{0,50}/i, '');
  return d.trim();
}

// cache de traduções em localStorage
const TR_CACHE_KEY = 'trCache';
function trCache() {
  try { return JSON.parse(localStorage.getItem(TR_CACHE_KEY) || '{}'); } catch { return {}; }
}
function trCacheSave(c) {
  try { localStorage.setItem(TR_CACHE_KEY, JSON.stringify(c)); } catch {}
}

// traduz texto EN -> PT-BR via Google Translate (grátis, sem chave), com cache
async function translatePt(text) {
  if (!text || text.length < 12) return text;
  const c = trCache();
  const key = text.slice(0, 60);
  if (c[key]) return c[key];
  try {
    const r = await fetch('https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=pt&dt=t&q=' + encodeURIComponent(text.slice(0, 1800)));
    if (!r.ok) return text;
    const d = await r.json();
    const out = (d?.[0] || []).map((s) => s?.[0] || '').join('');
    if (out) {
      c[key] = out;
      trCacheSave(c);
      return out;
    }
  } catch {}
  return text;
}

// traduz descrições dos personagens em lote (com cache por personagem)
async function translateCharDesc(c) {
  const cKey = 'tr_' + c.id;
  const cache = trCache();
  if (cache[cKey]) return cache[cKey];
  const clean = cleanAniDesc(c.description);
  if (clean.length < 12) return clean;
  const pt = await translatePt(clean);
  cache[cKey] = pt;
  trCacheSave(cache);
  return pt;
}

function anilistStatusPt(status) {
  const map = {
    FINISHED: 'Completo', RELEASING: 'Publicando', NOT_YET_RELEASED: 'Em breve',
    CANCELLED: 'Cancelado', HIATUS: 'Hiato',
  };
  return map[status] || status || '';
}

/* ---------- MangaPill (provedor secundário) ---------- */
const PILL_URL = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
  ? 'https://mangapill.com'
  : '/api/pill';

async function pillSearch(q) {
  const url = PILL_URL.startsWith('http')
    ? `${PILL_URL}/search?q=${encodeURIComponent(q)}`
    : `${PILL_URL}?type=search&q=${encodeURIComponent(q)}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error('MangaPill ' + r.status);
  const d = await r.json();
  return d.data || [];
}

async function pillManga(slug) {
  const url = PILL_URL.startsWith('http')
    ? `${PILL_URL}/manga/${slug}`
    : `${PILL_URL}?type=manga&slug=${encodeURIComponent(slug)}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error('MangaPill ' + r.status);
  return r.json();
}

async function pillChapter(slug) {
  const url = PILL_URL.startsWith('http')
    ? `${PILL_URL}/chapters/${slug}`
    : `${PILL_URL}?type=chapter&slug=${encodeURIComponent(slug)}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error('MangaPill ' + r.status);
  return r.json();
}

/* ---------- idiomas ---------- */
const LANG_NAMES = {
  'pt-br': 'Português (BR)', 'pt': 'Português', 'en': 'Inglês', 'es-la': 'Espanhol (LATAM)',
  'es': 'Espanhol', 'fr': 'Francês', 'ja': 'Japonês', 'ko': 'Coreano', 'zh': 'Chinês',
  'zh-hk': 'Chinês (HK)', 'ru': 'Russo', 'de': 'Alemão', 'it': 'Italiano', 'ar': 'Árabe',
  'id': 'Indonésio', 'th': 'Tailandês', 'vi': 'Vietnamita', 'uk': 'Ucraniano', 'tr': 'Turco',
  'fa': 'Persa', 'pl': 'Polonês', 'hi': 'Hindi', 'ms': 'Malaio', 'fil': 'Filipino',
  'ka': 'Georgiano', 'he': 'Hebraico', 'el': 'Grego', 'nl': 'Holandês', 'sv': 'Sueco',
  'da': 'Dinamarquês', 'no': 'Norueguês', 'fi': 'Finlandês', 'cs': 'Tcheco', 'hu': 'Húngaro',
  'ro': 'Romeno', 'bg': 'Búlgaro', 'sr': 'Sérvio', 'hr': 'Croata', 'sk': 'Eslovaco',
  'sl': 'Esloveno', 'lt': 'Lituano', 'lv': 'Letão', 'et': 'Estoniano', 'bn': 'Bengali',
  'ta': 'Tâmil', 'te': 'Telugu', 'ml': 'Malaiala', 'kn': 'Canarês', 'ur': 'Urdu',
  'ne': 'Nepalês', 'sw': 'Suaíli', 'af': 'Africâner', 'sq': 'Albanês', 'az': 'Azerbaijano',
  'be': 'Bielorrusso', 'ca': 'Catalão', 'cy': 'Galês', 'eu': 'Basco', 'gl': 'Galego',
  'is': 'Islandês', 'mk': 'Macedônio', 'mn': 'Mongol', 'my': 'Birmanês', 'kk': 'Cazaque',
  'km': 'Khmer', 'lo': 'Laosiano', 'uz': 'Uzbeque', 'si': 'Cingalês', 'am': 'Amárico',
  'hy': 'Armênio', 'kaa': 'Caracalpaque', 'tl': 'Tagalo', 'jv': 'Javanês', 'su': 'Sundanês',
  'ceb': 'Cebuano', 'haw': 'Havaiano', 'mi': 'Maori', 'sm': 'Samoano',
};
function langName(code) { return LANG_NAMES[code] || code; }

// lista os idiomas disponíveis para o mangá (feed do MangaDex, 1ª página)
async function mangaLanguages(mangaId) {
  const p = new URLSearchParams();
  p.set('limit', 100);
  p.set('offset', 0);
  p.set('order[chapter]', 'asc');
  p.append('contentRating[]', 'safe');
  p.append('contentRating[]', 'suggestive');
  const data = await mdFetch(`/manga/${mangaId}/feed?` + p.toString());
  const counts = {};
  for (const c of data.data ?? []) {
    const l = c.attributes.translatedLanguage;
    counts[l] = (counts[l] || 0) + 1;
  }
  // ordena: pt-br primeiro, depois por quantidade
  return Object.entries(counts)
    .sort((a, b) => {
      const pa = a[0] === 'pt-br' ? -2 : (a[0] === 'en' ? -1 : 0);
      const pb = b[0] === 'pt-br' ? -2 : (b[0] === 'en' ? -1 : 0);
      return pb - pa || b[1] - a[1];
    })
    .map(([code, count]) => ({ code, count }));
}

// busca capítulos do MangaDex num idioma específico
async function getChaptersLang(mangaId, lang) {
  const out = [];
  let offset = 0;
  for (;;) {
    const p = new URLSearchParams();
    p.set('limit', 500);
    p.set('offset', offset);
    p.set('translatedLanguage[]', lang);
    p.set('order[chapter]', 'asc');
    p.append('contentRating[]', 'safe');
    p.append('contentRating[]', 'suggestive');
    p.append('includes[]', 'scanlation_group');
    const data = await mdFetch(`/manga/${mangaId}/feed?` + p.toString());
    const batch = data.data ?? [];
    out.push(...batch);
    if (batch.length < 500 || !data.total || out.length >= data.total) break;
    offset += 500;
  }
  const seen = new Set();
  return out.filter((c) => {
    const n = c.attributes.chapter ?? '';
    if (n === '' || seen.has(n)) return false;
    seen.add(n);
    return true;
  }).sort((a, b) => (parseFloat(a.attributes.chapter) || 0) - (parseFloat(b.attributes.chapter) || 0));
}

// tenta achar o mesmo mangá no MangaPill pelo título
async function findOnPill(title) {
  try {
    const res = await pillSearch(title.split(':')[0].trim().slice(0, 40));
    if (!res.length) return null;
    const t = title.toLowerCase();
    // tenta casar por similaridade simples
    const words = t.split(/\s+/).filter((w) => w.length > 3);
    const scored = res
      .map((m) => {
        const mt = m.title.toLowerCase();
        let score = 0;
        for (const w of words) if (mt.includes(w)) score++;
        return { ...m, score };
      })
      .sort((a, b) => b.score - a.score);
    return scored[0] && scored[0].score > 0 ? scored[0] : null;
  } catch { return null; }
}

/* ---------- Manga Livre (provedor BR — capítulos completos em pt-br) ---------- */
const ML_URL = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
  ? 'https://mangalivre.to'
  : '/api/mlivre';

async function mlSearch(q) {
  const url = ML_URL.startsWith('http')
    ? `${ML_URL}/?s=${encodeURIComponent(q)}`
    : `${ML_URL}?type=search&q=${encodeURIComponent(q)}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error('Manga Livre ' + r.status);
  const d = await r.json();
  return d.data || [];
}

async function mlManga(slug) {
  const url = ML_URL.startsWith('http')
    ? `${ML_URL}/manga/${slug}/ajax/chapters`
    : `${ML_URL}?type=manga&slug=${encodeURIComponent(slug)}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error('Manga Livre ' + r.status);
  return r.json();
}

async function mlChapterPages(capUrl) {
  const url = ML_URL.startsWith('http')
    ? capUrl
    : `${ML_URL}?type=chapter&url=${encodeURIComponent(capUrl)}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error('Manga Livre ' + r.status);
  const d = await r.json();
  return d.images || [];
}

async function findOnMl(title) {
  try {
    const res = await mlSearch(title.split(':')[0].trim().slice(0, 40));
    if (!res.length) return null;
    // valida por similaridade (evita falso positivo tipo "punpun" → "Witches and Cigarettes")
    const t = title.toLowerCase();
    const words = t.split(/\s+/).filter((w) => w.length > 3);
    let best = null, bestScore = 0;
    for (const m of res) {
      const mt = (m.title || m.slug || '').toLowerCase();
      let score = 0;
      for (const w of words) if (mt.includes(w)) score++;
      // bônus se o slug bate com alguma palavra do título
      const slugWords = (m.slug || '').split('-');
      for (const w of words) if (slugWords.includes(w)) score += 2;
      if (score > bestScore) { bestScore = score; best = m; }
    }
    // exige pelo menos 1 palavra em comum (ou match parcial forte)
    if (!best || bestScore < 1) return null;
    return best;
  } catch { return null; }
}

/* ---------- Vegitoons (API GreenShit — 4.494 obras BR, sem Cloudflare) ---------- */
async function vegiSearch(q) {
  const r = await fetch(`/api/mlivre?src=vegi&type=search&q=${encodeURIComponent(q)}`);
  if (!r.ok) throw new Error('Vegitoons ' + r.status);
  return r.json();
}
async function vegiManga(id) {
  const r = await fetch(`/api/mlivre?src=vegi&type=manga&slug=${encodeURIComponent(id)}`);
  if (!r.ok) throw new Error('Vegitoons ' + r.status);
  return r.json();
}
async function vegiChapter(id) {
  const r = await fetch(`/api/mlivre?src=vegi&type=chapter&slug=${encodeURIComponent(id)}`);
  if (!r.ok) throw new Error('Vegitoons ' + r.status);
  const d = await r.json();
  return d.images || [];
}
async function findOnVegi(title) {
  try {
    const d = await vegiSearch(title.split(':')[0].trim().slice(0, 40));
    if (!d.data || !d.data.length) return null;
    const t = title.toLowerCase();
    const words = t.split(/\s+/).filter((w) => w.length > 3);
    let best = null, bestScore = 0;
    for (const m of d.data) {
      const mt = (m.title || '').toLowerCase();
      let score = 0;
      for (const w of words) if (mt.includes(w)) score++;
      if (score > bestScore) { bestScore = score; best = m; }
    }
    if (!best || bestScore < 1) return null;
    return best;
  } catch { return null; }
}
/* ---------- Comick (agregador global — capítulos BR via proxy do Vercel) ---------- */
async function ckSearch(q) {
  const r = await fetch(`/api/mlivre?src=ck&type=search&q=${encodeURIComponent(q)}`);
  if (!r.ok) throw new Error('Comick ' + r.status);
  const d = await r.json();
  return d.data || [];
}

async function ckChapters(slug, lang) {
  const r = await fetch(`/api/mlivre?src=ck&type=manga&slug=${encodeURIComponent(slug)}&lang=${encodeURIComponent(lang)}`);
  if (!r.ok) throw new Error('Comick ' + r.status);
  const d = await r.json();
  return d.chapters || [];
}

async function ckChapterPages(slug, hid, chap, lang) {
  const r = await fetch(`/api/mlivre?src=ck&type=chapter&slug=${encodeURIComponent(slug)}&hid=${encodeURIComponent(hid)}&chap=${encodeURIComponent(chap)}&lang=${encodeURIComponent(lang)}`);
  if (!r.ok) throw new Error('Comick ' + r.status);
  const d = await r.json();
  return d.images || [];
}

async function findOnCk(title) {
  try {
    const res = await ckSearch(title.split(':')[0].trim().slice(0, 40));
    if (!res.length) return null;
    const t = title.toLowerCase();
    const words = t.split(/\s+/).filter((w) => w.length > 3);
    let best = null, bestScore = 0;
    for (const m of res) {
      const mt = (m.title || m.slug || '').toLowerCase();
      let score = 0;
      for (const w of words) if (mt.includes(w)) score++;
      if (score > bestScore) { bestScore = score; best = m; }
    }
    if (!best || bestScore < 1) return null;
    return best;
  } catch { return null; }
}
/* ---------- MangaDex API ---------- */
// lê o índice de capítulos BR extras (salvos pelo scraper do celular via GitHub)
let brExtraCache = null;
async function brExtraData() {
  if (brExtraCache) return brExtraCache;
  try {
    const r = await fetch('https://raw.githubusercontent.com/jaivedpereira/manganana-br-data/main/br_extra.json', {
      headers: { 'Accept': 'application/json' },
    });
    if (!r.ok) { brExtraCache = {}; return brExtraCache; }
    brExtraCache = await r.json();
  } catch { brExtraCache = {}; }
  return brExtraCache;
}
async function mdFetch(path) {
  const url = API_BASE === API
    ? API + path                       // localhost: direto
    : API_BASE + '?path=' + encodeURIComponent(path); // produção: proxy
  const r = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!r.ok) throw new Error('MangaDex ' + r.status);
  return r.json();
}

function mangaTitle(m) {
  const t = m?.attributes?.title ?? {};
  return t['pt-br'] || t['pt'] || t.en || t['ja'] || Object.values(t)[0] || 'Sem título';
}
function mangaAltTitles(m) {
  const alts = m?.attributes?.altTitles ?? [];
  for (const a of alts) if (a['pt-br'] || a['pt']) return a['pt-br'] || a['pt'];
  return '';
}
function mangaDesc(m) {
  const d = m?.attributes?.description ?? {};
  let s = d['pt-br'] || d['pt'] || d.en || Object.values(d)[0] || '';
  return s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}
function mangaCover(m) {
  if (m?._cover) return m._cover; // fonte externa (Comick/Vegitoons) já traz a capa
  const rel = (m?.relationships ?? []).find((r) => r.type === 'cover_art');
  const fn = rel?.attributes?.fileName;
  return fn ? px(`${CDN}/covers/${m.id}/${fn}.256.jpg`) : '';
}
function mangaCoverFull(m) {
  if (m?._cover) return m._cover; // fonte externa (Comick/Vegitoons) já traz a capa
  const rel = (m?.relationships ?? []).find((r) => r.type === 'cover_art');
  const fn = rel?.attributes?.fileName;
  return fn ? px(`${CDN}/covers/${m.id}/${fn}.512.jpg`) : '';
}
function mangaYear(m) { return m?.attributes?.year || ''; }
function mangaAuthors(m) {
  return (m?.relationships ?? [])
    .filter((r) => r.type === 'author' || r.type === 'artist')
    .map((r) => r.attributes?.name).filter(Boolean).slice(0, 3).join(', ');
}
function mangaTags(m) {
  const map = {};
  (m?.attributes?.tags ?? []).forEach((t) => {
    const name = t.attributes?.name;
    const pt = name?.['pt-br'] || name?.en || '';
    if (pt && !t.attributes.group.includes('format')) map[pt] = true;
  });
  return Object.keys(map).slice(0, 4);
}
function chapterNum(ch) {
  const n = ch?.attributes?.chapter;
  if (n == null || n === '') return '—';
  return 'Cap. ' + String(Number(n) || n);
}
function chapterTitle(ch) {
  const t = ch?.attributes?.title;
  if (t && t.trim()) return t.trim().slice(0, 48);
  return '';
}
function timeAgo(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return ''; // data inválida (undefined/null/etc) → sem data
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 60) return 'agora';
  if (s < 3600) return Math.floor(s / 60) + ' min';
  if (s < 86400) return Math.floor(s / 3600) + 'h';
  if (s < 604800) return Math.floor(s / 86400) + 'd';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}
function pct(n) { return Number(n).toFixed(1); }

async function searchManga({ query = '', genre = 'all', offset = 0, limit = 24, order = 'followedCount', status = '', year = '', sort = '', lang = 'pt-br' }) {
  const p = new URLSearchParams();
  p.set('limit', limit);
  p.set('offset', offset);
  p.append('includes[]', 'cover_art');
  p.append('includes[]', 'author');
  p.append('includes[]', 'artist');
  if (lang && lang !== 'all') {
    p.set('availableTranslatedLanguage[]', lang);
  }
  // ordenação: filtro avançado tem prioridade, senão usa o order padrão
  const ord = sort || order;
  if (ord === 'title') p.set('order[title]', 'asc');
  else p.set('order[' + ord + ']', 'desc');
  p.append('contentRating[]', 'safe');
  p.append('contentRating[]', 'suggestive');
  if (query) p.set('title', query);
  if (genre !== 'all') p.set('includedTags[]', genre);
  if (status) p.append('status[]', status); // MangaDex exige array
  if (year === 'antigo') p.set('year', 2019); // retorna 2019 e anteriores
  else if (year) p.set('year', year);
  const data = await mdFetch('/manga?' + p.toString());
  return data.data ?? [];
}

async function getManga(id) {
  const data = await mdFetch(`/manga/${id}?includes[]=cover_art&includes[]=author&includes[]=artist`);
  return data.data;
}

async function getChapters(mangaId) {
  const out = [];
  let offset = 0;
  for (;;) {
    const p = new URLSearchParams();
    p.set('limit', 500);
    p.set('offset', offset);
    p.set('translatedLanguage[]', 'pt-br');
    p.set('order[chapter]', 'asc');
    p.append('contentRating[]', 'safe');
    p.append('contentRating[]', 'suggestive');
    p.append('includes[]', 'scanlation_group');
    const data = await mdFetch(`/manga/${mangaId}/feed?` + p.toString());
    const batch = data.data ?? [];
    out.push(...batch);
    if (batch.length < 500 || !data.total || out.length >= data.total) break;
    offset += 500;
  }
  // remove duplicados pelo número
  const seen = new Set();
  return out.filter((c) => {
    const n = c.attributes.chapter ?? '';
    if (n === '' || seen.has(n)) return false;
    seen.add(n);
    return true;
  }).sort((a, b) => (parseFloat(a.attributes.chapter) || 0) - (parseFloat(b.attributes.chapter) || 0));
}

async function getChapterPages(chapterId) {
  const data = await mdFetch(`/at-home/server/${chapterId}`);
  return data;
}

async function getGenres() {
  const data = await mdFetch('/manga/tag');
  return (data.data ?? [])
    .filter((t) => t.attributes.group === 'genre')
    .map((t) => ({ id: t.id, name: t.attributes.name['pt-br'] || t.attributes.name.en }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/* ---------- render: helpers ---------- */
function coverImg(src, alt, cls = '') {
  if (!src) return `<div class="cover ${cls}" style="display:grid;place-items:center;color:var(--muted)"><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 4h6a4 4 0 0 1 4 4v12a3 3 0 0 0-3-3H2z"/><path d="M22 4h-6a4 4 0 0 0-4 4v12a3 3 0 0 1 3-3h7z"/></svg></div>`;
  return `<img src="${src}" alt="${esc(alt)}" loading="lazy" />`;
}

function cardHTML(m, faved) {
  const title = mangaTitle(m);
  const cover = mangaCover(m);
  const year = mangaYear(m);
  const sub = [year].filter(Boolean).join(' · ') || mangaTags(m)[0] || '';
  const srcBadge = m._src ? `<span class="src-badge" style="background:${m._srcColor}">${esc(m._src)}</span>` : '';
  // justificativa da recomendação (só quando o algoritmo define m._recReason)
  const reason = m._recReason
    ? `<div class="rec-reason">🎯 Porque você gosta de <b>${esc(m._recReason)}</b></div>`
    : '';
  return `
  <article class="manga-card" data-id="${m.id}" onclick="openDetail('${m.id}')">
    <div class="cover">
      ${coverImg(cover, title)}
      ${srcBadge}
      ${faved ? '<span class="tag"><svg class="tag-heart" viewBox="0 0 24 24" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>FAV</span>' : ''}
    </div>
    <h3>${esc(title)}</h3>
    <div class="sub">${esc(sub)}</div>
    ${reason}
  </article>`;
}

// card de lista (usado no Explorar) — capa pequena + info ao lado
function rowHTML(m, faved) {
  const title = mangaTitle(m);
  const cover = mangaCover(m);
  const year = mangaYear(m);
  const tags = mangaTags(m);
  const srcBadge = m._src ? `<span class="src-badge" style="background:${m._srcColor}">${esc(m._src)}</span>` : '';
  return `
  <article class="manga-row" data-id="${m.id}" onclick="openDetail('${m.id}')">
    <div class="rcover">
      ${coverImg(cover, title)}
      ${srcBadge}
      ${faved ? '<span class="rtag"><svg class="tag-heart" viewBox="0 0 24 24" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg></span>' : ''}
    </div>
    <div class="rinfo">
      <h3>${esc(title)}</h3>
      <div class="rsub">
        ${year ? `<span>${year}</span>` : ''}
        ${mangaAuthors(m) ? `<span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="inline-icon" style="color:var(--muted);width:10px;height:10px;margin-right:3px;"><path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>${esc(mangaAuthors(m))}</span>` : ''}
      </div>
      ${tags.length ? `<div class="rtags">${tags.slice(0, 3).map((t) => `<span class="rtag-chip">${esc(t)}</span>`).join('')}</div>` : ''}
    </div>
    <div class="rarrow">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
    </div>
  </article>`;
}

// recomendações: descobre os gêneros favoritos do usuário e busca mangás parecidos
async function recommendFor() {
  // ===== 1. perfil de tags ponderado (estilo YouTube) =====
  // favorito pesa 2x, lido 1x, mais recente ganha bônus
  const favIds = state.favs.map((f) => f.id);
  const histIds = state.history.map((h) => h.id).slice(0, 30);
  const ids = [...new Set([...favIds, ...histIds])];
  if (!ids.length) return [];

  const tagWeight = {};      // nome da tag → peso acumulado
  const tagCount = {};       // quantas obras contribuíram (pra normalizar)
  let got = 0;
  for (let i = 0; i < ids.length && got < 15; i += 5) {
    const batch = ids.slice(i, i + 5);
    const results = await Promise.allSettled(batch.map((id) => getManga(id)));
    results.forEach((r) => {
      if (r.status !== 'fulfilled' || !r.value) return;
      got++;
      const isFav = favIds.includes(r.value.id);
      const weight = isFav ? 2 : 1;
      (r.value.attributes.tags || [])
        .filter((t) => t.attributes.group === 'genre')
        .forEach((t) => {
          const n = t.attributes.name.en;
          tagWeight[n] = (tagWeight[n] || 0) + weight;
          tagCount[n] = (tagCount[n] || 0) + 1;
        });
    });
  }
  // normaliza: peso médio por obra (evita que 10 obras de um gênero dominem demais)
  const profile = {};
  for (const [tag, w] of Object.entries(tagWeight)) {
    profile[tag] = w / Math.sqrt(tagCount[tag] || 1);
  }
  const topTags = Object.entries(profile).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([n]) => n);
  if (!topTags.length) return [];

  // ===== 2. busca candidatos dos gêneros top (com fallback por gênero) =====
  const known = new Set(ids);
  const candidates = [];
  for (const tag of topTags.slice(0, 3)) {
    const g = state.genres.find((x) => x.name.toLowerCase() === tag.toLowerCase());
    if (!g) continue;
    try {
      const found = await searchManga({ limit: 12, genre: g.id });
      found.filter((m) => !known.has(m.id)).forEach((m) => {
        if (!candidates.some((c) => c.id === m.id)) candidates.push(m);
      });
    } catch { /* pula gênero com falha */ }
  }

  // ===== 3. score de similaridade (cosseno aproximado) =====
  const scored = candidates.map((m) => {
    const tags = (m.attributes.tags || [])
      .filter((t) => t.attributes.group === 'genre')
      .map((t) => t.attributes.name.en);
    // soma dos pesos dos tags do candidato que batem com o perfil
    let score = 0;
    const matched = [];
    for (const t of tags) {
      if (profile[t]) { score += profile[t]; matched.push(t); }
    }
    // bônus de popularidade (o YouTube também mistura "o que todo mundo vê")
    score += Math.min(2, Math.log10(1 + (m.attributes.followedCount || 0)) / 3);
    return { m, score, matched: matched.slice(0, 3) };
  });
  scored.sort((a, b) => b.score - a.score);

  // ===== 4. justificativa + retorno =====
  // guarda a razão num dataset pro card poder mostrar "por quê"
  const result = scored.slice(0, 10).map(({ m, matched }) => {
    m._recReason = matched.length ? matched.join(' + ') : topTags[0];
    return m;
  });
  return result;
}

// recomendações na página de detalhes — mesmo gênero do mangá atual
async function loadDetailRecs(m) {
  const row = $('#detailRecRow');
  if (!row) return;
  try {
    const genres = (m.attributes.tags || [])
      .filter((t) => t.attributes.group === 'genre')
      .map((t) => t.attributes.name.en);
    const g = genres.length ? state.genres.find((x) => x.name.toLowerCase() === genres[0].toLowerCase()) : null;
    if (!g) { row.innerHTML = ''; return; }
    const found = await searchManga({ limit: 12, genre: g.id });
    const list = found.filter((x) => x.id !== m.id).slice(0, 8);
    row.innerHTML = list.length
      ? list.map((x) => cardHTML(x, state.favs.some((f) => f.id === x.id))).join('')
      : '';
  } catch { row.innerHTML = ''; }
}

// item do ranking — posição grande + capa + info
function rankItemHTML(m, pos, faved) {
  const medals = { 1: '🥇', 2: '🥈', 3: '🥉' };
  const title = mangaTitle(m);
  const cover = mangaCover(m);
  const year = mangaYear(m);
  const tags = mangaTags(m);
  return `
  <article class="rank-item" data-id="${m.id}" onclick="openDetail('${m.id}')">
    <div class="rank-pos ${pos <= 3 ? 'top' : ''}">${medals[pos] || pos}</div>
    <div class="rank-cover">${coverImg(cover, title)}</div>
    <div class="rank-info">
      <h3>${esc(title)}</h3>
      <div class="rank-sub">
        ${year ? `<span>${year}</span>` : ''}
        ${faved ? '<span class="rtag"><svg class="tag-heart" viewBox="0 0 24 24" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg></span>' : ''}
      </div>
      ${tags.length ? `<div class="rtags">${tags.slice(0, 3).map((t) => `<span class="rtag-chip">${esc(t)}</span>`).join('')}</div>` : ''}
    </div>
    <div class="rarrow">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
    </div>
  </article>`;
}

// card grande estilo home (usado no Ver tudo) — capa em destaque + título + ano + tags
function bigCardHTML(m, faved) {
  const title = mangaTitle(m);
  const cover = mangaCover(m);
  const year = mangaYear(m);
  const tags = mangaTags(m);
  return `
  <article class="big-card" data-id="${m.id}" onclick="openDetail('${m.id}')">
    <div class="bcover">
      ${coverImg(cover, title)}
      ${faved ? '<span class="tag"><svg class="tag-heart" viewBox="0 0 24 24" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>FAV</span>' : ''}
      ${year ? `<span class="byear">${year}</span>` : ''}
    </div>
    <h3>${esc(title)}</h3>
    ${tags.length ? `<div class="btags">${tags.slice(0, 2).map((t) => `<span class="rtag-chip">${esc(t)}</span>`).join('')}</div>` : ''}
  </article>`;
}

/* ---------- render: home ---------- */
// nomes de gêneros (inglês) para buscar por categoria
const CATS = {
  trending: { title: 'Em alta', api: { order: 'followedCount' } },
  recent: { title: 'Recentes', api: { order: 'latestUploadedChapter' } },
  action: { title: 'Ação', genre: 'Action' },
  romance: { title: 'Romance', genre: 'Romance' },
  fantasy: { title: 'Fantasia', genre: 'Fantasy' },
  horror: { title: 'Terror', genre: 'Horror' },
  comedy: { title: 'Comédia', genre: 'Comedy' },
};

// busca mangás por categoria (gênero ou ordenação)
async function fetchCat(catKey, limit = 12, offset = 0) {
  const cat = CATS[catKey];
  if (!cat) return [];
  const params = { limit, offset };
  if (cat.api) {
    Object.assign(params, cat.api);
    return searchManga(params);
  }
  // por gênero: acha o id da tag
  const g = state.genres.find((x) => x.name.toLowerCase() === cat.genre.toLowerCase());
  if (!g) return [];
  return searchManga({ limit, offset, genre: g.id });
}

function mangaStatusPt(m) {
  const s = m?.attributes?.status;
  if (s === 'ongoing') return 'Em publicação';
  if (s === 'completed') return 'Finalizado';
  if (s === 'hiatus') return 'Em hiato';
  if (s === 'cancelled') return 'Cancelado';
  return '';
}

let heroTimer = null;
let heroIdx = 0;
let heroList = [];

// carrossel do hero com rotação automática e design premium
function renderHero() {
  const track = $('#heroTrack');
  const dots = $('#heroDots');
  const sk = $('#heroSkeleton');
  if (!heroList.length) { sk.style.display = 'none'; return; }
  sk.className = 'hero-skeleton';
  sk.style.display = '';

  const badges = [
    '✦ Em destaque',
    '🔥 Em alta',
    '⭐ Escolha dos leitores',
    '✨ Recomendado',
    '💎 Obra-prima',
    '👑 Campeão de audiência',
    '⚡ Sucesso absoluto',
    '📈 Tendência da semana'
  ];

  track.innerHTML = heroList.map((m, i) => {
    const t = mangaTitle(m);
    const rawD = mangaDesc(m);
    const d = rawD.length > 120 ? rawD.slice(0, 117) + '...' : rawD;
    const full = mangaCoverFull(m);
    const tags = mangaTags(m).slice(0, 2).join(' • ');
    const year = mangaYear(m);
    const status = mangaStatusPt(m);

    const metaParts = [];
    if (status) metaParts.push(status);
    if (year) metaParts.push(year);
    if (tags) metaParts.push(tags);
    const metaHtml = metaParts.length ? `<div class="hero-meta">${esc(metaParts.join('  •  '))}</div>` : '';
    const badge = badges[i % badges.length];

    return `
    <div class="hero-card slide" onclick="if (!event.target.closest('button')) openDetail('${m.id}')">
      <div class="hero-bg-blur" style="background-image: url('${full}')"></div>
      <div class="hero-shade"></div>
      <div class="hero-body">
        <div class="hero-tag">${esc(badge)}</div>
        <h1>${esc(t)}</h1>
        ${metaHtml}
        <p>${esc(d)}</p>
        <button class="hero-cta" onclick="openDetail('${m.id}')">Ver detalhes
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
        </button>
      </div>
      <div class="hero-cover-wrap">
        <img src="${full}" alt="${esc(t)}" class="hero-right-cover" loading="eager" decoding="async" />
      </div>
    </div>`;
  }).join('');

  dots.innerHTML = heroList.map((_, i) => `<button class="dot ${i === 0 ? 'active' : ''}" onclick="heroGo(${i})"></button>`).join('');
  heroIdx = 0;
  startHeroTimer();
}

function heroGo(i) {
  heroIdx = i;
  const track = $('#heroTrack');
  if (track) track.style.transform = `translateX(-${i * 100}%)`;
  $$('#heroDots .dot').forEach((d, j) => d.classList.toggle('active', j === i));
  startHeroTimer();
}

function startHeroTimer() {
  clearInterval(heroTimer);
  if (heroList.length < 2) return;
  heroTimer = setInterval(() => {
    heroGo((heroIdx + 1) % heroList.length);
  }, 5000);
}

// swipe no hero
function initHeroSwipe() {
  const sk = $('#heroSkeleton');
  if (!sk || sk.dataset.swipe) return;
  sk.dataset.swipe = '1';
  let x0 = null;
  sk.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
  sk.addEventListener('touchend', (e) => {
    if (x0 == null) return;
    const dx = e.changedTouches[0].clientX - x0;
    if (Math.abs(dx) > 50) {
      if (dx < 0) heroGo((heroIdx + 1) % Math.max(1, heroList.length));
      else heroGo((heroIdx - 1 + heroList.length) % Math.max(1, heroList.length));
    }
    x0 = null;
  }, { passive: true });
}

async function fetchHeroList() {
  const curatedIds = [
    'a77742b1-befd-49a4-bff5-1ad4e6b0ef7b', // Chainsaw Man
    '32d76d19-8a05-4db0-9fc2-e0b0648fe9d0', // Solo Leveling
    '4141c5dc-c525-4df5-afd7-cc7d192a832f', // Jujutsu Kaisen
    'a1c7c817-4e59-43b7-9365-09675a149a6f', // One Piece
    'b0b721ff-c388-4486-aa0f-c2b0bb321512', // Frieren
    '296cbc31-af1a-4b5b-a34b-fee2b4cad542', // Oshi no Ko
    '0acb51ef-3d71-4993-81a0-8cbcfb88fa9e'  // Demon Slayer
  ];

  try {
    const results = await Promise.all(
      curatedIds.map(async (id) => {
        try {
          return await getManga(id);
        } catch (e) {
          console.warn(`Error fetching curated manga ${id}:`, e);
          return null;
        }
      })
    );
    const valid = results.filter(Boolean);
    if (valid.length >= 3) {
      return valid;
    }
  } catch (err) {
    console.error('Error fetching curated hero list:', err);
  }

  // Fallback 1: global top followed mangas (no language restrictions)
  try {
    const fallbackList = await searchManga({ limit: 8, order: 'followedCount', lang: 'all' });
    if (fallbackList && fallbackList.length) return fallbackList;
  } catch (e) {
    console.warn('Fallback 1 search failed, trying fallback 2:', e);
  }

  // Fallback 2: default Portuguese top followed
  return await searchManga({ limit: 8, order: 'followedCount' });
}

// skeleton: mostra cards de carregamento numa row
function skRow(n = 4) {
  let s = '';
  for (let i = 0; i < n; i++) {
    s += `<div class="sk-card"><div class="sk-cover"></div><div class="sk-line"></div><div class="sk-line short"></div></div>`;
  }
  return `<div class="sk-row">${s}</div>`;
}

// empty state bonito: ícone + título + descrição
function emptyState(icon, title, desc) {
  return `<div class="empty-state">
    <div class="empty-icon">${icon}</div>
    <strong>${title}</strong>
    <p>${desc}</p>
  </div>`;
}

async function renderHome() {
  const c = $('#homeContent');
  // skeletons enquanto carrega
  $('#trendingRow').innerHTML = skRow(5);
  $('#recRow').innerHTML = skRow(5);
  $('#rankList').innerHTML = skRow(3);
  $('#recentRow').innerHTML = skRow(5);
  $('#catActionRow').innerHTML = skRow(4);
  $('#catRomanceRow').innerHTML = skRow(4);
  $('#catComedyRow').innerHTML = skRow(4);
  $('#catFantasyRow').innerHTML = skRow(4);
  $('#catHorrorRow').innerHTML = skRow(4);
  // hero (carrossel premium com animes icônicos e populares)
  try {
    heroList = await fetchHeroList();
    renderHero();
    initHeroSwipe();
  } catch { $('#heroSkeleton').style.display = 'none'; }

  // trending
  try {
    const t = await searchManga({ limit: 12, order: 'followedCount' });
    $('#trendingRow').innerHTML = t.map((m) => cardHTML(m, state.favs.some((f) => f.id === m.id))).join('');
  } catch { $('#trendingRow').innerHTML = '<p class="muted" style="font-size:12px">Não foi possível carregar.</p>'; }

  // recomendações ("pra você") — baseado nos gêneros dos favoritos + histórico
  try {
    const recs = await recommendFor();
    const head = $('#recHead');
    const row = $('#recRow');
    if (recs.length) {
      if (head) head.style.display = '';
      if (row) row.innerHTML = recs.map((m) => cardHTML(m, state.favs.some((f) => f.id === m.id))).join('');
    } else {
      if (head) head.style.display = 'none';
    }
  } catch { $('#recHead').style.display = 'none'; }

  // ranking (top 10 mais seguidos)
  try {
    const top = await searchManga({ limit: 10, order: 'followedCount' });
    $('#rankList').innerHTML = top.map((m, i) => rankItemHTML(m, i + 1, state.favs.some((f) => f.id === m.id))).join('');
  } catch { $('#rankList').innerHTML = '<p class="muted" style="font-size:12px">Ranking indisponível.</p>'; }

  // recentes (últimos capítulos publicados)
  try {
    const p = new URLSearchParams();
    p.set('limit', 12);
    p.append('includes[]', 'cover_art');
    p.set('availableTranslatedLanguage[]', 'pt-br');
    p.set('order[latestUploadedChapter]', 'desc');
    p.append('contentRating[]', 'safe');
    p.append('contentRating[]', 'suggestive');
    const data = await mdFetch('/manga?' + p.toString());
    $('#recentRow').innerHTML = (data.data ?? []).map((m) => cardHTML(m, state.favs.some((f) => f.id === m.id))).join('');
  } catch { $('#recentRow').innerHTML = ''; }

  // categorias por gênero (em paralelo)
  try {
    const [action, romance, fantasy, horror, comedy] = await Promise.all([
      fetchCat('action', 10), fetchCat('romance', 10), fetchCat('fantasy', 10),
      fetchCat('horror', 10), fetchCat('comedy', 10),
    ]);
    const fill = (sel, list) => {
      const el = $(sel);
      if (el) el.innerHTML = list.map((m) => cardHTML(m, state.favs.some((f) => f.id === m.id))).join('');
    };
    fill('#catActionRow', action);
    fill('#catRomanceRow', romance);
    fill('#catFantasyRow', fantasy);
    fill('#catHorrorRow', horror);
    fill('#catComedyRow', comedy);
    // esconde seções vazias
    [['#catActionHead', action], ['#catRomanceHead', romance], ['#catFantasyHead', fantasy], ['#catHorrorHead', horror], ['#catComedyHead', comedy]]
      .forEach(([sel, list]) => { if (!list.length) $(sel).style.display = 'none'; });
  } catch {}

  // continue lendo (histórico)
  renderContinue();
}

/* ---------- ver tudo (categoria completa) ---------- */
let seeAllState = { cat: 'trending', offset: 0, loading: false, total: 0 };

async function openSeeAll(catKey) {
  const cat = CATS[catKey];
  if (!cat) return;
  showView('view-seeall');
  $('#bottomNav').classList.add('hidden');
  $('#seeAllTitle').textContent = cat.title.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '').trim();
  $('#seeAllGrid').innerHTML = '<div class="empty" style="grid-column:1/-1"><div class="spinner"></div></div>';
  $('#seeAllMoreBtn').style.display = 'none';
  $('#seeAllCount').textContent = '';
  seeAllState = { cat: catKey, offset: 0, loading: false, total: 0 };
  await loadSeeAll(true);
}

async function loadSeeAll(reset = false) {
  if (seeAllState.loading) return;
  seeAllState.loading = true;
  const grid = $('#seeAllGrid');
  const moreBtn = $('#seeAllMoreBtn');
  if (reset) grid.innerHTML = '';
  moreBtn.textContent = 'Carregando…';
  try {
    const list = await fetchCat(seeAllState.cat, 24, seeAllState.offset);
    const html = (m) => bigCardHTML(m, state.favs.some((f) => f.id === m.id));
    if (reset) {
      grid.innerHTML = list.length
        ? list.map(html).join('')
        : '<div style="grid-column:1/-1">' + emptyState('🔍', 'Nada encontrado', 'Tente outra categoria ou busca.') + '</div>';
    } else {
      grid.insertAdjacentHTML('beforeend', list.map(html).join(''));
    }
    seeAllState.offset += list.length;
    moreBtn.style.display = list.length < 24 ? 'none' : 'block';
    moreBtn.textContent = 'Carregar mais ↓';
    $('#seeAllCount').textContent = seeAllState.offset + '+';
  } catch (e) {
    if (reset) grid.innerHTML = '<div class="empty" style="grid-column:1/-1"><p>Erro: ' + esc(e.message) + '</p></div>';
    moreBtn.textContent = 'Tentar de novo';
  }
  seeAllState.loading = false;
}

function renderContinue() {
  const row = $('#continueRow');
  const items = [...state.history].sort((a, b) => b.ts - a.ts).slice(0, 10);
  if (!items.length) {
    row.innerHTML = emptyState('📖', 'Nada lido ainda', 'Explore a home e comece sua jornada!');
    return;
  }
  row.innerHTML = items.map((h) => {
    const pct = h.total ? Math.min(100, Math.round(((h.page + 1) / h.total) * 100)) : null;
    return `
    <article class="manga-card" onclick="continueReading('${h.id}')">
      <div class="cover">${coverImg(h.cover, h.title)}<span class="tag">${pct != null ? pct + '%' : 'CONTINUAR'}</span></div>
      <h3>${esc(h.title)}</h3>
      <div class="sub">${esc(h.chapter)}${pct != null ? ' • pág. ' + (h.page + 1) : ''}</div>
    </article>`;
  }).join('');
}

// abre direto o capítulo/página salvos (sem passar pelo detail)
async function continueReading(mangaId) {
  try {
    const m = await getManga(mangaId);
    const chs = await getChapters(mangaId);
    const lastRead = [...state.history].sort((a, b) => b.ts - a.ts).find((h) => h.id === mangaId);
    state.detail = m;
    state.chapters = chs;
    if (lastRead) {
      const ch = chs.find((c) => c.id === lastRead.chapterId);
      if (ch) { openChapter(ch.id, lastRead.page || 0); return; }
    }
    if (chs.length) openChapter(chs[0].id);
    else toast('Sem capítulos disponíveis');
  } catch (e) {
    toast('Erro: ' + e.message);
  }
}

/* ---------- render: explore ---------- */
async function initExplore() {
  renderSearchHistory();
  if (!state.genres.length) {
    try { state.genres = await getGenres(); } catch {}
  }
  const chips = $('#genreChips');
  chips.innerHTML = `<button class="chip active" data-genre="all">Todos</button>` +
    state.genres.slice(0, 14).map((g) => `<button class="chip" data-genre="${g.id}">${esc(g.name)}</button>`).join('');
  chips.addEventListener('click', (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    $$('.chip', chips).forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    state.explore.genre = b.dataset.genre;
    state.explore.offset = 0;
    $('#exploreGrid').innerHTML = '';
    loadExplore();
  });
  $('#searchInput').addEventListener('input', debounce(() => {
    state.explore.query = $('#searchInput').value.trim();
    state.explore.offset = 0;
    $('#exploreGrid').innerHTML = '';
    if (state.explore.query) saveSearch(state.explore.query);
    renderSearchHistory();
    loadExplore();
  }, 450));
  // botão de busca explícito (mobile): dispara na hora
  $('#btnSearchGo').addEventListener('click', () => {
    const q = $('#searchInput').value.trim();
    if (!q) { $('#searchInput').focus(); return; }
    state.explore.query = q;
    state.explore.offset = 0;
    $('#exploreGrid').innerHTML = '';
    saveSearch(q);
    renderSearchHistory();
    loadExplore();
  });
  $('#loadMoreBtn').addEventListener('click', loadExplore);
}

function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

async function loadExplore() {
  if (state.explore.loading) return;
  state.explore.loading = true;
  const grid = $('#exploreGrid');
  const loadBtn = $('#loadMoreBtn');
  loadBtn.textContent = 'Carregando…';
  try {
    let list;
    if (state.explore.query && !state.explore.offset) {
      // BUSCA AGREGADA: consulta TODAS as fontes em paralelo e mescla (catálogo completo)
      list = await searchAllSources(state.explore.query);
      state.explore._agg = true; // marca que veio do agregador (sem paginação infinita)
    } else {
      list = await searchManga({
        query: state.explore.query,
        genre: state.explore.genre,
        offset: state.explore.offset,
        limit: 24,
        status: state.filters.status,
        year: state.filters.year,
        sort: state.filters.sort,
      });
      state.explore._agg = false;
    }
    if (!list.length && state.explore.offset === 0) {
      grid.innerHTML = '<div style="grid-column:1/-1">' + emptyState('🔍', 'Nenhum mangá encontrado', 'Tente outro nome ou ajuste os filtros.') + '</div>';
      loadBtn.style.display = 'none';
    } else {
      grid.insertAdjacentHTML('beforeend', list.map((m) => rowHTML(m, state.favs.some((f) => f.id === m.id))).join(''));
      state.explore.offset += list.length;
      loadBtn.style.display = (state.explore._agg || list.length < 24) ? 'none' : 'block';
      loadBtn.textContent = 'Carregar mais ↓';
    }
  } catch (e) {
    toast('Erro ao carregar: ' + e.message);
    loadBtn.textContent = 'Carregar mais ↓';
  }
  state.explore.loading = false;
}

// busca em TODAS as fontes (MangaDex + Comick + Vegitoons + Manga Livre .to) e mescla
async function searchAllSources(q) {
  const out = [];
  const seen = new Set();

  // normaliza pro compare: minúsculo sem acento
  const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  // 1. MangaDex (busca oficial + cover art incluído)
  try {
    const md = await searchManga({ query: q, limit: 12, lang: 'pt-br' });
    for (const m of md) {
      const t = norm(mangaTitle(m));
      if (!t || seen.has(t)) continue;
      seen.add(t);
      m._src = 'MangaDex';
      m._srcColor = '#7a5fc7';
      out.push(m);
    }
  } catch {}

  // 2. Comick (agregador global — pega quase TUDO, inclusive BR)
  try {
    const ck = await ckSearch(q);
    for (const c of ck) {
      const t = norm(c.title);
      if (!t || seen.has(t)) continue;
      seen.add(t);
      out.push({
        id: 'ck:' + c.slug, _src: 'Comick', _srcColor: '#d4a94e', _ckSlug: c.slug,
        attributes: { title: { en: c.title, 'pt-br': c.title } },
        relationships: [],
      });    }
  } catch {}

  // 3. Vegitoons (catálogo BR de manhwas)
  try {
    const vgRes = await vegiSearch(q);
    const vg = vgRes.data || vgRes || [];
    for (const v of vg) {
      const t = norm(v.title);
      if (!t || seen.has(t)) continue;
      seen.add(t);
      const m = {
        id: 'vegi:' + v.id, _src: 'Vegitoons', _srcColor: '#3d9c6a', _vegiId: String(v.id),
        attributes: { title: { en: v.title, 'pt-br': v.title } },
        relationships: [],
      };
      if (v.cover) m._cover = v.cover;
      out.push(m);
    }
  } catch {}

  // 4. Manga Livre .to (obras clássicas BR)
  try {
    const ml = await mlSearch(q);
    for (const c of ml) {
      const t = norm(c.title);
      if (!t || seen.has(t)) continue;
      seen.add(t);
      out.push({
        id: 'ml:' + c.slug, _src: 'Manga Livre', _srcColor: '#4a7fc1', _mlSlug: c.slug,
        attributes: { title: { en: c.title, 'pt-br': c.title } },
        relationships: [],
      });
    }
  } catch {}

  return out;
}

/* ---------- histórico de busca ---------- */
function saveSearch(q) {
  const list = state.searchHistory.filter((s) => s.toLowerCase() !== q.toLowerCase());
  list.unshift(q);
  state.searchHistory = list.slice(0, 8);
  store('searchHistory', state.searchHistory);
}

function renderSearchHistory() {
  const wrap = $('#searchHistoryWrap');
  if (!wrap) return;
  const q = (state.explore.query || '').toLowerCase();
  const list = state.searchHistory.filter((s) => !q || s.toLowerCase() !== q);
  if (!list.length) { wrap.innerHTML = ''; return; }
  wrap.innerHTML = `
    <div class="sh-head"><span>Buscas recentes</span><button class="sh-clear" onclick="clearSearchHistory()">Limpar</button></div>
    <div class="sh-chips">
      ${list.map((s) => `<button class="sh-chip" onclick="doSearchTerm('${esc(s).replace(/'/g, "\\'")}')">${esc(s)}</button>`).join('')}
    </div>`;
}

function clearSearchHistory() {
  state.searchHistory = [];
  store('searchHistory', []);
  renderSearchHistory();
  toast('Histórico de buscas limpo');
}

function doSearchTerm(q) {
  state.explore.query = q;
  state.explore.offset = 0;
  const inp = $('#searchInput');
  if (inp) inp.value = q;
  $('#exploreGrid').innerHTML = '';
  saveSearch(q);
  renderSearchHistory();
  loadExplore();
}

let libTab = 'favs';
let libSort = 'recent';
let libQuery = '';
let libStatus = 'all';

function renderLibrary() {
  const grid = $('#libraryGrid');
  const empty = $('#libraryEmpty');
  const emptyText = $('#libraryEmptyText');
  // contadores nas abas
  $('#libCountFavs').textContent = state.favs.length ? `(${state.favs.length})` : '';
  $('#libCountHist').textContent = state.history.length ? `(${state.history.length})` : '';
  let items;
  if (libTab === 'favs') {
    items = state.favs;
    emptyText.textContent = 'Nenhum favorito ainda. Toque no coração em um mangá para salvar aqui.';
  } else {
    items = [...state.history].sort((a, b) => b.ts - a.ts);
    emptyText.textContent = 'Nenhum capítulo lido ainda.';
  }
  // busca dentro da biblioteca
  if (libQuery) {
    const q = libQuery.toLowerCase();
    items = items.filter((f) => (f.title || '').toLowerCase().includes(q));
  }
  // filtro por status (usa as listas do usuário)
  if (libStatus !== 'all') {
    const lists = myLists();
    const statusIds = new Set((lists[libStatus] || []).map((x) => x.id));
    items = items.filter((f) => statusIds.has(f.id));
  }
  // ordenação
  if (libTab === 'favs') {
    if (libSort === 'az') items = [...items].sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    else if (libSort === 'read') {
      const rc = load('readCount', {});
      items = [...items].sort((a, b) => (rc[b.id] || 0) - (rc[a.id] || 0));
    }
    else if (libSort === 'unread') {
      // favoritos nunca lidos (sem histórico) primeiro
      items = [...items].sort((a, b) => {
        const ha = state.history.some((h) => h.id === a.id) ? 1 : 0;
        const hb = state.history.some((h) => h.id === b.id) ? 1 : 0;
        return ha - hb;
      });
    }
    // 'recent': favs são salvos em ordem de adição; mostra os mais recentes primeiro
    if (libSort === 'recent') items = [...items].reverse();
  }
  const readCount = load('readCount', {});
  empty.hidden = items.length > 0;
  // badge de status por mangá (das listas)
  const lists = myLists();
  const statusOf = {};
  Object.entries(lists).forEach(([name, arr]) => (arr || []).forEach((x) => { if (!statusOf[x.id]) statusOf[x.id] = name; }));
  const statusLabel = { lendo: 'Lendo', vouLer: 'Vou ler', completo: 'Completo', dropei: 'Dropei' };
  const cardOf = (f, chapterLabel) => {
    const newIds = load('newChapters', {});
    const rc = readCount[f.id] || 0;
    const last = [...state.history].sort((a, b) => b.ts - a.ts).find((h) => h.id === f.id);
    const pct = last && last.total ? Math.min(100, Math.round(((last.page + 1) / last.total) * 100)) : null;
    const st = statusOf[f.id];
    return `
    <article class="manga-card" onclick="openDetail('${f.id}')">
      <div class="cover">${coverImg(f.cover, f.title)}${newIds[f.id] ? '<span class="tag novo">NOVO</span>' : ''}${st ? `<span class="tag st-${st}">${statusLabel[st]}</span>` : ''}${pct != null && libTab === 'favs' ? `<div class="readbar"><i style="width:${pct}%"></i></div>` : ''}</div>
      <h3>${esc(f.title)}</h3>
      <div class="sub">${chapterLabel || (pct != null ? pct + '% lido' : (rc ? rc + ' págs' : ''))}</div>
    </article>`;
  };
  // histórico: agrupa por dia (Hoje / Ontem / Esta semana / Antes)
  if (libTab === 'history' && items.length) {
    const groups = { hoje: [], ontem: [], semana: [], antes: [] };
    const now = new Date();
    const startOf = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
    const today = startOf(now);
    const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
    const weekAgo = new Date(today); weekAgo.setDate(weekAgo.getDate() - 7);
    for (const h of items) {
      const d = startOf(h.ts);
      if (d >= today) groups.hoje.push(h);
      else if (d >= yesterday) groups.ontem.push(h);
      else if (d >= weekAgo) groups.semana.push(h);
      else groups.antes.push(h);
    }
    const groupTitles = { hoje: 'Hoje', ontem: 'Ontem', semana: 'Esta semana', antes: 'Mais antigo' };
    const has = Object.values(groups).some((g) => g.length);
    if (!has) { empty.hidden = false; grid.innerHTML = ''; return; }
    grid.innerHTML = Object.entries(groups).filter(([, g]) => g.length).map(([k, g]) => `
      <div class="lib-group">
        <div class="lib-group-title">${groupTitles[k]} <span>${g.length}</span></div>
        <div class="grid">${g.map((f) => cardOf(f, 'Cap. ' + esc(f.chapter || ''))).join('')}</div>
      </div>`).join('');
  } else {
    grid.innerHTML = items.map((f) => cardOf(f)).join('');
  }
}

/* ---------- render: detail ---------- */
// desativa todas as views e ativa só a desejada (evita sobreposição de telas)
function showView(viewId) {
  $$('.view').forEach((v) => v.classList.remove('active'));
  if (viewId) $('#' + viewId).classList.add('active');
}

/* ===== navegação com pilha (botão voltar do Android) ===== */
let navStack = [];   // [{view, tab?, mangaId?, chapterId?, page?}]

// empilha uma navegação (chama pushState pra criar entrada no histórico)
function navPush(entry) {
  navStack.push(entry);
  try { history.pushState({ nav: true }, ''); } catch {}
}

// navega pra uma view empilhando
function navGo(view, entry = {}) {
  navPush({ view, ...entry });
}

// botão voltar: desempilha e volta (ou sai do app na raiz)
function navBack() {
  if (navStack.length > 1) {
    navStack.pop();               // remove a atual
    const prev = navStack[navStack.length - 1];
    restoreNav(prev);
    return true;
  }
  return false; // pilha vazia → deixa o browser sair
}

// restaura uma entrada da pilha (navega SEM re-empilhar)
function restoreNav(entry) {
  const v = entry.view || 'home';
  if (v === 'home') { switchTab('home', false, true); }
  else if (v === 'explore') { switchTab('explore', false, true); }
  else if (v === 'library') { switchTab('library', false, true); }
  else if (v === 'profile') { switchTab('profile', false, true); }
  else if (v === 'detail' && entry.mangaId) { openDetail(entry.mangaId, true); }
  else if (v === 'reader' && entry.chapterId) { openChapter(entry.chapterId, entry.page || 0, true); }
  else { switchTab('home', false, true); }
}

// volta com o botão do header (sempre desempilha)
function navBackBtn() {
  if (!navBack()) { switchTab('home', false); }
}

async function openDetail(id, silent = false) {
  if (!silent) navPush({ view: 'detail', mangaId: id });
  showView('view-detail');
  clearNewFlag(id);
  document.title = 'Manganana';
  $('#view-detail').querySelector('.content').scrollTop = 0;
  $('#detailContent').innerHTML = '<div style="padding:120px 0;text-align:center;color:var(--muted)"><div class="spinner" style="margin:0 auto 14px"></div>Carregando…</div>';
  $('#bottomNav').classList.add('hidden');
  try {
    let m;
    // IDs de fonte externa (busca agregada): ck:slug | vegi:id | ml:slug
    if (id.startsWith('ck:')) {
      const slug = id.slice(3);
      const q = slug.replace(/-/g, ' ');
      const res = await ckSearch(q);
      const found = res.find((x) => x.slug === slug) || res[0];
      m = {
        id, _src: 'Comick', _ckSlug: slug,
        attributes: { title: { en: found?.title || q, 'pt-br': found?.title || q } },
        relationships: [],
      };
    } else if (id.startsWith('vegi:')) {
      const vid = id.slice(5);
      m = {
        id, _src: 'Vegitoons', _vegiId: vid,
        attributes: { title: { en: 'Mangá', 'pt-br': 'Mangá' } },
        relationships: [],
      };
      try { const v = await vegiManga(vid); if (v?.obr_nome) m.attributes = { title: { en: v.obr_nome, 'pt-br': v.obr_nome } }; } catch {}
    } else if (id.startsWith('ml:')) {
      const slug = id.slice(3);
      m = {
        id, _src: 'Manga Livre', _mlSlug: slug,
        attributes: { title: { en: slug.replace(/-/g, ' '), 'pt-br': slug.replace(/-/g, ' ') } },
        relationships: [],
      };
      try { const d = await mlManga(slug); if (d?.title) m.attributes = { title: { en: d.title, 'pt-br': d.title } }; } catch {}
    } else {
      m = await getManga(id);
    }
    if (!m || !Object.keys(m).length) throw new Error('mangá não encontrado');
    state.detail = m;
    document.title = mangaTitle(m) + ' | Manganana';
    state.lang = 'pt-br';
    state.provider = 'mangadex';
    state.allChapters = {};
    state.autoProvider = {};
    state.pill = null;
    state.ml = null;
    // busca dados premium (AniList) em paralelo — não bloqueia se falhar
    let premium = null;
    try { premium = await fetchAniList(mangaTitle(m)); } catch {}
    state.premium = premium;
    // busca idiomas disponíveis (paralelo, não bloqueia)
    let langs = [{ code: 'pt-br', count: 0 }];
    try { const l = await mangaLanguages(id); if (l.length) langs = l; } catch {}
    // abriu direto de fonte externa (busca agregada): já sabemos onde o mangá está
    if (m._src === 'Comick') state.ck = { slug: m._ckSlug, title: mangaTitle(m) };
    if (m._src === 'Vegitoons') state.vegi = { id: m._vegiId, title: mangaTitle(m) };
    if (m._src === 'Manga Livre') state.ml = { slug: m._mlSlug, title: mangaTitle(m) };
    // tenta achar no MangaPill (provedor secundário)
    try { state.pill = await findOnPill(mangaTitle(m)); } catch {}
    // tenta achar no Manga Livre (provedor BR — capítulos completos em pt-br)
    if (!state.ml) try { state.ml = await findOnMl(mangaTitle(m)); } catch {}
    // tenta achar na Vegitoons (provedor BR — manhwas completos)
    if (!state.vegi) try { state.vegi = await findOnVegi(mangaTitle(m)); } catch {}
    // tenta achar no Comick (agregador global — direto do browser, IP residencial)
    if (!state.ck) try { state.ck = await findOnCk(mangaTitle(m)); } catch {}
    // carrega capítulos do idioma ativo escolhendo a fonte mais completa
    await loadChaptersForLang('pt-br');
    // capítulos BR extras (scraper do celular → GitHub)
    try {
      const extra = await brExtraData();
      const t = mangaTitle(m).toLowerCase();
      const key = Object.keys(extra).find((k) => {
        const kk = decodeURIComponent(k).toLowerCase();
        return t.includes(kk) || kk.includes(t.split(':')[0].trim().slice(0, 20));
      });
      state.brExtra = key ? extra[key] : null;
    } catch { state.brExtra = null; }
    renderDetail(m, premium, langs);
  } catch (e) {
    $('#detailContent').innerHTML = `<div class="empty"><p>Erro ao carregar: ${esc(e.message)}</p></div>`;
  }
}

function renderDetail(m, premium, langs) {
  const faved = state.favs.some((f) => f.id === m.id);
  $('#detailTitleNav').textContent = mangaTitle(m);
  $('#btnDetailFav').classList.toggle('faved', faved);
  const cover = mangaCoverFull(m);
  const desc = mangaDesc(m);
  const chs = state.chapters;
  const lastRead = [...state.history].sort((a, b) => b.ts - a.ts).find((h) => h.id === m.id);
  const hasRead = !!lastRead;
  const pill = state.pill;
  const ml = state.ml;
  const provider = state.provider;
  const lang = state.lang;

  // dados premium (AniList)
  const score = anilistScore(premium);
  const stars = scoreStars(score);
  const pop = premium?.popularity ? premium.popularity.toLocaleString('pt-BR') : null;
  const favCount = premium?.favourites ? premium.favourites.toLocaleString('pt-BR') : null;
  const statusPt = anilistStatusPt(premium?.status);
  const totalCaps = premium?.chapters || '';
  const anigenres = premium?.genres || [];
  const chars = (premium?.characters?.nodes || []).filter((c) => c.image?.large);

  // chips de idioma (MangaDex) + opção MangaPill
  const langChips = (langs || []).map((l) => `
    <button class="chip ${provider === 'mangadex' && lang === l.code ? 'active' : ''}"
      onclick="switchLang('${l.code}')">${esc(langName(l.code))} (${l.count})</button>`).join('');

  const providerInfo = provider === 'mangapill'
    ? `<div class="provider-banner"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="inline-icon" style="width: 12px; height: 12px; margin-right: 4px; color: var(--accent);"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>Provedor: <b>MangaPill</b> — capítulos em inglês</div>`
    : '';

  $('#detailContent').innerHTML = `
    <div class="detail-hero">
      <img src="${cover}" alt="${esc(mangaTitle(m))}" />
      <div class="shade"></div>
      <div class="badges">
        ${mangaTags(m).map((t) => `<span class="badge">${esc(t)}</span>`).join('')}
        ${mangaYear(m) ? `<span class="badge">${mangaYear(m)}</span>` : ''}
      </div>
    </div>
    <div class="detail-info">
      <h1>${esc(mangaTitle(m))}</h1>
      ${m._src ? `<div class="src-row"><span class="detail-src-badge"><span class="dot" style="background:${m._srcColor || '#d4a94e'}"></span>Disponível em ${esc(m._src)}</span></div>` : ''}
      ${mangaAltTitles(m) ? `<div class="authors">${esc(mangaAltTitles(m))}</div>` : ''}
      ${mangaAuthors(m) ? `<div class="authors"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="inline-icon" style="color:var(--muted);width:11px;height:11px;margin-right:4px;"><path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>${esc(mangaAuthors(m))}</div>` : ''}
      ${(score != null || pop || statusPt || totalCaps) ? `
      <div class="premium-card">
        ${score != null ? `
        <div class="premium-score">
          <div class="score-big"><span>${score}</span><small>/10</small></div>
          <div class="score-meta">
            <div class="stars">${stars}</div>
            <small>Nota da comunidade</small>
          </div>
        </div>` : ''}
        <div class="premium-stats">
          ${statusPt ? `<div class="pstat"><small>Status</small><strong>${statusPt}</strong></div>` : ''}
          ${totalCaps ? `<div class="pstat"><small>Capítulos</small><strong>${totalCaps}</strong></div>` : ''}
          ${pop ? `<div class="pstat"><small>Popularidade</small><strong>${pop}</strong></div>` : ''}
          ${favCount ? `<div class="pstat"><small>Favoritos</small><strong>${favCount}</strong></div>` : ''}
        </div>
      </div>` : ''}
      <div class="detail-actions">
        <button class="btn-primary" onclick="resumeRead()">
          <svg viewBox="0 0 24 24" fill="currentColor" style="width: 13px; height: 13px; margin-right: 6px;"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
          <span>${hasRead ? 'Continuar lendo' : 'Começar a ler'}</span>
        </button>
        <button class="btn-ghost ${faved ? 'faved' : ''}" id="detailFavBtn" onclick="toggleFav()">
          <svg viewBox="0 0 24 24" fill="${faved ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
        </button>
        <button class="btn-ghost" id="detailDlAll" title="Baixar todos os capítulos" onclick="downloadAllChapters()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
        </button>
        <button class="btn-ghost" id="detailListBtn" title="Adicionar à lista" onclick="openListPicker()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/></svg>
        </button>
      </div>
      <div class="dl-progress" id="dlAllProgress" hidden>
        <div class="dlp-bar"><i id="dlAllBar"></i></div>
        <span id="dlAllLabel"></span>
      </div>
      ${desc ? `
        <p class="detail-desc ${desc.length > 280 ? 'clamped' : ''}" id="detailDesc">${esc(desc)}</p>
        ${desc.length > 280 ? '<button class="detail-toggle" id="descToggle">Ver mais ▾</button>' : ''}
      ` : ''}
      ${chars.length ? `
      <div class="char-head"><h2>Personagens</h2></div>
      <div class="char-row" id="charRow">
        ${chars.map((c) => `
        <div class="char-card" data-cname="${esc(c.name.full)}" data-cdesc="${esc(cleanAniDesc(c.description))}">
          <div class="char-img"><img src="${px(c.image.large)}" alt="${esc(c.name.full)}" loading="lazy" /></div>
          <strong>${esc(c.name.full)}</strong>
        </div>`).join('')}
      </div>` : ''}
      <div class="chapter-head">
        <h2>Capítulos</h2>
        <span>${chs.length} disponíveis</span>
      </div>
      ${provider === 'mlivre' ? `
      <div class="auto-source">
        <span class="as-badge">🇧🇷 Fonte automática: Manga Livre</span>
        <span class="as-sub">Catálogo BR completo (${chs.length} capítulos em português)</span>
      </div>` : provider === 'vegi' ? `
      <div class="auto-source">
        <span class="as-badge">🇧🇷 Fonte automática: Vegitoons</span>
        <span class="as-sub">Catálogo BR (${chs.length} capítulos em português)</span>
      </div>` : provider === 'ck' ? `
      <div class="auto-source">
        <span class="as-badge">🌐 Fonte automática: Comick</span>
        <span class="as-sub">Agregador global (${chs.length} capítulos em português)</span>
      </div>` : provider === 'mangapill' ? `
      <div class="auto-source">
        <span class="as-badge">🇺🇸 Fonte automática: MangaPill</span>
        <span class="as-sub">Catálogo EN completo (${chs.length} capítulos em inglês)</span>
      </div>` : ''}
      ${(chs.length <= 15 || (totalCaps && chs.length < totalCaps * 0.6)) && pill ? `
      <div class="incomplete-banner">
        <div class="icb-icon">⚠️</div>
        <div class="icb-body">
          <strong>Poucos capítulos em português</strong>
          <p>Este mangá está incompleto no MangaDex (só ${chs.length} em pt-br${totalCaps ? ` de ~${totalCaps} no total` : ''}). O MangaPill tem a obra completa em inglês.</p>
          <button class="icb-btn" onclick="switchProvider('mangapill')">📖 Ler no MangaPill (inglês)</button>
        </div>
      </div>` : ''}
      <div class="lang-row" id="langRow">${langChips}${ml ? `<button class="chip ml-chip ${provider === 'mlivre' ? 'active' : ''}" onclick="switchProvider('mlivre')">🇧🇷 Manga Livre</button>` : ''}${pill ? `<button class="chip ${provider === 'mangapill' ? 'active' : ''}" onclick="switchProvider('mangapill')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="inline-icon" style="width: 12px; height: 12px; margin-right: 4px; color: inherit;"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>MangaPill</button>` : ''}</div>
      ${providerInfo}
      <div class="chapter-list">
        ${chs.length ? chs.map((c) => chapterItemHTML(c, lastRead)).join('') : `<p class="muted" style="font-size:12px">Nenhum capítulo neste idioma ainda. Tente outro idioma ou o provedor alternativo.</p>`}
      </div>
      ${state.brExtra ? brExtraSection(state.brExtra) : ''}
      <div class="section-head">
        <h2>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="header-icon"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
          <span>Você também pode gostar</span>
        </h2>
      </div>
      <div class="scroll-row" id="detailRecRow"><div class="spinner"></div></div>
    </div>`;

  // carrega recomendações do mesmo gênero
  loadDetailRecs(m);
  renderDetailListState();

  const d = $('#detailDesc');
  if (d) $('#descToggle')?.addEventListener('click', () => {
    d.classList.toggle('clamped');
    d.classList.toggle('expanded');
    $('#descToggle').textContent = d.classList.contains('clamped') ? 'Ver mais ▾' : 'Ver menos ▴';
  });
}

function chapterItemHTML(c, lastRead) {
  const read = lastRead && lastRead.chapterId === c.id;
  const group = c._group || (c.relationships ?? []).find((r) => r.type === 'scanlation_group')?.attributes?.name;
  return `
  <div class="chapter-item ${read ? 'read' : ''}" onclick="openChapter('${c.id}')">
    <div class="num">${c.attributes.chapter || '•'}</div>
    <div class="meta">
      <strong>${esc(chapterNum(c))}${chapterTitle(c) ? ' — ' + esc(chapterTitle(c)) : ''}</strong>
      <small>${[group, timeAgo(c.attributes.publishAt)].filter(Boolean).join(' · ')}</small>
    </div>
    <button class="mark-read" title="${read ? 'Marcar como não lido' : 'Marcar como lido'}" onclick="event.stopPropagation(); markChapterRead('${c.id}')">
      <svg viewBox="0 0 24 24" fill="${read ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
    </button>
  </div>`;
}

function markProgress() {
  const r = state.reader;
  if (!r) return;
  const entry = {
    id: r.manga.id, title: mangaTitle(r.manga), cover: mangaCover(r.manga),
    chapter: chapterNum(r.chapter), chapterId: r.chapter.id,
    page: r.idx, total: r.pages.length, ts: Date.now(),
  };
  state.history = state.history.filter((h) => h.id !== r.manga.id);
  state.history.unshift(entry);
  store('history', state.history.slice(0, 60));
  const n = load('readCount', {});
  n[r.manga.id] = (n[r.manga.id] || 0) + 1;
  store('readCount', n);
  logReading(r.manga.id, mangaTitle(r.manga), chapterNum(r.chapter));
  // registra o último capítulo visto (para alertas de capítulo novo)
  const lastSeen = load('lastSeen', {});
  lastSeen[r.manga.id] = r.chapter.id;
  store('lastSeen', lastSeen);
  schedulePush();
}

// marca um capítulo como lido (ou desmarca) sem abrir
function markChapterRead(chapterId) {
  const m = state.detail;
  if (!m) return;
  const existing = state.history.find((h) => h.id === m.id && h.chapterId === chapterId);
  if (existing) {
    state.history = state.history.filter((h) => !(h.id === m.id && h.chapterId === chapterId));
    toast('Marcado como não lido');
  } else {
    const ch = state.chapters.find((c) => c.id === chapterId);
    state.history.unshift({
      id: m.id, title: mangaTitle(m), cover: mangaCover(m),
      chapter: chapterNum(ch), chapterId, page: 0, total: 0, ts: Date.now(),
    });
    logReading(m.id, mangaTitle(m), chapterNum(ch));
    const lastSeen = load('lastSeen', {});
    lastSeen[m.id] = chapterId;
    store('lastSeen', lastSeen);
    toast('Capítulo marcado como lido');
  }
  store('history', state.history.slice(0, 60));
  const lastRead = [...state.history].sort((a, b) => b.ts - a.ts).find((h) => h.id === m.id);
  renderDetail(m, state.premium, null);
  renderChapterSheet();
  schedulePush();
}

function toggleFav() {
  const m = state.detail;
  if (!m) return;
  const idx = state.favs.findIndex((f) => f.id === m.id);
  if (idx >= 0) {
    state.favs.splice(idx, 1);
    toast('Removido dos favoritos');
  } else {
    state.favs.push({ id: m.id, title: mangaTitle(m), cover: mangaCover(m) });
    toast('Adicionado aos favoritos');
  }
  store('favs', state.favs);
  $('#btnDetailFav')?.classList.toggle('faved', idx < 0);
  if (idx < 0) { const b = $('#detailFavBtn'); if (b) b.innerHTML = b.innerHTML.replace('fill="none"', 'fill="currentColor"'); }
  renderLibrary();
  schedulePush();
}

// modal de personagem (detalhe premium)
function openCharModal(name, desc) {
  const body = $('#charModalBody');
  const clean = cleanAniDesc(desc);
  body.innerHTML = `
    <h3>${esc(name)}</h3>
    <p class="muted">${clean ? esc(clean) : 'Sem descrição disponível.'}</p>
    <p class="muted char-tr" style="font-size:11px;color:var(--accent);margin-top:8px">🌐 Traduzindo para português…</p>`;
  $('#charModal').classList.add('open');
  $('#sheetBackdrop').classList.add('open');
  // traduz para pt-br (com cache) e atualiza quando pronto
  if (clean && clean.length >= 12) {
    translatePt(clean).then((pt) => {
      if (pt && pt !== clean) {
        body.querySelector('.muted').textContent = pt;
      }
      const tr = body.querySelector('.char-tr');
      if (tr) tr.remove();
    });
  } else {
    const tr = body.querySelector('.char-tr');
    if (tr) tr.remove();
  }
}
function closeCharModal() {
  $('#charModal').classList.remove('open');
  $('#sheetBackdrop').classList.remove('open');
}

function resumeRead() {
  const m = state.detail;
  const lastRead = [...state.history].sort((a, b) => b.ts - a.ts).find((h) => h.id === m.id);
  if (lastRead) {
    // retoma exatamente no capítulo onde parou (mesmo que seja o último)
    const ch = state.chapters.find((c) => c.id === lastRead.chapterId);
    if (ch) {
      openChapter(ch.id, lastRead.page || 0);
      return;
    }
    // capítulo salvo não existe mais — vai pro primeiro
    if (state.chapters.length) { openChapter(state.chapters[0].id); return; }
  }
  if (state.chapters.length) openChapter(state.chapters[0].id);
  else toast('Sem capítulos disponíveis');
}

// troca o idioma dos capítulos — modo agregado: escolhe automaticamente a fonte mais completa
async function switchLang(code) {
  if (!state.detail) return;
  state.lang = code;
  const grid = $('#detailContent');
  toast('Carregando ' + langName(code) + '…');
  try {
    await loadChaptersForLang(code);
    renderDetail(state.detail, state.premium, await mangaLanguages(state.detail.id));
    if (grid) grid.scrollTop = grid.scrollHeight;
  } catch (e) {
    toast('Erro: ' + e.message);
  }
}

// carrega capítulos do idioma escolhendo a fonte MAIS COMPLETA automaticamente
async function loadChaptersForLang(code) {
  // cache por idioma (guarda a fonte escolhida também)
  if (state.allChapters[code] && state.autoProvider[code]) {
    state.chapters = state.allChapters[code];
    state.provider = state.autoProvider[code];
    return;
  }
  // 1. MangaDex no idioma
  let chs = [];
  try { chs = await getChaptersLang(state.detail.id, code); } catch {}
  let best = chs;
  let provider = 'mangadex';

  // 2. pt-br: compara com Manga Livre (BR completo) e Vegitoons (manhwas BR)
  if (code === 'pt-br') {
    if (state.ml) {
      try {
        const data = await mlManga(state.ml.slug);
        const mlChs = (data.chapters || []).map((c) => ({
          id: 'ml_' + c.url,
          _provider: 'mlivre',
          _mlUrl: c.url,
          attributes: {
            chapter: c.num, title: '', publishAt: null, translatedLanguage: 'pt-br',
          },
        }));
        if (mlChs.length > best.length) { best = mlChs; provider = 'mlivre'; }
      } catch {}
    }
    if (state.vegi) {
      try {
        const data = await vegiManga(state.vegi.id);
        const vegiChs = (data.chapters || []).map((c) => ({
          id: 'vegi_' + c.id,
          _provider: 'vegi',
          _vegiId: c.id,
          attributes: {
            chapter: c.num, title: c.title || '', publishAt: null, translatedLanguage: 'pt-br',
          },
        }));
        if (vegiChs.length > best.length) { best = vegiChs; provider = 'vegi'; }
      } catch {}
    }
    // Comick: agregador global com pt-br (via proxy do Vercel)
    if (state.ck) {
      try {
        const data = await ckChapters(state.ck.slug, 'pt-br');
        const ckChs = (data || []).map((c) => ({
          id: 'ck_' + c.hid,
          _provider: 'ck',
          _ckSlug: state.ck.slug,
          _ckHid: c.hid,
          _ckChap: c.num || c.chap,
          _group: c.group || '',
          attributes: {
            chapter: c.num || c.chap, title: c.title || '', publishAt: null, translatedLanguage: 'pt-br',
          },
        }));
        if (ckChs.length > best.length) { best = ckChs; provider = 'ck'; }
      } catch {}
    }
  }

  // 3. en: compara com MangaPill (inglês completo)
  if (code === 'en' && state.pill) {
    try {
      const data = await pillManga(state.pill.slug);
      const pillChs = (data.chapters || []).map((c, i) => ({
        id: 'pill_' + c.slug,
        _provider: 'mangapill',
        _pillSlug: c.slug,
        attributes: {
          chapter: String(i + 1), title: c.title, publishAt: null, translatedLanguage: 'en',
        },
      }));
      if (pillChs.length > best.length) { best = pillChs; provider = 'mangapill'; }
    } catch {}
  }

  state.chapters = best;
  state.provider = provider;
  state.allChapters[code] = best;
  state.autoProvider[code] = provider;
}

// troca de provedor (MangaDex <-> MangaPill <-> Manga Livre)
async function switchProvider(name) {
  if (!state.detail) return;
  state.provider = name;
  const grid = $('#detailContent');
  if (name === 'mlivre') {
    if (!state.ml) { toast('Não encontrado no Manga Livre'); return; }
    toast('Carregando Manga Livre…');
    try {
      const data = await mlManga(state.ml.slug);
      state.chapters = (data.chapters || []).map((c) => ({
        id: 'ml_' + c.url,
        _provider: 'mlivre',
        _mlUrl: c.url,
        attributes: {
          chapter: c.num,
          title: '',
          publishAt: null,
          translatedLanguage: 'pt-br',
        },
      }));
      renderDetail(state.detail, state.premium, [{ code: 'pt-br', count: state.chapters.length }]);
      if (grid) grid.scrollTop = grid.scrollHeight;
    } catch (e) { toast('Erro Manga Livre: ' + e.message); }
  } else if (name === 'mangapill') {
    if (!state.pill) { toast('Não encontrado no MangaPill'); return; }
    toast('Carregando MangaPill…');
    try {
      const data = await pillManga(state.pill.slug);
      state.chapters = (data.chapters || []).map((c, i) => ({
        id: 'pill_' + c.slug,
        _provider: 'mangapill',
        _pillSlug: c.slug,
        attributes: {
          chapter: String(i + 1),
          title: c.title,
          publishAt: null,
          translatedLanguage: 'en',
        },
      }));
      renderDetail(state.detail, state.premium, [{ code: 'en', count: state.chapters.length }]);
      if (grid) grid.scrollTop = grid.scrollHeight;
    } catch (e) { toast('Erro MangaPill: ' + e.message); }
  } else {
    // volta pro MangaDex no idioma atual
    switchLang(state.lang);
  }
}

// ===== capítulos BR extras (scraper do celular) =====
function brExtraSection(extra) {
  const chs = Object.entries(extra.chapters || {}).sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]));
  if (!chs.length) return '';
  return `
  <div class="brx-box">
    <div class="brx-head">
      <span class="brx-badge">🇧🇷 EXTRA</span>
      <div>
        <strong>Capítulos completos em português</strong>
        <p class="muted" style="font-size:11px">Baixados pelo scraper — ${chs.length} capítulos, ${chs.reduce((a, [, c]) => a + (c.pages || 0), 0)} páginas</p>
      </div>
    </div>
    <div class="chapter-list brx-list">
      ${chs.map(([num, c]) => `
      <div class="chapter-item" onclick="openBrExtra('${state.brExtra.title.replace(/'/g, "\\'")}', '${num}')">
        <div class="num">${num}</div>
        <div class="info"><div class="ch-title">Capítulo ${num}</div><div class="ch-sub">${c.pages || '?'} páginas · BR</div></div>
        <div class="chev">▶</div>
      </div>`).join('')}
    </div>
  </div>`;
}

// abre um capítulo BR extra (baixa o ZIP do gofile e mostra as imagens)
async function openBrExtra(title, num) {
  const extra = state.brExtra;
  if (!extra || !extra.chapters[num]) { toast('Capítulo não encontrado'); return; }
  const ch = extra.chapters[num];
  toast('Baixando capítulo…');
  try {
    const r = await fetch(px(ch.zip));
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const buf = await r.arrayBuffer();
    // descompacta o ZIP e monta as páginas
    const z = await new Response(buf).arrayBuffer();
    // fallback: baixa e extrai via arquivo temporário (JSZip não incluído — usa inflate manual via lib)
    const pages = await unzipPages(buf);
    if (!pages.length) throw new Error('ZIP vazio');
    state.brReader = { title, num, pages, idx: 0 };
    showView('view-reader');
    $('#bottomNav').classList.add('hidden');
    const body = $('#readerBody');
    body.innerHTML = pages.map((src, i) =>
      `<img class="page-img vertical" src="${src}" alt="página ${i + 1}" />`).join('');
    document.title = `${title} Cap. ${num} | Manganana`;
    body.scrollTop = 0;
    toast(`${pages.length} páginas`);
  } catch (e) {
    toast('Erro ao baixar: ' + e.message);
  }
}

// descompacta ZIP e retorna data URLs das imagens
async function unzipPages(buf) {
  const out = [];
  try {
    const ds = new DecompressionStream('deflate-raw');
    // JSZip-like manual: procura local file headers
    const view = new DataView(buf);
    let off = 0;
    while (off + 30 <= view.byteLength) {
      if (view.getUint32(off) !== 0x04034b50) break; // assinatura local file
      const method = view.getUint16(off + 8);
      const compSize = view.getUint32(off + 18);
      const nameLen = view.getUint16(off + 26);
      const extraLen = view.getUint16(off + 28);
      const name = new TextDecoder().decode(new Uint8Array(buf, off + 30, nameLen));
      const dataStart = off + 30 + nameLen + extraLen;
      const raw = new Uint8Array(buf, dataStart, compSize);
      if (/\.(jpe?g|png|webp)$/i.test(name)) {
        let bytes = raw;
        if (method === 8) { // deflate
          const ds = new DecompressionStream('deflate-raw');
          bytes = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(ds)).arrayBuffer());
        }
        const blob = new Blob([bytes], { type: 'image/jpeg' });
        out.push(URL.createObjectURL(blob));
      }
      off = dataStart + compSize;
    }
  } catch (e) { console.warn('unzip err', e); }
  return out;
}
/* ---------- leitor ---------- */
async function openChapter(chapterId, startPage = 0, silent = false) {
  if (!silent) navPush({ view: 'reader', chapterId, page: startPage });
  showView('view-reader');
  $('#bottomNav').classList.add('hidden');
  const body = $('#readerBody');
  body.innerHTML = '<div class="reader-loading"><div class="spinner"></div>Carregando capítulo…</div>';
  body.scrollTop = 0;
  try {
    const ch = state.chapters.find((c) => c.id === chapterId);
    if (!ch) throw new Error('capítulo não encontrado');

    // provedor MangaPill: busca as páginas via scraping
    if (ch._provider === 'mangapill') {
      const data = await pillChapter(ch._pillSlug);
      if (!data.pages || !data.pages.length) throw new Error('sem páginas');
      const idx = Math.max(0, Math.min(startPage | 0, data.pages.length - 1));
      state.reader = {
        manga: state.detail, chapter: ch, pages: data.pages, baseUrl: '', hash: '', idx,
        provider: 'mangapill',
      };
      renderReader();
      if (idx > 0) restorePage(idx);
      return;
    }

    // provedor Manga Livre: busca as páginas via proxy
    if (ch._provider === 'mlivre') {
      const imgs = await mlChapterPages(ch._mlUrl);
      if (!imgs.length) throw new Error('sem páginas');
      const idx = Math.max(0, Math.min(startPage | 0, imgs.length - 1));
      state.reader = {
        manga: state.detail, chapter: ch, pages: imgs, baseUrl: '', hash: '', idx,
        provider: 'mlivre',
      };
      renderReader();
      if (idx > 0) restorePage(idx);
      return;
    }

    // provedor Vegitoons: busca as páginas via proxy
    if (ch._provider === 'vegi') {
      const imgs = await vegiChapter(ch._vegiId);
      if (!imgs.length) throw new Error('sem páginas');
      const idx = Math.max(0, Math.min(startPage | 0, imgs.length - 1));
      state.reader = {
        manga: state.detail, chapter: ch, pages: imgs, baseUrl: '', hash: '', idx,
        provider: 'vegi',
      };
      renderReader();
      if (idx > 0) restorePage(idx);
      return;
    }

    // provedor Comick: páginas via leitor web (direto do browser)
    if (ch._provider === 'ck') {
      const imgs = await ckChapterPages(ch._ckSlug, ch._ckHid, ch._ckChap, 'pt-br');
      if (!imgs.length) throw new Error('sem páginas');
      const idx = Math.max(0, Math.min(startPage | 0, imgs.length - 1));
      state.reader = {
        manga: state.detail, chapter: ch, pages: imgs, baseUrl: '', hash: '', idx,
        provider: 'ck',
      };
      renderReader();
      if (idx > 0) restorePage(idx);
      return;
    }

    // provedor MangaDex: at-home server
    const srv = await getChapterPages(chapterId);
    const base = srv.baseUrl;
    const hash = srv.chapter.hash;
    const files = state.settings.quality === 'dataSaver' ? srv.chapter.dataSaver : srv.chapter.data;
    const idx = Math.max(0, Math.min(startPage | 0, files.length - 1));
    state.reader = {
      manga: state.detail, chapter: ch, pages: files, baseUrl: base, hash, idx,
      provider: 'mangadex',
    };
    renderReader();
    if (idx > 0) restorePage(idx);
  } catch (e) {
    body.innerHTML = `<div class="empty"><p>Erro: ${esc(e.message)}<br>O capítulo pode não ter páginas disponíveis neste provedor.</p></div>`;
  }
}

// rola até a página salva depois das imagens carregarem
function restorePage(idx) {
  const tryScroll = () => {
    const imgs = $$('#readerBody .page-img');
    const target = imgs[idx];
    if (target && target.offsetHeight > 0) {
      target.scrollIntoView({ behavior: 'auto', block: 'start' });
    } else {
      setTimeout(tryScroll, 200);
    }
  };
  tryScroll();
}

function renderReader() {
  const r = state.reader;
  const body = $('#readerBody');
  const mode = state.settings.mode;
  $('#readerMangaName').textContent = mangaTitle(r.manga);
  $('#readerChapterName').textContent = chapterNum(r.chapter) + (chapterTitle(r.chapter) ? ' — ' + chapterTitle(r.chapter) : '');
  document.title = `${chapterNum(r.chapter)} — ${mangaTitle(r.manga)} | Manganana`;
  body.classList.toggle('rtl', state.settings.rtl);
  // MangaPill/Manga Livre/Vegitoons/Comick: páginas já são URLs completas; MangaDex: baseUrl/hash/file
  const urls = (r.provider === 'mangapill' || r.provider === 'mlivre' || r.provider === 'vegi' || r.provider === 'ck')
    ? r.pages.map((p) => px(p))
    : r.pages.map((p) => px(r.baseUrl + '/data/' + r.hash + '/' + p));
  body.innerHTML = urls.map((src, i) => readerPageHTML(src, i, mode)).join('') +
    chapterEndHTML();
  applyReaderStyles();
  initReaderZoom();
  initTapZones();
  updateReaderNav();
  updateReaderProgress();
  markProgress();
  preloadAdjacentPages();
  loadComments();
  // progresso acompanha o scroll (modo contínuo/webtoon)
  const rb = $('#readerBody');
  rb.onscroll = () => {
    const wraps = $$('#readerBody .page-wrap');
    if (!wraps.length || !state.reader) return;
    // página mais próxima do topo da viewport
    let best = 0, bestDist = Infinity;
    const top = rb.scrollTop + 40;
    wraps.forEach((w, i) => {
      const d = Math.abs(w.offsetTop - top);
      if (d < bestDist) { bestDist = d; best = i; }
    });
    if (best !== state.reader.idx) {
      state.reader.idx = best;
      updateReaderNav();
      updateReaderProgress();
      markProgress();
    }
  };
}

// HTML de cada página do leitor — com placeholder e pré-carregamento inteligente
function readerPageHTML(src, i, mode) {
  // 1ª página carrega com prioridade; demais com lazy (mas placeholder evita "tela branca")
  const fp = i === 0 ? ' fetchpriority="high" ' : '';
  const lazy = i === 0 ? '' : ' loading="lazy" ';
  return `<div class="page-wrap" data-idx="${i}">
    <div class="page-ph"></div>
    <img class="page-img ${mode}" ${fp}${lazy} decoding="async" src="${src}" alt="página ${i + 1}" />
  </div>`;
}

// pré-carrega a página atual + as 3 seguintes (acelera a leitura)
function preloadAdjacentPages() {
  const imgs = $$('#readerBody .page-img');
  const idx = state.reader?.idx ?? 0;
  for (let i = idx; i < Math.min(idx + 4, imgs.length); i++) {
    const img = imgs[i];
    if (img && !img.complete) {
      const ph = img.parentElement?.querySelector('.page-ph');
      if (ph) ph.style.display = 'block';
      const clone = new Image();
      clone.onload = () => { img.src = img.src; img.classList.add('loaded'); if (ph) ph.style.display = 'none'; };
      clone.onerror = () => { if (ph) ph.style.display = 'none'; };
      clone.src = img.src;
    }
  }
}

// esconde placeholder quando a imagem termina de carregar (delegação)
function bindPageLoad() {
  document.addEventListener('load', (e) => {
    if (e.target && e.target.classList && e.target.classList.contains('page-img')) {
      e.target.classList.add('loaded');
      const ph = e.target.parentElement?.querySelector('.page-ph');
      if (ph) ph.style.display = 'none';
    }
  }, true);
}

function updateReaderNav() {
  const idx = state.reader?.idx ?? 0;
  const total = state.reader?.pages.length ?? 0;
  const prevB = $('#prevChapter');
  const nextB = $('#nextChapter');
  prevB.disabled = !(idx > 0);
  nextB.disabled = !(idx < total - 1);
  const lbl = $('#pageJumpLabel');
  if (lbl) lbl.textContent = (idx + 1) + '/' + total;
}

// ir para uma página específica do capítulo
function pageJump() {
  const r = state.reader;
  if (!r || !r.pages.length) return;
  const total = r.pages.length;
  const cur = r.idx + 1;
  const v = prompt(`Ir para página (1-${total}):`, String(cur));
  if (v === null || v.trim() === '') return;
  const n = parseInt(v, 10);
  if (isNaN(n) || n < 1 || n > total) { toast('Página inválida'); return; }
  state.reader.idx = n - 1;
  scrollToPage();
}

function prevPage() { if (state.reader && state.reader.idx > 0) { state.reader.idx--; scrollToPage(); } }
function nextPage() { if (state.reader && state.reader.idx < state.reader.pages.length - 1) { state.reader.idx++; scrollToPage(); } }
function scrollToPage() {
  const wraps = $$('#readerBody .page-wrap');
  const target = wraps[state.reader.idx];
  if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  updateReaderNav();
  markProgress();
  preloadAdjacentPages();
  updateReaderProgress();
}

// barra de progresso do capítulo (página atual / total)
function updateReaderProgress() {
  const r = state.reader;
  const bar = $('#readerProgressBar');
  const txt = $('#readerProgressText');
  if (!r || !bar || !txt) return;
  const total = r.pages.length || 1;
  const cur = Math.min(r.idx + 1, total);
  const pct = Math.round((cur / total) * 100);
  bar.style.width = pct + '%';
  txt.textContent = `${cur}/${total} · ${pct}%`;
}

function prevChapterNav() {
  const chs = state.chapters;
  const cur = state.reader?.chapter?.id;
  const idx = chs.findIndex((c) => c.id === cur);
  if (idx > 0) openChapter(chs[idx - 1].id);
  else toast('Já está no primeiro capítulo');
}function nextChapterNav() {
  const chs = state.chapters;
  const cur = state.reader?.chapter?.id;
  const idx = chs.findIndex((c) => c.id === cur);
  if (idx < chs.length - 1) openChapter(chs[idx + 1].id);
  else toast('Último capítulo');
}
function closeReader() {
  // botão voltar do leitor: volta pro detalhe (desempilha sem re-push)
  navStack = navStack.filter((e) => e.view !== 'reader');
  if (state.detail) { showView('view-detail'); renderDetail(state.detail); }
  else switchTab('home', false);
  $('#bottomNav').classList.remove('hidden');
}

/* ---------- leitor turbinado ---------- */
// bloco "fim do capítulo" com botões de navegação + comentários
function chapterEndHTML() {
  const chs = state.chapters || [];
  const cur = state.reader?.chapter?.id;
  const idx = chs.findIndex((c) => c.id === cur);
  const hasNext = idx < chs.length - 1;
  const hasPrev = idx > 0;
  const mangaId = state.reader?.manga?.id || state.detail?.id || '';
  const chapterId = cur || '';
  return `
  <div class="chapter-end">
    <div class="ce-divider"><span>Fim do capítulo</span></div>
    <div class="ce-title">${esc(chapterNum(state.reader?.chapter))}</div>
    <div class="ce-actions">
      ${hasPrev ? `<button class="ce-btn ghost" onclick="prevChapterNav()">← Anterior</button>` : ''}
      ${hasNext ? `<button class="ce-btn main" onclick="nextChapterNav()">Próximo capítulo →</button>` : '<span class="muted" style="font-size:12px">Último capítulo disponível</span>'}
    </div>
    <button class="ce-btn ghost" onclick="closeReader()">Voltar ao mangá</button>
  </div>
  <div class="comments-block" data-manga="${esc(mangaId)}" data-chapter="${esc(chapterId)}">
    <div class="cb-head"><h3>💬 Comentários</h3><span class="cb-count" id="cbCount"></span></div>
    <div class="cb-list" id="cbList"><div class="cb-loading">Carregando comentários…</div></div>
    <div class="cb-form">
      ${syncUser
        ? `<div class="cb-input-row">
             <textarea id="cbText" rows="2" maxlength="500" placeholder="Comente este capítulo…"></textarea>
             <button class="cb-send" id="cbSend" onclick="sendComment()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg></button>
           </div>`
        : `<button class="cb-login" onclick="switchTab('profile')">Entrar com Google para comentar</button>`}
    </div>
  </div>`;
}

// carrega os comentários do capítulo atual
async function loadComments() {
  const block = $('#readerBody .comments-block');
  if (!block) return;
  const manga = block.dataset.manga;
  const chapter = block.dataset.chapter;
  if (!manga || !chapter) return;
  const list = $('#cbList');
  const count = $('#cbCount');
  if (list) list.innerHTML = '<div class="cb-loading">Carregando comentários…</div>';
  try {
    const r = await fetch(`/api/comments?manga=${encodeURIComponent(manga)}&chapter=${encodeURIComponent(chapter)}`);
    const j = await r.json();
    if (!j.ok || !j.comments) throw new Error('erro');
    const c = j.comments;
    if (count) count.textContent = c.length ? `(${c.length})` : '';
    if (!list) return;
    if (!c.length) {
      list.innerHTML = '<div class="cb-empty">Nenhum comentário ainda — seja o primeiro! 🎉</div>';
      return;
    }
    list.innerHTML = c.map((cm) => commentItemHTML(cm)).join('');
  } catch {
    if (list) list.innerHTML = '<div class="cb-empty">Não foi possível carregar os comentários.</div>';
  }
}

// HTML de um comentário (com curtir, responder, apagar e respostas)
function commentItemHTML(cm) {
  const myId = syncUser?.id;
  const liked = myId && (cm.likes || []).includes(myId);
  const nLikes = (cm.likes || []).length;
  const replies = cm.replies || [];
  return `
  <div class="cb-item" id="cb-${cm.id}">
    <div class="cb-avatar-wrap" onclick="openUserProfile('${cm.user.id}')">
      ${cm.user.image ? `<img class="cb-avatar" src="${esc(cm.user.image)}" alt="" />` : `<div class="cb-avatar ph">${esc((cm.user.name || 'L')[0])}</div>`}
    </div>
    <div class="cb-body">
      <div class="cb-meta">
        <strong class="cb-name" onclick="openUserProfile('${cm.user.id}')">${esc(cm.user.name)}</strong>
        <small>${timeAgo(cm.ts)}</small>
        ${myId && cm.user.id === myId ? `<button class="cb-del" onclick="deleteComment('${cm.id}')" title="Apagar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>` : ''}
      </div>
      <p>${esc(cm.text)}</p>
      <div class="cb-actions">
        <button class="cb-like ${liked ? 'liked' : ''}" onclick="likeComment('${cm.id}', this)">
          <svg viewBox="0 0 24 24" fill="${liked ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
          <span>${nLikes || ''}</span>
        </button>
        <button class="cb-reply-btn" onclick="toggleReply('${cm.id}')">Responder</button>
      </div>
      ${replies.length ? `<div class="cb-replies">${replies.map((rp) => `
        <div class="cb-item reply">
          <div class="cb-avatar-wrap" onclick="openUserProfile('${rp.userId}')">
            ${rp.user?.image ? `<img class="cb-avatar sm" src="${esc(rp.user.image)}" alt="" />` : `<div class="cb-avatar sm ph">${esc((rp.user?.name || 'L')[0])}</div>`}
          </div>
          <div class="cb-body">
            <div class="cb-meta"><strong class="cb-name" onclick="openUserProfile('${rp.userId}')">${esc(rp.user?.name || 'Leitor')}</strong><small>${timeAgo(rp.ts)}</small></div>
            <p>${esc(rp.text)}</p>
          </div>
        </div>`).join('')}</div>` : ''}
      <div class="cb-reply-form" id="rf-${cm.id}" hidden>
        <input id="rt-${cm.id}" maxlength="300" placeholder="Responder…" />
        <button class="cb-send sm" onclick="sendReply('${cm.id}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg></button>
      </div>
    </div>
  </div>`;
}

// mostra/esconde a caixa de responder
function toggleReply(id) {
  const f = $('#rf-' + id);
  if (!f) return;
  if (!syncUser) { switchTab('profile'); return; }
  f.hidden = !f.hidden;
  if (!f.hidden) f.querySelector('input')?.focus();
}

// envia resposta
async function sendReply(parentId) {
  if (!syncUser) { toast('Entre com sua conta primeiro'); return; }
  const inp = $('#rt-' + parentId);
  const text = inp?.value.trim();
  if (!text) { toast('Escreva algo antes de responder'); return; }
  try {
    const token = await window.Clerk.session?.getToken();
    if (!token) { toast('Sessão expirada — recarregue a página'); return; }
    const r = await fetch('/api/comments?reply=1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ parent: parentId, text }),
    });
    const j = await r.json();
    if (!j.ok) { toast('Erro: ' + (j.error || 'não foi possível responder')); return; }
    if (inp) inp.value = '';
    toast('Resposta enviada!');
    loadComments();
  } catch {
    toast('Erro de rede — tente de novo');
  }
}

// curte/descurte um comentário
async function likeComment(id, btn) {
  if (!syncUser) { switchTab('profile'); return; }
  if (btn.disabled) return;
  btn.disabled = true;
  try {
    const token = await window.Clerk.session?.getToken();
    if (!token) { toast('Sessão expirada — recarregue a página'); return; }
    const r = await fetch('/api/comments?like=1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ id }),
    });
    const j = await r.json();
    if (!j.ok) { toast('Erro: ' + (j.error || 'não foi possível curtir')); return; }
    const span = btn.querySelector('span');
    if (span) span.textContent = j.count || '';
    btn.classList.toggle('liked', j.liked);
    const svg = btn.querySelector('svg');
    if (svg) svg.setAttribute('fill', j.liked ? 'currentColor' : 'none');
    toast(j.liked ? '❤️' : '');
  } catch {
    toast('Erro de rede — tente de novo');
  } finally {
    btn.disabled = false;
  }
}

// abre o perfil público de um usuário (sheet)
async function openUserProfile(uid) {
  try {
    const r = await fetch('/api/comments?user=' + encodeURIComponent(uid));
    const j = await r.json();
    if (!j.ok || !j.user) { toast('Usuário não encontrado'); return; }
    const u = j.user;
    const isMe = syncUser && syncUser.id === uid;
    showUserSheet(u, isMe);
  } catch {
    toast('Erro de rede');
  }
}

// sheet de perfil público
function showUserSheet(u, isMe) {
  let sh = $('#userSheet');
  if (!sh) {
    sh = document.createElement('div');
    sh.id = 'userSheet';
    sh.className = 'sheet user-sheet';
    document.body.appendChild(sh);
    sh.addEventListener('click', (e) => { if (e.target === sh) sh.classList.remove('open'); });
  }
  sh.innerHTML = `
    <div class="sheet-handle"></div>
    <div class="sheet-head"><strong>Perfil</strong><button class="icon-btn" onclick="$('#userSheet').classList.remove('open')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>
    <div class="sheet-body" style="text-align:center;padding:20px">
      ${u.image ? `<img src="${esc(u.image)}" class="user-sheet-avatar" alt="" />` : `<div class="user-sheet-avatar ph">${esc((u.name || 'L')[0])}</div>`}
      <h3 style="margin-top:12px">${esc(u.name)}</h3>
      <p class="muted" style="font-size:12px;margin-top:4px">${isMe ? 'Este é você!' : 'Membro do Manganana'}</p>
      <div style="display:flex;gap:20px;justify-content:center;margin-top:16px">
        <div><strong>${u.comments}</strong><small class="muted" style="display:block;font-size:11px">comentários</small></div>
      </div>
    </div>`;
  sh.classList.add('open');
}

// envia um comentário no capítulo atual
async function sendComment() {
  if (!syncUser) { toast('Entre com sua conta primeiro'); return; }
  const textEl = $('#cbText');
  const text = textEl?.value.trim();
  if (!text) { toast('Escreva algo antes de enviar'); return; }
  const block = $('#readerBody .comments-block');
  if (!block) return;
  const btn = $('#cbSend');
  if (btn) btn.disabled = true;
  try {
    const token = await window.Clerk.session?.getToken();
    if (!token) { toast('Sessão expirada — recarregue a página'); return; }
    const r = await fetch('/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ manga: block.dataset.manga, chapter: block.dataset.chapter, text }),
    });
    const j = await r.json();
    if (!j.ok) { toast('Erro: ' + (j.error || 'não foi possível comentar')); return; }
    if (textEl) textEl.value = '';
    toast('Comentário enviado!');
    loadComments();
  } catch {
    toast('Erro de rede — tente de novo');
  } finally {
    if (btn) btn.disabled = false;
  }
}

// apaga um comentário próprio
async function deleteComment(id) {
  if (!syncUser) return;
  try {
    const token = await window.Clerk.session?.getToken();
    if (!token) return;
    const r = await fetch('/api/comments?id=' + id, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + token },
    });
    const j = await r.json();
    if (j.ok) { toast('Comentário removido'); loadComments(); }
  } catch { /* ignora */ }
}

// formata tempo relativo ("há 5 min")
function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'agora';
  const m = Math.floor(s / 60);
  if (m < 60) return 'há ' + m + ' min';
  const h = Math.floor(m / 60);
  if (h < 24) return 'há ' + h + 'h';
  const d = Math.floor(h / 24);
  if (d < 30) return 'há ' + d + 'd';
  return new Date(ts).toLocaleDateString('pt-BR');
}

// aplica fundo + brilho + largura no leitor
function applyReaderStyles() {
  const s = state.settings;
  const view = $('#view-reader');
  const body = $('#readerBody');
  if (!view) return;
  // fundo do leitor (auto = segue o tema do app)
  view.classList.remove('bg-sepia', 'bg-light');
  if (s.readerBg === 'sepia') view.classList.add('bg-sepia');
  else if (s.readerBg === 'light') view.classList.add('bg-light');
  // brilho: overlay com preto/transparente sobre o leitor
  let ov = $('#readerBrightness');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'readerBrightness';
    ov.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:5;background:#000;transition:opacity .2s';
    view.appendChild(ov);
  }
  const b = s.readerBright;
  ov.style.opacity = b >= 100 ? '0' : String((100 - b) / 100);
  // largura das páginas
  if (body) {
    const w = s.readerWidth;
    body.style.setProperty('--page-w', w + '%');
  }
  // contraste + saturação + nitidez via CSS filter nas imagens
  if (body) {
    const c = s.readerContrast ?? 100;
    const sat = s.readerSat ?? 100;
    const sharp = s.readerSharp || 'soft';
    let filter = `contrast(${c / 100}) saturate(${sat / 100})`;
    if (sharp === 'soft') filter += ' blur(0.3px)';       // suaviza pixel art
    else if (sharp === 'crisp') filter += ' contrast(1.05) saturate(1.05)'; // mais definido
    // 'auto' e 'none' deixam o filter de cor apenas
    body.style.setProperty('--page-filter', filter);
  }
}

// zoom por pinça/double-tap numa página
function initReaderZoom() {
  const body = $('#readerBody');
  if (!body) return;
  if (body.dataset.zoomInit) return; // idempotente
  body.dataset.zoomInit = '1';
  // impede zoom acidental do browser (pinça/double-tap) no leitor
  body.addEventListener('gesturestart', (e) => e.preventDefault());
  body.addEventListener('dblclick', (e) => {
    const img = e.target.closest('.page-img');
    if (!img) return;
    img.classList.toggle('zoomed');
  });
  // double-tap via touch (mais confiável no Android)
  let lastTap = 0;
  let lastTapTarget = null;
  body.addEventListener('touchend', (e) => {
    const img = e.target.closest('.page-img');
    if (!img) return;
    const now = Date.now();
    if (lastTapTarget === img && now - lastTap < 320) {
      e.preventDefault();
      img.classList.toggle('zoomed');
      lastTap = 0;
      lastTapTarget = null;
    } else {
      lastTap = now;
      lastTapTarget = img;
    }
  }, { passive: false });
  // pinch-zoom nativo habilitado (meta viewport já tem user-scalable? garante)
  const meta = document.querySelector('meta[name=viewport]');
  if (meta) meta.setAttribute('content', 'width=device-width, initial-scale=1.0, viewport-fit=cover, maximum-scale=5, user-scalable=yes');
}

// zonas de toque: tap na borda esquerda = anterior, direita = próximo (só em modo página)
function initTapZones() {
  const body = $('#readerBody');
  if (!body) return;
  // remove zonas antigas
  $$('.tap-zone').forEach((z) => z.remove());
  if (!state.settings.tapZones) return;
  const mk = (side, fn) => {
    const z = document.createElement('div');
    z.className = 'tap-zone ' + side;
    z.addEventListener('click', fn);
    body.appendChild(z);
  };
  mk('left', () => { if (state.settings.mode !== 'paged') return; prevPage(); });
  mk('right', () => { if (state.settings.mode !== 'paged') return; nextPage(); });
}

// webtoon: ao chegar no fim do capítulo, carrega o próximo automaticamente
function webtoonCheck() {
  if (!state.settings.webtoon || !state.reader) return;
  const body = $('#readerBody');
  if (!body) return;
  const rect = body.getBoundingClientRect();
  const last = body.lastElementChild;
  if (!last) return;
  const lastRect = last.getBoundingClientRect();
  if (lastRect.top < rect.bottom + 200) {
    const chs = state.chapters;
    const idx = chs.findIndex((c) => c.id === state.reader.chapter.id);
    if (idx < chs.length - 1) {
      // carrega o próximo sem sair da view
      const next = chs[idx + 1];
      loadNextWebtoon(next);
    }
  }
}

async function loadNextWebtoon(ch) {
  const r = state.reader;
  if (!r) return;
  const body = $('#readerBody');
  try {
    if (ch._provider === 'mangapill') {
      const data = await pillChapter(ch._pillSlug);
      if (!data.pages?.length) return;
      const urls = data.pages.map((p) => px(p));
      body.insertAdjacentHTML('beforeend', webtoonBlockHTML(ch, urls));
    } else {
      const srv = await getChapterPages(ch.id);
      const files = state.settings.quality === 'dataSaver' ? srv.chapter.dataSaver : srv.chapter.data;
      const urls = files.map((p) => px(srv.baseUrl + '/data/' + srv.chapter.hash + '/' + p));
      body.insertAdjacentHTML('beforeend', webtoonBlockHTML(ch, urls));
    }
    // atualiza o reader para o próximo capítulo (para progresso/nav)
    state.reader.chapter = ch;
    state.reader.pages = [];
    state.reader.idx = 0;
    updateReaderNav();
    markProgress();
  } catch { /* silencioso: sem internet ou capítulo sem páginas */ }
}

function webtoonBlockHTML(ch, urls) {
  return `<div class="webtoon-sep">${esc(chapterNum(ch))} ${chapterTitle(ch) ? '— ' + esc(chapterTitle(ch)) : ''}</div>` +
    urls.map((src) => `<img class="page-img vertical" loading="lazy" src="${src}" alt="página" />`).join('');
}

function openReaderSettings() {
  const s = state.settings;
  $('#rsBright').value = s.readerBright;
  $('#rsBrightVal').textContent = s.readerBright + '%';
  $('#rsContrast').value = s.readerContrast ?? 100;
  $('#rsContrastVal').textContent = (s.readerContrast ?? 100) + '%';
  $('#rsSat').value = s.readerSat ?? 100;
  $('#rsSatVal').textContent = (s.readerSat ?? 100) + '%';
  const sharpNames = { soft: 'Suave', auto: 'Auto', crisp: 'Nítido', none: 'Original' };
  $('#rsSharpVal').textContent = sharpNames[s.readerSharp] || 'Suave';
  $$('#rsSharpChips .rs-chip').forEach((c) => c.classList.toggle('active', c.dataset.sharp === (s.readerSharp || 'soft')));
  $('#rsWidth').value = s.readerWidth;
  $('#rsWidthVal').textContent = s.readerWidth + '%';
  $('#rsWebtoon').checked = !!s.webtoon;
  $('#rsTapZones').checked = !!s.tapZones;
  $$('#rsBgChips .rs-chip').forEach((c) => c.classList.toggle('active', c.dataset.bg === s.readerBg));
  openSheet('#readerSettingsSheet');
}

// abrir menu de compartilhamento do mangá
function shareManga() {
  const m = state.detail;
  if (!m) return;
  openSheet('#shareMangaSheet');
}

// copiar link do mangá — link bonito (?manga=ID) via Web Share API ou copiar
async function copyMangaLink() {
  const m = state.detail;
  if (!m) return;
  const title = mangaTitle(m);
  const url = location.origin + location.pathname + '?manga=' + m.id;
  const text = `📖 ${title} — lendo no Manganana!`;
  try {
    if (navigator.share) {
      await navigator.share({ title, text, url });
      return;
    }
  } catch { /* usuário cancelou */ }
  // fallback: copia o link
  try {
    await navigator.clipboard.writeText(url);
    toast('Link copiado!');
  } catch {
    prompt('Link do mangá:', url);
  }
}

/* ---------- filtros avançados da busca ---------- */
function openFilters() {
  // sincroniza a UI com o estado atual
  const sync = (sel, val) => {
    $$(sel + ' .f-chip').forEach((c) => c.classList.toggle('active', c.dataset.v === val));
  };
  sync('#fStatus', state.filters.status);
  sync('#fYear', state.filters.year);
  sync('#fSort', state.filters.sort);
  updateFilterDot();
  openSheet('#filtersSheet');
}

function updateFilterDot() {
  const dot = $('#filterDot');
  const has = state.filters.status || state.filters.year || state.filters.sort !== 'followedCount';
  if (dot) dot.classList.toggle('show', !!has);
}

function applyFilters() {
  closeSheets();
  state.explore.offset = 0;
  $('#exploreGrid').innerHTML = '';
  updateFilterDot();
  loadExplore();
  toast('Filtros aplicados');
}

function clearFilters() {
  state.filters = { status: '', year: '', sort: 'followedCount' };
  store('filters', state.filters);
  $$('#fStatus .f-chip').forEach((c) => c.classList.toggle('active', c.dataset.v === ''));
  $$('#fYear .f-chip').forEach((c) => c.classList.toggle('active', c.dataset.v === ''));
  $$('#fSort .f-chip').forEach((c) => c.classList.toggle('active', c.dataset.v === 'followedCount'));
  applyFilters();
  toast('Filtros limpos');
}

/* ---------- navegação ---------- */
function switchTab(tab, keepScroll = true, silent = false) {
  state.tab = tab;
  showView(tab ? 'view-' + tab : null);
  $$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  // sempre restaura a barra de navegação ao trocar de aba (corrige bug de sumir)
  $('#bottomNav').classList.remove('hidden');
  if (tab === 'explore' && !$('#exploreGrid').children.length) loadExplore();
  if (tab === 'home') renderContinue();
  if (tab === 'library') renderLibrary();
  if (tab === 'profile') { renderProfile(); renderDownloads(); }
  // empilha a navegação (exceto quando restaurando via popstate)
  if (tab && !silent) {
    const last = navStack[navStack.length - 1];
    if (!last || last.view !== tab) navPush({ view: tab });
  }
}

// ===== estatísticas de leitura =====
const READING_LOG_KEY = 'readingLog';

// registra um evento de leitura (capítulo lido) com data
function logReading(mangaId, title, chapter) {
  const log = load(READING_LOG_KEY, []);
  log.push({ m: mangaId, t: title, c: chapter, d: Date.now() });
  // mantém só os últimos 500 eventos
  store(READING_LOG_KEY, log.slice(-500));
  checkAchievements();
}

/* ========== CONQUISTAS (gamificação) ========== */
const ACHIEVEMENTS = [
  { id: 'cap10', icon: '📖', title: 'Primeiras páginas', desc: 'Leia 10 capítulos', check: (s) => s.total >= 10 },
  { id: 'cap50', icon: '📚', title: 'Leitor dedicado', desc: 'Leia 50 capítulos', check: (s) => s.total >= 50 },
  { id: 'cap200', icon: '🏛️', title: 'Biblioteca viva', desc: 'Leia 200 capítulos', check: (s) => s.total >= 200 },
  { id: 'cap500', icon: '🔥', title: 'Viciado oficial', desc: 'Leia 500 capítulos', check: (s) => s.total >= 500 },
  { id: 'cap1000', icon: '👑', title: 'Lenda do Manganana', desc: 'Leia 1.000 capítulos', check: (s) => s.total >= 1000 },
  { id: 'streak3', icon: '🌱', title: 'Criando hábito', desc: '3 dias seguidos lendo', check: (s) => s.streak >= 3 },
  { id: 'streak7', icon: '⚡', title: 'Semana completa', desc: '7 dias seguidos lendo', check: (s) => s.streak >= 7 },
  { id: 'streak30', icon: '🌋', title: 'Mês de fogo', desc: '30 dias seguidos lendo', check: (s) => s.streak >= 30 },
  { id: 'manga5', icon: '🎯', title: 'Explorador', desc: 'Leia 5 mangás diferentes', check: (s) => s.mangas >= 5 },
  { id: 'manga15', icon: '🧭', title: 'Aventureiro', desc: 'Leia 15 mangás diferentes', check: (s) => s.mangas >= 15 },
  { id: 'manga40', icon: '🌐', title: 'Colecionador de mundos', desc: 'Leia 40 mangás diferentes', check: (s) => s.mangas >= 40 },
  { id: 'fav10', icon: '💛', title: 'Primeiros favoritos', desc: 'Favoritou 10 mangás', check: (s) => s.favs >= 10 },
  { id: 'fav30', icon: '💎', title: 'Gosto refinado', desc: 'Favoritou 30 mangás', check: (s) => s.favs >= 30 },
  { id: 'maratona', icon: '🏃', title: 'Maratonista', desc: 'Leia 20 capítulos em 1 dia', check: (s) => s.maxDay >= 20 },
  { id: 'madrugada', icon: '🦉', title: 'Coruja', desc: 'Leia 1 capítulo depois da meia-noite', check: (s) => s.nightReads > 0 },
];

// stats completas pra conquistas
function achievementStats() {
  const log = load(READING_LOG_KEY, []);
  const byDay = {};
  let nightReads = 0;
  for (const e of log) {
    const k = dayKey(e.d);
    byDay[k] = (byDay[k] || 0) + 1;
    const h = new Date(e.d).getHours();
    if (h >= 0 && h < 4) nightReads++;
  }
  const days = new Set(Object.keys(byDay));
  let streak = 0;
  const cursor = new Date();
  const today = dayKey(cursor.getTime());
  if (!days.has(today)) cursor.setDate(cursor.getDate() - 1);
  while (days.has(dayKey(cursor.getTime()))) { streak++; cursor.setDate(cursor.getDate() - 1); }
  return {
    total: log.length,
    mangas: new Set(log.map((e) => e.m)).size,
    streak,
    favs: state.favs.length,
    maxDay: Math.max(0, ...Object.values(byDay)),
    nightReads,
  };
}

// retorna conquistas desbloqueadas (persistidas)
function unlockedAchievements() { return load('achievements', []); }

// checa conquistas e notifica as novas
function checkAchievements() {
  const s = achievementStats();
  const unlocked = new Set(unlockedAchievements());
  const fresh = [];
  for (const a of ACHIEVEMENTS) {
    if (!unlocked.has(a.id) && a.check(s)) {
      unlocked.add(a.id);
      fresh.push(a);
    }
  }
  if (!fresh.length) return;
  store('achievements', [...unlocked]);
  schedulePush();
  // toast + notificação (a primeira com destaque)
  fresh.forEach((a, i) => setTimeout(() => {
    toast(`🏆 Conquista: ${a.title}!`, '🎉');
  }, i * 900));
  // avisa no Telegram (se vinculado) — payload via pushSync já inclui achievements
  if (fresh.length && syncUser) pushSync();
}

// renderiza o grid de conquistas no perfil
function renderAchievements() {
  let wrap = $('#achvWrap');
  const content = $('#view-profile .content');
  if (!content) return;
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.id = 'achvWrap';
    // insere DENTRO da seção Resumo (após statsWrap)
    const resumo = $('#pSecResumo');
    const target = resumo || content;
    const anchor = $('#statsWrap') || $('#visitCount') || $('#profileBio');
    target.insertBefore(wrap, anchor ? anchor.nextSibling : null);
  }
  const s = achievementStats();
  const unlocked = new Set(unlockedAchievements());
  const unlockedCount = ACHIEVEMENTS.filter((a) => unlocked.has(a.id)).length;
  wrap.innerHTML = `
    <div class="stats-head">
      <h3><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width: 16px; height: 16px; color: var(--accent);"><circle cx="12" cy="8" r="7"></circle><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"></polyline></svg>Conquistas</h3>
      <span class="stats-streak">${unlockedCount}/${ACHIEVEMENTS.length}</span>
    </div>
    <div class="achv-grid">
      ${ACHIEVEMENTS.map((a) => {
        const has = unlocked.has(a.id);
        const prog = progressOf(a, s);
        return `
        <div class="achv-item ${has ? 'unlocked' : ''}" title="${esc(a.desc)}">
          <div class="achv-icon">${has ? a.icon : '🔒'}</div>
          <div class="achv-name">${esc(a.title)}</div>
          ${has ? '<div class="achv-check">✓</div>' : `<div class="achv-prog">${prog}</div>`}
        </div>`;
      }).join('')}
    </div>`;
}

// progresso textual pra conquista bloqueada (ex: "7/10")
function progressOf(a, s) {
  if (a.id.startsWith('cap')) return `${Math.min(s.total, 1000)}/${a.id.replace('cap', '')}`;
  if (a.id.startsWith('streak')) return `${s.streak}/${a.id.replace('streak', '')}`;
  if (a.id.startsWith('manga')) return `${s.mangas}/${a.id.replace('manga', '')}`;
  if (a.id.startsWith('fav')) return `${s.favs}/${a.id.replace('fav', '')}`;
  if (a.id === 'maratona') return `${s.maxDay}/20`;
  if (a.id === 'madrugada') return s.nightReads > 0 ? '✓' : '0/1';
  return '';
}

// dia local em formato YYYY-MM-DD
function dayKey(ts) {
  const d = new Date(ts);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// calcula estatísticas: streak, últimos 7 dias, totais
function readingStats() {
  const log = load(READING_LOG_KEY, []);
  const days = new Set(log.map((e) => dayKey(e.d)));
  const byDay = {};
  for (const e of log) {
    const k = dayKey(e.d);
    byDay[k] = (byDay[k] || 0) + 1;
  }
  // streak: dias seguidos lendo (hoje conta, ontem não quebra)
  let streak = 0;
  const cursor = new Date();
  const today = dayKey(cursor.getTime());
  if (!days.has(today)) cursor.setDate(cursor.getDate() - 1); // permite streak que "ainda não leu hoje"
  while (days.has(dayKey(cursor.getTime()))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  // últimos 7 dias (incluindo hoje)
  const week = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    week.push({ label: ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'][d.getDay()], key: dayKey(d.getTime()), n: byDay[dayKey(d.getTime())] || 0 });
  }
  const mangas = new Set(log.map((e) => e.m)).size;
  return { streak, week, total: log.length, mangas };
}

// renderiza a seção de estatísticas no perfil
function renderStatsSection() {
  let wrap = $('#statsWrap');
  const content = $('#view-profile .content');
  if (!content) return;
  const s = readingStats();
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.id = 'statsWrap';
    wrap.className = 'stats-wrap';
    // insere DENTRO da seção Resumo (para as abas funcionarem)
    const resumo = $('#pSecResumo');
    const target = resumo || content;
    const anchor = $('#listsWrap') || $('#visitCount') || $('#profileBio');
    target.insertBefore(wrap, anchor ? anchor.nextSibling : null);
  }
  const max = Math.max(1, ...s.week.map((d) => d.n));
  const bars = s.week.map((d) => {
    const h = Math.max(6, Math.round((d.n / max) * 44));
    return `<div class="stat-bar-col" title="${d.n} capítulo(s)">
      <div class="stat-bar" style="height:${h}px"></div>
      <span class="stat-bar-label">${d.label}</span>
    </div>`;
  }).join('');
  wrap.innerHTML = `
    <div class="stats-head">
      <h3><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width: 16px; height: 16px; color: var(--accent);"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>Suas estatísticas</h3>
      <span class="stats-streak"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width: 12px; height: 12px; color: var(--accent); fill: var(--accent);"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"></path></svg>${s.streak} ${s.streak === 1 ? 'dia seguido' : 'dias seguidos'}</span>
    </div>
    <div class="stats-bars">${bars}</div>
    <div class="stats-totals">
      <div class="stat-total"><strong>${s.total}</strong><span>capítulos lidos</span></div>
      <div class="stat-total"><strong>${s.mangas}</strong><span>mangás</span></div>
      <div class="stat-total"><strong>${s.week.reduce((a, d) => a + d.n, 0)}</strong><span>nesta semana</span></div>
    </div>
    <button class="stats-share" id="btnShareStats"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" class="inline-icon" style="width: 14px; height: 14px; margin-right: 6px; color: inherit;"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line></svg>Compartilhar estatísticas</button>`;
  $('#btnShareStats').addEventListener('click', shareStatsCard);
}

// ── carregar imagem com CORS e fallback ──
function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => {
      // tenta carregar sem anonymous se falhar (pode tensionar o canvas mas tenta)
      const img2 = new Image();
      img2.onload = () => resolve(img2);
      img2.onerror = () => resolve(null);
      img2.src = src;
    };
    img.src = src;
  });
}

// ── quebra de texto para canvas ──
function wrapText(ctx, text, x, y, maxWidth, lineHeight, maxLines = 2) {
  const words = text.split(' ');
  let line = '';
  const lines = [];

  for (let n = 0; n < words.length; n++) {
    const testLine = line + words[n] + ' ';
    const metrics = ctx.measureText(testLine);
    const testWidth = metrics.width;
    if (testWidth > maxWidth && n > 0) {
      lines.push(line.trim());
      line = words[n] + ' ';
    } else {
      line = testLine;
    }
  }
  lines.push(line.trim());

  const linesToDraw = lines.slice(0, maxLines);
  if (lines.length > maxLines) {
    linesToDraw[maxLines - 1] = linesToDraw[maxLines - 1].substring(0, linesToDraw[maxLines - 1].length - 3) + '...';
  }

  for (let i = 0; i < linesToDraw.length; i++) {
    ctx.fillText(linesToDraw[i], x, y + i * lineHeight);
  }
  return linesToDraw.length;
}

// ── desenha avatar padrão ──
function drawDefaultAvatar(ctx, name, x = 540, y = 245, r = 45) {
  ctx.save();
  const avatarGrad = ctx.createLinearGradient(x - r, y - r, x + r, y + r);
  avatarGrad.addColorStop(0, '#ffd60a');
  avatarGrad.addColorStop(1, '#d97706');
  ctx.fillStyle = avatarGrad;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = '#141300';
  ctx.font = `900 ${Math.round(r * 0.9)}px system-ui, -apple-system, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(name.charAt(0).toUpperCase(), x, y);
  ctx.restore();
}

// ── card de estatísticas compartilhável premium (canvas) ──
async function shareStatsCard() {
  toast('Gerando imagem de estatísticas… 🎨');
  const s = readingStats();
  const name = syncUser?.name?.split(' ')[0] || 'Leitor';
  const cv = document.createElement('canvas');
  cv.width = 1080;
  cv.height = 1350;
  const ctx = cv.getContext('2d');

  // fundo com gradiente radial profundo premium (obsidian)
  const bgGrad = ctx.createRadialGradient(540, 675, 100, 540, 675, 800);
  bgGrad.addColorStop(0, '#0d1322');
  bgGrad.addColorStop(0.6, '#080c16');
  bgGrad.addColorStop(1, '#04060b');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, 1080, 1350);

  // Efeitos de iluminação de estúdio (Glows neon)
  // Glow superior direito (Dourado/Ambar quente)
  const glowTR = ctx.createRadialGradient(900, 250, 0, 900, 250, 450);
  glowTR.addColorStop(0, 'rgba(255, 214, 10, 0.16)');
  glowTR.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glowTR;
  ctx.fillRect(0, 0, 1080, 1350);

  // Glow inferior esquerdo (Ciano/Azul neon)
  const glowBL = ctx.createRadialGradient(180, 1100, 0, 180, 1100, 500);
  glowBL.addColorStop(0, 'rgba(99, 102, 241, 0.15)');
  glowBL.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glowBL;
  ctx.fillRect(0, 0, 1080, 1350);

  // Glow central atrás da contagem de streak
  const glowCenter = ctx.createRadialGradient(540, 485, 0, 540, 485, 300);
  glowCenter.addColorStop(0, 'rgba(255, 214, 10, 0.15)');
  glowCenter.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glowCenter;
  ctx.fillRect(0, 0, 1080, 1350);

  // Linhas curvas de iluminação ambiente dinâmicas (efeito Spotify/Apple)
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 214, 10, 0.035)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(-100, 400);
  ctx.bezierCurveTo(300, 200, 700, 800, 1180, 600);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(99, 102, 241, 0.035)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-100, 900);
  ctx.bezierCurveTo(400, 1100, 600, 500, 1180, 800);
  ctx.stroke();
  ctx.restore();

  // Padrão de grade de pontos discretos de alta qualidade
  ctx.fillStyle = 'rgba(255, 255, 255, 0.015)';
  for (let xG = 60; xG < 1020; xG += 40) {
    for (let yG = 60; yG < 1290; yG += 40) {
      ctx.beginPath();
      ctx.arc(xG, yG, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Moldura/Bordas Premium
  ctx.strokeStyle = 'rgba(255, 214, 10, 0.28)';
  ctx.lineWidth = 3;
  ctx.strokeRect(40, 40, 1000, 1270);

  // Linha de acento interna extremamente sutil
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
  ctx.lineWidth = 1;
  ctx.strokeRect(55, 55, 970, 1240);

  // Badge da logo no topo (Pílula moderna)
  ctx.fillStyle = 'rgba(255, 255, 255, 0.02)';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(410, 60, 260, 54, 27);
  } else {
    ctx.rect(410, 60, 260, 54);
  }
  ctx.fill();
  ctx.stroke();

  // Texto da logo centralizado no Badge
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '900 26px system-ui, -apple-system, sans-serif';
  
  const textManga = 'manga';
  const textSep = ' • ';
  const textNana = 'nana';
  const wM = ctx.measureText(textManga).width;
  const wS = ctx.measureText(textSep).width;
  const wN = ctx.measureText(textNana).width;
  const startX = 540 - (wM + wS + wN) / 2;

  ctx.fillStyle = '#ffd60a';
  ctx.fillText(textManga, startX + wM / 2, 87);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
  ctx.fillText(textSep, startX + wM + wS / 2, 87);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(textNana, startX + wM + wS + wN / 2, 87);

  // Slogan/Sub-cabeçalho decorativo
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.font = '700 12px system-ui, -apple-system, sans-serif';
  ctx.letterSpacing = '5px';
  ctx.fillText('ESTATÍSTICAS DE LEITURA', 540, 150);
  ctx.letterSpacing = 'normal'; // reset

  // Avatar da Conta (Se logado, renderiza com CORS, senão fallback elegante)
  if (syncUser && syncUser.image) {
    try {
      const avatarImg = await loadImage(syncUser.image);
      if (avatarImg) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(540, 245, 45, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(avatarImg, 540 - 45, 245 - 45, 90, 90);
        ctx.restore();

        // Borda dourada brilhante ao redor do avatar
        ctx.strokeStyle = '#ffd60a';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(540, 245, 45, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        drawDefaultAvatar(ctx, name, 540, 245, 45);
      }
    } catch {
      drawDefaultAvatar(ctx, name, 540, 245, 45);
    }
  } else {
    drawDefaultAvatar(ctx, name, 540, 245, 45);
  }

  // Nome do usuário com estilo refinado
  ctx.fillStyle = '#ffffff';
  ctx.font = '800 36px system-ui, -apple-system, sans-serif';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(`${name}, seu legado Manganana`, 540, 330);

  // Círculo decorativo da ofensiva (Streak)
  const circleX = 540;
  const circleY = 485;
  const radius = 90;

  // Sombra brilhante para o círculo de ofensiva
  ctx.shadowColor = 'rgba(255, 214, 10, 0.22)';
  ctx.shadowBlur = 35;
  ctx.fillStyle = 'rgba(255, 214, 10, 0.05)';
  ctx.beginPath();
  ctx.arc(circleX, circleY, radius, 0, Math.PI * 2);
  ctx.fill();

  // Linha de borda brilhante
  ctx.shadowBlur = 12;
  ctx.strokeStyle = 'rgba(255, 214, 10, 0.4)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(circleX, circleY, radius, 0, Math.PI * 2);
  ctx.stroke();

  // Desativa sombras
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;

  // Ícone de chama dourada desenhado via vetor Path2D
  const pathFlame = new Path2D("M12 2C11.5 2 8 6.5 8 11C8 13.5 10 15.5 12 15.5C14 15.5 16 13.5 16 11C16 6.5 12.5 2 12 2ZM12 5C12.5 7.5 14 9.5 14 11C14 12 13 13 12 13C11 13 10 12 10 11C10 9.5 11.5 7.5 12 5Z");
  ctx.save();
  ctx.translate(540 - 20, 415);
  ctx.scale(1.6, 1.6); // Escala adequada
  ctx.fillStyle = '#ffd60a';
  ctx.fill(pathFlame);
  ctx.restore();

  // Número da ofensiva
  ctx.fillStyle = '#ffffff';
  ctx.font = '900 74px system-ui, -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(s.streak), 540, 515);

  // Rótulo da ofensiva
  ctx.fillStyle = 'rgba(255, 214, 10, 0.95)';
  ctx.font = '800 15px system-ui, -apple-system, sans-serif';
  ctx.letterSpacing = '2px';
  ctx.fillText(s.streak === 1 ? 'DIA SEGUIDO' : 'DIAS SEGUIDOS', 540, 545);
  ctx.letterSpacing = 'normal'; // reset

  // Divisória horizontal sutil degradê
  const gradLine = ctx.createLinearGradient(140, 0, 940, 0);
  gradLine.addColorStop(0, 'rgba(255,255,255,0)');
  gradLine.addColorStop(0.5, 'rgba(255,255,255,0.12)');
  gradLine.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.strokeStyle = gradLine;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(140, 610);
  ctx.lineTo(940, 610);
  ctx.stroke();

  // Gráfico de barras (Últimos 7 dias)
  const max = Math.max(1, ...s.week.map((d) => d.n));
  const bw = 80;
  const gap = 24;
  const totalW = 7 * bw + 6 * gap;
  let x = (1080 - totalW) / 2;
  const baseY = 810;
  const labels = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];

  for (let i = 0; i < 7; i++) {
    const d = s.week[i];
    const h = Math.max(18, (d.n / max) * 150);

    // Fundo da barra
    ctx.fillStyle = 'rgba(255, 255, 255, 0.018)';
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(x, baseY - 150, bw, 150, 12);
    } else {
      ctx.rect(x, baseY - 150, bw, 150);
    }
    ctx.fill();

    // Gradiente bonito para a barra ativa
    const barGrad = ctx.createLinearGradient(x, baseY - h, x, baseY);
    if (d.n > 0) {
      barGrad.addColorStop(0, '#ffd60a');
      barGrad.addColorStop(1, '#d97706');
    } else {
      barGrad.addColorStop(0, 'rgba(255, 255, 255, 0.06)');
      barGrad.addColorStop(1, 'rgba(255, 255, 255, 0.02)');
    }

    ctx.fillStyle = barGrad;
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(x, baseY - h, bw, h, 12);
    } else {
      ctx.rect(x, baseY - h, bw, h);
    }
    ctx.fill();

    // Borda fina cintilante para barras ativas
    if (d.n > 0) {
      ctx.strokeStyle = 'rgba(255, 214, 10, 0.4)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Topo de acento brilhante
      ctx.fillStyle = '#ffd60a';
      ctx.fillRect(x, baseY - h, bw, 3);
    }

    // Texto com o valor lido no topo da barra
    ctx.fillStyle = d.n ? '#ffd60a' : 'rgba(255, 255, 255, 0.2)';
    ctx.font = '800 22px system-ui, -apple-system, sans-serif';
    ctx.fillText(String(d.n), x + bw / 2, baseY - h - 14);

    // Nome abreviado do dia da semana
    ctx.fillStyle = d.n ? '#ffffff' : 'rgba(255, 255, 255, 0.35)';
    ctx.font = '700 16px system-ui, -apple-system, sans-serif';
    ctx.fillText(labels[i], x + bw / 2, baseY + 30);

    x += bw + gap;
  }

  // Rótulo da seção de gráfico
  ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
  ctx.font = '700 13px system-ui, -apple-system, sans-serif';
  ctx.letterSpacing = '4px';
  ctx.fillText('HISTÓRICO DE LEITURA SEMANAL', 540, 880);
  ctx.letterSpacing = 'normal'; // reset

  // Cards de Totais
  const cards = [
    { n: s.total, l: 'capítulos lidos', icon: 'book' },
    { n: s.mangas, l: 'mangás salvos', icon: 'grid' },
    { n: s.week.reduce((a, d) => a + d.n, 0), l: 'lidos esta semana', icon: 'calendar' },
  ];
  const cw = 280;
  const cgap = 30;
  const cTotal = 3 * cw + 2 * cgap;
  let cx = (1080 - cTotal) / 2;
  const cy = 945;

  for (const c of cards) {
    // Fundo do card translúcido escuro
    const cardGrad = ctx.createLinearGradient(cx, cy, cx, cy + 160);
    cardGrad.addColorStop(0, 'rgba(255, 255, 255, 0.04)');
    cardGrad.addColorStop(1, 'rgba(255, 255, 255, 0.01)');
    ctx.fillStyle = cardGrad;
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(cx, cy, cw, 160, 24);
    } else {
      ctx.rect(cx, cy, cw, 160);
    }
    ctx.fill();

    // Borda fina moderna
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Desenha o ícone vetorial correspondente no card
    ctx.save();
    ctx.translate(cx + 28, cy + 28);
    ctx.strokeStyle = '#ffd60a';
    ctx.lineWidth = 2.25;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (c.icon === 'book') {
      const p = new Path2D("M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z");
      ctx.scale(1.1, 1.1);
      ctx.stroke(p);
    } else if (c.icon === 'grid') {
      const p = new Path2D("M3 3h7v7H3zm11 0h7v7h-7zM3 14h7v7H3zm11 0h7v7h-7z");
      ctx.scale(1.1, 1.1);
      ctx.stroke(p);
    } else if (c.icon === 'calendar') {
      const p = new Path2D("M19 4H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm-7 15l-5-5 1.41-1.41L12 16.17l7.59-7.59L21 10l-9 9z");
      ctx.scale(1.1, 1.1);
      ctx.stroke(p);
    }
    ctx.restore();

    // Número do total
    ctx.textAlign = 'right';
    ctx.fillStyle = '#ffffff';
    ctx.font = '900 48px system-ui, -apple-system, sans-serif';
    ctx.fillText(String(c.n), cx + cw - 28, cy + 65);

    // Rótulo descritivo
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.font = '700 15px system-ui, -apple-system, sans-serif';
    ctx.fillText(c.l, cx + cw / 2, cy + 120);

    cx += cw + cgap;
  }

  // Rodapé sutil com a URL da plataforma
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
  ctx.font = '700 16px system-ui, -apple-system, sans-serif';
  ctx.letterSpacing = '4px';
  ctx.fillText('MANGANANA.VERCEL.APP', 540, 1220);
  ctx.letterSpacing = 'normal'; // reset

  // Executa o compartilhamento nativo ou fallback de download
  cv.toBlob(async (blob) => {
    if (!blob) return;
    const file = new File([blob], 'manganana-stats.png', { type: 'image/png' });
    const url = URL.createObjectURL(blob);
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Minhas stats no Manganana', text: `🔥 ${s.streak} dias seguidos lendo mangá!`, files: [file] });
        toast('Compartilhado!');
        return;
      } catch (e) { /* cancelado */ }
    }
    // download fallback
    const a = document.createElement('a');
    a.href = url;
    a.download = 'manganana-stats.png';
    a.click();
    toast('Imagem salva!');
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }, 'image/png');
}

// ── gerar e compartilhar cartão lindo do mangá favorito (canvas com fundo desfocado) ──
async function shareMangaCard() {
  const m = state.detail;
  if (!m) return;
  
  toast('Gerando cartão do mangá… 🎨');
  
  const title = mangaTitle(m);
  const author = mangaAuthors(m) || 'Autor Desconhecido';
  const coverUrl = mangaCoverFull(m);
  
  const score = anilistScore(state.premium);
  const statusPt = anilistStatusPt(state.premium?.status) || (m.attributes?.status === 'ongoing' ? 'Publicando' : m.attributes?.status === 'completed' ? 'Completo' : 'N/A');
  const capsCount = state.premium?.chapters || state.chapters?.length || 'N/A';
  
  const cv = document.createElement('canvas');
  cv.width = 1080;
  cv.height = 1350;
  const ctx = cv.getContext('2d');
  
  // 1. Fundo base escuro obsidian
  ctx.fillStyle = '#0a0d14';
  ctx.fillRect(0, 0, 1080, 1350);
  
  // 2. Carrega a capa para desenhar desfocada de fundo e nítida no centro
  let img = null;
  if (coverUrl) {
    img = await loadImage(coverUrl);
  }
  
  if (img) {
    // Desenha capa desfocada no fundo
    ctx.save();
    ctx.filter = 'blur(45px) brightness(0.28) saturate(1.3)';
    // Calculo para cobrir preenchendo proporcionalmente
    const scale = Math.max(1080 / img.width, 1350 / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    const dx = (1080 - w) / 2;
    const dy = (1350 - h) / 2;
    ctx.drawImage(img, dx, dy, w, h);
    ctx.restore();
  } else {
    // Fallback: Lindo gradiente abstrato com tons de roxo/ouro
    const abstractGrad = ctx.createRadialGradient(540, 675, 100, 540, 675, 800);
    abstractGrad.addColorStop(0, '#1e1b4b');
    abstractGrad.addColorStop(0.5, '#0f172a');
    abstractGrad.addColorStop(1, '#020617');
    ctx.fillStyle = abstractGrad;
    ctx.fillRect(0, 0, 1080, 1350);
  }
  
  // Efeitos de iluminação de estúdio adicionais
  const glowTop = ctx.createRadialGradient(540, 200, 0, 540, 200, 450);
  glowTop.addColorStop(0, 'rgba(255, 214, 10, 0.08)');
  glowTop.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glowTop;
  ctx.fillRect(0, 0, 1080, 1350);
  
  const glowBottom = ctx.createRadialGradient(540, 1100, 0, 540, 1100, 450);
  glowBottom.addColorStop(0, 'rgba(99, 102, 241, 0.1)');
  glowBottom.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glowBottom;
  ctx.fillRect(0, 0, 1080, 1350);

  // Moldura dourada elegante
  ctx.strokeStyle = 'rgba(255, 214, 10, 0.22)';
  ctx.lineWidth = 3;
  ctx.strokeRect(40, 40, 1000, 1270);
  
  // Linha fina interna
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
  ctx.lineWidth = 1;
  ctx.strokeRect(55, 55, 970, 1240);

  // Badge da logo no topo
  ctx.fillStyle = 'rgba(255, 255, 255, 0.02)';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(410, 60, 260, 54, 27);
  } else {
    ctx.rect(410, 60, 260, 54);
  }
  ctx.fill();
  ctx.stroke();

  // Logo text
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '900 26px system-ui, -apple-system, sans-serif';
  const textManga = 'manga';
  const textSep = ' • ';
  const textNana = 'nana';
  const wM = ctx.measureText(textManga).width;
  const wS = ctx.measureText(textSep).width;
  const wN = ctx.measureText(textNana).width;
  const startX = 540 - (wM + wS + wN) / 2;

  ctx.fillStyle = '#ffd60a';
  ctx.fillText(textManga, startX + wM / 2, 87);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
  ctx.fillText(textSep, startX + wM + wS / 2, 87);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(textNana, startX + wM + wS + wN / 2, 87);

  // Slogan
  ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.font = '700 11px system-ui, -apple-system, sans-serif';
  ctx.letterSpacing = '5px';
  ctx.fillText('RECOMENDAÇÃO DE MANGÁ', 540, 145);
  ctx.letterSpacing = 'normal';

  // 3. Desenha a Capa Nítida Centralizada
  const cw = 340;
  const ch = 510;
  const cx = 540 - cw / 2;
  const cy = 185;
  
  if (img) {
    ctx.save();
    // Sombra projetada da capa
    ctx.shadowColor = 'rgba(0, 0, 0, 0.65)';
    ctx.shadowBlur = 40;
    ctx.shadowOffsetY = 15;
    ctx.fillStyle = '#0a0d14';
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(cx, cy, cw, ch, 20);
    } else {
      ctx.rect(cx, cy, cw, ch);
    }
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    
    // Recorte de cantos arredondados
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(cx, cy, cw, ch, 20);
    } else {
      ctx.rect(cx, cy, cw, ch);
    }
    ctx.clip();
    ctx.drawImage(img, cx, cy, cw, ch);
    ctx.restore();
    
    // Borda fina na capa
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(cx, cy, cw, ch, 20);
    } else {
      ctx.rect(cx, cy, cw, ch);
    }
    ctx.stroke();
  } else {
    // Capa faltante placeholder
    ctx.fillStyle = '#1e293b';
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(cx, cy, cw, ch, 20);
    } else {
      ctx.rect(cx, cy, cw, ch);
    }
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.font = '800 24px system-ui, -apple-system, sans-serif';
    ctx.fillText('Sem Capa', 540, cy + ch/2);
  }

  // 4. Título do Mangá
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#ffffff';
  ctx.font = '900 42px system-ui, -apple-system, sans-serif';
  // wrapText inteligente para não estourar
  const textLinesDrawn = wrapText(ctx, title, 540, 755, 840, 48, 2);
  
  // 5. Autor
  const authorY = 755 + (textLinesDrawn * 48) + 10;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
  ctx.font = '700 18px system-ui, -apple-system, sans-serif';
  ctx.fillText(author, 540, authorY);
  
  // 6. Grid de 3 Estatísticas (Nota, Status, Capítulos)
  const statsY = authorY + 40;
  const badgeW = 260;
  const badgeH = 135;
  const badgeGap = 30;
  const totalStatsW = 3 * badgeW + 2 * badgeGap;
  let startBadgeX = (1080 - totalStatsW) / 2;
  
  const mstats = [
    { v: score != null ? `${score}/10` : 'N/A', l: 'AVALIAÇÃO', icon: 'star' },
    { v: statusPt, l: 'STATUS', icon: 'status' },
    { v: capsCount ? `${capsCount} caps` : 'N/A', l: 'CAPÍTULOS', icon: 'caps' }
  ];
  
  for (const ms of mstats) {
    // Card de vidro translúcido
    const cardGrad = ctx.createLinearGradient(startBadgeX, statsY, startBadgeX, statsY + badgeH);
    cardGrad.addColorStop(0, 'rgba(255, 255, 255, 0.05)');
    cardGrad.addColorStop(1, 'rgba(255, 255, 255, 0.01)');
    ctx.fillStyle = cardGrad;
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(startBadgeX, statsY, badgeW, badgeH, 20);
    } else {
      ctx.rect(startBadgeX, statsY, badgeW, badgeH);
    }
    ctx.fill();
    
    // Borda fina
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    
    // Ícone decorativo pequeno no canto esquerdo ou topo
    ctx.save();
    ctx.translate(startBadgeX + 24, statsY + 24);
    ctx.strokeStyle = '#ffd60a';
    ctx.lineWidth = 2.25;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    if (ms.icon === 'star') {
      const p = new Path2D("M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z");
      ctx.scale(0.85, 0.85);
      ctx.stroke(p);
    } else if (ms.icon === 'status') {
      const p = new Path2D("M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z M9 12l2 2 4-4");
      ctx.scale(0.85, 0.85);
      ctx.stroke(p);
    } else if (ms.icon === 'caps') {
      const p = new Path2D("M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z");
      ctx.scale(0.85, 0.85);
      ctx.stroke(p);
    }
    ctx.restore();
    
    // Valor (alinhado à direita de forma harmoniosa)
    ctx.textAlign = 'right';
    ctx.fillStyle = '#ffffff';
    ctx.font = '900 32px system-ui, -apple-system, sans-serif';
    ctx.fillText(ms.v, startBadgeX + badgeW - 24, statsY + 54);
    
    // Rótulo descritivo
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.font = '800 12px system-ui, -apple-system, sans-serif';
    ctx.letterSpacing = '1px';
    ctx.fillText(ms.l, startBadgeX + badgeW / 2, statsY + 104);
    ctx.letterSpacing = 'normal';
    
    startBadgeX += badgeW + badgeGap;
  }
  
  // 7. Descrição curta do mangá (Primeiros 120 caracteres)
  const descText = mangaDesc(m);
  if (descText) {
    const descY = statsY + badgeH + 45;
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
    ctx.font = '500 18px system-ui, -apple-system, sans-serif';
    
    // Pega um trecho de descrição e quebra em até 2 linhas
    const descSnippet = descText.length > 130 ? descText.substring(0, 130) + '...' : descText;
    wrapText(ctx, descSnippet, 540, descY, 800, 28, 2);
  }
  
  // 8. Rodapé branding
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
  ctx.font = '800 15px system-ui, -apple-system, sans-serif';
  ctx.letterSpacing = '3px';
  ctx.fillText('LEIA NO MANGANANA • MANGANANA.VERCEL.APP', 540, 1225);
  ctx.letterSpacing = 'normal';
  
  // 9. Processa o Blob para compartilhar ou baixar
  cv.toBlob(async (blob) => {
    if (!blob) return;
    const filename = `manganana-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`;
    const file = new File([blob], filename, { type: 'image/png' });
    const url = URL.createObjectURL(blob);
    if (navigator.share) {
      try {
        await navigator.share({ title: `Cartão de ${title}`, text: `Olha só esse mangá fantástico que estou lendo no Manganana: ${title}!`, files: [file] });
        toast('Compartilhado com sucesso!');
        return;
      } catch (e) { /* usuário cancelou */ }
    }
    // download fallback
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    toast('Imagem salva com sucesso!');
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }, 'image/png');
}

/* ===== perfil organizado em abas ===== */
// move notificações pro Ajustes; login (accountBox) fica VISÍVEL no Resumo
function organizeProfileSections() {
  const reloc = $('#profileReloc');
  if (!reloc || reloc.dataset.done) return;
  reloc.dataset.done = '1';
  // notifyBox → Ajustes
  const ajustes = $('#pSecAjustes');
  const notify = $('#notifyBox');
  if (ajustes && notify) ajustes.insertBefore(notify, ajustes.firstChild);
  // accountBox volta pro início do Resumo (logo após o hero) — login acessível
  const resumo = $('#pSecResumo');
  const account = $('#accountBox');
  if (resumo && account) {
    const hero = resumo.querySelector('.profile-hero');
    if (hero) resumo.insertBefore(account, hero.nextSibling);
  }
  reloc.remove();
}

// troca a aba ativa do perfil
function switchProfileTab(tab) {
  $$('.p-tab').forEach((b) => b.classList.toggle('active', b.dataset.ptab === tab));
  const show = (id) => { const el = $('#' + id); if (el) el.hidden = (id !== 'pSec' + tab[0].toUpperCase() + tab.slice(1)); };
  show('pSecResumo');
  show('pSecListas');
  show('pSecAjustes');
  if (tab === 'listas') { renderListsSection(); renderDownloads(); }
  if (tab === 'resumo') { renderStatsSection(); renderAchievements(); renderSpotlight(); }
}

function renderProfile() {
  organizeProfileSections();
  $('#statFavs').textContent = state.favs.length;
  $('#statRead').textContent = Object.keys(load('readCount', {})).length;
  const pages = Object.values(load('readCount', {})).reduce((a, b) => a + b, 0);
  $('#statPages').textContent = pages;
  renderStatsSection();
  renderAchievements();
  renderSpotlight();
  renderVisits();
  renderMyProfile();
}

// ===== perfil rico (banner, bio, listas) =====
let myProfileData = null; // {bio, banner} do usuário logado

function renderMyProfile() {
  const isLogged = !!syncUser;
  $('#btnEditBanner').hidden = !isLogged;
  $('#btnEditProfile').hidden = !isLogged;
  // avatar (foto do Google ou inicial)
  const av = $('#profileAvatar');
  if (isLogged && syncUser.image) av.innerHTML = `<img src="${esc(syncUser.image)}" alt="" />`;
  else av.textContent = (syncUser?.name || 'L')[0];
  // avatar do header (botão de perfil no topo)
  const hImg = $('#btnProfileImg');
  const hLetter = $('#btnProfileLetter');
  if (hImg && hLetter) {
    if (isLogged && syncUser.image) {
      hImg.src = syncUser.image;
      hImg.hidden = false;
      hLetter.hidden = true;
      hLetter.textContent = '';
    } else {
      hImg.hidden = true;
      hImg.removeAttribute('src');
      hLetter.hidden = false;
      hLetter.textContent = (syncUser?.name || 'L')[0];
    }
  }
  // nome/email
  $('#profileName').textContent = syncUser?.name || 'Leitor';
  $('#profileEmail').textContent = syncUser?.email || 'Leitor do Manganana';
  // tags de listas
  const tags = $('#profileTags');
  const lists = myLists();
  const counts = Object.entries(LIST_NAMES)
    .filter(([k]) => (lists[k] || []).length)
    .map(([k, label]) => `<span class="ptag">${LIST_ICONS[k] || ''}${label} ${lists[k].length}</span>`);
  tags.innerHTML = counts.join('');
  // bio + banner
  const bio = $('#profileBio');
  if (myProfileData?.bio) {
    bio.textContent = myProfileData.bio;
    bio.hidden = false;
  } else { bio.hidden = true; }
  renderBanner(myProfileData?.banner || pendingBanner || '');
  renderListsSection();
  renderNotifyBox();
}

// ===== notificações de capítulo (Telegram) =====
function renderNotifyBox() {
  const box = $('#notifyBox');
  if (!box) return;
  const isLogged = !!syncUser;
  box.style.display = isLogged ? '' : 'none';
  if (!isLogged) return;
  const tg = load('tgChatId', '');
  const status = $('#notifyStatus');
  const input = $('#tgChatInput');
  status.textContent = tg ? 'ativo' : 'off';
  status.classList.toggle('on', !!tg);
  input.value = tg;
}

function saveTgChat() {
  const input = $('#tgChatInput');
  const v = input.value.trim();
  if (!v) { toast('Digite seu ID do Telegram', '❌'); return; }
  if (!/^\d{5,}$/.test(v)) { toast('ID inválido — só números', '❌'); return; }
  store('tgChatId', v);
  schedulePush();
  renderNotifyBox();
  toast('Notificações ativadas! 🔔', '✅');
}

// aplica o banner: GIF usa <img> (anima de verdade), imagem usa background
function renderBanner(src) {
  const banner = $('#profileBanner');
  const gif = $('#profileBannerGif');
  if (!banner || !gif) return;
  const isGif = src && (src.startsWith('data:image/gif') || /\.gif(\?|$)/i.test(src));
  if (isGif) {
    // GIF: <img> real (background-image congela a animação em vários navegadores)
    banner.style.backgroundImage = '';
    gif.src = src;
    gif.hidden = false;
  } else {
    // imagem comum: background-image
    gif.hidden = true;
    gif.removeAttribute('src');
    banner.style.backgroundImage = src ? `url(${src})` : '';
  }
}

// seção de listas no perfil
function renderListsSection() {
  let wrap = $('#listsWrap');
  if (!wrap) {
    const content = $('#view-profile .content');
    if (!content) return;
    // insere DENTRO da seção Listas (para as abas funcionarem)
    const listas = $('#pSecListas');
    const target = listas || content;
    wrap = document.createElement('div');
    wrap.id = 'listsWrap';
    target.insertBefore(wrap, target.firstChild);
  }
  const lists = myLists();
  const any = Object.values(lists).some((l) => l.length);
  if (!any) { wrap.innerHTML = ''; return; }
  wrap.innerHTML = `
    <div class="lists-head">
      <h2>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="header-icon"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>
        <span>Minhas listas</span>
      </h2>
    </div>
    ${Object.entries(LIST_NAMES).filter(([k]) => (lists[k] || []).length).map(([k, label]) => {
      const items = lists[k].slice(0, 6);
      return `<div class="list-section">
        <div class="list-title"><span>${LIST_ICONS[k] || ''}${label}</span><small>${lists[k].length}</small></div>
        <div class="list-row">${items.map((it) => `
          <div class="list-mini" onclick="openDetail('${it.id}')">
            ${it.cover ? `<img src="${esc(it.cover)}" alt="" />` : `<div class="lm-ph">${esc((it.title || '?')[0])}</div>`}
            <span>${esc(it.title || '')}</span>
          </div>`).join('')}
        </div>
      </div>`;
    }).join('')}
    `;
}

// abre/fecha o editor de perfil (sheet)
function toggleEditProfile(open) {
  if (!open) { closeEditSheet(); return; }
  if (!syncUser) { switchTab('profile'); return; }
  const sh = $('#editProfileSheet');
  if (!sh) return;
  $('#editBio').value = myProfileData?.bio || '';
  // preview do banner atual no editor
  const src = pendingBanner || myProfileData?.banner || '';
  renderBannerPreview(src);
  sh.classList.add('open');
  $('#sheetBackdrop').classList.add('open');
}

// preview do banner no editor (GIF anima via <img>)
function renderBannerPreview(src) {
  const pv = $('#epBannerPreview');
  const gif = $('#epPreviewGif');
  const txt = $('#epBannerText');
  const rm = $('#epBannerRemove');
  if (!pv || !txt || !rm) return;
  const isGif = src && (src.startsWith('data:image/gif') || /\.gif(\?|$)/i.test(src));
  if (src) {
    pv.style.backgroundImage = isGif ? '' : `url(${src})`;
    if (isGif) { gif.src = src; gif.hidden = false; }
    else { gif.hidden = true; gif.removeAttribute('src'); }
    txt.textContent = isGif ? 'GIF selecionado ✓' : 'Banner selecionado ✓';
    rm.hidden = false;
  } else {
    pv.style.backgroundImage = '';
    gif.hidden = true;
    gif.removeAttribute('src');
    txt.textContent = 'Toque para escolher um banner 📷';
    rm.hidden = true;
  }
}

function closeEditSheet() {
  $('#editProfileSheet')?.classList.remove('open');
  $('#sheetBackdrop')?.classList.remove('open');
}

// remove o banner do perfil
function removeBanner() {
  pendingBanner = null;
  myProfileData = { ...(myProfileData || {}), banner: '' };
  renderBannerPreview('');
  renderBanner('');
  toast('Banner removido — toque em Salvar para confirmar');
}

// salva bio (+ banner se tiver pendente)
async function saveProfile() {
  if (!syncUser) return;
  const bio = $('#editBio').value.trim();
  const body = { bio };
  if (pendingBanner) { body.banner = pendingBanner; }
  // se marcou remover banner e não tem pendente, envia vazio
  if (!myProfileData?.banner && !pendingBanner && $('#epBannerRemove')?.hidden === false) {
    body.banner = '';
  }
  try {
    const token = await window.Clerk.session?.getToken();
    if (!token) { toast('Sessão expirada — recarregue a página'); return; }
    const r = await fetch('/api/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    if (!j.ok) { toast('Erro: ' + (j.error || 'não foi possível salvar')); return; }
    myProfileData = { ...(myProfileData || {}), bio };
    if (pendingBanner) { myProfileData.banner = pendingBanner; pendingBanner = null; }
    closeEditSheet();
    renderMyProfile();
    toast('Perfil salvo');
  } catch { toast('Erro de rede — tente de novo'); }
}

let pendingBanner = null;

// upload do banner (GIF preserva animação; imagem é comprimida via canvas)
function handleBannerUpload(file) {
  if (!file) return;
  if (file.size > 8 * 1024 * 1024) { toast('Imagem muito grande (máx 8MB)'); return; }
  // GIF animado: preserva a animação (canvas congelaria no 1º frame)
  if (file.type === 'image/gif' || /\.gif$/i.test(file.name)) {
    const rd = new FileReader();
    rd.onload = () => {
      pendingBanner = rd.result;
      renderBannerPreview(pendingBanner);
      toast('GIF pronto! Toque em Salvar');
    };
    rd.onerror = () => toast('Não foi possível ler o GIF');
    rd.readAsDataURL(file);
    return;
  }
  const img = new Image();
  const url = URL.createObjectURL(file);
  img.onload = () => {
    // redimensiona para máx 1000px de largura, JPEG q0.72
    const MAX = 1000;
    const scale = Math.min(1, MAX / img.width);
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#070a12';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    pendingBanner = cv.toDataURL('image/jpeg', 0.72);
    URL.revokeObjectURL(url);
    renderBannerPreview(pendingBanner);
    toast('Banner pronto! Toque em Salvar');
  };
  img.onerror = () => toast('Imagem inválida');
  img.src = url;
}

// carrega o perfil salvo do usuário logado
async function loadMyProfile() {
  if (!syncUser) return;
  try {
    const r = await fetch('/api/profile?user=' + encodeURIComponent(syncUser.id));
    const j = await r.json();
    if (j.ok && j.user) {
      myProfileData = { bio: j.user.bio || '', banner: j.user.banner || '' };
      renderMyProfile();
    }
  } catch { /* offline: mantém o que tem */ }
}

// capa em destaque: o mangá mais lido (maior contagem de páginas)
function renderSpotlight() {
  const card = $('#spotlightCard');
  if (!card) return;
  const readCount = load('readCount', {});
  const entries = Object.entries(readCount).sort((a, b) => b[1] - a[1]);
  if (!entries.length) { card.style.display = 'none'; return; }
  // acha o título/capa pelo histórico (mais recente com esse id)
  const topId = entries[0][0];
  const hist = [...state.history].find((h) => h.id === topId);
  const fav = state.favs.find((f) => f.id === topId);
  const title = hist?.title || fav?.title || '';
  const cover = hist?.cover || fav?.cover || '';
  const pages = entries[0][1];
  if (!title) { card.style.display = 'none'; return; }
  card.style.display = '';
  $('#spotlightTitle').textContent = title;
  $('#spotlightSub').textContent = pages + ' páginas lidas';
  $('#spotlightCover').innerHTML = cover ? coverImg(cover, title) : '';
}

function spotlightClick() {
  const readCount = load('readCount', {});
  const entries = Object.entries(readCount).sort((a, b) => b[1] - a[1]);
  if (entries.length) openDetail(entries[0][0]);
}

/* ---------- contador de visitas ---------- */
// conta 1 visita por sessão (sessionStorage) via counterapi.dev e exibe no perfil
const VISIT_KEY = 'mn_visitCounted';
async function countVisit() {
  try {
    if (sessionStorage.getItem(VISIT_KEY)) return;
    const r = await fetch('https://api.counterapi.dev/v1/manganana/manganana-visits/up', { method: 'GET' });
    const j = await r.json();
    if (j && typeof j.count === 'number') {
      sessionStorage.setItem(VISIT_KEY, '1');
      store('visitTotal', j.count);
      renderProfile();
    }
  } catch { /* offline/erro: não quebra nada */ }
}

// mostra o total de visitas no perfil (atualizado a cada visita contada)
function renderVisits() {
  const el = $('#visitCount');
  const txt = $('#visitCountText');
  if (!el || !txt) return;
  const total = load('visitTotal', 0);
  if (!total) { el.hidden = true; return; }
  el.hidden = false;
  txt.textContent = total.toLocaleString('pt-BR') + ' visitas';
}

/* ---------- conta (Clerk) + sincronização ---------- */
let clerkLoaded = false;
let syncUser = null; // {id, name, email, image}

function clerkReady() {
  return typeof window.Clerk !== 'undefined' && !!window.Clerk.load;
}

// inicializa o Clerk e atualiza a UI de conta
async function initClerk() {
  try {
    if (!window.Clerk) return;
    if (!clerkLoaded) {
      await window.Clerk.load();
      clerkLoaded = true;
    }
    window.Clerk.addListener(({ user }) => {
      syncUser = user ? { id: user.id, name: user.fullName || 'Leitor', email: user.primaryEmailAddress?.emailAddress || '', image: user.imageUrl || '' } : null;
      renderAccount();
      renderMyProfile();
      if (user) { pullSync(); loadMyProfile(); }
    });
    syncUser = window.Clerk.user ? { id: window.Clerk.user.id, name: window.Clerk.user.fullName || 'Leitor', email: window.Clerk.user.primaryEmailAddress?.emailAddress || '', image: window.Clerk.user.imageUrl || '' } : null;
    renderAccount();
    // se já está logado (reload da página), puxa/sincroniza de qualquer forma
    if (syncUser) {
      pullSync();
      loadMyProfile();
      setTimeout(pushSync, 2500); // garantia: sobe os dados locais
    }
  } catch (e) {
    console.warn('Clerk init falhou:', e.message);
  }
}

// botão entrar com Google
async function googleLogin() {
  if (!clerkReady()) { toast('Carregando login…'); return; }
  try {
    // redireciona para a página de login hospedada do Clerk (Account Portal)
    // — funciona sem depender da UI bundle no nosso site
    await window.Clerk.redirectToSignIn({ redirectUrl: location.href });
  } catch (e) {
    console.warn('redirectToSignIn:', e);
    toast('Não foi possível abrir o login: ' + (e?.message || 'erro'));
  }
}

// sincronização manual com feedback REAL
async function syncNow() {
  if (!syncUser) { toast('Entre com sua conta primeiro'); return; }
  toast('Sincronizando…');
  try {
    const token = await window.Clerk.session?.getToken();
    if (!token) { toast('Sem token de sessão — recarregue e tente de novo'); return; }
    const r = await fetch('/api/sync', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ data: { favs: state.favs, history: state.history, readCount: load('readCount', {}), lastSeen: load('lastSeen', {}), settings: state.settings } }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.status === 200 && j.ok) toast('Sincronizado');
    else toast('Erro ' + r.status + ': ' + (j.error || 'API recusou o token'));
  } catch (e) {
    toast('Erro: ' + (e?.message || 'rede'));
  }
}

async function logout() {
  try {
    await window.Clerk.signOut();
    syncUser = null;
    renderAccount();
    toast('Saiu da conta');
  } catch { /* ignora */ }
}

// upload de foto de perfil — o Clerk guarda a imagem e serve via CDN
async function changeProfilePhoto(file) {
  if (!file || !syncUser || !clerkReady()) return;
  // validação: imagem e tamanho máx ~5MB
  if (!file.type.startsWith('image/')) { toast('Escolha uma imagem'); return; }
  if (file.size > 5 * 1024 * 1024) { toast('Imagem muito grande (máx 5MB)'); return; }
  try {
    const user = window.Clerk.user;
    if (typeof user.setProfileImage === 'function') {
      await user.setProfileImage({ file });
    } else if (typeof user.update === 'function') {
      await user.update({ profileImage: file });
    } else {
      toast('Upload não suportado nesta versão');
      return;
    }
    syncUser.image = user.imageUrl || '';
    renderAccount();
    schedulePush(); // salva a URL da foto na nuvem também
    toast('Foto atualizada');
  } catch (e) {
    console.warn('upload foto:', e);
    toast('Erro ao atualizar foto');
  }
}

function renderAccount() {
  const guest = $('#accountGuest');
  const user = $('#accountUser');
  const avatar = $('#profileAvatar');
  const name = $('#profileName');
  const email = $('#profileEmail');
  if (!guest || !user) return;
  if (syncUser) {
    guest.hidden = true;
    user.hidden = false;
    if (avatar) {
      if (syncUser.image) avatar.innerHTML = `<img src="${syncUser.image}" alt="avatar" referrerpolicy="no-referrer" />`;
      else avatar.textContent = (syncUser.name || 'L')[0].toUpperCase();
    }
    if (name) name.textContent = syncUser.name || 'Leitor';
    if (email) email.textContent = syncUser.email || 'Sincronização ativa';
  } else {
    guest.hidden = false;
    user.hidden = true;
    if (avatar) avatar.textContent = 'J';
    if (name) name.textContent = 'Leitor';
    if (email) email.textContent = 'Leitor do Manganana';
  }
}

/* ---------- sincronização com a nuvem ---------- */

// salva tudo na nuvem (favoritos + histórico + progresso + settings)
async function pushSync() {
  if (!syncUser) return;
  const payload = {
    favs: state.favs,
    history: state.history,
    readCount: load('readCount', {}),
    lastSeen: load('lastSeen', {}),
    newChapters: load('newChapters', {}),
    settings: state.settings,
    filters: state.filters,
    lists: myLists(),
    achievements: load('achievements', []),
    telegramChatId: load('tgChatId', ''),
  };
  try {
    const token = await window.Clerk.session?.getToken();
    if (!token) { console.warn('pushSync: sem token'); return; }
    const r = await fetch('/api/sync', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ data: payload }),
    });
    console.log('pushSync:', r.status, await r.text());
  } catch (e) { console.warn('pushSync erro:', e.message); }
}

let syncTimer = null;
function schedulePush() {
  if (!syncUser) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(pushSync, 1500);
}

// puxa dados da nuvem e faz merge inteligente (item mais recente vence)
async function pullSync() {
  if (!syncUser) return;
  try {
    const token = await window.Clerk.session?.getToken();
    if (!token) { console.warn('pullSync: sem token'); return; }
    const r = await fetch('/api/sync', {
      headers: { 'Authorization': 'Bearer ' + token },
    });
    const j = await r.json();
    console.log('pullSync:', r.status, 'ok=', j.ok);
    if (!j.ok || !j.data) return;
    const cloud = j.data;
    if (!cloud || Object.keys(cloud).length === 0) {
      // primeira vez: sobe o que tem local
      pushSync();
      return;
    }
    mergeData(cloud);
    toast('Dados sincronizados');
  } catch { /* silencioso */ }
}

// merge: une local + nuvem; para arrays usa o mais recente por item (ts)
function mergeData(cloud) {
  // favoritos: une por id
  const mergedFavs = [...state.favs];
  (cloud.favs || []).forEach((cf) => {
    if (!mergedFavs.some((f) => f.id === cf.id)) mergedFavs.push(cf);
  });
  state.favs = mergedFavs;
  store('favs', state.favs);

  // histórico: une por (id+chapterId), item mais recente vence
  const localHist = state.history.map((h) => ({ ...h, _src: 'l' }));
  const cloudHist = (cloud.history || []).map((h) => ({ ...h, _src: 'c' }));
  const byKey = {};
  [...localHist, ...cloudHist].forEach((h) => {
    const key = h.id + '|' + (h.chapterId || '');
    if (!byKey[key] || (h.ts || 0) > (byKey[key].ts || 0)) byKey[key] = h;
  });
  state.history = Object.values(byKey)
    .sort((a, b) => (b.ts || 0) - (a.ts || 0))
    .map(({ _src, ...h }) => h);
  store('history', state.history.slice(0, 60));

  // readCount: soma (maior conta de páginas de cada fonte)
  const rc = { ...(cloud.readCount || {}) };
  Object.entries(load('readCount', {})).forEach(([k, v]) => {
    rc[k] = Math.max(rc[k] || 0, v);
  });
  store('readCount', rc);

  // lastSeen: mais recente vence por mangá
  const ls = { ...load('lastSeen', {}) };
  Object.entries(cloud.lastSeen || {}).forEach(([k, v]) => { ls[k] = v; });
  store('lastSeen', ls);

  // settings: nuvem vence se tiver (mais recente)
  if (cloud.settings) {
    state.settings = { ...state.settings, ...cloud.settings };
    store('settings', state.settings);
    applyTheme();
  }

  // filtros
  if (cloud.filters) {
    state.filters = { ...state.filters, ...cloud.filters };
    store('filters', state.filters);
  }

  // listas: une por mangá (mais recente vence)
  if (cloud.lists) {
    const local = myLists();
    const out = { lendo: [], vouLer: [], completo: [], dropei: [] };
    Object.keys(out).forEach((l) => {
      const items = [...(local[l] || []), ...(cloud.lists[l] || [])];
      const byId = {};
      items.forEach((it) => {
        if (!byId[it.id] || (it.ts || 0) > (byId[it.id].ts || 0)) byId[it.id] = it;
      });
      out[l] = Object.values(byId).sort((a, b) => (b.ts || 0) - (a.ts || 0));
    });
    store('lists', out);
  }

  // conquistas: união (nuvem desbloqueia, local nunca "tira" uma conquista)
  if (Array.isArray(cloud.achievements) && cloud.achievements.length) {
    const merged = [...new Set([...(load('achievements', []) || []), ...cloud.achievements])];
    store('achievements', merged);
  }

  // telegramChatId: nuvem vence (é o mesmo em todos os aparelhos)
  if (cloud.telegramChatId) {
    store('tgChatId', cloud.telegramChatId);
  }

  renderHome();
  renderLibrary();
  renderProfile();
}

/* ---------- settings / sheets ---------- */
function openSheet(id) {
  $(id).classList.add('open');
  $('#sheetBackdrop').classList.add('open');
}
function closeSheets() {
  $$('.sheet').forEach((s) => s.classList.remove('open'));
  $('#sheetBackdrop').classList.remove('open');
}
function renderChapterSheet() {
  const list = $('#chapterSheetList');
  const cur = state.reader?.chapter?.id;
  list.innerHTML = state.chapters.map((c) => `
    <div class="chapter-item ${c.id === cur ? 'current' : ''}" onclick="pickChapter('${c.id}')">
      <div class="num">${c.attributes.chapter || '•'}</div>
      <div class="meta"><strong>${esc(chapterNum(c))}</strong><small>${esc(chapterTitle(c)) || '—'}</small></div>
      ${c.id === cur ? '<span style="color:var(--accent);font-size:10px;font-weight:800">LENDO</span>' : ''}
    </div>`).join('');
}
function pickChapter(id) { closeSheets(); openChapter(id); }

/* ---------- botões globais ---------- */
function bindGlobal() {
  $$('.nav-item').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));
  // busca e ordenação da biblioteca
  $('#libSearch').addEventListener('input', (e) => { libQuery = e.target.value.trim(); renderLibrary(); });
  $$('#libSortSeg .seg-btn').forEach((b) => b.addEventListener('click', () => {
    $$('#libSortSeg .seg-btn').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    libSort = b.dataset.libsort;
    renderLibrary();
  }));
  $$('#libSeg .seg-btn').forEach((b) => b.addEventListener('click', () => {
    $$('#libSeg .seg-btn').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    libTab = b.dataset.lib;
    renderLibrary();
  }));
  $$('#libStatus .ls-chip').forEach((b) => b.addEventListener('click', () => {
    $$('#libStatus .ls-chip').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    libStatus = b.dataset.ls;
    renderLibrary();
  }));
  $('#btnFilters').addEventListener('click', openFilters);
  $('#closeFilters').addEventListener('click', closeSheets);
  // chips dos filtros: seleção única por grupo
  ['#fStatus', '#fYear', '#fSort'].forEach((sel) => {
    $(sel).addEventListener('click', (e) => {
      const chip = e.target.closest('.f-chip');
      if (!chip) return;
      $$(sel + ' .f-chip').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      const group = sel.slice(1);
      const key = group === 'fStatus' ? 'status' : (group === 'fYear' ? 'year' : 'sort');
      state.filters[key] = chip.dataset.v;
      store('filters', state.filters);
    });
  });
  $('#fApply').addEventListener('click', applyFilters);
  $('#fClear').addEventListener('click', clearFilters);
  $('#btnGoogleLogin').addEventListener('click', googleLogin);
  $('#btnLogout').addEventListener('click', logout);
  $('#btnSyncNow').addEventListener('click', syncNow);
  $('#btnTgSave').addEventListener('click', saveTgChat);
  $('#btnEditProfile').addEventListener('click', () => toggleEditProfile(true));
  $('#epBannerInput').addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) handleBannerUpload(e.target.files[0]);
    e.target.value = '';
  });
  $('#btnEditBanner').addEventListener('click', () => toggleEditProfile(true));
  $('#photoInput').addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) changeProfilePhoto(e.target.files[0]);
    e.target.value = '';
  });
  $('#btnDetailBack').addEventListener('click', () => navBackBtn());
  $('#btnDetailFav').addEventListener('click', toggleFav);
  $('#btnDetailShare').addEventListener('click', shareManga);
  $('#closeShareManga').addEventListener('click', closeSheets);
  $('#btnShareMangaLink').addEventListener('click', () => { closeSheets(); copyMangaLink(); });
  $('#btnShareMangaStory').addEventListener('click', () => { closeSheets(); shareMangaCard(); });
  $('#btnSeeAllBack').addEventListener('click', () => {
    showView('view-home');
    $('#bottomNav').classList.remove('hidden');
    window.scrollTo(0, 0);
  });
  $('#seeAllMoreBtn').addEventListener('click', () => loadSeeAll(false));
  $('#btnReaderBack').addEventListener('click', () => {
    navBackBtn();
  });
  $('#btnSettings').addEventListener('click', () => openSheet('#settingsSheet'));
  $('#closeSettings').addEventListener('click', closeSheets);
  $('#sheetBackdrop').addEventListener('click', closeSheets);
  $('#sheetBackdrop').addEventListener('click', closeCharModal);
  $('#btnProfile').addEventListener('click', () => switchTab('profile'));
  $('#chapterListBtn').addEventListener('click', () => { renderChapterSheet(); openSheet('#chapterSheet'); });
  $('#pageJumpBtn').addEventListener('click', pageJump);
  $('#closeSheet').addEventListener('click', closeSheets);
  $('#btnDownloadChapter').addEventListener('click', downloadChapter);
  $('#btnReaderSettings').addEventListener('click', openReaderSettings);
  $('#closeReaderSettings').addEventListener('click', closeSheets);
  $('#rsBright').addEventListener('input', (e) => {
    state.settings.readerBright = +e.target.value; store('settings', state.settings);
    $('#rsBrightVal').textContent = e.target.value + '%'; applyReaderStyles();
  });
  $('#rsContrast').addEventListener('input', (e) => {
    state.settings.readerContrast = +e.target.value; store('settings', state.settings);
    $('#rsContrastVal').textContent = e.target.value + '%'; applyReaderStyles();
  });
  $('#rsSat').addEventListener('input', (e) => {
    state.settings.readerSat = +e.target.value; store('settings', state.settings);
    $('#rsSatVal').textContent = e.target.value + '%'; applyReaderStyles();
  });
  $$('#rsSharpChips .rs-chip').forEach((c) => c.addEventListener('click', () => {
    state.settings.readerSharp = c.dataset.sharp; store('settings', state.settings);
    const sharpNames = { soft: 'Suave', auto: 'Auto', crisp: 'Nítido', none: 'Original' };
    $('#rsSharpVal').textContent = sharpNames[c.dataset.sharp];
    $$('#rsSharpChips .rs-chip').forEach((x) => x.classList.toggle('active', x === c));
    applyReaderStyles();
  }));
  $('#rsWidth').addEventListener('input', (e) => {
    state.settings.readerWidth = +e.target.value; store('settings', state.settings);
    $('#rsWidthVal').textContent = e.target.value + '%'; applyReaderStyles();
  });
  $('#rsWebtoon').addEventListener('change', (e) => {
    state.settings.webtoon = e.target.checked; store('settings', state.settings);
    toast(e.target.checked ? 'Modo webtoon ativado — rolagem contínua' : 'Modo webtoon desativado');
  });
  $('#rsTapZones').addEventListener('change', (e) => {
    state.settings.tapZones = e.target.checked; store('settings', state.settings);
    initTapZones();
  });
  $$('#rsBgChips .rs-chip').forEach((c) => c.addEventListener('click', () => {
    state.settings.readerBg = c.dataset.bg; store('settings', state.settings);
    $$('#rsBgChips .rs-chip').forEach((x) => x.classList.toggle('active', x === c));
    applyReaderStyles();
  }));
  $('#nextChapter').addEventListener('click', nextChapterNav);
  $('#btnClearHistory').addEventListener('click', () => {
    // confirmação antes de apagar tudo
    if (!confirm('Apagar todo o histórico e progresso de leitura? Essa ação não pode ser desfeita.')) return;
    state.history = []; store('history', []); store('readCount', {});
    renderLibrary(); renderProfile(); toast('Histórico limpo', '🗑️');
  });
  $$('#libSeg .seg-btn').forEach((b) => b.addEventListener('click', () => {
    $$('#libSeg .seg-btn').forEach((x) => x.classList.remove('active'));
    b.classList.add('active'); libTab = b.dataset.lib; renderLibrary();
  }));

  // personagens: clique abre modal com descrição
  document.addEventListener('click', (e) => {
    const card = e.target.closest('.char-card');
    if (card) openCharModal(card.dataset.cname, card.dataset.cdesc);
  });

  // settings inputs
  const sysDark = () => window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const applyDark = (v) => document.body.classList.toggle('light', !v);
  // resolve o tema: 'auto' segue o sistema operacional
  const resolveTheme = () => state.settings.theme === 'light' ? false : (state.settings.theme === 'dark' ? true : sysDark());
  // compat: quem tinha settings.dark booleano (versão antiga) vira 'dark'/'light'
  if (!state.settings.theme) state.settings.theme = state.settings.dark ? 'dark' : 'light';
  $('#setReadingMode').value = state.settings.mode;
  $('#setQuality').value = state.settings.quality;
  $('#setRTL').checked = state.settings.rtl;
  $('#setDark').value = state.settings.theme;
  applyDark(resolveTheme());
  $('#setReadingMode').addEventListener('change', (e) => { state.settings.mode = e.target.value; store('settings', state.settings); if (state.reader) renderReader(); });
  $('#setQuality').addEventListener('change', (e) => { state.settings.quality = e.target.value; store('settings', state.settings); if (state.reader) openChapter(state.reader.chapter.id); });
  $('#setRTL').addEventListener('change', (e) => { state.settings.rtl = e.target.checked; store('settings', state.settings); if (state.reader) renderReader(); });
  $('#setDark').addEventListener('change', (e) => { state.settings.theme = e.target.value; store('settings', state.settings); applyDark(resolveTheme()); });
  // tema 'auto' acompanha mudanças do sistema em tempo real
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
    if (state.settings.theme === 'auto') applyDark(sysDark());
  });

  // tap para mostrar/esconder controles do leitor
  $('#readerBody').addEventListener('click', (e) => {
    if (e.target.closest('img')) {
      $('#readerTop').classList.toggle('hidden');
      $('#readerNav').classList.toggle('hidden');
    }
  });

  // swipe esquerda/direita no leitor (mobile)
  let x0 = null;
  $('#readerBody').addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
  $('#readerBody').addEventListener('touchend', (e) => {
    if (x0 == null) return;
    const dx = e.changedTouches[0].clientX - x0;
    if (Math.abs(dx) > 70) {
      if (state.settings.rtl) { dx > 0 ? prevPage() : nextPage(); }
      else { dx < 0 ? nextPage() : prevPage(); }
    }
    x0 = null;
  }, { passive: true });

  // scroll marca progresso (índice aproximado) + webtoon contínuo
  $('#readerBody').addEventListener('scroll', debounce(() => {
    if (!state.reader) return;
    const imgs = $$('#readerBody .page-img');
    const mid = $('#readerBody').scrollTop + window.innerHeight * 0.5;
    let idx = 0;
    imgs.forEach((img, i) => { if (img.offsetTop < mid) idx = i; });
    state.reader.idx = idx;
    updateReaderNav(); markProgress();
    webtoonCheck();
  }, 400), { passive: true });

  // keyboard
  document.addEventListener('keydown', (e) => {
    if (!state.reader) return;
    if (e.key === 'ArrowRight') nextPage();
    if (e.key === 'ArrowLeft') prevPage();
  });

  // botão voltar do Android: desempilha e volta (pilha com pushState)
  window.addEventListener('popstate', () => {
    if (navStack.length > 1) {
      navStack.pop();
      const prev = navStack[navStack.length - 1];
      restoreNav(prev);
      $('#bottomNav').classList.remove('hidden');
    } else {
      // raiz: sai do app normalmente
    }
  });
  // estado inicial da pilha
  navStack = [{ view: 'home' }];
  history.replaceState({ nav: true }, '');
}

/* ---------- PWA: registro + instalação ---------- */
let deferredPrompt = null;
let swReady = false;

function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  const doRegister = () => {
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      swReady = true;
      // atualização automática: quando um SW novo termina de instalar,
      // recarrega a página para carregar a versão nova (sem cache antigo)
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (nw) nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) {
            // avisa com botão "atualizar" (não recarrega sozinho, respeita o usuário)
            const t = $('#toast');
            t.innerHTML = '';
            const s = document.createElement('span');
            s.textContent = 'Nova versão disponível';
            t.appendChild(s);
            const b = document.createElement('button');
            b.className = 'toast-action';
            b.textContent = 'Atualizar';
            b.onclick = () => window.location.reload();
            t.appendChild(b);
            t.classList.remove('show');
            void t.offsetWidth;
            t.classList.add('show');
            clearTimeout(t._h);
            t._h = setTimeout(() => t.classList.remove('show'), 8000);
          }
        });
      });
      // verifica updates periodicamente (a cada 30 min) e no foco
      setInterval(() => reg.update().catch(() => {}), 30 * 60 * 1000);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      });
    }).catch(() => {});
  };
  if (document.readyState === 'complete') doRegister();
  else window.addEventListener('load', doRegister);
  // captura o evento de instalação (beforeinstallprompt)
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    showInstallBtn();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    hideInstallBtn();
    toast('Manganana instalado');
  });
}

function showInstallBtn() {
  let btn = $('#installBtn');
  if (!btn) {
    btn = document.createElement('button');
    btn.id = 'installBtn';
    btn.className = 'install-btn';
    btn.innerHTML = '⬇ Instalar app';
    btn.addEventListener('click', async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') hideInstallBtn();
      deferredPrompt = null;
    });
    document.body.appendChild(btn);
  }
  btn.classList.add('show');
}

function hideInstallBtn() {
  const btn = $('#installBtn');
  if (btn) btn.classList.remove('show');
}

/* ---------- download de capítulos (offline) ---------- */
function downloadsList() { return load('downloads', []); } // [{id, mangaId, manga, chapter, urls, ts}]

async function downloadChapter() {
  const r = state.reader;
  if (!r) return;
  if (!('serviceWorker' in navigator)) { toast('Offline não disponível neste navegador'); return; }
  // px() resolve certo em cada ambiente: localhost usa URL direta,
  // produção usa /api/img (que tem o UA correto p/ MangaDex)
  const raw = (r.provider === 'mangapill' || r.provider === 'mlivre' || r.provider === 'vegi' || r.provider === 'ck')
    ? r.pages
    : r.pages.map((p) => r.baseUrl + '/data/' + r.hash + '/' + p);
  const urls = raw.map((u) => px(u));

  const existing = downloadsList().find((d) => d.id === r.chapter.id);
  if (existing) { toast('Capítulo já baixado'); return; }

  const btn = $('#btnDownloadChapter');
  if (btn) { btn.classList.add('loading'); btn.style.pointerEvents = 'none'; }
  toast('Baixando ' + urls.length + ' páginas…');

  try {
    // o SW cacheia automaticamente toda imagem /api/img que passa por ele.
    // Em produção px() = /api/img?url=... (same-origin, funciona);
    // em localhost px() = URL direta (fetch cross-origin pode falhar por CORS — só dev).
    let done = 0, failed = 0;
    const fetcher = (u) => Promise.race([
      fetch(u),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 15000)),
    ]);
    // baixa em lotes de 5 p/ não estourar conexões
    for (let i = 0; i < urls.length; i += 5) {
      const batch = urls.slice(i, i + 5);
      const results = await Promise.allSettled(batch.map(fetcher));
      results.forEach((x) => { if (x.status === 'fulfilled' && x.value.ok) done++; else failed++; });
    }
    if (done === 0) throw new Error('todas as páginas falharam (' + failed + ')');

    const dl = {
      id: r.chapter.id,
      mangaId: r.manga.id,
      manga: mangaTitle(r.manga),
      chapter: chapterNum(r.chapter),
      urls,
      ts: Date.now(),
    };
    const list = downloadsList().filter((d) => d.id !== dl.id);
    list.unshift(dl);
    store('downloads', list.slice(0, 40));
    toast('Capítulo baixado (' + done + ' páginas p/ leitura offline)');
    if (btn) { btn.classList.remove('loading'); btn.classList.add('done'); }
  } catch (e) {
    toast('Falha ao baixar: ' + e.message);
    if (btn) btn.classList.remove('loading');
  }
  if (btn) btn.style.pointerEvents = '';
}

// baixa todos os capítulos do mangá (pt-br) em sequência, com progresso
async function downloadAllChapters() {
  const m = state.detail;
  if (!m) return;
  if (!('serviceWorker' in navigator)) { toast('Offline não disponível neste navegador'); return; }
  const chs = state.chapters || [];
  if (!chs.length) { toast('Nenhum capítulo disponível'); return; }
  // ignora capítulos já baixados
  const have = new Set(downloadsList().map((d) => d.id));
  const todo = chs.filter((c) => !have.has(c.id) && !c._provider);
  if (!todo.length) { toast('Todos os capítulos já estão baixados'); return; }

  const prog = $('#dlAllProgress');
  const bar = $('#dlAllBar');
  const label = $('#dlAllLabel');
  if (prog) prog.hidden = false;
  let done = 0;
  const upd = () => {
    if (bar) bar.style.width = Math.round((done / todo.length) * 100) + '%';
    if (label) label.textContent = `Baixando capítulo ${done + 1} de ${todo.length}…`;
  };
  upd();

  let okCount = 0;
  for (const ch of todo) {
    try {
      const srv = await getChapterPages(ch.id);
      const files = state.settings.quality === 'dataSaver' ? srv.chapter.dataSaver : srv.chapter.data;
      const urls = files.map((p) => px(srv.baseUrl + '/data/' + srv.chapter.hash + '/' + p));
      // baixa as páginas em lotes de 5
      let doneP = 0, failP = 0;
      for (let i = 0; i < urls.length; i += 5) {
        const batch = urls.slice(i, i + 5);
        const results = await Promise.allSettled(batch.map((u) => Promise.race([
          fetch(u), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 15000)),
        ])));
        results.forEach((x) => { if (x.status === 'fulfilled' && x.value.ok) doneP++; else failP++; });
      }
      if (doneP > 0) {
        const dl = { id: ch.id, mangaId: m.id, manga: mangaTitle(m), chapter: chapterNum(ch), urls, ts: Date.now() };
        const list = downloadsList().filter((d) => d.id !== dl.id);
        list.unshift(dl);
        store('downloads', list.slice(0, 60));
        okCount++;
      }
    } catch { /* capítulo sem páginas: segue */ }
    done++;
    upd();
  }
  if (prog) prog.hidden = true;
  renderDownloads();
  toast(okCount ? `${okCount} capítulos baixados!` : 'Nenhum capítulo pôde ser baixado');
}

async function deleteDownload(id) {
  const list = downloadsList();
  const dl = list.find((d) => d.id === id);
  if (!dl) return;
  if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({ type: 'DELETE_CHAPTER', urls: dl.urls });
  }
  store('downloads', list.filter((d) => d.id !== id));
  toast('Download removido');
}

// renderiza a lista de downloads na aba Perfil — agrupada por mangá
function renderDownloads() {
  const wrap = $('#downloadsWrap');
  if (!wrap) return;
  const list = downloadsList();
  if (!list.length) {
    wrap.innerHTML = '<div class="empty"><p>Nenhum capítulo baixado ainda.<br>Abra um capítulo e toque em ⬇ ou use "baixar tudo" no mangá.</p></div>';
    return;
  }
  // agrupa por mangá
  const groups = {};
  list.forEach((d) => {
    if (!groups[d.mangaId]) groups[d.mangaId] = { manga: d.manga, items: [] };
    groups[d.mangaId].items.push(d);
  });
  wrap.innerHTML = Object.values(groups).map((g) => {
    // capa: tenta achar no histórico/favoritos
    const fav = state.favs.find((f) => f.id === g.items[0].mangaId);
    const hist = state.history.find((h) => h.id === g.items[0].mangaId);
    const cover = fav?.cover || hist?.cover || '';
    const totalP = g.items.reduce((a, d) => a + d.urls.length, 0);
    return `
    <div class="dl-group">
      <div class="dlg-head" onclick="openDetail('${g.items[0].mangaId}')">
        ${cover ? `<div class="dlg-cover">${coverImg(cover, g.manga)}</div>` : `<div class="dlg-cover ph">📚</div>`}
        <div class="dlg-info">
          <strong>${esc(g.manga)}</strong>
          <small>${g.items.length} capítulos • ${totalP} páginas</small>
        </div>
        <div class="rarrow"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg></div>
      </div>
      <div class="dlg-chapters">
        ${g.items.map((d) => `
          <div class="dlg-ch" onclick="openDownloadedChapter('${d.id}')">
            <span>${esc(d.chapter)}</span>
            <small>${d.urls.length} pág.</small>
            <button class="dl-del" onclick="event.stopPropagation(); deleteDownload('${d.id}')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          </div>`).join('')}
      </div>
      <button class="dlg-del-all" onclick="deleteMangaDownloads('${g.items[0].mangaId}')">Excluir todos</button>
    </div>`;
  }).join('');
}

// abre um capítulo baixado direto no leitor (offline)
async function openDownloadedChapter(dlId) {
  const dl = downloadsList().find((d) => d.id === dlId);
  if (!dl) return;
  try {
    const m = await getManga(dl.mangaId);
    state.detail = m;
    state.chapters = []; // sem network pra lista completa
    state.reader = {
      manga: m, chapter: { id: dl.id, attributes: { chapter: dl.chapter } },
      pages: dl.urls.map((u) => decodeURIComponent(u.split('url=')[1] || u)),
      idx: 0, provider: 'offline',
    };
    showView('view-reader');
    $('#bottomNav').classList.add('hidden');
    renderReader();
  } catch { toast('Não foi possível abrir o download'); }
}

// exclui todos os capítulos de um mangá
function deleteMangaDownloads(mangaId) {
  const list = downloadsList();
  const toDel = list.filter((d) => d.mangaId === mangaId);
  if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
    toDel.forEach((d) => navigator.serviceWorker.controller.postMessage({ type: 'DELETE_CHAPTER', urls: d.urls }));
  }
  store('downloads', list.filter((d) => d.mangaId !== mangaId));
  renderDownloads();
  toast('Downloads excluídos');
}

/* ---------- listas personalizadas ---------- */
const LIST_NAMES = { lendo: 'Lendo', vouLer: 'Vou ler', completo: 'Completo', dropei: 'Dropei' };
const LIST_ICONS = {
  lendo: `<svg class="list-svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>`,
  vouLer: `<svg class="list-svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path></svg>`,
  completo: `<svg class="list-svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>`,
  dropei: `<svg class="list-svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`
};

// pega as listas do usuário (local + nuvem)
function myLists() { return load('lists', { lendo: [], vouLer: [], completo: [], dropei: [] }); }
function saveLists(l) {
  store('lists', l);
  if (syncUser) schedulePush();
}

// abre o picker de lista no detail
function openListPicker() {
  if (!syncUser) { toast('Entre com sua conta para criar listas'); switchTab('profile'); return; }
  const m = state.detail;
  if (!m) return;
  const lists = myLists();
  const inWhich = Object.keys(lists).find((l) => lists[l].some((x) => x.id === m.id));
  let sh = $('#listSheet');
  if (!sh) {
    sh = document.createElement('div');
    sh.id = 'listSheet';
    sh.className = 'sheet list-sheet';
    document.body.appendChild(sh);
    sh.addEventListener('click', (e) => { if (e.target === sh) sh.classList.remove('open'); });
  }
  sh.innerHTML = `
    <div class="sheet-handle"></div>
    <div class="sheet-head"><strong>${esc(m.title || 'Mangá')}</strong><button class="icon-btn" onclick="$('#listSheet').classList.remove('open')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>
    <div class="sheet-body" style="padding:8px 16px 24px">
      ${Object.entries(LIST_NAMES).map(([key, label]) => {
        const active = inWhich === key;
        return `<button class="list-pick ${active ? 'active' : ''}" onclick="setMangaList('${key}')">
          <span>${LIST_ICONS[key] || ''}${label}</span><small>${active ? '✓' : ''}</small>
        </button>`;
      }).join('')}
      ${inWhich ? `<button class="list-remove" onclick="setMangaList('')">Remover de todas as listas</button>` : ''}
    </div>`;
  sh.classList.add('open');
}

// adiciona/remove o mangá atual de uma lista
async function setMangaList(listName) {
  const m = state.detail;
  if (!m || !syncUser) return;
  const lists = myLists();
  const clean = {};
  Object.keys(lists).forEach((l) => { clean[l] = lists[l].filter((x) => x.id !== m.id); });
  if (listName && LIST_NAMES[listName]) {
    clean[listName].unshift({ id: m.id, title: m.title || mangaTitle(m), cover: m.cover || '', ts: Date.now() });
  }
  saveLists(clean);
  $('#listSheet')?.classList.remove('open');
  toast(listName ? `Adicionado em ${LIST_NAMES[listName]}` : 'Removido das listas');
  // sincroniza na nuvem
  try {
    const token = await window.Clerk.session?.getToken();
    if (!token) return;
    await fetch('/api/profile?list=1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ mangaId: m.id, list: listName, title: m.title || mangaTitle(m), cover: m.cover || '' }),
    });
  } catch { /* offline ok — push cobre depois */ }
  renderDetailListState();
}

// marca visual do botão de lista no detail
function renderDetailListState() {
  const m = state.detail;
  const btn = $('#detailListBtn');
  if (!btn || !m) return;
  const lists = myLists();
  const inWhich = Object.keys(lists).find((l) => lists[l].some((x) => x.id === m.id));
  btn.classList.toggle('faved', !!inWhich);
  btn.title = inWhich ? `Na lista: ${LIST_NAMES[inWhich]}` : 'Adicionar à lista';
}

/* ---------- alertas de capítulo novo ---------- */
// verifica se os favoritos têm capítulos novos (rodado no boot, uma vez por sessão)
async function checkNewChapters() {
  try {
    const favs = state.favs;
    if (!favs.length) return;
    const lastSeen = load('lastSeen', {});
    const newIds = load('newChapters', {});
    let changed = false;
    const news = [];
    // verifica no máximo 8 favoritos por vez (limite de requests)
    const batch = favs.slice(0, 8);
    const results = await Promise.allSettled(batch.map(async (f) => {
      const chs = await getChaptersLang(f.id, 'pt-br');
      if (!chs.length) return null;
      const latest = chs[chs.length - 1];
      const seen = lastSeen[f.id];
      if (seen && latest.id !== seen) {
        return { id: f.id, title: f.title, num: chapterNum(latest) };
      }
      return null;
    }));
    results.forEach((r) => {
      if (r.status === 'fulfilled' && r.value) {
        news.push(r.value);
        if (!newIds[r.value.id]) { newIds[r.value.id] = true; changed = true; }
      }
    });
    if (changed) store('newChapters', newIds);
    if (news.length) {
      const total = news.length > 1 ? ` (e mais ${news.length - 1})` : '';
      toast(`Novo capítulo: ${news[0].title} ${news[0].num}${total}`);
      renderLibrary();
    }
  } catch { /* silencioso */ }
}

// limpa o marcador "NOVO" quando o usuário abre o mangá
function clearNewFlag(mangaId) {
  const newIds = load('newChapters', {});
  if (newIds[mangaId]) {
    delete newIds[mangaId];
    store('newChapters', newIds);
    renderLibrary();
  }
}

function scrollTopHome() {
  const c = $('#view-home').querySelector('.content');
  if (c) c.scrollTo({ top: 0, behavior: 'smooth' });
}

// mostra o botão "voltar ao topo" quando o usuário rola a home
function bindToTop() {
  const btn = $('#toTopBtn');
  if (!btn) return;
  const content = $('#view-home').querySelector('.content');
  if (!content) return;
  content.addEventListener('scroll', () => {
    btn.classList.toggle('show', content.scrollTop > 600);
  }, { passive: true });
}

/* ---------- pull-to-refresh (home) ---------- */
function bindPullRefresh() {
  const content = $('#view-home').querySelector('.content');
  if (!content) return;
  let startY = 0;
  let pulling = false;
  let dy = 0;
  const MAX = 76;
  let indicator = document.getElementById('ptrIndicator');
  if (!indicator) {
    indicator = document.createElement('div');
    indicator.id = 'ptrIndicator';
    indicator.innerHTML = '🔄';
    content.parentElement.appendChild(indicator);
  }
  content.addEventListener('touchstart', (e) => {
    if (content.scrollTop <= 0) {
      startY = e.touches[0].clientY;
      pulling = true;
      dy = 0;
    } else {
      pulling = false;
    }
  }, { passive: true });
  content.addEventListener('touchmove', (e) => {
    if (!pulling || content.scrollTop > 0) return;
    dy = Math.max(0, e.touches[0].clientY - startY);
    if (dy > 0) {
      indicator.classList.add('show');
      const t = Math.min(dy / MAX, 1);
      indicator.style.transform = `translate(-50%, ${Math.min(dy, MAX) - 44}px) rotate(${t * 180}deg)`;
    }
  }, { passive: true });
  content.addEventListener('touchend', () => {
    if (!pulling) return;
    pulling = false;
    if (dy >= MAX) {
      indicator.classList.add('refreshing');
      toast('Atualizando…', '🔄');
      renderHome().finally(() => {
        setTimeout(() => {
          indicator.classList.remove('show', 'refreshing');
          indicator.style.transform = '';
          toast('Atualizado!', '✅');
        }, 600);
      });
    } else {
      indicator.classList.remove('show');
      indicator.style.transform = '';
    }
  }, { passive: true });
}

/* ---------- ripple effect (delegado, funciona em botões dinâmicos) ---------- */
function bindRipple() {
  document.addEventListener('pointerdown', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    const r = document.createElement('span');
    r.className = 'ripple';
    r.style.width = r.style.height = size + 'px';
    r.style.left = (e.clientX - rect.left - size / 2) + 'px';
    r.style.top = (e.clientY - rect.top - size / 2) + 'px';
    btn.appendChild(r);
    setTimeout(() => r.remove(), 550);
  }, { passive: true });
}

/* ---------- boot ---------- */
(async function boot() {
  try {
    bindGlobal();
    bindPageLoad();
    initExplore();
    bindToTop();
    bindPullRefresh();
    bindRipple();
    // SPLASH: some assim que a home termina de renderizar (sem espera fixa)
    await renderHome().then(() => {
      const splash = $('#splash');
      if (splash) splash.classList.add('hidden');
    });
    // fallback: nunca deixa o splash preso na tela
    setTimeout(() => {
      const splash = $('#splash');
      if (splash) splash.classList.add('hidden');
    }, 2500);
    renderLibrary();
    renderProfile();
    registerSW();
    checkNewChapters();
    countVisit();
    initClerk();
    // deep link: ?manga=ID abre direto o mangá (links compartilhados)
    const q = new URLSearchParams(location.search);
    const mangaId = q.get('manga');
    const chapterId = q.get('chapter');
    if (mangaId) {
      try {
        await openDetail(mangaId);
        if (chapterId) {
          // espera a lista de capítulos carregar e abre o capítulo direto
          const waitFor = setInterval(() => {
            const exists = (state.chapters || []).some(c => c.id === chapterId);
            if (exists) {
              clearInterval(waitFor);
              openChapter(chapterId);
            }
          }, 300);
          setTimeout(() => clearInterval(waitFor), 15000);
        }
        history.replaceState({}, '', location.pathname);
      } catch (err) {
        console.warn('Falha ao processar deep link:', err);
      }
    }
  } catch (err) {
    console.error('Erro durante inicialização (boot):', err);
  } finally {
    setTimeout(() => {
      const splash = $('#splash');
      if (splash) splash.classList.add('hidden');
    }, 700);
  }
})();

// expor p/ onclick inline
window.openDetail = openDetail;
window.openChapter = openChapter;
window.toggleFav = toggleFav;
window.resumeRead = resumeRead;
window.pickChapter = pickChapter;
window.continueReading = continueReading;
window.openCharModal = openCharModal;
window.closeCharModal = closeCharModal;
window.switchLang = switchLang;
window.switchProvider = switchProvider;
window.downloadChapter = downloadChapter;
window.deleteDownload = deleteDownload;
window.downloadAllChapters = downloadAllChapters;
window.openDownloadedChapter = openDownloadedChapter;
window.deleteMangaDownloads = deleteMangaDownloads;
window.sendComment = sendComment;
window.deleteComment = deleteComment;
window.loadComments = loadComments;
window.likeComment = likeComment;
window.sendReply = sendReply;
window.toggleReply = toggleReply;
window.openUserProfile = openUserProfile;
window.openListPicker = openListPicker;
window.setMangaList = setMangaList;
window.saveProfile = saveProfile;
window.toggleEditProfile = toggleEditProfile;
window.closeEditSheet = closeEditSheet;
window.removeBanner = removeBanner;
window.renderBanner = renderBanner;
window.openReaderSettings = openReaderSettings;
window.markChapterRead = markChapterRead;
window.clearSearchHistory = clearSearchHistory;
window.doSearchTerm = doSearchTerm;
window.openSeeAll = openSeeAll;
window.heroGo = heroGo;
window.shareManga = shareManga;
window.openFilters = openFilters;
window.applyFilters = applyFilters;
window.clearFilters = clearFilters;
window.spotlightClick = spotlightClick;
window.prevChapterNav = prevChapterNav;
window.nextChapterNav = nextChapterNav;
window.closeReader = closeReader;
window.scrollTopHome = scrollTopHome;
window.syncNow = syncNow;
