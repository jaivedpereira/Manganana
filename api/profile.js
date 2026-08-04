// ===== API de perfil do Manganana =====
//   GET  /api/profile?user=ID        → perfil público (bio, banner, stats, listas)
//   PUT  /api/profile                → salva perfil do usuário logado (auth) {bio?, banner?}
//   POST /api/profile/list           → adiciona/remove mangá de lista (auth) {mangaId, list?} (list vazio = remover)
//   GET  /api/profile/mangas?ids=a,b → busca capas de mangás por id (para as listas)

const { createClerkClient, verifyToken } = require('@clerk/backend');
const { MongoClient } = require('mongodb');

const clerk = createClerkClient({
  secretKey: process.env.CLERK_SECRET_KEY,
  publishableKey: process.env.CLERK_PUBLISHABLE_KEY,
});
let mongoPromise = null;

function getMongo() {
  if (!mongoPromise) {
    mongoPromise = new MongoClient(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 15000,
    }).connect();
  }
  return mongoPromise;
}

async function authUserId(req) {
  const header = req.headers['authorization'] || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return null;
  try {
    const payload = await verifyToken(token, {
      secretKey: process.env.CLERK_SECRET_KEY,
      publishableKey: process.env.CLERK_PUBLISHABLE_KEY,
    });
    return payload.sub || null;
  } catch (e) {
    console.error('auth error:', e.message);
    return null;
  }
}

async function userProfile(userId) {
  try {
    const u = await clerk.users.getUser(userId);
    return {
      name: u.fullName || u.firstName || u.username || 'Leitor',
      image: u.imageUrl || '',
    };
  } catch {
    return { name: 'Leitor', image: '' };
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    const client = await getMongo();
    const profiles = client.db('manganana').collection('profiles');
    const users = client.db('manganana').collection('users');

    // GET: perfil público
    if (req.method === 'GET' && req.query.user) {
      const uid = req.query.user;
      const p = await userProfile(uid);
      const prof = await profiles.findOne({ _id: uid });
      const syncDoc = await users.findOne({ _id: uid });
      const data = syncDoc?.data || {};

      // stats
      const favs = Array.isArray(data.favs) ? data.favs : [];
      const history = Array.isArray(data.history) ? data.history : [];
      const readCount = data.readCount || {};
      const pages = Object.values(readCount).reduce((a, b) => a + (Number(b) || 0), 0);
      const lists = data.lists || { lendo: [], vouLer: [], completo: [], dropei: [] };

      // última leitura
      let lastRead = null;
      if (history.length) {
        const last = [...history].sort((a, b) => (b.ts || 0) - (a.ts || 0))[0];
        lastRead = { id: last.id, title: last.title || '', cover: last.cover || '', ts: last.ts || 0 };
      }

      return res.json({
        ok: true,
        user: {
          id: uid,
          name: p.name,
          image: p.image,
          bio: prof?.bio || '',
          banner: prof?.banner || '',
          memberSince: prof?.createdAt || null,
        },
        stats: { favs: favs.length, read: history.length, pages, comments: 0 },
        lists,
        lastRead,
      });
    }

    // GET: capas de mangás por id (para renderizar listas)
    if (req.method === 'GET' && req.query.mangas) {
      const ids = String(req.query.mangas).split(',').filter(Boolean).slice(0, 50);
      // tenta achar no cache global de mangás (se existir)
      const mangas = client.db('manganana').collection('mangas');
      const found = await mangas.find({ _id: { $in: ids } }).toArray();
      return res.json({ ok: true, mangas: found.map((m) => ({ id: m._id, title: m.title, cover: m.cover })) });
    }

    const userId = await authUserId(req);
    if (!userId) {
      return res.status(401).json({ ok: false, error: 'Não autenticado' });
    }

    // PUT: salva bio/banner do perfil
    if (req.method === 'PUT') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      const set = {};
      if (typeof body.bio === 'string') {
        if (body.bio.length > 300) return res.status(413).json({ ok: false, error: 'Bio muito longa (máx 300)' });
        set.bio = body.bio;
      }
      if (typeof body.banner === 'string') {
        if (body.banner.length > 2_500_000) return res.status(413).json({ ok: false, error: 'Banner muito grande (máx 2.5MB)' });
        set.banner = body.banner;
      }
      if (!Object.keys(set).length) return res.status(400).json({ ok: false, error: 'Nada para salvar' });
      set.updatedAt = new Date().toISOString();
      await profiles.updateOne({ _id: userId }, { $set: set, $setOnInsert: { createdAt: new Date().toISOString() } }, { upsert: true });
      return res.json({ ok: true });
    }

    // POST: lista (adicionar/remover mangá da lista do usuário)
    if (req.method === 'POST' && req.query.list) {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      const mangaId = String(body.mangaId || '').trim();
      const listName = String(body.list || '').trim();
      const title = String(body.title || '').trim();
      const cover = String(body.cover || '').trim();
      const validLists = ['lendo', 'vouLer', 'completo', 'dropei'];
      if (!mangaId) return res.status(400).json({ ok: false, error: 'mangaId é obrigatório' });

      const syncDoc = await users.findOne({ _id: userId });
      const data = syncDoc?.data || {};
      const lists = data.lists || { lendo: [], vouLer: [], completo: [], dropei: [] };

      // remove de todas as listas primeiro
      const clean = {};
      validLists.forEach((l) => { clean[l] = (lists[l] || []).filter((m) => m.id !== mangaId); });

      if (listName && validLists.includes(listName)) {
        clean[listName].unshift({ id: mangaId, title, cover, ts: Date.now() });
      }

      const newData = { ...data, lists: clean };
      await users.updateOne({ _id: userId }, { $set: { data: newData, updatedAt: new Date().toISOString() } }, { upsert: true });
      return res.json({ ok: true, lists: clean, inList: !!listName && validLists.includes(listName) });
    }

    return res.status(405).json({ ok: false, error: 'Método não permitido' });
  } catch (e) {
    console.error('profile error:', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
};
