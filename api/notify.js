// ===== API de notificação de capítulos novos (chamada por cron do Vercel) =====
//   GET /api/notify?key=...   → cron chama a cada 30min
// Pega todos os usuários, junta os mangás seguidos (lendo/vouLer), busca
// capítulos novos no MangaDex e manda aviso no Telegram de quem vinculou o bot.

const { MongoClient } = require('./db.js');

const MD = 'https://api.mangadex.org';
const MD_UA = 'MangananaNotifier/1.0 (https://manganana.vercel.app)';

// badges de conquista (espelho do app.js — mantido em sincronia manual)
const ACH_BADGES = {
  cap10: '📖 Primeiras páginas', cap50: '📚 Leitor dedicado', cap200: '🏛️ Biblioteca viva',
  cap500: '🔥 Viciado oficial', cap1000: '👑 Lenda do Manganana',
  streak3: '🌱 Criando hábito', streak7: '⚡ Semana completa', streak30: '🌋 Mês de fogo',
  manga5: '🎯 Explorador', manga15: '🧭 Aventureiro', manga40: '🌐 Colecionador de mundos',
  fav10: '💛 Primeiros favoritos', fav30: '💎 Gosto refinado',
  maratona: '🏃 Maratonista', madrugada: '🦉 Coruja',
};

let mongoPromise = null;
function getMongo() {
  if (!mongoPromise) {
    mongoPromise = new MongoClient(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 15000,
    }).connect();
  }
  return mongoPromise;
}

async function mdFetch(url) {
  const r = await fetch(url, { headers: { 'User-Agent': MD_UA, 'Accept': 'application/json' } });
  if (!r.ok) throw new Error('MangaDex ' + r.status);
  return r.json();
}

// busca o capítulo mais recente traduzido pra PT-BR de um mangá
async function latestChapter(mangaId) {
  const url = `${MD}/chapter?manga=${mangaId}&translatedLanguage[]=pt-br&order[chapter]=desc&limit=1&includes[]=scanlation_group`;
  const d = await mdFetch(url);
  const ch = d?.data?.[0];
  if (!ch) return null;
  const attrs = ch.attributes || {};
  const group = (ch.relationships || []).find(r => r.type === 'scanlation_group')?.attributes?.name || '';
  return {
    id: ch.id,
    chapter: attrs.chapter || '?',
    title: attrs.title || '',
    group,
    publishAt: attrs.publishAt || '',
  };
}

// monta a mensagem bonita do Telegram (com suporte a HTML do Telegram)
function tgMessage(mangaTitle, ch, mangaId) {
  const num = ch.chapter === '0' ? '0 (Prólogo)' : ch.chapter;
  const lines = [
    `📖 <b>${mangaTitle}</b>`,
    ``,
    `🔥 <b>Capítulo ${num}</b>${ch.title ? ' — ' + ch.title : ''}`,
    ch.group ? `📦 ${ch.group}` : '',
    `🔗 <a href="https://manganana.vercel.app/?manga=${mangaId}&chapter=${ch.id}">Ler capítulo no Manganana</a>`,
  ].filter(Boolean);
  return lines.join('\n');
}

// envia foto (buffer PNG) com legenda — usa FormData nativo do Node 18+
async function sendTelegramPhoto(token, chatId, photoBuffer, caption) {
  const form = new FormData();
  form.append('chat_id', String(chatId));
  form.append('photo', new Blob([photoBuffer], { type: 'image/png' }), 'monthly_card.png');
  form.append('caption', caption);
  form.append('parse_mode', 'HTML');
  const r = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
    method: 'POST',
    body: form,
  });
  const j = await r.json().catch(() => ({}));
  return { ok: !!j.ok, ...j };
}

async function sendTelegram(token, chatId, text, photoUrl) {
  if (!token || !chatId) return { ok: false, reason: 'sem token/chat' };
  if (photoUrl) {
    // envia com foto (capa do mangá) + legenda
    const r = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        photo: photoUrl,
        caption: text,
        parse_mode: 'HTML',
      }),
    });
    const j = await r.json().catch(() => ({}));
    return { ok: !!j.ok, ...j };
  }
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: false }),
  });
  const j = await r.json().catch(() => ({}));
  return { ok: !!j.ok, ...j };
}

// ===== webhook do bot: responde /start com o ID do usuário =====
async function handleWebhook(req, res) {
  const tgToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!tgToken) return res.status(200).json({ ok: false, error: 'bot não configurado' });

  const raw = req.body || {};
  let body = raw;
  // Vercel pode entregar o body como string JSON — normaliza
  if (typeof raw === 'string') {
    try { body = JSON.parse(raw); } catch { body = {}; }
  }
  const msg = body.message || body.edited_message || {};
  const chat = msg.chat || {};
  const text = (msg.text || '').trim();
  if (!text.startsWith('/')) return res.status(200).json({ ok: true });

  const chatId = chat.id;
  let reply = '';
  if (text.startsWith('/start')) {
    reply =
      '👋 Olá! Sou o assistente de notificações do <b>Manganana</b> 📖\n\n' +
      'Seu ID do Telegram é:\n\n' +
      `<code>${chatId}</code>\n\n` +
      '1️⃣ Copie esse número\n' +
      '2️⃣ Cole no Manganana (Perfil → Notificações de capítulo)\n' +
      '3️⃣ Pronto! 🔔 Você vai receber aviso quando sair capítulo novo dos mangás da sua lista.';
  } else if (text.startsWith('/id')) {
    reply = `Seu ID: <code>${chatId}</code>`;
  } else if (text.startsWith('/resumo')) {
    reply = '📊 O resumo mensal é enviado automaticamente no dia 1º de cada mês! 📖';
  } else if (text.startsWith('/conquistas')) {
    // mostra as conquistas do usuário (via chat_id → dados no Mongo)
    try {
      const client = await getMongo();
      const usersCol = client.db('manganana').collection('users');
      const users = await usersCol.find({ 'data.telegramChatId': String(chatId) }).toArray();
      const achv = users[0]?.data?.achievements || [];
      if (!users.length || !achv.length) {
        reply = '🏆 Você ainda não desbloqueou conquistas no Manganana.\nLeia capítulos e favorite mangás para ganhar badges! 📖';
      } else {
        const total = 15;
        reply = `🏆 <b>Suas conquistas:</b> ${achv.length}/${total}\n\n` + achv.map((id) => `✅ ${ACH_BADGES[id] || id}`).join('\n');
      }
    } catch (e) {
      reply = 'Não consegui buscar suas conquistas. Tente de novo!';
    }
  } else {
    reply = 'Use /start para ver seu ID.';
  }
  try {
    await fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: reply, parse_mode: 'HTML' }),
    });
  } catch (e) {
    console.error('tg webhook reply err:', e.message);
  }
  return res.status(200).json({ ok: true });
}

// ===== resumo mensal: "Esse mês no Manganana" =====
function escapeXml(s) {
  return String(s).replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
}

// gera o card visual (SVG → PNG) com as stats do mês
async function buildMonthlyCard(data, coverB64) {
  const sharp = require('sharp');
  const W = 1080, H = 1350;
  const NAVY = '#0b1120', NAVY2 = '#111a30', GOLD = '#ffd60a', TEXT = '#e8edf7', MUTED = '#8a94ad';

  const coverSvg = coverB64
    ? `<image href="${coverB64}" x="30" y="120" width="170" height="240" rx="18" preserveAspectRatio="xMidYMid slice"/>
       <rect x="30" y="120" width="170" height="240" rx="18" fill="none" stroke="#2a3a60" stroke-width="3"/>`
    : `<rect x="30" y="120" width="170" height="240" rx="18" fill="${NAVY2}" stroke="#2a3a60" stroke-width="3"/>
       <text x="115" y="250" text-anchor="middle" font-size="50" fill="${GOLD}">📖</text>`;

  const stats = [
    { v: data.chapters, l: 'capítulos lidos' },
    { v: data.mangas, l: 'mangás' },
    { v: data.days, l: 'dias ativos' },
    { v: data.streak, l: 'streak 🔥' },
  ];
  const cardW = 196, gap = 14, startX = 230;
  let statsSvg = '';
  stats.forEach((s, i) => {
    const x = startX + i * (cardW + gap);
    statsSvg += `
    <rect x="${x}" y="120" width="${cardW}" height="240" rx="18" fill="${NAVY2}" stroke="#1e2a4a" stroke-width="2"/>
    <text x="${x + cardW / 2}" y="225" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="64" font-weight="900" fill="${GOLD}">${s.v}</text>
    <text x="${x + cardW / 2}" y="285" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="22" fill="${MUTED}">${s.l}</text>`;
  });

  const maxCh = Math.max(...data.top.map(t => t.chapters), 1);
  const barH = 52, barGap = 18;
  let barsSvg = '';
  data.top.forEach((t, i) => {
    const w = Math.max(60, (t.chapters / maxCh) * 520);
    const y = 560 + i * (barH + barGap);
    barsSvg += `
    <text x="30" y="${y + 34}" font-family="Segoe UI, sans-serif" font-size="24" font-weight="bold" fill="${TEXT}">${i === 0 ? '🏆' : i === 1 ? '🥈' : i === 2 ? '🥉' : '•'} ${escapeXml(truncate(t.title))}</text>
    <rect x="500" y="${y}" width="${w}" height="${barH}" rx="10" fill="${i === 0 ? GOLD : '#f0a500'}" opacity="0.92"/>
    <text x="${500 + w + 18}" y="${y + 37}" font-family="Segoe UI, sans-serif" font-size="28" font-weight="bold" fill="${GOLD}">${t.chapters}</text>`;
  });

  const weekly = data.weekly || [0, 0, 0, 0];
  const maxWk = Math.max(...weekly, 1);
  const wkW = 80, wkGap = 22, wkTop = 940, wkH = 180;
  let weeklySvg = '';
  weekly.forEach((v, i) => {
    const h = Math.max(16, (v / maxWk) * wkH);
    const x = 30 + i * (wkW + wkGap);
    const y = wkTop + wkH - h;
    weeklySvg += `
    <rect x="${x}" y="${y}" width="${wkW}" height="${h}" rx="10" fill="url(#wkGrad)" opacity="0.95"/>
    <text x="${x + wkW / 2}" y="${y - 12}" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="26" font-weight="bold" fill="${GOLD}">${v}</text>
    <text x="${x + wkW / 2}" y="${wkTop + wkH + 32}" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="20" fill="${MUTED}">Sem ${i + 1}</text>`;
  });

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${NAVY}"/><stop offset="100%" stop-color="#0a1226"/>
    </linearGradient>
    <linearGradient id="goldline" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${GOLD}"/><stop offset="100%" stop-color="#ff8c00"/>
    </linearGradient>
    <linearGradient id="wkGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ffd60a"/><stop offset="100%" stop-color="#b8860b"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <circle cx="950" cy="120" r="300" fill="#ffd60a" opacity="0.05"/>
  <circle cx="100" cy="1200" r="300" fill="#ff8c00" opacity="0.05"/>
  <text x="540" y="70" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="44" font-weight="800" fill="${TEXT}">📊 SEU MÊS NO</text>
  <text x="540" y="120" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="56" font-weight="900" fill="${GOLD}">MANGANANA</text>
  ${coverSvg}
  ${statsSvg}
  <rect x="380" y="410" width="320" height="5" rx="2.5" fill="url(#goldline)"/>
  <text x="540" y="465" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="30" fill="${MUTED}">${escapeXml(data.month)}</text>
  <text x="30" y="530" font-family="Segoe UI, sans-serif" font-size="32" font-weight="800" fill="${TEXT}">MAIS LIDOS</text>
  <rect x="30" y="546" width="70" height="5" rx="2.5" fill="${GOLD}"/>
  ${barsSvg}
  <text x="30" y="865" font-family="Segoe UI, sans-serif" font-size="32" font-weight="800" fill="${TEXT}">RITMO SEMANAL</text>
  <rect x="30" y="881" width="70" height="5" rx="2.5" fill="${GOLD}"/>
  ${weeklySvg}
  <rect x="0" y="${H - 105}" width="${W}" height="105" fill="${NAVY2}"/>
  <text x="540" y="${H - 55}" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="28" font-weight="700" fill="${TEXT}">📖 manganana.vercel.app</text>
  <text x="540" y="${H - 22}" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="20" fill="${MUTED}">Histórias que viram mundos</text>
</svg>`;
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  return png;
}

function truncate(s, max = 22) {
  s = String(s);
  return s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s;
}

// monta os dados do resumo a partir do histórico
async function buildMonthlySummary(history) {
  const now = new Date();
  // mês passado (ex: se hoje é 12/08, resumo de julho? não — mês ATUAL até agora, mas no dia 1º, mês passado)
  // o cron roda dia 1º: resume o mês que terminou
  const firstOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const events = (history || []).filter(h => h.ts && h.ts < firstOfThisMonth);
  if (!events.length) return null;

  const byManga = {};
  const days = new Set();
  for (const e of events) {
    byManga[e.id] = byManga[e.id] || { title: e.title || 'Mangá', chapters: 0 };
    byManga[e.id].chapters++;
    days.add(new Date(e.ts).getDate());
  }
  const mangaList = Object.entries(byManga).sort((a, b) => b[1].chapters - a[1].chapters);
  const top = mangaList[0];
  const totalChapters = events.length;
  const totalMangas = mangaList.length;

  const monthName = new Date(firstOfThisMonth - 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  // top 4 mangás (limita pra caber no card)
  const top4 = mangaList.slice(0, 4).map(([id, m]) => ({ id, title: m.title, chapters: m.chapters }));

  // streak: dias consecutivos lendo (contando do fim do mês pra trás)
  let streak = 0;
  const daySet = new Set(events.map(e => new Date(e.ts).getDate()));
  const lastDay = new Date(firstOfThisMonth - 1).getDate();
  for (let d = lastDay; d >= 1; d--) {
    if (daySet.has(d)) { streak++; } else if (streak > 0) { break; }
  }

  // ritmo semanal: capítulos por semana do mês
  const weekly = [0, 0, 0, 0, 0];
  for (const e of events) {
    const day = new Date(e.ts).getDate();
    const wk = Math.min(4, Math.floor((day - 1) / 7));
    weekly[wk]++;
  }

  return {
    month: monthName,
    chapters: totalChapters,
    mangas: totalMangas,
    days: days.size,
    streak,
    top: top4,
    weekly,
  };
}

// ===== resumo mensal: envia o card visual pra todo mundo que vinculou o bot =====
async function monthlySummary(res) {
  const tgToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!tgToken) return res.json({ ok: false, error: 'bot não configurado' });
  try {
    const client = await getMongo();
    const usersCol = client.db('manganana').collection('users');
    const users = await usersCol.find({}).toArray();
    let sent = 0, skipped = 0;

    for (const u of users) {
      const data = u.data || {};
      const chatId = data.telegramChatId || data.tgChat;
      if (!chatId) { skipped++; continue; }
      const summary = await buildMonthlySummary(data.history || []);
      if (!summary) { skipped++; continue; }
      // busca a capa do mangá mais lido (pra ilustrar o card)
      let coverB64 = '';
      const topId = summary.top?.[0]?.id;
      if (topId) {
        try {
          const d = await mdFetch(`${MD}/manga/${topId}?includes[]=cover_art`);
          const rel = (d?.data?.relationships || []).find(r => r.type === 'cover_art');
          const fn = rel?.attributes?.fileName;
          if (fn) {
            const img = await fetch(`https://uploads.mangadex.org/covers/${topId}/${fn}.512.jpg`).then(r => r.arrayBuffer());
            coverB64 = 'data:image/jpeg;base64,' + Buffer.from(img).toString('base64');
          }
        } catch { coverB64 = ''; }
      }
      const png = await buildMonthlyCard(summary, coverB64);
      const caption = `📊 <b>Seu mês no Manganana</b>\n<i>${summary.month}</i>\n\n🔗 <a href="https://manganana.vercel.app">Continuar lendo →</a>`;
      const r = await sendTelegramPhoto(tgToken, chatId, png, caption);
      if (r.ok) sent++;
    }
    return res.json({ ok: true, mode: 'monthly', sent, skipped, ts: new Date().toISOString() });
  } catch (e) {
    console.error('monthly err:', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
}

module.exports = async function handler(req, res) {
  // ===== WEBHOOK do bot do Telegram (POST /api/notify sem auth = webhook) =====
  if (req.method === 'POST') {
    return await handleWebhook(req, res);
  }
  // ===== CRON de notificação (GET /api/notify com header secreto) =====
  const auth = req.headers['authorization'] || '';
  const cronSecret = process.env.CRON_SECRET || process.env.NOTIFY_KEY;
  if (!cronSecret || auth !== 'Bearer ' + cronSecret) {
    return res.status(401).json({ ok: false, error: 'não autorizado' });
  }
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'use GET' });
  }

  // modo mensal: resumo "Esse mês no Manganana" (chamado dia 1º às 12h)
  if (req.query.mode === 'monthly') {
    return await monthlySummary(res);
  }

  const tgToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!tgToken) {
    return res.json({ ok: false, error: 'TELEGRAM_BOT_TOKEN não configurado' });
  }

  try {
    const client = await getMongo();
    const usersCol = client.db('manganana').collection('users');
    const users = await usersCol.find({}).toArray();

    let checked = 0, sent = 0, errors = 0;

    // mapa: mangaId → { titulo, ultimoNotificado }
    const notifyState = client.db('manganana').collection('notify_state');
    const seenMangas = new Map(); // mangaId → título

    for (const u of users) {
      const data = u.data || {};
      const lists = data.lists || {};
      const chatId = data.telegramChatId || data.tgChat;
      if (!chatId) continue; // usuário sem bot vinculado

      const ids = new Set([...(lists.lendo || []), ...(lists.vouLer || [])]);
      for (const mid of ids) {
        if (!seenMangas.has(mid)) {
          // busca título do mangá + capa (cover_art)
          try {
            const m = await mdFetch(`${MD}/manga/${mid}?includes[]=cover_art`);
            const t = m?.data?.attributes?.title || {};
            const coverRel = (m?.data?.relationships || []).find(r => r.type === 'cover_art');
            const coverFn = coverRel?.attributes?.fileName;
            seenMangas.set(mid, {
              title: t['pt-br'] || t['en'] || t['ja-ro'] || Object.values(t)[0] || 'Mangá',
              cover: coverFn ? `https://uploads.mangadex.org/covers/${mid}/${coverFn}.512.jpg` : '',
            });
          } catch {
            seenMangas.set(mid, { title: 'Mangá', cover: '' });
          }
          checked++;
        }

        try {
          const ch = await latestChapter(mid);
          if (!ch) continue;
          const state = await notifyState.findOne({ mangaId: mid });
          if (state && state.lastChapter === ch.id) continue; // já avisamos

          const info = seenMangas.get(mid) || { title: 'Mangá', cover: '' };
          const msg = tgMessage(info.title, ch, mid);
          const r = await sendTelegram(tgToken, chatId, msg, info.cover);
          if (r.ok) {
            sent++;
            // registra que avisamos esse capítulo
            await notifyState.updateOne(
              { mangaId: mid },
              { $set: { lastChapter: ch.id, lastAt: new Date().toISOString(), title: info.title } },
              { upsert: true }
            );
          } else {
            errors++;
          }
        } catch (e) {
          errors++;
          console.error('notify err', mid, e.message);
        }
      }
    }

    return res.json({ ok: true, checked, sent, errors, ts: new Date().toISOString() });
  } catch (e) {
    console.error('notify fatal:', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
};
