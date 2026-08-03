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
  settings: load('settings', { mode: 'vertical', quality: 'full', rtl: false, dark: true }),
  favs: load('favs', []),           // [{id, title, cover}]
  history: load('history', []),     // [{id, title, cover, chapter, chapterId, page, ts}]
  readCount: load('readCount', {}), // {mangaId: n páginas lidas}
  explore: { query: '', genre: 'all', offset: 0, loading: false },
  detail: null,          // mangá atual
  chapters: [],          // capítulos do mangá atual
  reader: null,          // {manga, chapter, pages, baseUrl, hash, idx}
  genres: [],            // tags do MangaDex
};

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

async function searchManga({ query = '', genre = 'all', offset = 0, limit = 24, order = 'followedCount' }) {
  const p = new URLSearchParams();
  p.set('limit', limit);
  p.set('offset', offset);
  p.append('includes[]', 'cover_art');
  p.append('includes[]', 'author');
  p.append('includes[]', 'artist');
  p.set('availableTranslatedLanguage[]', 'pt-br');
  p.set('order[' + order + ']', 'desc');
  p.append('contentRating[]', 'safe');
  p.append('contentRating[]', 'suggestive');
  if (query) p.set('title', query);
  if (genre !== 'all') p.set('includedTags[]', genre);
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

/* ---------- render: home ---------- */
async function renderHome() {
  const c = $('#homeContent');
  // hero
  try {
    const heroList = await searchManga({ limit: 1, order: 'followedCount' });
    const hero = heroList[0];
    if (hero) {
      const t = mangaTitle(hero);
      const d = mangaDesc(hero).slice(0, 120);
      const full = mangaCoverFull(hero);
      const heroEl = document.getElementById('heroSkeleton');
      heroEl.className = 'hero-card';
      heroEl.innerHTML = `
        <img src="${full}" alt="${esc(t)}" loading="eager" />
        <div class="hero-shade"></div>
        <div class="hero-body">
          <div class="hero-tag">✦ Em destaque</div>
          <h1>${esc(t)}</h1>
          <p>${esc(d)}</p>
          <button class="hero-cta" onclick="openDetail('${hero.id}')">Ver detalhes
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
          </button>
        </div>`;
    } else {
      $('#heroSkeleton').style.display = 'none';
    }
  } catch (e) { $('#heroSkeleton').style.display = 'none'; }

  // trending
  try {
    const t = await searchManga({ limit: 12, order: 'followedCount' });
    $('#trendingRow').innerHTML = t.map((m) => cardHTML(m, state.favs.some((f) => f.id === m.id))).join('');
  } catch { $('#trendingRow').innerHTML = '<p class="muted" style="font-size:12px">Não foi possível carregar.</p>'; }

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

  // continue lendo (histórico)
  renderContinue();
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

/* ---------- render: library ---------- */
let libTab = 'favs';
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
  empty.hidden = items.length > 0;
  grid.innerHTML = items.map((f) => `
    <article class="manga-card" onclick="openDetail('${f.id}')">
      <div class="cover">${coverImg(f.cover, f.title)}</div>
      <h3>${esc(f.title)}</h3>
      <div class="sub">${libTab === 'history' ? esc(f.chapter) : ''}</div>
    </article>`).join('');
}

/* ---------- render: detail ---------- */
// desativa todas as views e ativa só a desejada (evita sobreposição de telas)
function showView(viewId) {
  $$('.view').forEach((v) => v.classList.remove('active'));
  if (viewId) $('#' + viewId).classList.add('active');
}

async function openDetail(id) {
  showView('view-detail');
  $('#view-detail').querySelector('.content').scrollTop = 0;
  $('#detailContent').innerHTML = '<div style="padding:120px 0;text-align:center;color:var(--muted)"><div class="spinner" style="margin:0 auto 14px"></div>Carregando…</div>';
  $('#bottomNav').classList.add('hidden');
  try {
    const m = await getManga(id);
    state.detail = m;
    state.chapters = await getChapters(id);
    renderDetail(m);
  } catch (e) {
    $('#detailContent').innerHTML = `<div class="empty"><p>Erro ao carregar: ${esc(e.message)}</p></div>`;
  }
}

function renderDetail(m) {
  const faved = state.favs.some((f) => f.id === m.id);
  $('#detailTitleNav').textContent = mangaTitle(m);
  $('#btnDetailFav').classList.toggle('faved', faved);
  const cover = mangaCoverFull(m);
  const desc = mangaDesc(m);
  const chs = state.chapters;
  const lastRead = [...state.history].sort((a, b) => b.ts - a.ts).find((h) => h.id === m.id);
  const hasRead = !!lastRead;
  const nextCh = hasRead ? chs.find((c) => c.id === lastRead.chapterId) : null;
  const nextIdx = nextCh ? chs.indexOf(nextCh) + 1 : 0;
  const resumeCh = nextIdx < chs.length ? chs[nextIdx] : (hasRead ? lastRead.chapterId && chs.find(c => c.id === lastRead.chapterId) : chs[0]);

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
      <div class="chapter-head">
        <h2>Capítulos</h2>
        <span>${chs.length} em pt-br</span>
      </div>
      <div class="chapter-list">
        ${chs.length ? chs.map((c) => chapterItemHTML(c, lastRead)).join('') : '<p class="muted" style="font-size:12px">Nenhum capítulo em português ainda.</p>'}
      </div>
    </div>`;

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
  <div class="chapter-item" onclick="openChapter('${c.id}')">
    <div class="num">${c.attributes.chapter || '•'}</div>
    <div class="meta">
      <strong>${esc(chapterNum(c))}${chapterTitle(c) ? ' — ' + esc(chapterTitle(c)) : ''}</strong>
      <small>${[group, timeAgo(c.attributes.publishAt)].filter(Boolean).join(' · ')}</small>
    </div>
    ${read ? '<svg class="read-mark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>' : ''}
  </div>`;
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

/* ---------- leitor ---------- */
async function openChapter(chapterId, startPage = 0) {
  showView('view-reader');
  $('#bottomNav').classList.add('hidden');
  const body = $('#readerBody');
  body.innerHTML = '<div class="reader-loading"><div class="spinner"></div>Carregando capítulo…</div>';
  body.scrollTop = 0;
  try {
    const srv = await getChapterPages(chapterId);
    const ch = state.chapters.find((c) => c.id === chapterId);
    if (!ch) throw new Error('capítulo não encontrado');
    const base = srv.baseUrl;
    const hash = srv.chapter.hash;
    const files = state.settings.quality === 'dataSaver' ? srv.chapter.dataSaver : srv.chapter.data;
    const idx = Math.max(0, Math.min(startPage | 0, files.length - 1));
    state.reader = {
      manga: state.detail, chapter: ch, pages: files, baseUrl: base, hash, idx,
    };
    renderReader();
    if (idx > 0) restorePage(idx);
  } catch (e) {
    body.innerHTML = `<div class="empty"><p>Erro: ${esc(e.message)}<br>O capítulo pode não ter páginas em pt-br.</p></div>`;
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
  body.classList.toggle('rtl', state.settings.rtl);
  body.innerHTML = r.pages.map((p) =>
    `<img class="page-img ${mode}" loading="lazy"
        src="${px(r.baseUrl + '/data/' + r.hash + '/' + p)}"
        alt="página" />`).join('') +
    `<div style="height:40px"></div>`;
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
}
function nextChapterNav() {
  const chs = state.chapters;
  const cur = state.reader?.chapter?.id;
  const idx = chs.findIndex((c) => c.id === cur);
  if (idx >= 0 && idx < chs.length - 1) openChapter(chs[idx + 1].id);
  else toast('Último capítulo disponível');
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
  if (tab === 'profile') renderProfile();
}

function renderProfile() {
  $('#statFavs').textContent = state.favs.length;
  $('#statRead').textContent = Object.keys(load('readCount', {})).length;
  const pages = Object.values(load('readCount', {})).reduce((a, b) => a + b, 0);
  $('#statPages').textContent = pages;
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
  $$('.see-all').forEach((b) => b.addEventListener('click', () => switchTab('explore')));
  $('#btnDetailBack').addEventListener('click', () => switchTab('home'));
  $('#btnDetailFav').addEventListener('click', toggleFav);
  $('#btnReaderBack').addEventListener('click', () => {
    if (state.detail) { showView('view-detail'); renderDetail(state.detail); }
    else switchTab('home');
    $('#bottomNav').classList.remove('hidden');
  });
  $('#btnSettings').addEventListener('click', () => openSheet('#settingsSheet'));
  $('#closeSettings').addEventListener('click', closeSheets);
  $('#sheetBackdrop').addEventListener('click', closeSheets);
  $('#btnProfile').addEventListener('click', () => switchTab('profile'));
  $('#chapterListBtn').addEventListener('click', () => { renderChapterSheet(); openSheet('#chapterSheet'); });
  $('#closeSheet').addEventListener('click', closeSheets);
  $('#prevChapter').addEventListener('click', prevChapterNav);
  $('#nextChapter').addEventListener('click', nextChapterNav);
  $('#btnClearHistory').addEventListener('click', () => {
    state.history = []; store('history', []); store('readCount', {});
    renderLibrary(); renderProfile(); toast('Histórico limpo');
  });
  $$('#libSeg .seg-btn').forEach((b) => b.addEventListener('click', () => {
    $$('#libSeg .seg-btn').forEach((x) => x.classList.remove('active'));
    b.classList.add('active'); libTab = b.dataset.lib; renderLibrary();
  }));

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

  // scroll marca progresso (índice aproximado)
  $('#readerBody').addEventListener('scroll', debounce(() => {
    if (!state.reader) return;
    const imgs = $$('#readerBody .page-img');
    const mid = $('#readerBody').scrollTop + window.innerHeight * 0.5;
    let idx = 0;
    imgs.forEach((img, i) => { if (img.offsetTop < mid) idx = i; });
    state.reader.idx = idx;
    updateReaderNav(); markProgress();
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

/* ---------- boot ---------- */
(async function boot() {
  bindGlobal();
  initExplore();
  await renderHome();
  renderLibrary();
  renderProfile();
  setTimeout(() => $('#splash').classList.add('hidden'), 700);
})();

// expor p/ onclick inline
window.openDetail = openDetail;
window.openChapter = openChapter;
window.toggleFav = toggleFav;
window.resumeRead = resumeRead;
window.pickChapter = pickChapter;
window.continueReading = continueReading;
