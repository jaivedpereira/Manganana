// ===== API de notificação de capítulos novos (chamada por cron do Vercel) =====
//   GET /api/notify?key=...   → cron chama a cada 30min
// Pega todos os usuários, junta os mangás seguidos (lendo/vouLer), busca
// capítulos novos no MangaDex e manda aviso no Telegram de quem vinculou o bot.

const { MongoClient } = require('./db.js');

const MD = 'https://api.mangadex.org';
const MD_UA = 'MangananaNotifier/1.0 (https://manganana.vercel.app)';

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
function tgMessage(mangaTitle, ch) {
  const num = ch.chapter === '0' ? '0 (Prólogo)' : ch.chapter;
  const lines = [
    `📖 <b>${mangaTitle}</b>`,
    ``,
    `🔥 <b>Capítulo ${num}</b>${ch.title ? ' — ' + ch.title : ''}`,
    ch.group ? `📦 ${ch.group}` : '',
    `🔗 <a href="https://manganana.vercel.app/?manga=${encodeURIComponent(mangaTitle)}">Ler no Manganana</a>`,
  ].filter(Boolean);
  return lines.join('\n');
}

async function sendTelegram(token, chatId, text) {
  if (!token || !chatId) return { ok: false, reason: 'sem token/chat' };
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: false }),
  });
  const j = await r.json().catch(() => ({}));
  return { ok: !!j.ok, ...j };
}

module.exports = async function handler(req, res) {
  // proteção: o cron do Vercel injeta Authorization: Bearer $CRON_SECRET automaticamente
  const auth = req.headers['authorization'] || '';
  const cronSecret = process.env.CRON_SECRET || process.env.NOTIFY_KEY;
  if (!cronSecret || auth !== 'Bearer ' + cronSecret) {
    return res.status(401).json({ ok: false, error: 'não autorizado' });
  }
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'use GET' });
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
          // busca título do mangá
          try {
            const m = await mdFetch(`${MD}/manga/${mid}`);
            const t = m?.data?.attributes?.title || {};
            seenMangas.set(mid, t['pt-br'] || t['en'] || t['ja-ro'] || Object.values(t)[0] || 'Mangá');
          } catch {
            seenMangas.set(mid, 'Mangá');
          }
          checked++;
        }

        try {
          const ch = await latestChapter(mid);
          if (!ch) continue;
          const state = await notifyState.findOne({ mangaId: mid });
          if (state && state.lastChapter === ch.id) continue; // já avisamos

          const title = seenMangas.get(mid);
          const msg = tgMessage(title, ch);
          const r = await sendTelegram(tgToken, chatId, msg);
          if (r.ok) {
            sent++;
            // registra que avisamos esse capítulo
            await notifyState.updateOne(
              { mangaId: mid },
              { $set: { lastChapter: ch.id, lastAt: new Date().toISOString(), title } },
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
