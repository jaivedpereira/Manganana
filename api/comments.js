// ===== API de comentários do Manganana =====
//   GET  /api/comments?manga=ID&chapter=ID     → lista comentários (público)
//   POST /api/comments                         → cria comentário (auth)
//   POST /api/comments/reply                   → responde comentário (auth) {parent, text}
//   POST /api/comments/like                    → curtir/descurtir (auth) {id}
//   DELETE /api/comments?id=ID                 → apaga comentário (auth, dono)
//   GET  /api/user?id=ID                       → perfil público de um usuário

const { createClerkClient, verifyToken } = require('@clerk/backend');
const { MongoClient, ObjectId } = require('./db.js');

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
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    const client = await getMongo();
    const col = client.db('manganana').collection('comments');

    // GET /api/user?id=... → perfil público
    if (req.method === 'GET' && req.query.user) {
      const p = await userProfile(req.query.user);
      // stats: nº de comentários do usuário
      const count = await col.countDocuments({ userId: req.query.user });
      return res.json({ ok: true, user: { id: req.query.user, ...p, comments: count } });
    }

    // GET: lista comentários (público, sem auth)
    if (req.method === 'GET') {
      const manga = req.query.manga || '';
      const chapter = req.query.chapter || '';
      if (!manga || !chapter) {
        return res.status(400).json({ ok: false, error: 'manga e chapter são obrigatórios' });
      }
      const docs = await col.find({ manga, chapter })
        .sort({ ts: 1 })
        .limit(100)
        .toArray();
      const out = [];
      for (const d of docs) {
        const p = await userProfile(d.userId);
        out.push({
          id: d._id.toString(),
          text: d.text,
          ts: d.ts,
          likes: d.likes || [],
          user: { id: d.userId, name: p.name, image: p.image },
          replies: d.replies || [],
        });
        // enriquece respostas com nome/foto
        for (const rp of out[out.length - 1].replies) {
          const rpUser = await userProfile(rp.userId);
          rp.user = { id: rp.userId, name: rpUser.name, image: rpUser.image };
        }
      }
      return res.json({ ok: true, comments: out });
    }

    const userId = await authUserId(req);
    if (!userId) {
      return res.status(401).json({ ok: false, error: 'Não autenticado' });
    }

    // POST: cria comentário
    if (req.method === 'POST' && !req.query.reply && !req.query.like) {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      const text = String(body.text || '').trim();
      const manga = String(body.manga || '').trim();
      const chapter = String(body.chapter || '').trim();
      if (!text || !manga || !chapter) {
        return res.status(400).json({ ok: false, error: 'text, manga e chapter são obrigatórios' });
      }
      if (text.length > 500) {
        return res.status(413).json({ ok: false, error: 'Comentário muito longo (máx 500)' });
      }
      const minuteAgo = Date.now() - 60000;
      const recent = await col.countDocuments({ userId, ts: { $gt: minuteAgo } });
      if (recent >= 5) {
        return res.status(429).json({ ok: false, error: 'Muito rápido! Espere um pouco.' });
      }
      const doc = { userId, manga, chapter, text, ts: Date.now(), likes: [], replies: [] };
      const r = await col.insertOne(doc);
      const p = await userProfile(userId);
      return res.json({
        ok: true,
        comment: {
          id: r.insertedId.toString(),
          text, ts: doc.ts, likes: [], replies: [],
          user: { id: userId, name: p.name, image: p.image },
        },
      });
    }

    // POST /api/comments/reply → responde um comentário
    if (req.method === 'POST' && req.query.reply) {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      const text = String(body.text || '').trim();
      const parentId = String(body.parent || '').trim();
      if (!text || !parentId) {
        return res.status(400).json({ ok: false, error: 'text e parent são obrigatórios' });
      }
      if (text.length > 300) {
        return res.status(413).json({ ok: false, error: 'Resposta muito longa (máx 300)' });
      }
      let oid;
      try { oid = new ObjectId(parentId); } catch { return res.status(400).json({ ok: false, error: 'parent inválido' }); }
      const parent = await col.findOne({ _id: oid });
      if (!parent) return res.status(404).json({ ok: false, error: 'Comentário não encontrado' });
      const rp = { userId, text, ts: Date.now() };
      await col.updateOne({ _id: oid }, { $push: { replies: rp } });
      const p = await userProfile(userId);
      rp.user = { id: userId, name: p.name, image: p.image };
      return res.json({ ok: true, reply: rp });
    }

    // POST /api/comments/like → curtir/descurtir
    if (req.method === 'POST' && req.query.like) {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      const id = String(body.id || '').trim();
      if (!id) return res.status(400).json({ ok: false, error: 'id é obrigatório' });
      let oid;
      try { oid = new ObjectId(id); } catch { return res.status(400).json({ ok: false, error: 'id inválido' }); }
      const doc = await col.findOne({ _id: oid });
      if (!doc) return res.status(404).json({ ok: false, error: 'Comentário não encontrado' });
      const likes = doc.likes || [];
      const has = likes.includes(userId);
      await col.updateOne(
        { _id: oid },
        has ? { $pull: { likes: userId } } : { $addToSet: { likes: userId } }
      );
      return res.json({ ok: true, liked: !has, count: has ? likes.length - 1 : likes.length + 1 });
    }

    // DELETE: apaga comentário (só o dono)
    if (req.method === 'DELETE') {
      const id = req.query.id || '';
      if (!id) return res.status(400).json({ ok: false, error: 'id é obrigatório' });
      let oid;
      try { oid = new ObjectId(id); } catch { return res.status(400).json({ ok: false, error: 'id inválido' }); }
      const r = await col.deleteOne({ _id: oid, userId });
      return res.json({ ok: r.deletedCount > 0 });
    }

    return res.status(405).json({ ok: false, error: 'Método não permitido' });
  } catch (e) {
    console.error('comments error:', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
};
