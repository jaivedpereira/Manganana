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

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove('show'), 2200);
}

function store(key, val) { localStorage.setItem('mn_' + key, JSON.stringify(val)); }
function load(key, def) { try { return JSON.parse(localStorage.getItem('mn_' + key)) ?? def; } catch { return def; } }

/* ---------- estado ---------- */
const state = {
  tab: 'home',
  settings: load('settings', { mode: 'vertical', quality: 'full', rtl: false, dark: true, readerBg: 'auto', readerBright: 100, readerWidth: 100, webtoon: false, tapZones: false }),
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
  lang: 'pt-br',         // idioma ativo
  provider: 'mangadex',  // provedor ativo: mangadex | mangapill
  pill: null,            // dados do MangaPill (quando disponível)
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
  return (desc || '')
    .replace(/__([^_]+)__/g, '$1: ')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
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

/* ---------- API MangaDex ---------- */
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
  const rel = (m?.relationships ?? []).find((r) => r.type === 'cover_art');
  const fn = rel?.attributes?.fileName;
  return fn ? px(`${CDN}/covers/${m.id}/${fn}.256.jpg`) : '';
}
function mangaCoverFull(m) {
  const rel = (m?.relationships ?? []).find((r) => r.type === 'cover_art');
  const fn = rel?.attributes?.fileName;
  return fn ? px(`${CDN}/covers/${m.id}/${fn}`) : '';
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
  const d = new Date(iso); const s = (Date.now() - d.getTime()) / 1000;
  if (s < 60) return 'agora';
  if (s < 3600) return Math.floor(s / 60) + ' min';
  if (s < 86400) return Math.floor(s / 3600) + 'h';
  if (s < 604800) return Math.floor(s / 86400) + 'd';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}
function pct(n) { return Number(n).toFixed(1); }

async function searchManga({ query = '', genre = 'all', offset = 0, limit = 24, order = 'followedCount', status = '', year = '', sort = '' }) {
  const p = new URLSearchParams();
  p.set('limit', limit);
  p.set('offset', offset);
  p.append('includes[]', 'cover_art');
  p.append('includes[]', 'author');
  p.append('includes[]', 'artist');
  p.set('availableTranslatedLanguage[]', 'pt-br');
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
  return `
  <article class="manga-card" data-id="${m.id}" onclick="openDetail('${m.id}')">
    <div class="cover">
      ${coverImg(cover, title)}
      ${faved ? '<span class="tag">♥ FAV</span>' : ''}
    </div>
    <h3>${esc(title)}</h3>
    <div class="sub">${esc(sub)}</div>
  </article>`;
}

// card de lista (usado no Explorar) — capa pequena + info ao lado
function rowHTML(m, faved) {
  const title = mangaTitle(m);
  const cover = mangaCover(m);
  const year = mangaYear(m);
  const tags = mangaTags(m);
  return `
  <article class="manga-row" data-id="${m.id}" onclick="openDetail('${m.id}')">
    <div class="rcover">
      ${coverImg(cover, title)}
      ${faved ? '<span class="rtag">♥</span>' : ''}
    </div>
    <div class="rinfo">
      <h3>${esc(title)}</h3>
      <div class="rsub">
        ${year ? `<span>${year}</span>` : ''}
        ${mangaAuthors(m) ? `<span>✍ ${esc(mangaAuthors(m))}</span>` : ''}
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
  // coleta ids favoritos + lidos
  const favIds = state.favs.map((f) => f.id);
  const histIds = state.history.map((h) => h.id).slice(0, 20);
  const ids = [...new Set([...favIds, ...histIds])];
  if (!ids.length) return [];

  // busca os gêneros desses mangás (em lotes de 5)
  const genreCount = {};
  let got = 0;
  for (let i = 0; i < ids.length && got < 10; i += 5) {
    const batch = ids.slice(i, i + 5);
    const results = await Promise.allSettled(batch.map((id) => getManga(id)));
    results.forEach((r) => {
      if (r.status !== 'fulfilled' || !r.value) return;
      got++;
      (r.value.attributes.tags || [])
        .filter((t) => t.attributes.group === 'genre')
        .forEach((t) => { const n = t.attributes.name.en; genreCount[n] = (genreCount[n] || 0) + 1; });
    });
  }

  // top 2 gêneros
  const topGenres = Object.entries(genreCount).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([n]) => n);
  if (!topGenres.length) return [];

  // busca mangás desses gêneros (via state.genres já carregado)
  const g = state.genres.find((x) => x.name.toLowerCase() === topGenres[0].toLowerCase());
  if (!g) return [];
  const found = await searchManga({ limit: 14, genre: g.id });
  // exclui os que o usuário já conhece
  const known = new Set(ids);
  return found.filter((m) => !known.has(m.id)).slice(0, 10);
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
        ${faved ? '<span class="rtag">♥</span>' : ''}
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
      ${faved ? '<span class="tag">♥ FAV</span>' : ''}
      ${year ? `<span class="byear">${year}</span>` : ''}
    </div>
    <h3>${esc(title)}</h3>
    ${tags.length ? `<div class="btags">${tags.slice(0, 2).map((t) => `<span class="rtag-chip">${esc(t)}</span>`).join('')}</div>` : ''}
  </article>`;
}

/* ---------- render: home ---------- */
// nomes de gêneros (inglês) para buscar por categoria
const CATS = {
  trending: { title: 'Em alta 🔥', api: { order: 'followedCount' } },
  recent: { title: 'Recentes 📚', api: { order: 'latestUploadedChapter' } },
  action: { title: 'Ação ⚔️', genre: 'Action' },
  romance: { title: 'Romance 💕', genre: 'Romance' },
  fantasy: { title: 'Fantasia 🐉', genre: 'Fantasy' },
  horror: { title: 'Terror 👻', genre: 'Horror' },
  comedy: { title: 'Comédia 😂', genre: 'Comedy' },
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

let heroTimer = null;
let heroIdx = 0;
let heroList = [];

// carrossel do hero com rotação automática
function renderHero() {
  const track = $('#heroTrack');
  const dots = $('#heroDots');
  const sk = $('#heroSkeleton');
  if (!heroList.length) { sk.style.display = 'none'; return; }
  sk.className = 'hero-skeleton';
  sk.style.display = '';
  track.innerHTML = heroList.map((m, i) => {
    const t = mangaTitle(m);
    const d = mangaDesc(m).slice(0, 110);
    const full = mangaCoverFull(m);
    return `
    <div class="hero-card slide">
      <img data-src="${full}" alt="${esc(t)}" loading="eager" decoding="async" />
      <div class="hero-shade"></div>
      <div class="hero-body">
        <div class="hero-tag">✦ Em destaque</div>
        <h1>${esc(t)}</h1>
        <p>${esc(d)}</p>
        <button class="hero-cta" onclick="openDetail('${m.id}')">Ver detalhes
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
        </button>
      </div>
    </div>`;
  }).join('');
  dots.innerHTML = heroList.map((_, i) => `<button class="dot ${i === 0 ? 'active' : ''}" onclick="heroGo(${i})"></button>`).join('');
  heroIdx = 0;
  // pré-carrega as capas via JS (o lazy não carrega slides escondidos no track)
  $$('#heroTrack img').forEach((img) => {
    const src = img.dataset.src;
    if (!src) return;
    const loader = new Image();
    loader.onload = () => { if (img.dataset.src) { img.src = src; img.removeAttribute('data-src'); } };
    loader.src = src;
  });
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

async function renderHome() {
  const c = $('#homeContent');
  // hero (carrossel com os 5 mais populares)
  try {
    heroList = await searchManga({ limit: 5, order: 'followedCount' });
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
        : '<div class="empty" style="grid-column:1/-1"><p>Nada encontrado nesta categoria.</p></div>';
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
    row.innerHTML = '<p class="muted" style="font-size:12px;padding:4px 0">Nada lido ainda — explore e comece sua jornada!</p>';
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
    const list = await searchManga({
      query: state.explore.query,
      genre: state.explore.genre,
      offset: state.explore.offset,
      limit: 24,
      status: state.filters.status,
      year: state.filters.year,
      sort: state.filters.sort,
    });
    if (!list.length && state.explore.offset === 0) {
      grid.innerHTML = '<div class="empty" style="grid-column:1/-1"><p>Nenhum mangá encontrado.</p></div>';
      loadBtn.style.display = 'none';
    } else {
      grid.insertAdjacentHTML('beforeend', list.map((m) => rowHTML(m, state.favs.some((f) => f.id === m.id))).join(''));
      state.explore.offset += list.length;
      loadBtn.style.display = list.length < 24 ? 'none' : 'block';
      loadBtn.textContent = 'Carregar mais ↓';
    }
  } catch (e) {
    toast('Erro ao carregar: ' + e.message);
    loadBtn.textContent = 'Carregar mais ↓';
  }
  state.explore.loading = false;
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

/* ---------- render: library ---------- */
let libTab = 'favs';
let libSort = 'recent';
let libQuery = '';
function renderLibrary() {
  const grid = $('#libraryGrid');
  const empty = $('#libraryEmpty');
  const emptyText = $('#libraryEmptyText');
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
  // ordenação
  if (libTab === 'favs') {
    if (libSort === 'az') items = [...items].sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    else if (libSort === 'read') {
      const rc = load('readCount', {});
      items = [...items].sort((a, b) => (rc[b.id] || 0) - (rc[a.id] || 0));
    }
    // 'recent': favs são salvos em ordem de adição; mostra os mais recentes primeiro
    if (libSort === 'recent') items = [...items].reverse();
  }
  const readCount = load('readCount', {});
  empty.hidden = items.length > 0;
  grid.innerHTML = items.map((f) => {
    const newIds = load('newChapters', {});
    const rc = readCount[f.id] || 0;
    // progresso: % do último capítulo lido (se houver histórico com total)
    const last = [...state.history].sort((a, b) => b.ts - a.ts).find((h) => h.id === f.id);
    const pct = last && last.total ? Math.min(100, Math.round(((last.page + 1) / last.total) * 100)) : null;
    return `
    <article class="manga-card" onclick="openDetail('${f.id}')">
      <div class="cover">${coverImg(f.cover, f.title)}${newIds[f.id] ? '<span class="tag novo">NOVO</span>' : ''}${pct != null && libTab === 'favs' ? `<div class="readbar"><i style="width:${pct}%"></i></div>` : ''}</div>
      <h3>${esc(f.title)}</h3>
      <div class="sub">${libTab === 'history' ? esc(f.chapter) : (pct != null ? pct + '% lido' : (rc ? rc + ' págs' : ''))}</div>
    </article>`;
  }).join('');
}

/* ---------- render: detail ---------- */
// desativa todas as views e ativa só a desejada (evita sobreposição de telas)
function showView(viewId) {
  $$('.view').forEach((v) => v.classList.remove('active'));
  if (viewId) $('#' + viewId).classList.add('active');
}

async function openDetail(id) {
  showView('view-detail');
  clearNewFlag(id);
  document.title = 'Manganana';
  $('#view-detail').querySelector('.content').scrollTop = 0;
  $('#detailContent').innerHTML = '<div style="padding:120px 0;text-align:center;color:var(--muted)"><div class="spinner" style="margin:0 auto 14px"></div>Carregando…</div>';
  $('#bottomNav').classList.add('hidden');
  try {
    const m = await getManga(id);
    state.detail = m;
    document.title = mangaTitle(m) + ' | Manganana';
    state.lang = 'pt-br';
    state.provider = 'mangadex';
    state.allChapters = {};
    state.pill = null;
    // busca dados premium (AniList) em paralelo — não bloqueia se falhar
    let premium = null;
    try { premium = await fetchAniList(mangaTitle(m)); } catch {}
    state.premium = premium;
    // busca idiomas disponíveis + capítulos pt-br em paralelo
    let langs = [{ code: 'pt-br', count: 0 }];
    let chapters = [];
    try {
      const [l, c] = await Promise.all([
        mangaLanguages(id),
        getChaptersLang(id, 'pt-br'),
      ]);
      if (l.length) langs = l;
      chapters = c;
    } catch { try { chapters = await getChapters(id); } catch {} }
    state.chapters = chapters;
    // tenta achar no MangaPill (provedor secundário)
    try { state.pill = await findOnPill(mangaTitle(m)); } catch {}
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
    ? `<div class="provider-banner">📖 Provedor: <b>MangaPill</b> — capítulos em inglês</div>`
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
      ${mangaAltTitles(m) ? `<div class="authors">${esc(mangaAltTitles(m))}</div>` : ''}
      ${mangaAuthors(m) ? `<div class="authors">✍️ ${esc(mangaAuthors(m))}</div>` : ''}
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
          ${hasRead ? '▶ Continuar lendo' : '▶ Começar a ler'}
        </button>
        <button class="btn-ghost ${faved ? 'faved' : ''}" id="detailFavBtn" onclick="toggleFav()">
          <svg viewBox="0 0 24 24" fill="${faved ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
        </button>
      </div>
      ${desc ? `
        <p class="detail-desc ${desc.length > 280 ? 'clamped' : ''}" id="detailDesc">${esc(desc)}</p>
        ${desc.length > 280 ? '<button class="detail-toggle" id="descToggle">Ver mais</button>' : ''}
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
      <div class="lang-row" id="langRow">${langChips}${pill ? `<button class="chip ${provider === 'mangapill' ? 'active' : ''}" onclick="switchProvider('mangapill')">📖 MangaPill</button>` : ''}</div>
      ${providerInfo}
      <div class="chapter-list">
        ${chs.length ? chs.map((c) => chapterItemHTML(c, lastRead)).join('') : `<p class="muted" style="font-size:12px">Nenhum capítulo neste idioma ainda. Tente outro idioma ou o provedor alternativo.</p>`}
      </div>
      <div class="section-head"><h2>Você também pode gostar ✨</h2></div>
      <div class="scroll-row" id="detailRecRow"><div class="spinner"></div></div>
    </div>`;

  // carrega recomendações do mesmo gênero
  loadDetailRecs(m);

  const d = $('#detailDesc');
  if (d) $('#descToggle')?.addEventListener('click', () => {
    d.classList.toggle('clamped');
    d.classList.toggle('expanded');
    $('#descToggle').textContent = d.classList.contains('clamped') ? 'Ver mais' : 'Ver menos';
  });
}

function chapterItemHTML(c, lastRead) {
  const read = lastRead && lastRead.chapterId === c.id;
  const group = (c.relationships ?? []).find((r) => r.type === 'scanlation_group')?.attributes?.name;
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
    const lastSeen = load('lastSeen', {});
    lastSeen[m.id] = chapterId;
    store('lastSeen', lastSeen);
    toast('Capítulo marcado como lido ✓');
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
    toast('Adicionado aos favoritos ♥');
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
  body.innerHTML = `
    <h3>${esc(name)}</h3>
    <p class="muted">${desc ? esc(desc) : 'Sem descrição disponível.'}</p>`;
  $('#charModal').classList.add('open');
  $('#sheetBackdrop').classList.add('open');
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

// troca o idioma dos capítulos (MangaDex)
async function switchLang(code) {
  if (!state.detail) return;
  state.lang = code;
  state.provider = 'mangadex';
  const grid = $('#detailContent');
  toast('Carregando ' + langName(code) + '…');
  try {
    // usa cache se já carregou esse idioma
    let chs = state.allChapters[code];
    if (!chs) {
      chs = await getChaptersLang(state.detail.id, code);
      state.allChapters[code] = chs;
    }
    state.chapters = chs;
    renderDetail(state.detail, state.premium, await mangaLanguages(state.detail.id));
    if (grid) grid.scrollTop = grid.scrollHeight;
  } catch (e) {
    toast('Erro: ' + e.message);
  }
}

// troca de provedor (MangaDex <-> MangaPill)
async function switchProvider(name) {
  if (!state.detail) return;
  state.provider = name;
  const grid = $('#detailContent');
  if (name === 'mangapill') {
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

/* ---------- leitor ---------- */
async function openChapter(chapterId, startPage = 0) {
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
  // MangaPill: páginas já são URLs completas; MangaDex: baseUrl/hash/file
  const urls = r.provider === 'mangapill'
    ? r.pages.map((p) => px(p))
    : r.pages.map((p) => px(r.baseUrl + '/data/' + r.hash + '/' + p));
  body.innerHTML = urls.map((src) =>
    `<img class="page-img ${mode}" loading="lazy" src="${src}" alt="página" />`).join('') +
    chapterEndHTML();
  applyReaderStyles();
  initReaderZoom();
  initTapZones();
  updateReaderNav();
  markProgress();
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
  const imgs = $$('#readerBody .page-img');
  const target = imgs[state.reader.idx];
  if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  updateReaderNav(); markProgress();
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
  if (state.detail) { showView('view-detail'); renderDetail(state.detail); }
  else switchTab('home');
  $('#bottomNav').classList.remove('hidden');
}

/* ---------- leitor turbinado ---------- */
// bloco "fim do capítulo" com botões de navegação
function chapterEndHTML() {
  const chs = state.chapters || [];
  const cur = state.reader?.chapter?.id;
  const idx = chs.findIndex((c) => c.id === cur);
  const hasNext = idx < chs.length - 1;
  const hasPrev = idx > 0;
  return `
  <div class="chapter-end">
    <div class="ce-divider"><span>Fim do capítulo</span></div>
    <div class="ce-title">${esc(chapterNum(state.reader?.chapter))}</div>
    <div class="ce-actions">
      ${hasPrev ? `<button class="ce-btn ghost" onclick="prevChapterNav()">← Anterior</button>` : ''}
      ${hasNext ? `<button class="ce-btn main" onclick="nextChapterNav()">Próximo capítulo →</button>` : '<span class="muted" style="font-size:12px">Último capítulo disponível</span>'}
    </div>
    <button class="ce-btn ghost" onclick="closeReader()">Voltar ao mangá</button>
  </div>`;
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
}

// zoom por pinça/double-tap numa página
function initReaderZoom() {
  const body = $('#readerBody');
  if (!body) return;
  if (body.dataset.zoomInit) return; // idempotente
  body.dataset.zoomInit = '1';
  body.addEventListener('dblclick', (e) => {
    const img = e.target.closest('.page-img');
    if (!img) return;
    img.classList.toggle('zoomed');
  });
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
  $('#rsWidth').value = s.readerWidth;
  $('#rsWidthVal').textContent = s.readerWidth + '%';
  $('#rsWebtoon').checked = !!s.webtoon;
  $('#rsTapZones').checked = !!s.tapZones;
  $$('#rsBgChips .rs-chip').forEach((c) => c.classList.toggle('active', c.dataset.bg === s.readerBg));
  openSheet('#readerSettingsSheet');
}

// compartilhar mangá — link bonito (?manga=ID) via Web Share API ou copiar
async function shareManga() {
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
    toast('Link copiado! 🔗');
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
function switchTab(tab, keepScroll = true) {
  state.tab = tab;
  showView(tab ? 'view-' + tab : null);
  $$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  // sempre restaura a barra de navegação ao trocar de aba (corrige bug de sumir)
  $('#bottomNav').classList.remove('hidden');
  if (tab === 'explore' && !$('#exploreGrid').children.length) loadExplore();
  if (tab === 'home') renderContinue();
  if (tab === 'library') renderLibrary();
  if (tab === 'profile') { renderProfile(); renderDownloads(); }
}

function renderProfile() {
  $('#statFavs').textContent = state.favs.length;
  $('#statRead').textContent = Object.keys(load('readCount', {})).length;
  const pages = Object.values(load('readCount', {})).reduce((a, b) => a + b, 0);
  $('#statPages').textContent = pages;
  renderSpotlight();
  renderVisits();
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
      if (user) pullSync();
    });
    syncUser = window.Clerk.user ? { id: window.Clerk.user.id, name: window.Clerk.user.fullName || 'Leitor', email: window.Clerk.user.primaryEmailAddress?.emailAddress || '', image: window.Clerk.user.imageUrl || '' } : null;
    renderAccount();
    // se já está logado (reload da página), puxa/sincroniza de qualquer forma
    if (syncUser) {
      pullSync();
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
    if (!token) { toast('⚠️ Sem token de sessão — recarregue e tente de novo'); return; }
    const r = await fetch('/api/sync', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ data: { favs: state.favs, history: state.history, readCount: load('readCount', {}), lastSeen: load('lastSeen', {}), settings: state.settings } }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.status === 200 && j.ok) toast('Sincronizado! ☁️');
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
    toast('Foto atualizada! 📸');
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
    toast('Dados sincronizados ☁️');
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
  $('#photoInput').addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) changeProfilePhoto(e.target.files[0]);
    e.target.value = '';
  });
  $('#btnDetailBack').addEventListener('click', () => switchTab('home'));
  $('#btnDetailFav').addEventListener('click', toggleFav);
  $('#btnDetailShare').addEventListener('click', shareManga);
  $('#btnSeeAllBack').addEventListener('click', () => {
    showView('view-home');
    $('#bottomNav').classList.remove('hidden');
    window.scrollTo(0, 0);
  });
  $('#seeAllMoreBtn').addEventListener('click', () => loadSeeAll(false));
  $('#btnReaderBack').addEventListener('click', () => {
    if (state.detail) { showView('view-detail'); renderDetail(state.detail); }
    else switchTab('home');
    $('#bottomNav').classList.remove('hidden');
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
    state.history = []; store('history', []); store('readCount', {});
    renderLibrary(); renderProfile(); toast('Histórico limpo');
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
  const applyDark = (v) => document.body.classList.toggle('light', !v);
  $('#setReadingMode').value = state.settings.mode;
  $('#setQuality').value = state.settings.quality;
  $('#setRTL').checked = state.settings.rtl;
  $('#setDark').checked = state.settings.dark;
  applyDark(state.settings.dark);
  $('#setReadingMode').addEventListener('change', (e) => { state.settings.mode = e.target.value; store('settings', state.settings); if (state.reader) renderReader(); });
  $('#setQuality').addEventListener('change', (e) => { state.settings.quality = e.target.value; store('settings', state.settings); if (state.reader) openChapter(state.reader.chapter.id); });
  $('#setRTL').addEventListener('change', (e) => { state.settings.rtl = e.target.checked; store('settings', state.settings); if (state.reader) renderReader(); });
  $('#setDark').addEventListener('change', (e) => { state.settings.dark = e.target.checked; store('settings', state.settings); applyDark(e.target.checked); });

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

  // botão voltar do Android
  window.addEventListener('popstate', () => {
    const rd = $('#view-reader').classList.contains('active');
    const dt = $('#view-detail').classList.contains('active');
    if (rd) {
      if (state.detail) { showView('view-detail'); renderDetail(state.detail); }
      else switchTab('home');
      $('#bottomNav').classList.remove('hidden');
    }
    else if (dt) { switchTab('home'); }
  });
  history.replaceState({}, '');
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
            toast('Nova versão disponível — atualizando…');
            setTimeout(() => window.location.reload(), 600);
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
    toast('Manganana instalado! 🎉');
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
  const raw = r.provider === 'mangapill'
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
    toast('Capítulo baixado! 📥 ' + done + ' páginas p/ leitura offline');
    if (btn) { btn.classList.remove('loading'); btn.classList.add('done'); }
  } catch (e) {
    toast('Falha ao baixar: ' + e.message);
    if (btn) btn.classList.remove('loading');
  }
  if (btn) btn.style.pointerEvents = '';
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

// renderiza a lista de downloads na aba Perfil
function renderDownloads() {
  const wrap = $('#downloadsWrap');
  if (!wrap) return;
  const list = downloadsList();
  if (!list.length) {
    wrap.innerHTML = '<div class="empty"><p>Nenhum capítulo baixado ainda.<br>Abra um capítulo e toque em ⬇ para ler offline.</p></div>';
    return;
  }
  wrap.innerHTML = list.map((d) => `
    <div class="dl-item">
      <div class="dl-info">
        <strong>${esc(d.manga)}</strong>
        <small>${esc(d.chapter)} • ${d.urls.length} páginas</small>
      </div>
      <button class="dl-del" onclick="deleteDownload('${d.id}')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
      </button>
    </div>`).join('');
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
      toast(`🔔 Capítulo novo: ${news[0].title} ${news[0].num}${total}`);
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

/* ---------- boot ---------- */
(async function boot() {
  bindGlobal();
  initExplore();
  bindToTop();
  await renderHome();
  renderLibrary();
  renderProfile();
  registerSW();
  checkNewChapters();
  countVisit();
  initClerk();
  // deep link: ?manga=ID abre direto o mangá (links compartilhados)
  const q = new URLSearchParams(location.search);
  const mangaId = q.get('manga');
  if (mangaId) { await openDetail(mangaId); history.replaceState({}, '', location.pathname); }
  setTimeout(() => $('#splash').classList.add('hidden'), 700);
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
