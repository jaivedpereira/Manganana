// ===== API de sincronização do Manganana =====
// Autentica via Clerk (JWT) e sincroniza dados do usuário no MongoDB.
//   GET /api/sync            → retorna os dados salvos do usuário logado
//   PUT /api/sync            → salva/atualiza os dados do usuário logado
//   DELETE /api/sync         → apaga os dados do usuário (logout com limpeza)

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
  // o token vem no header Authorization: Bearer <session token do Clerk>
  const header = req.headers['authorization'] || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return null;
  try {
    // valida o JWT de sessão diretamente (sem depender de cookies de servidor)
    const payload = await verifyToken(token, {
      secretKey: process.env.CLERK_SECRET_KEY,
      publishableKey: process.env.CLERK_PUBLISHABLE_KEY,
    });
    console.log('auth: userId=', payload.sub, '| ok');
    return payload.sub || null;
  } catch (e) {
    console.error('auth error:', e.message);
    return null;
  }
}

module.exports = async function handler(req, res) {
  // CORS (o app roda em manganana.vercel.app)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const userId = await authUserId(req);
  if (!userId) {
    return res.status(401).json({ ok: false, error: 'Não autenticado' });
  }

  try {
    const client = await getMongo();
    const col = client.db('manganana').collection('users');

    if (req.method === 'GET') {
      const doc = await col.findOne({ _id: userId });
      return res.json({
        ok: true,
        data: doc ? (doc.data || {}) : {},
        syncedAt: doc ? (doc.updatedAt || null) : null,
      });
    }

    if (req.method === 'PUT') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      const data = body.data || body; // aceita {data:{...}} ou {...}
      if (typeof data !== 'object' || Array.isArray(data)) {
        return res.status(400).json({ ok: false, error: 'Dados inválidos' });
      }
      // limite de tamanho por segurança (~2MB)
      const size = JSON.stringify(data).length;
      if (size > 2_000_000) {
        return res.status(413).json({ ok: false, error: 'Dados grandes demais' });
      }
      await col.updateOne(
        { _id: userId },
        { $set: { data, updatedAt: new Date().toISOString() } },
        { upsert: true }
      );
      return res.json({ ok: true, syncedAt: new Date().toISOString() });
    }

    if (req.method === 'DELETE') {
      await col.deleteOne({ _id: userId });
      return res.json({ ok: true });
    }

    return res.status(405).json({ ok: false, error: 'Método não permitido' });
  } catch (e) {
    console.error('sync error:', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
};
